"""The real demo fan: phone recordings → DCASE-style clips → train/calibrate/evaluate → continuous-stream alert test.

Record with the phone exactly where it will sit in the demo. Put the files (any format ffmpeg reads: m4a, mp3, wav…)
in folders named by role. Each role must be a SEPARATE recording session (stop, wait, start again later) so that no
two roles share a session:

    recordings/train_healthy/        session 1, healthy (≈10 min; every speed setting the demo will use) → training
    recordings/calib_healthy/        session 2, healthy (≥5 min) → sets the alert threshold (`calibrate`)
    recordings/test_healthy/         session 3, healthy  ┐ DEVELOPMENT: look at these as often as needed while tuning
    recordings/fault_<name>/         e.g. fault_paper    ┘ (thresholds, smoothing, model choice)
    recordings/final_healthy/        session 4, healthy  ┐ FINAL: evaluated once with the frozen configuration;
    recordings/final_fault_<name>/   same faults again   ┘ never used to choose anything
    recordings/noise_speech/         optional: people talking, recorded WITHOUT the fan running (same phone position)
    recordings/noise_impact/         optional: claps, a dropped tool, a door, recorded WITHOUT the fan running

Then, from the repo root:

    python -m ml.demo_fan prepare --recordings recordings --out data/demo_fan_v1        # NEW folder per version
    python -m ml.train --data data/demo_fan_v1 --arch dense --out backend/models/demo_fan_dense.pt
    python -m ml.demo_fan calibrate --data data/demo_fan_v1 backend/models/demo_fan_dense.pt \\
        --out backend/models/demo_fan_dense_cal.pt
    python -m ml.evaluate --data data/demo_fan_v1 backend/models/demo_fan_dense_cal.pt    # dev clip AUROC etc.
    python -m ml.demo_fan stream --data data/demo_fan_v1 backend/models/demo_fan_dense_cal.pt [--interference]
    python -m ml.demo_fan stream --data data/demo_fan_v1 backend/models/demo_fan_dense_cal.pt --phase final   # once

`prepare` never overwrites or deletes anything: it refuses a non-empty --out. Calibration and stream recordings are
kept at their native sample rate (the rate a browser listener would send; rates the API does not accept are converted
to 48 kHz), and `stream`/`calibrate` cut them into 3 s windows every 1 s, encode each window as 16-bit WAV and pass it
through the API's own decoder (app.audio.wav.decode_window): same downmix, same silence/clipping gate BEFORE
resampling, same resampler. Then the serving scorer and the production 3-of-5 alert policy, with state kept within
a recording and reset between recordings.

Healthy groups report false alerts per hour with an approximate one-sided 95 % upper bound (Poisson assumption; alerts
from one policy are not independent events, so treat it as indicative). Short tests cannot show a low rate: 0 alerts
in 5 min gives a bound of about 36/h. Fault groups report whether and how fast an alert fires.

If noise_* folders exist, every dev/final recording also gets digitally mixed variants ("test_healthy+speech",
"fault_paper+speech", ...): 6 s noise bursts every 20 s. With --interference the replay also runs the speech/impact
flags (backend INTERFERENCE=flag) exactly as the API does, and reports flagged windows and alerts whose counted windows
include a flagged one. Flags never change the alert decision.

Every `--phase final` run is appended to <reports>/final_runs.json, keyed by a hash of the final source recordings,
so the history survives re-preparing the dataset; from the second look on, a warning is printed.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import platform
import shutil
import subprocess
import tempfile
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from math import gcd
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly
from scipy.stats import chi2

from app.audio.wav import CLIP_LEVEL, decode_window
from app.profiles import ACCEPTED_INPUT_RATES, ALERT_POLICY, HOP_MS, SAMPLE_RATE_HZ, WINDOW_MS

CLIP_S = 10
BURST_EVERY_S, BURST_S, BURST_OFFSET_S = 20, 6, 5
FALLBACK_RATE = 48_000
AUDIO = {".wav", ".m4a", ".mp3", ".aac", ".ogg", ".flac", ".webm", ".3gp", ".amr", ".opus", ".mp4"}
REPORTS = Path(__file__).parent / "reports"
FINAL_LOG = "final_runs.json"


# --- audio I/O ------------------------------------------------------------------------------------
def resample(x: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst:
        return x
    g = gcd(src, dst)
    return resample_poly(x, dst // g, src // g).astype(np.float32)


def _read_wav(path: Path) -> tuple[int, np.ndarray]:
    rate, x = wavfile.read(path)
    scale = {np.dtype(np.int16): 32768.0, np.dtype(np.int32): 2147483648.0}.get(x.dtype, 1.0)
    if x.dtype == np.uint8:
        x, scale = x.astype(np.float32) - 128, 128.0
    x = x.astype(np.float32) / scale
    if x.ndim > 1:
        x = x.mean(axis=1)  # the API's documented downmix: channel mean
    return rate, x


def read_native(path: Path) -> tuple[int, np.ndarray]:
    """(rate, mono float32) at the recording's own rate (converted to 48 kHz only if the API would reject it)."""
    if path.suffix.lower() == ".wav":
        rate, x = _read_wav(path)
    else:
        if not shutil.which("ffmpeg"):
            raise SystemExit(f"{path.name}: install ffmpeg or export the recording as WAV")
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "x.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(path), "-ac", "1", "-c:a", "pcm_s16le", str(out)],
                           check=True)
            rate, x = _read_wav(out)
    if rate not in ACCEPTED_INPUT_RATES:
        x, rate = resample(x, rate, FALLBACK_RATE), FALLBACK_RATE
    return rate, x


