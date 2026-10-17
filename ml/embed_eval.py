"""Pretrained-embedding anomaly detection (PANNs CNN14 + kNN): evaluation and machine enrollment.

Parallel experiment to the autoencoder (ml/train.py); it does not replace it. Run from the repo root.

    # Evaluate on MIMII (<root>/<type>/id_XX/{normal,abnormal}/*.wav) or DCASE 2020 (<root>/{train,test}/*.wav)
    python -m ml.embed_eval evaluate --data /path/to/mimii-6db --types fan --ids id_00
    python -m ml.embed_eval evaluate --data data/dcase2020/dev_data/fan --save-profiles backend/models/emb

    # Enroll one real machine from healthy recordings (e.g. phone recordings of the demo fan)
    python -m ml.embed_eval enroll --wavs recordings/fan_healthy/ --machine fan_01 --out backend/models/fan_01_emb.npz

Protocol (per machine type + id; every split is by SOURCE RECORDING, so overlapping 3 s windows never cross sets):
    test        DCASE: the official test/ folder. MIMII (no official split): all abnormal clips plus the same
                number of randomly chosen normal clips (capped at half the normal clips).
    calibration calib_frac of the remaining healthy clips; threshold = percentile of their kNN distances.
    reference   the rest of the healthy clips (optionally only --ref-clips of them, to mimic short enrollment).
Abnormal clips are used only for the final metrics. The PRIMARY config below is fixed in advance; the grid over
layers/metrics/k is reported as exploratory and must not be used to pick a winner on the same test clips.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import ROOT
from .data import NAME, load_audio, windows
from app.inference.embedding import METRICS, build_profile, knn_distance, prepare, save_profile
from app.profiles import HOP_MS, SAMPLE_RATE_HZ, WINDOW_MS

WINDOW = SAMPLE_RATE_HZ * WINDOW_MS // 1000
PRIMARY = {"layer": "pooled", "metric": "cosine", "k": 1}
LAYERS = ("pooled", "fc1")
DEFAULT_ENCODER = ROOT / "backend" / "models" / "panns" / "Cnn14_16k_mAP=0.438.pth"
REPORTS = Path(__file__).parent / "reports"


@dataclass(frozen=True)
class Item:
    path: Path
    label: str  # normal | anomaly
    machine_type: str
    machine_id: str
    split: str | None  # DCASE "train"/"test"; None for MIMII (no official split)

    @property
    def group(self) -> str:
        return f"{self.machine_type}/{self.machine_id}"


def discover(root: str | Path, types: list[str] | None = None, ids: list[str] | None = None) -> list[Item]:
    out = []
    for p in sorted(Path(root).rglob("*.wav")):
        d = p.parent
        if d.name in ("normal", "abnormal") and re.fullmatch(r"id_\d+", d.parent.name):
            it = Item(p, "normal" if d.name == "normal" else "anomaly", d.parent.parent.name, d.parent.name, None)
        elif d.name in ("train", "test") and (m := NAME.match(p.name)):
            it = Item(p, m.group(1), d.parent.name, m.group(2), d.name)
        else:
            continue
        if (types and it.machine_type not in types) or (ids and it.machine_id not in ids):
            continue
        out.append(it)
    if not out:
        raise FileNotFoundError(f"no MIMII- or DCASE-style wav files under {root} (types={types}, ids={ids})")
    return out


def split_groups(items: list[Item], *, seed: int = 0, calib_frac: float = 0.2,
                 ref_clips: int | None = None) -> dict[str, dict[str, list[Item]]]:
    rng = np.random.default_rng(seed)
    by_group: dict[str, list[Item]] = {}
    for it in items:
        by_group.setdefault(it.group, []).append(it)
    out = {}
    for g, its in sorted(by_group.items()):
        shuffle = lambda xs: [xs[j] for j in rng.permutation(len(xs))]  # noqa: E731
        if any(i.split for i in its):
            test = [i for i in its if i.split == "test"]
            normal = shuffle([i for i in its if i.split == "train" and i.label == "normal"])
        else:
            normal = shuffle([i for i in its if i.label == "normal"])
            anomalies = [i for i in its if i.label == "anomaly"]
            n_test = min(len(anomalies), len(normal) // 2)
            test, normal = normal[:n_test] + anomalies, normal[n_test:]
        if len(normal) < 2:
            raise ValueError(f"{g}: need at least 2 healthy clips for reference + calibration")
        n_cal = min(len(normal) - 1, max(1, round(len(normal) * calib_frac)))
        calibration, reference = normal[:n_cal], normal[n_cal:]
        if ref_clips:
            reference = reference[:ref_clips]
        sets = {"reference": reference, "calibration": calibration, "test": test}
        paths = [{i.path for i in s} for s in sets.values()]
        assert not (paths[0] & paths[1] or paths[0] & paths[2] or paths[1] & paths[2]), f"{g}: split overlap"
        out[g] = sets
    return out


def clip_windows(x: np.ndarray) -> np.ndarray:
    """(W, 3 s) windows at the production 1 s hop; a clip shorter than 3 s is zero-padded to one window."""
    ws = windows(x)
    return np.stack([np.pad(w, (0, WINDOW - w.size)) if w.size < WINDOW else w for w in ws]).astype(np.float32)


def embed_items(embedder, items: list[Item], cache_dir: Path | None, batch: int = 64) -> dict[Path, dict]:
    """Embeddings of every window of every clip, {path: {layer: (W, D)}}; cached per encoder + file."""
    out: dict[Path, dict] = {}
    cache = Path(cache_dir) / embedder.sha256[:12] if cache_dir else None
    if cache:
        cache.mkdir(parents=True, exist_ok=True)

    def key(p: Path) -> Path:
        st = p.stat()
        return cache / (hashlib.sha1(f"{p.resolve()}|{st.st_size}|{st.st_mtime_ns}".encode()).hexdigest() + ".npz")

    todo = []
    for it in items:
        if it.path in out:
            continue
        if cache and key(it.path).exists():
            with np.load(key(it.path)) as z:
                out[it.path] = {k: z[k] for k in z.files}
        else:
            todo.append(it.path)

    pending: list[tuple[Path, np.ndarray]] = []

    def flush():
        if not pending:
            return
        embs = embedder.embed_batch(np.concatenate([w for _, w in pending]))
        i = 0
        for p, w in pending:
            out[p] = {layer: e[i : i + len(w)] for layer, e in embs.items()}
            if cache:
                np.savez(key(p), **out[p])
            i += len(w)
        pending.clear()

    t0 = time.perf_counter()
    for n, p in enumerate(todo, 1):
        pending.append((p, clip_windows(load_audio(p))))
        if sum(len(w) for _, w in pending) >= batch:
            flush()
        if n % 200 == 0:
            print(f"  embedded {n}/{len(todo)} clips ({time.perf_counter() - t0:.0f}s)", flush=True)
    flush()
    return out


def metrics(rows: list[dict], thr: float) -> dict:
    """Same metrics as ml/evaluate.py, from per-clip rows {"y", "clip", "windows"}."""
    from sklearn.metrics import roc_auc_score

    from .evaluate import simulate_alerts

    y, s = [r["y"] for r in rows], [r["clip"] for r in rows]
    both = 0 < sum(y) < len(y)
    norm_w = [w for r in rows if not r["y"] for w in r["windows"]]
    anom_w = [w for r in rows if r["y"] for w in r["windows"]]
    normal_hours = len(norm_w) * HOP_MS / 1000 / 3600
    anomalous = [r for r in rows if r["y"]]
    return {
        "clips": {"normal": len(y) - sum(y), "anomaly": sum(y)},
        "roc_auc": float(roc_auc_score(y, s)) if both else None,
        "pauc_0.1": float(roc_auc_score(y, s, max_fpr=0.1)) if both else None,
        "window_tpr_at_threshold": float(np.mean(np.array(anom_w) > thr)) if anom_w else None,
        "window_fpr_at_threshold": float(np.mean(np.array(norm_w) > thr)) if norm_w else None,
        "false_alerts_per_hour": (simulate_alerts([r["windows"] for r in rows if not r["y"]], thr) / normal_hours
                                  if normal_hours else None),
        "anomalous_clips_alerted": (sum(simulate_alerts([r["windows"]], thr) > 0 for r in anomalous) / len(anomalous)
                                    if anomalous else None),
    }


def evaluate_group(sets: dict[str, list[Item]], emb: dict[Path, dict], *, layer: str, metric: str, k: int,
                   percentile: float, meta: dict | None = None):
    stack = lambda items: np.concatenate([emb[i.path][layer] for i in items])  # noqa: E731
    profile = build_profile(stack(sets["reference"]), stack(sets["calibration"]), metric=metric, k=k, layer=layer,
                            percentile=percentile, meta=meta or {})
    rows = []
    for it in sets["test"]:
        ws = knn_distance(profile.bank, prepare(emb[it.path][layer], metric), k, metric)
        rows.append({"y": int(it.label == "anomaly"), "clip": float(ws.mean()), "windows": ws.tolist()})
    m = metrics(rows, profile.threshold)
    m.update(threshold=profile.threshold, calibration=profile.meta["calibration"],
             reference_windows=int(len(profile.bank)))
    return m, profile


def mean_or_none(xs):
    xs = [x for x in xs if x is not None]
    return float(np.mean(xs)) if xs else None


def ensure_encoder(path: Path) -> Path:
    if not path.exists():
        from app.inference.panns import CHECKPOINT_URL

        path.parent.mkdir(parents=True, exist_ok=True)
        print(f"downloading PANNs CNN14 16 kHz weights (~360 MB) → {path}", flush=True)
        urllib.request.urlretrieve(CHECKPOINT_URL, path)
    return path


def latency(embedder, sample: np.ndarray, bank: np.ndarray, metric: str, k: int, runs: int = 30) -> dict:
    one = sample[None, :]
    for _ in range(3):
        embedder.embed_batch(one)  # warm-up (kernel compilation, caches)
    times = []
    for _ in range(runs):
        t0 = time.perf_counter()
        e = embedder.embed_batch(one)[PRIMARY["layer"]]
        knn_distance(bank, prepare(e, metric), k, metric)
        times.append((time.perf_counter() - t0) * 1000)
    return {"mean": float(np.mean(times)), "p95": float(np.percentile(times, 95)), "reference_windows": int(len(bank)),
            "includes": "CNN14 forward on one 3 s window + kNN search (batch 1)"}


def to_markdown(r: dict) -> str:
    f = lambda v, d=3: "n/a" if v is None else f"{v:.{d}f}"  # noqa: E731
    p = r["primary"]
    lines = [f"# Embedding evaluation {r['stamp']}", "",
             f"Encoder: {r['encoder']['name']} (frozen, pretrained on AudioSet; sha256 {r['encoder']['sha256'][:12]}…). "
             f"Device: {r['device']['device']}. Data: `{r['data']}`.", "",
             f"## Primary config (fixed before testing): layer={p['layer']}, metric={p['metric']}, k={p['k']}, "
             f"threshold = {r['percentile']}th pct of calibration windows", "",
             "| Machine | Ref / cal / test clips | ROC AUC | pAUC (0.1) | Window TPR | Window FPR (test normal) | False alerts/h | Anomalous clips alerted |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for g, gr in r["groups"].items():
        m, c = gr["primary"], gr["clips"]
        lines.append(f"| {g} | {c['reference']} / {c['calibration']} / {c['test']} | {f(m['roc_auc'])} | {f(m['pauc_0.1'])} | "
                     f"{f(m['window_tpr_at_threshold'])} | {f(m['window_fpr_at_threshold'])} | "
                     f"{f(m['false_alerts_per_hour'], 2)} | {f(m['anomalous_clips_alerted'])} |")
    for t, a in r["aggregate"].items():
        lines.append(f"| **{t} (mean over ids)** | | {f(a['roc_auc'])} | {f(a['pauc_0.1'])} | | | | |")
    configs = list(next(iter(r["groups"].values()))["grid"])
    lines += ["", "## Exploratory grid: ROC AUC (do not pick a winner from this on the same test clips)", "",
              "| Machine | " + " | ".join(configs) + " |", "| --- |" + " --- |" * len(configs)]
    for g, gr in r["groups"].items():
        lines.append(f"| {g} | " + " | ".join(f(gr["grid"][c]["roc_auc"]) for c in configs) + " |")
    lat = r["latency_ms_per_window"]
    lines += ["", f"Latency per window: mean {f(lat['mean'], 1)} ms, p95 {f(lat['p95'], 1)} ms ({lat['includes']}; "
              f"{lat['reference_windows']} reference windows).", "",
              "Notes: thresholds come from healthy calibration clips only; a 99th-percentile threshold does not guarantee "
              "1% false alarms in live monitoring (overlapping windows are correlated, rooms differ from the dataset).", ""]
    return "\n".join(lines)


def cmd_evaluate(a) -> dict:
    from app.inference.model import device_info
    from app.inference.panns import FRONTEND, PannsEmbedder

    items = discover(a.data, a.types, a.ids)
    groups = split_groups(items, seed=a.seed, calib_frac=a.calib_frac, ref_clips=a.ref_clips)
    embedder = PannsEmbedder(ensure_encoder(Path(a.encoder)))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    print(f"device: {device_info()} | groups: {', '.join(groups)}", flush=True)

    result = {"stamp": stamp, "data": str(a.data), "seed": a.seed, "percentile": a.percentile, "primary": PRIMARY,
              "encoder": {"name": embedder.name, "sha256": embedder.sha256, "frontend": FRONTEND},
              "device": device_info(), "groups": {}, "splits": {}}
    lat = None
    for g, sets in groups.items():
        print(f"== {g}: {', '.join(f'{k} {len(v)}' for k, v in sets.items())} clips", flush=True)
        emb = embed_items(embedder, [i for s in sets.values() for i in s], a.cache, a.batch)
        meta = {"version": f"{embedder.name}-{PRIMARY['layer']}-{PRIMARY['metric']}-k{PRIMARY['k']}-"
                           f"{g.replace('/', '-')}-{stamp}",
                "encoder": embedder.name, "encoder_sha256": embedder.sha256, "machine": g, "data": str(a.data),
                "reference_clips": len(sets["reference"]), "calibration_clips": len(sets["calibration"]),
                "window_ms": WINDOW_MS, "hop_ms": HOP_MS, "sample_rate_hz": SAMPLE_RATE_HZ, "created_at": stamp}
        grid = {}
        for layer in LAYERS:
            for metric in METRICS:
                for k in sorted(set(a.k) | {PRIMARY["k"]}):
                    m, profile = evaluate_group(sets, emb, layer=layer, metric=metric, k=k, percentile=a.percentile,
                                                meta=meta)
                    grid[f"{layer}/{metric}/k{k}"] = m
                    if {"layer": layer, "metric": metric, "k": k} == PRIMARY:
                        primary, primary_profile = m, profile
        result["groups"][g] = {"clips": {k: len(v) for k, v in sets.items()}, "primary": primary, "grid": grid}
        result["splits"][g] = {k: [str(i.path) for i in v] for k, v in sets.items()}
        print(f"   primary AUROC {primary['roc_auc']}", flush=True)
        if a.save_profiles:
            out = Path(a.save_profiles) / f"{g.replace('/', '_')}_emb.npz"
            save_profile(out, primary_profile)
            print(f"   saved profile {out}", flush=True)
        if lat is None:
            sample = clip_windows(load_audio(sets["test"][0].path))[0]
            lat = latency(embedder, sample, primary_profile.bank, PRIMARY["metric"], PRIMARY["k"])

    by_type: dict[str, list[dict]] = {}
    for g, gr in result["groups"].items():
        by_type.setdefault(g.split("/")[0], []).append(gr["primary"])
    by_type["all"] = [gr["primary"] for gr in result["groups"].values()]
    result["aggregate"] = {t: {"roc_auc": mean_or_none([m["roc_auc"] for m in ms]),
                               "pauc_0.1": mean_or_none([m["pauc_0.1"] for m in ms]), "ids": len(ms)}
                           for t, ms in by_type.items()}
    result["latency_ms_per_window"] = lat

    REPORTS.mkdir(parents=True, exist_ok=True)
    splits = result.pop("splits")
    (REPORTS / f"embed-eval-{stamp}.json").write_text(json.dumps(result, indent=2))
    (REPORTS / f"embed-splits-{stamp}.json").write_text(json.dumps(splits, indent=2))
    md = to_markdown(result)
    (REPORTS / f"embed-eval-{stamp}.md").write_text(md, encoding="utf-8")
    print(md)
    return result


def segments(x: np.ndarray, seconds: float) -> list[np.ndarray]:
    n = int(seconds * SAMPLE_RATE_HZ)
    return [x[i : i + n] for i in range(0, x.size - WINDOW + 1, n)]


def cmd_enroll(a) -> Path:
    from app.inference.panns import PannsEmbedder

    files = [p for w in a.wavs for p in (sorted(Path(w).rglob("*.wav")) if Path(w).is_dir() else [Path(w)])]
    # Chop recordings into non-overlapping segments; reference/calibration are split by SEGMENT so no 3 s window
    # appears (even partially) in both.
    segs = [s for f in files for s in segments(load_audio(f), a.segment_s)]
    total_s = sum(s.size for s in segs) / SAMPLE_RATE_HZ
    if len(segs) < 2:
        raise SystemExit(f"need at least 2 x {a.segment_s:.0f} s of healthy audio, got {total_s:.0f} s")
    if total_s < 60:
        print(f"warning: only {total_s:.0f} s of healthy audio; enroll with a few minutes covering normal variation")
    order = np.random.default_rng(a.seed).permutation(len(segs))
    n_cal = min(len(segs) - 1, max(1, round(len(segs) * a.calib_frac)))
    cal, ref = [segs[j] for j in order[:n_cal]], [segs[j] for j in order[n_cal:]]

    embedder = PannsEmbedder(ensure_encoder(Path(a.encoder)))
    emb = lambda ss: embedder.embed_batch(np.concatenate([clip_windows(s) for s in ss]))[a.layer]  # noqa: E731
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    meta = {"version": f"{embedder.name}-{a.layer}-{a.metric}-k{a.k}-{a.machine}-{stamp}", "encoder": embedder.name,
            "encoder_sha256": embedder.sha256, "machine": a.machine, "sources": [str(f) for f in files],
            "healthy_seconds": round(total_s, 1), "reference_segments": len(ref), "calibration_segments": len(cal),
            "window_ms": WINDOW_MS, "hop_ms": HOP_MS, "sample_rate_hz": SAMPLE_RATE_HZ, "created_at": stamp}
    profile = build_profile(emb(ref), emb(cal), metric=a.metric, k=a.k, layer=a.layer, percentile=a.percentile, meta=meta)
    save_profile(a.out, profile)
    print(f"saved {a.out}: {len(profile.bank)} reference windows, threshold {profile.threshold:.4f} "
          f"({profile.meta['calibration']['windows']} calibration windows); version {profile.version}")
    return Path(a.out)


def main(argv: list[str] | None = None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--encoder", default=str(DEFAULT_ENCODER), help="PANNs Cnn14_16k checkpoint (downloaded if missing)")
    common.add_argument("--percentile", type=float, default=99.0, help="threshold percentile of calibration windows")
    common.add_argument("--calib-frac", type=float, default=0.2)
    common.add_argument("--seed", type=int, default=0)

    e = sub.add_parser("evaluate", parents=[common])
    e.add_argument("--data", required=True, help="MIMII or DCASE 2020 root")
    e.add_argument("--types", nargs="*", help="machine types, e.g. fan pump (default: all found)")
    e.add_argument("--ids", nargs="*", help="machine ids, e.g. id_00 id_02 (default: all found)")
    e.add_argument("--ref-clips", type=int, help="use only N reference clips (simulates a short enrollment)")
    e.add_argument("--k", type=int, nargs="+", default=[1, 5])
    e.add_argument("--batch", type=int, default=64, help="windows per encoder batch")
    e.add_argument("--cache", default=str(ROOT / "data" / "embed-cache"), help="embedding cache dir ('' to disable)")
    e.add_argument("--save-profiles", help="dir to save one primary-config profile per machine id")

    n = sub.add_parser("enroll", parents=[common])
    n.add_argument("--wavs", nargs="+", required=True, help="healthy recordings (files or folders)")
    n.add_argument("--machine", required=True, help="profile id, e.g. fan_01")
    n.add_argument("--out", required=True)
    n.add_argument("--segment-s", type=float, default=10.0)
    n.add_argument("--layer", choices=LAYERS, default=PRIMARY["layer"])
    n.add_argument("--metric", choices=METRICS, default=PRIMARY["metric"])
    n.add_argument("--k", type=int, default=PRIMARY["k"])

    a = p.parse_args(argv)
    if a.cmd == "evaluate":
        a.cache = a.cache or None
        return cmd_evaluate(a)
    return cmd_enroll(a)


if __name__ == "__main__":
    main()
