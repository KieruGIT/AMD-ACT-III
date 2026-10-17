"""Tiny DCASE-shaped synthetic dataset for smoke-testing the pipeline. NOT for any reported result.

    python -m ml.make_synthetic data/synthetic/fan
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

RATE = 16_000


def fan(seconds: float, hum: float, anomaly: bool, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(int(seconds * RATE)) / RATE
    wobble = 1 + 0.02 * np.sin(2 * np.pi * rng.uniform(0.2, 0.6) * t)
    x = 0.15 * np.sin(2 * np.pi * hum * t) + 0.07 * np.sin(2 * np.pi * 3 * hum * t * wobble) + 0.03 * rng.standard_normal(t.size)
    if anomaly:
        x += 0.06 * np.sin(2 * np.pi * rng.uniform(2400, 3200) * t)
        knocks = (t % rng.uniform(0.3, 0.6)) < 0.01
        x[knocks] += 0.4 * rng.standard_normal(knocks.sum())
    return np.clip(x, -1, 1)


def make(root: str | Path, train_per_id: int = 20, test_per_id: int = 8, seconds: float = 10.0, seed: int = 0) -> Path:
    rng = np.random.default_rng(seed)
    root = Path(root)
    for split in ("train", "test"):
        (root / split).mkdir(parents=True, exist_ok=True)
    for mid, hum in (("id_00", 120.0), ("id_02", 150.0)):
        for i in range(train_per_id):
            wavfile.write(root / "train" / f"normal_{mid}_{i:08d}.wav", RATE, (fan(seconds, hum, False, rng) * 32767).astype(np.int16))
        for i in range(test_per_id):
            for label in ("normal", "anomaly"):
                x = fan(seconds, hum, label == "anomaly", rng)
                wavfile.write(root / "test" / f"{label}_{mid}_{i:08d}.wav", RATE, (x * 32767).astype(np.int16))
    return root


if __name__ == "__main__":
    print(make(sys.argv[1] if len(sys.argv) > 1 else "data/synthetic/fan"))
