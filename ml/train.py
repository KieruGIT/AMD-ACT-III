"""Train a normal-only autoencoder and calibrate its threshold on held-out normal windows.

    python -m ml.train --data data/dcase2020/fan --arch dense --out models/fan_01_dense.pt
    python -m ml.train --data data/dcase2020/fan --arch conv  --out models/fan_01_conv.pt

Test clips are never touched here (no leakage): the threshold comes from a clip-level split of train/normal.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch

from .data import list_clips, load_audio, windows
from app.inference.autoencoder import window_scores
from app.inference.features import DEFAULT_CFG, logmel, model_inputs
from app.inference.model import build_model, device_info, pick_device


def gpu_evidence() -> str | None:
    """Raw output of the AMD tools, saved with the report as runtime evidence."""
    for cmd in (["amd-smi", "static", "--asic"], ["rocm-smi", "--showproductname"]):
        if shutil.which(cmd[0]):
            try:
                return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout
            except Exception:
                pass
    return None


def main(argv: list[str] | None = None) -> Path:
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True, help="machine-type folder with train/ (and test/)")
    p.add_argument("--out", required=True)
    p.add_argument("--arch", choices=["dense", "conv"], default="dense")
    p.add_argument("--ids", nargs="*", help="machine ids to use, e.g. id_00 id_02 (default: all)")
    p.add_argument("--epochs", type=int, default=100)
    p.add_argument("--batch", type=int, default=512)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--val-frac", type=float, default=0.1)
    p.add_argument("--threshold-percentile", type=float, default=99.0,
                   help="percentile of held-out NORMAL window scores used as the alert threshold")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--report-dir", default=str(Path(__file__).parent / "reports"))
    a = p.parse_args(argv)

    torch.manual_seed(a.seed)
    rng = np.random.default_rng(a.seed)
    device = pick_device()
    cfg = dict(DEFAULT_CFG)
    print(f"device: {device_info()}")

    clips = [c for c in list_clips(a.data, "train", a.ids) if c.label == "normal"]
    rng.shuffle(clips)
    n_val = max(1, int(len(clips) * a.val_frac))
    val, train = clips[:n_val], clips[n_val:]  # split by CLIP so overlapping windows never cross splits
    print(f"clips: {len(train)} train, {len(val)} validation (normal only)")

    t0 = time.perf_counter()
    lms = [logmel(load_audio(c.path), cfg) for c in train]
    stacked = np.concatenate(lms)
    mean, std = stacked.mean(axis=0), stacked.std(axis=0) + 1e-6
    x = torch.from_numpy(np.concatenate([model_inputs((lm - mean) / std, cfg, a.arch) for lm in lms])).to(device)
    feature_s = time.perf_counter() - t0
    print(f"features: {tuple(x.shape)} in {feature_s:.1f}s")

    model = build_model(a.arch, cfg).to(device)
    opt = torch.optim.Adam(model.parameters(), lr=a.lr)
    losses, t1 = [], time.perf_counter()
    for epoch in range(a.epochs):
        model.train()
        perm, total = torch.randperm(x.shape[0], device=device), 0.0
        for i in range(0, x.shape[0], a.batch):
            b = x[perm[i : i + a.batch]]
            if b.shape[0] < 2:
                continue  # BatchNorm needs >1 sample
            loss = torch.mean((model(b) - b) ** 2)
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += loss.item() * b.shape[0]
        losses.append(total / x.shape[0])
        if epoch % 10 == 0 or epoch == a.epochs - 1:
            print(f"epoch {epoch + 1}/{a.epochs} loss {losses[-1]:.4f}")
    if device.type == "cuda":
        torch.cuda.synchronize()
    train_s = time.perf_counter() - t1

    model.eval()
    val_scores = [window_scores(model, model_inputs((logmel(w, cfg) - mean) / std, cfg, a.arch), device)
                  for c in val for w in windows(load_audio(c.path))]
    threshold = float(np.percentile(val_scores, a.threshold_percentile))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    version = f"fan-{a.arch}-ae-{stamp}"

    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "version": version, "arch": a.arch, "features": cfg,
        "norm_mean": torch.from_numpy(mean), "norm_std": torch.from_numpy(std),
        "state_dict": {k: v.cpu() for k, v in model.state_dict().items()},
        "threshold": threshold,
    }, out)

    report = {
        "version": version, "checkpoint": str(out), "arch": a.arch, "trained_at": stamp,
        "device": device_info(), "gpu_evidence": gpu_evidence(),
        "data": {"root": a.data, "ids": a.ids or "all", "train_clips": len(train), "val_clips": len(val),
                 "val_windows": len(val_scores)},
        "hyperparameters": {k: getattr(a, k) for k in ("epochs", "batch", "lr", "val_frac", "threshold_percentile", "seed")},
        "features": cfg, "timing_s": {"features": round(feature_s, 2), "training": round(train_s, 2)},
        "loss": {"first": losses[0], "last": losses[-1]},
        "threshold": {"value": threshold, "method": f"{a.threshold_percentile}th percentile of held-out normal windows",
                      "val_score_mean": float(np.mean(val_scores)), "val_score_max": float(np.max(val_scores))},
    }
    rpath = Path(a.report_dir) / f"train-{version}.json"
    rpath.parent.mkdir(parents=True, exist_ok=True)
    rpath.write_text(json.dumps(report, indent=2))
    print(f"saved {out} (threshold {threshold:.4f}); report {rpath}")
    return out


if __name__ == "__main__":
    main()
