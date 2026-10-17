"""Dev scorer: NOT a trained model.

It learns the first few windows of each session as that session's "normal" and scores later windows
by how far their band energies drift from it. It exists so the device → API → alert → dashboard flow
can be demonstrated before the autoencoder is trained. /health reports mode "heuristic" and the UI
labels it accordingly; never present its output as model accuracy.
"""
from __future__ import annotations

import time

import numpy as np

from ..profiles import SAMPLE_RATE_HZ
from .base import Score

N_FFT = 1024
HOP = 512
BANDS = np.geomspace(60, SAMPLE_RATE_HZ / 2, 33)
BASELINE_WINDOWS = 5
MIN_STD_DB = 1.5


def band_energies_db(x: np.ndarray) -> np.ndarray:
    win = np.hanning(N_FFT).astype(np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(x, N_FFT)[::HOP] * win
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    freqs = np.fft.rfftfreq(N_FFT, 1 / SAMPLE_RATE_HZ)
    out = np.empty(len(BANDS) - 1, dtype=np.float64)
    for i in range(len(BANDS) - 1):
        sel = (freqs >= BANDS[i]) & (freqs < BANDS[i + 1])
        out[i] = 10 * np.log10(power[:, sel].mean() + 1e-12)
    return out


class HeuristicScorer:
    mode = "heuristic"
    version = "session-baseline-heuristic-0.1"
    score_name = "band_energy_deviation"
    ready = True
    threshold = 3.0

    def score(self, samples_16k: np.ndarray, state: dict) -> Score:
        t0 = time.perf_counter()
        feats = band_energies_db(samples_16k)
        history: list[np.ndarray] = state.setdefault("baseline", [])
        if len(history) < BASELINE_WINDOWS:
            history.append(feats)
            return Score(None, self.threshold, (time.perf_counter() - t0) * 1000)
        ref = np.stack(history)
        z = (feats - ref.mean(axis=0)) / np.maximum(ref.std(axis=0), MIN_STD_DB)
        value = float(np.sqrt(np.mean(z**2)))  # RMS z-score across bands
        return Score(value, self.threshold, (time.perf_counter() - t0) * 1000)
