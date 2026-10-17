"""Evaluate one or more checkpoints on the SAME held-out test split, through the exact serving code path.

    python -m ml.evaluate --data data/dcase2020/fan models/fan_01_dense.pt models/fan_01_conv.pt

Reports per machine id: ROC AUC and pAUC (max FPR 0.1, as DCASE 2020) on clip scores; window-level TPR/FPR at
the calibrated threshold; simulated monitoring with the real 3-of-5 alert policy (false alerts per hour on normal
audio, share of anomalous clips that raise an alert); and per-window inference latency on this device.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score

from .data import list_clips, load_audio, windows
from app.alerting.policy import AlertAggregator
from app.inference.autoencoder import AutoencoderScorer
from app.profiles import ALERT_POLICY, HOP_MS


def simulate_alerts(window_scores: list[list[float]], threshold: float) -> int:
    """Streams clips back to back (1 s hop) through the production alert policy; returns alerts raised."""
    agg = AlertAggregator(ALERT_POLICY["min_anomalous_windows"], ALERT_POLICY["consider_last_valid_windows"],
                          ALERT_POLICY["cooldown_seconds"], new_id=lambda: "e")
    t, alerts = datetime(2026, 1, 1, tzinfo=timezone.utc), 0
    for clip in window_scores:
        for s in clip:
            t += timedelta(milliseconds=HOP_MS)
            d = agg.observe(valid=True, is_anomaly=s > threshold, score=s, threshold=threshold,
                            recorded_at=t.isoformat(), session_id="sim", machine_id="fan")
            alerts += d.triggered
    return alerts


def evaluate(ckpt: str, data: str, ids: list[str] | None) -> dict:
    from app.inference.model import device_info  # needs torch; keeps simulate_alerts importable without it

    scorer = AutoencoderScorer(ckpt)
    if not scorer.ready:
        raise RuntimeError(f"cannot load {ckpt}: {scorer.load_error}")
    clips = list_clips(data, "test", ids)
    rows = []
    for c in clips:
        ws = [scorer.score(w, {}).value for w in windows(load_audio(c.path))]
        rows.append({"id": c.machine_id, "y": int(c.label == "anomaly"), "clip": float(np.mean(ws)), "windows": ws})

    thr = scorer.threshold
    result = {"version": scorer.version, "checkpoint": ckpt, "threshold": thr, "device": device_info(), "per_id": {}}
    for mid in sorted({r["id"] for r in rows}) + ["all"]:
        sel = [r for r in rows if mid == "all" or r["id"] == mid]
        y, s = [r["y"] for r in sel], [r["clip"] for r in sel]
        norm_w = [w for r in sel if not r["y"] for w in r["windows"]]
        anom_w = [w for r in sel if r["y"] for w in r["windows"]]
        normal_hours = len(norm_w) * HOP_MS / 1000 / 3600
        anomalous_clips = [r for r in sel if r["y"]]
        result["per_id"][mid] = {
            "clips": {"normal": len(y) - sum(y), "anomaly": sum(y)},
            "roc_auc": roc_auc_score(y, s) if 0 < sum(y) < len(y) else None,
            "pauc_0.1": roc_auc_score(y, s, max_fpr=0.1) if 0 < sum(y) < len(y) else None,
            "window_tpr_at_threshold": float(np.mean(np.array(anom_w) > thr)) if anom_w else None,
            "window_fpr_at_threshold": float(np.mean(np.array(norm_w) > thr)) if norm_w else None,
            "false_alerts_per_hour": simulate_alerts([r["windows"] for r in sel if not r["y"]], thr) / normal_hours if normal_hours else None,
            "anomalous_clips_alerted": (sum(simulate_alerts([r["windows"]], thr) > 0 for r in anomalous_clips) / len(anomalous_clips)) if anomalous_clips else None,
        }

    sample = windows(load_audio(clips[0].path))[0]
    for _ in range(5):
        scorer.score(sample, {})  # warm-up (kernel compilation, caches)
    times = []
    for _ in range(50):
        t0 = time.perf_counter()
        scorer.score(sample, {})
        times.append((time.perf_counter() - t0) * 1000)
    result["latency_ms_per_window"] = {"mean": float(np.mean(times)), "p95": float(np.percentile(times, 95)),
                                       "includes": "log-mel features + model forward, one 3 s window"}
    return result


def to_markdown(results: list[dict]) -> str:
    f = lambda v, d=3: "n/a" if v is None else f"{v:.{d}f}"  # noqa: E731
    lines = ["| Model | Machine | ROC AUC | pAUC (0.1) | Window TPR | Window FPR | False alerts/h | Anomalous clips alerted | Latency mean/p95 (ms) | Device |",
             "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in results:
        lat = r["latency_ms_per_window"]
        for mid, m in r["per_id"].items():
            lines.append(f"| {r['version']} | {mid} | {f(m['roc_auc'])} | {f(m['pauc_0.1'])} | {f(m['window_tpr_at_threshold'])} | "
                         f"{f(m['window_fpr_at_threshold'])} | {f(m['false_alerts_per_hour'], 2)} | {f(m['anomalous_clips_alerted'])} | "
                         f"{f(lat['mean'], 1)} / {f(lat['p95'], 1)} | {r['device']['device']} |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> list[dict]:
    p = argparse.ArgumentParser()
    p.add_argument("checkpoints", nargs="+")
    p.add_argument("--data", required=True)
    p.add_argument("--ids", nargs="*")
    a = p.parse_args(argv)
    results = [evaluate(c, a.data, a.ids) for c in a.checkpoints]
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    out = Path(__file__).parent / "reports"
    (out / f"eval-{stamp}.json").write_text(json.dumps(results, indent=2))
    md = f"# Evaluation {stamp} (held-out test split: {a.data})\n\n" + to_markdown(results)
    (out / f"eval-{stamp}.md").write_text(md)
    print(md)
    return results


if __name__ == "__main__":
    main()