def to_int16(x: np.ndarray) -> np.ndarray:
    """Same scaling the API decodes with (/32768), so a WAV round trip is lossless."""
    return np.clip(np.round(x * 32768.0), -32768, 32767).astype(np.int16)


def write_wav(path: Path, x: np.ndarray, rate: int = SAMPLE_RATE_HZ) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(path, rate, to_int16(x))


def window_bytes(x: np.ndarray, rate: int) -> bytes:
    buf = io.BytesIO()
    wavfile.write(buf, rate, to_int16(x))
    return buf.getvalue()


def production_windows(x: np.ndarray, rate: int):
    """3 s windows every 1 s, each decoded exactly as an upload: yields (index, app.audio.wav.Window)."""
    n, hop = rate * WINDOW_MS // 1000, rate * HOP_MS // 1000
    for i, start in enumerate(range(0, x.size - n + 1, hop)):
        yield i, decode_window(window_bytes(x[start : start + n], rate))


def sha256(path: str | Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


# --- prepare --------------------------------------------------------------------------------------
def role(folder: str) -> tuple[str, str] | None:
    """(phase, label) for a recordings sub-folder, or None to ignore it.

    phase: train (training clips) · calib (threshold) · dev (tuning) · final (held out) · noise (mixing only)."""
    if folder == "train_healthy":
        return "train", "normal"
    if folder == "calib_healthy":
        return "calib", "normal"
    if folder == "test_healthy":
        return "dev", "normal"
    if folder == "final_healthy":
        return "final", "normal"
    if folder.startswith("final_fault_"):
        return "final", "anomaly"
    if folder.startswith("fault_"):
        return "dev", "anomaly"
    if folder.startswith("noise_"):
        return "noise", "noise"
    return None


def mix_bursts(base: np.ndarray, noise: np.ndarray, rate: int = SAMPLE_RATE_HZ) -> tuple[np.ndarray, list[list[float]]]:
    """Overlay noise in 6 s bursts every 20 s (noise looped as needed); returns the mix and burst intervals (s).

    Loud mixes can clip; that is kept (a real phone clips too) and the API decoder then marks those windows
    "unable to assess"."""
    out, spans, pos = base.copy(), [], 0
    for start in range(BURST_OFFSET_S * rate, base.size, BURST_EVERY_S * rate):
        n = min(BURST_S * rate, base.size - start)
        idx = (pos + np.arange(n)) % noise.size
        out[start : start + n] += noise[idx]
        pos = int(idx[-1]) + 1
        spans.append([start / rate, (start + n) / rate])
    return np.clip(out, -1, 1).astype(np.float32), spans


def check_output(recordings: Path, out: Path) -> None:
    """Write only into a new or empty folder that is neither the recordings nor inside/around them. Never deletes."""
    rec, dst = recordings.resolve(), out.resolve()
    if dst == rec or rec in dst.parents or dst in rec.parents:
        raise SystemExit(f"--out {out} overlaps the recordings folder {recordings}; choose a separate folder")
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} is not empty; prepare into a NEW folder (e.g. data/demo_fan_v2). Nothing was changed.")


