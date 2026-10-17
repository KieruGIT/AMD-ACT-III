"""DCASE 2020 Task 2 style dataset access.

Expected layout (as unzipped from the DCASE development dataset, one machine type):
    <root>/train/normal_id_00_00000000.wav ...          (normal only)
    <root>/test/normal_id_00_00000000.wav, anomaly_id_00_00000000.wav ...
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from math import gcd
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import resample_poly

from . import ROOT  # noqa: F401  (puts backend/ on sys.path)
from app.profiles import HOP_MS, SAMPLE_RATE_HZ, WINDOW_MS

NAME = re.compile(r"^(normal|anomaly)_(id_\d+)_\d+\.wav$")


@dataclass(frozen=True)
class Clip:
    path: Path
    label: str  # normal | anomaly
    machine_id: str  # e.g. id_00


def list_clips(root: str | Path, split: str, ids: list[str] | None = None) -> list[Clip]:
    out = []
    for p in sorted(Path(root, split).glob("*.wav")):
        m = NAME.match(p.name)
        if m and (not ids or m.group(2) in ids):
            out.append(Clip(p, m.group(1), m.group(2)))
    if not out:
        raise FileNotFoundError(f"no DCASE-style wav files in {Path(root, split)}")
    return out


def load_audio(path: str | Path) -> np.ndarray:
    """Mono float32 at the model rate, scaled to [-1, 1] (same convention as the API)."""
    rate, x = wavfile.read(path)
    x = x.astype(np.float32) / (32768.0 if x.dtype == np.int16 else 1.0)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if rate != SAMPLE_RATE_HZ:
        g = gcd(SAMPLE_RATE_HZ, rate)
        x = resample_poly(x, SAMPLE_RATE_HZ // g, rate // g).astype(np.float32)
    return x


def windows(x: np.ndarray) -> list[np.ndarray]:
    """Same 3 s / 1 s windows the listening devices send in production."""
    n, h = SAMPLE_RATE_HZ * WINDOW_MS // 1000, SAMPLE_RATE_HZ * HOP_MS // 1000
    return [x[i : i + n] for i in range(0, max(1, x.size - n + 1), h)]