def prepare(recordings: Path, out: Path, machine_id: str = "id_00") -> dict:
    check_output(recordings, out)
    out.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"prepared_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                      "recordings": str(recordings), "clips": {}, "streams": []}
    noises: dict[str, list[tuple[int, np.ndarray]]] = {}
    counters = {"normal": 0, "anomaly": 0}
    for folder in sorted(p for p in recordings.iterdir() if p.is_dir()):
        r = role(folder.name)
        if r is None:
            print(f"skipping {folder.name}/ (see `python -m ml.demo_fan -h` for folder names)")
            continue
        phase, label = r
        for f in sorted(p for p in folder.iterdir() if p.suffix.lower() in AUDIO):
            rate, x = read_native(f)
            seconds = x.size / rate
            print(f"{folder.name}/{f.name}: {seconds:.0f} s at {rate} Hz")
            if phase == "noise":
                noises.setdefault(folder.name.removeprefix("noise_"), []).append((rate, x))
                continue
            if phase != "train":  # continuous recording at its native rate, for calibration / the stream test
                stream = out / "streams" / folder.name / (f.stem + ".wav")
                write_wav(stream, x, rate)
                manifest["streams"].append({"path": stream.relative_to(out).as_posix(), "group": folder.name,
                                            "phase": phase, "label": label, "seconds": round(seconds, 1),
                                            "rate": rate, "source": str(f), "source_sha256": sha256(f)})
            if phase in ("train", "dev"):  # final/calib audio never enters train/ or test/ (ml.evaluate reads test/)
                x16, n = resample(x, rate, SAMPLE_RATE_HZ), CLIP_S * SAMPLE_RATE_HZ
                split = "train" if phase == "train" else "test"
                for i in range(0, x16.size - WINDOW_MS * SAMPLE_RATE_HZ // 1000 + 1, n):  # non-overlapping 10 s clips
                    name = f"{label}_{machine_id}_{counters[label]:08d}.wav"
                    write_wav(out / split / name, x16[i : i + n])
                    manifest["clips"][f"{split}/{name}"] = {"source": str(f), "group": folder.name,
                                                            "offset_s": i // SAMPLE_RATE_HZ}
                    counters[label] += 1
    for base in [s for s in manifest["streams"] if s["phase"] in ("dev", "final")]:  # mixed interference variants
        rate, raw = _read_wav(out / base["path"])
        for kind, parts in noises.items():
            noise = np.concatenate([resample(x, r, rate) for r, x in parts])
            x, spans = mix_bursts(raw, noise, rate)
            group = f"{base['group']}+{kind}"
            stream = out / "streams" / group / Path(base["path"]).name
            write_wav(stream, x, rate)
            manifest["streams"].append({**base, "path": stream.relative_to(out).as_posix(), "group": group,
                                        "mixed": kind, "noise_bursts_s": spans,
                                        "clipped_fraction": round(float(np.mean(np.abs(x) >= CLIP_LEVEL)), 5)})
    for split in ("train", "test"):
        if not (out / split).exists():
            raise SystemExit(f"no {split} clips: need train_healthy/ and test_healthy/ + fault_*/ recordings")
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    train_s = sum(1 for k in manifest["clips"] if k.startswith("train/")) * CLIP_S
    phases = {p: sum(1 for s in manifest["streams"] if s["phase"] == p and "mixed" not in s) for p in ("calib", "dev", "final")}
    print(f"wrote {out}: {train_s / 60:.1f} min of training clips; recordings per phase {phases}")
    if train_s < 300:
        print("warning: under 5 min of healthy training audio; record more covering every speed setting")
    if not phases["calib"]:
        print("note: no calib_healthy/; the threshold stays the training-session one (same-session, optimistic)")
    if not phases["final"]:
        print("note: no final_* recordings; every result on this data is development data, not a held-out test")
    return manifest


# --- replay, calibrate, stream --------------------------------------------------------------------
def replay(scorer, x: np.ndarray, rate: int, new_aggregator, interference=None) -> dict:
    """One continuous recording through the API decoder, the scorer, (optionally) the interference flags and a fresh
    alert aggregator, mirroring routers/api.py: flags are recorded by window identity and an alert counts as
    "with flag" if any window the policy counted for it was flagged."""
    from app.inference.interference import remember, summarize

    agg, state, istate, history = new_aggregator(), {}, {}, OrderedDict()
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    scores, flagged, alerts, alerts_with_flag, first_alert_s, unassessable = [], [], 0, 0, None, 0
    for i, w in production_windows(x, rate):
        end_s = (i * HOP_MS + WINDOW_MS) / 1000  # audio heard so far when this window is scored
        window_id = (t0 + timedelta(seconds=end_s)).isoformat()
        ok = w.quality == "ok"
        s = scorer.score(w.samples, state) if ok else None
        valid = s is not None and s.value is not None
        unassessable += not ok
        if interference is not None and ok:  # the API only flags assessable windows
            info, istate = interference.analyze(w.samples, istate, i * HOP_MS / 1000)
            remember(history, window_id, info)
            if info.get("checked"):
                flagged.append(bool(info["flags"]))
        d = agg.observe(valid=valid, is_anomaly=valid and s.value > s.threshold, score=s.value if valid else None,
                        threshold=scorer.threshold, recorded_at=window_id, session_id="replay", machine_id="demo")
        if valid:
            scores.append(s.value)
        if d.triggered:
            alerts += 1
            first_alert_s = end_s if first_alert_s is None else first_alert_s
            if interference is not None:
                alerts_with_flag += summarize(history, agg.recent_window_ids())["recent_windows_flagged"] > 0
    out = {"windows": len(scores), "unassessable_windows": unassessable, "alerts": alerts, "first_alert_s": first_alert_s,
           "window_over_threshold": float(np.mean(np.array(scores) > scorer.threshold)) if scores else None,
           "score_median": float(np.median(scores)) if scores else None}
    if interference is not None:
        out.update(windows_flagged=float(np.mean(flagged)) if flagged else None, alerts_with_flag=alerts_with_flag)
    return out


def rate_upper95(events: int, hours: float) -> float | None:
    """Approximate one-sided 95 % upper bound on events per hour under a Poisson assumption (0 events → ≈3/hours).

    Alerts from the 3-of-5 policy (with cooldown) are not independent, so this is indicative, not a guarantee."""
    return float(chi2.ppf(0.95, 2 * (events + 1)) / 2 / hours) if hours else None


def group_summary(rs: list[dict], with_flags: bool) -> dict:
    firsts = [r["first_alert_s"] for r in rs if r["first_alert_s"] is not None]
    hours = sum(r["windows"] for r in rs) * HOP_MS / 1000 / 3600  # assessed audio only
    alerts = sum(r["alerts"] for r in rs)
    over = [r["window_over_threshold"] for r in rs if r["window_over_threshold"] is not None]
    g = {"recordings": len(rs), "assessed_seconds": round(hours * 3600),
         "unassessable_windows": sum(r["unassessable_windows"] for r in rs), "alerts": alerts,
         "alerts_per_hour": alerts / hours if hours else None,
         "alerts_per_hour_upper95_approx": rate_upper95(alerts, hours),
         "recordings_alerted": len(firsts),
         "median_time_to_alert_s": float(np.median(firsts)) if firsts else None,
         "window_over_threshold": float(np.mean(over)) if over else None}
    if with_flags:
        g["windows_flagged"] = float(np.mean([r["windows_flagged"] for r in rs if r["windows_flagged"] is not None] or [0]))
        g["alerts_with_flag"] = sum(r["alerts_with_flag"] for r in rs)
    return g


def load_scorer(checkpoint: str):
    from app.inference.autoencoder import AutoencoderScorer

    scorer = AutoencoderScorer(checkpoint)
    if not scorer.ready:
        raise SystemExit(f"cannot load {checkpoint}: {scorer.load_error}")
    return scorer


def run_info(checkpoint: str, scorer) -> dict:
    """What produced these numbers: scorer, exact checkpoint, threshold source and hardware."""
    import torch

    ckpt = torch.load(checkpoint, map_location="cpu", weights_only=True)
    dev = str(scorer.device)
    gpu = torch.cuda.get_device_name(0) if dev.startswith("cuda") else None
    return {"scorer": "autoencoder", "model_version": scorer.version, "checkpoint": str(checkpoint),
            "checkpoint_sha256": sha256(checkpoint), "threshold": scorer.threshold,
            "threshold_source": ckpt.get("threshold_source", "training session: held-out normal windows (ml.train)"),
            "device": dev, "gpu": gpu, "rocm": getattr(torch.version, "hip", None), "torch": torch.__version__,
            "host": platform.node(), "platform": platform.platform()}


def calibrate(data: Path, checkpoint: str, out: str, percentile: float = 99.0) -> float:
    """Re-set the threshold from a SEPARATE healthy session (calib_healthy/): the training session's own held-out
    windows share its exact conditions and give an optimistic (too low) threshold for another day."""
    import torch

    manifest = json.loads((data / "manifest.json").read_text())
    calib = [s for s in manifest["streams"] if s["phase"] == "calib"]
    if not calib:
        raise SystemExit("no calib_healthy/ recordings in this dataset")
    scorer = load_scorer(checkpoint)
    scores = []
    for s in calib:
        rate, x = _read_wav(data / s["path"])
        scores += [scorer.score(w.samples, {}).value for _, w in production_windows(x, rate) if w.quality == "ok"]
    if not scores:
        raise SystemExit("no assessable calib windows (all silent or clipping)")
    threshold = float(np.percentile(scores, percentile))
    ckpt = torch.load(checkpoint, map_location="cpu", weights_only=True)
    previous = float(ckpt["threshold"])
    ckpt.update(threshold=threshold, version=f"{ckpt['version']}-cal",
                threshold_source=f"{percentile}th percentile of {len(scores)} windows from calib_healthy/ "
                                 f"({len(calib)} recording(s)); training-session threshold was {previous:.4f}")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    torch.save(ckpt, out)
    print(f"threshold {previous:.4f} → {threshold:.4f} from {len(scores)} calib windows; saved {out}")
    if len(scores) < 300:
        print("note: under 300 calib windows (5 min); the 99th percentile rests on very few windows")
    return threshold


def final_set_id(streams: list[dict]) -> str:
    """Identity of the held-out set = its source recordings' content, so re-preparing does not reset the history."""
    return hashlib.sha256("".join(sorted(s["source_sha256"] for s in streams if "mixed" not in s)).encode()).hexdigest()


def log_final_run(report_dir: Path, set_id: str, data: Path, info: dict) -> int:
    """Append to <report_dir>/final_runs.json; returns how many earlier runs used this same final set."""
    path = report_dir / FINAL_LOG
    runs = json.loads(path.read_text()) if path.exists() else []
    before = sum(r["final_set"] == set_id for r in runs)
    runs.append({"at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "final_set": set_id,
                 "dataset": str(data), "model_version": info["model_version"],
                 "checkpoint_sha256": info["checkpoint_sha256"]})
    report_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(runs, indent=2))
    return before


def stream(data: Path, checkpoint: str, use_interference: bool = False, phase: str = "dev",
           report_dir: Path | None = None) -> dict:
    from app.alerting.policy import AlertAggregator

    report_dir = report_dir or REPORTS
    scorer = load_scorer(checkpoint)
    info = run_info(checkpoint, scorer)
    interference = None
    if use_interference:
        from app.inference.interference import InterferenceDetector

        interference = InterferenceDetector()
        if not interference.speech.available:
            print(f"speech detector unavailable ({interference.speech.error}); impacts only")
    new_agg = lambda: AlertAggregator(ALERT_POLICY["min_anomalous_windows"], ALERT_POLICY["consider_last_valid_windows"],  # noqa: E731
                                      ALERT_POLICY["cooldown_seconds"], new_id=lambda: "e")
    manifest = json.loads((data / "manifest.json").read_text())
    todo = [s for s in manifest["streams"] if s["phase"] == phase]
    if not todo:
        raise SystemExit(f"no {phase} recordings in {data}")
    if phase == "final":
        before = log_final_run(report_dir, final_set_id(todo), data, info)
        if before:
            print(f"WARNING: this final set was already evaluated {before} time(s) (see {report_dir / FINAL_LOG}). "
                  "Report the first run, or record new final sessions.")
    rows = []
    for s in todo:
        rate, x = _read_wav(data / s["path"])
        r = replay(scorer, x, rate, new_agg, interference)
        rows.append({**s, **r})
        flag = f"  flagged {r['windows_flagged']:.2f}" if interference is not None and r["windows_flagged"] is not None else ""
        over = f"{r['window_over_threshold']:.2f}" if r["window_over_threshold"] is not None else "-"
        print(f"{s['group']:>24} {Path(s['path']).name:<24} {s['seconds']:>6.0f}s  alerts {r['alerts']}  "
              f"first alert {r['first_alert_s'] if r['first_alert_s'] is not None else '-'}s  "
              f"windows>thr {over}  unassessable {r['unassessable_windows']}{flag}")

    # Healthy groups: every alert is a false alert. Fault groups: alerts are detections.
    summary = {"phase": phase, "run": info, "interference_flags": use_interference, "healthy": {}, "faults": {}}
    for g in sorted({r["group"] for r in rows}):
        rs = [r for r in rows if r["group"] == g]
        summary["healthy" if rs[0]["label"] == "normal" else "faults"][g] = group_summary(rs, interference is not None)
    report = {"summary": summary, "recordings": rows}
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out = report_dir / f"demo-stream-{phase}-{stamp}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"report: {out}")
    return report


def main(argv: list[str] | None = None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("prepare")
    a.add_argument("--recordings", required=True)
    a.add_argument("--out", required=True, help="a NEW (or empty) folder per dataset version")
    c = sub.add_parser("calibrate")
    c.add_argument("--data", required=True)
    c.add_argument("checkpoint")
    c.add_argument("--out", required=True)
    c.add_argument("--percentile", type=float, default=99.0)
    b = sub.add_parser("stream")
    b.add_argument("--data", required=True)
    b.add_argument("checkpoint")
    b.add_argument("--phase", choices=["dev", "final"], default="dev")
    b.add_argument("--interference", action="store_true", help="also run the speech/impact flags (needs silero-vad)")
    b.add_argument("--report-dir", default=str(REPORTS))
    args = p.parse_args(argv)
    if args.cmd == "prepare":
        return prepare(Path(args.recordings), Path(args.out))
    if args.cmd == "calibrate":
        return calibrate(Path(args.data), args.checkpoint, args.out, args.percentile)
    return stream(Path(args.data), args.checkpoint, args.interference, args.phase, Path(args.report_dir))


if __name__ == "__main__":
    main()
