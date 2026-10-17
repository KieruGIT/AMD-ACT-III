"""Dev scorer: NOT a trained model. It learns each listening device's normal sound on site, then locks it.

Learning: the first `learn_windows` good windows from a device (about a minute) are its normal sound. Nothing is
assessed while it learns. Then the learned normal is saved for that device and kept across sessions and restarts, until
an admin asks it to re-learn (machine serviced, moved, or the new sound is the normal one).

Scoring compares the SHAPE of the spectrum (which frequencies dominate), not how loud it is: each window's band
energies are taken relative to their own average level. Turning the volume up, moving the microphone closer or a louder
room therefore stays normal; a new whine, rattle or knock changes the shape and stands out. A large overall level change
is reported as a note, never as an anomaly. The alert threshold comes from how much the learned minute itself varied.

/health reports mode "heuristic" and the UI labels it; never present its output as model accuracy.
"""
from __future__ import annotations

import time

import numpy as np

from ..profiles import SAMPLE_RATE_HZ
from ..settings import settings
from .base import Score

N_FFT = 1024
HOP = 512
BANDS = np.geomspace(60, SAMPLE_RATE_HZ / 2, 33)
MIN_STD_DB = 1.5  # floor on per-band spread, so a very steady machine does not alarm on tiny wobbles
THRESHOLD_FLOOR, THRESHOLD_CAP, THRESHOLD_MARGIN = 2.5, 6.0, 1.3
LEVEL_NOTE_DB = 10.0  # overall level this far from the learned normal earns a note (never an anomaly)


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


def _rms_z(shape: np.ndarray, mean: np.ndarray, std: np.ndarray) -> float:
    return float(np.sqrt(np.mean(((shape - mean) / std) ** 2)))


class HeuristicScorer:
    mode = "heuristic"
    version = "learned-on-site-heuristic-0.2"
    score_name = "sound_shape_deviation"
    ready = True
    threshold = 3.0  # shown before a device has learned; each device then gets its own from the learned minute
    learns_on_site = True

    def __init__(self, learn_windows: int | None = None):
        self.learn_windows = learn_windows or settings.learn_windows

    def fit(self, feats: list[np.ndarray]) -> dict:
        """The learned normal: mean/spread of the spectrum shape and of the overall level, plus its own threshold."""
        f = np.stack(feats)
        level = f.mean(axis=1)
        shape = f - level[:, None]
        mean, std = shape.mean(axis=0), np.maximum(shape.std(axis=0), MIN_STD_DB)
        # how unusual each learned window looks when it is left out: the normal minute's own variation
        loo = []
        for i in range(len(shape)):
            rest = np.delete(shape, i, axis=0)
            loo.append(_rms_z(shape[i], rest.mean(axis=0), np.maximum(rest.std(axis=0), MIN_STD_DB)))
        threshold = float(np.clip(THRESHOLD_MARGIN * max(loo), THRESHOLD_FLOOR, THRESHOLD_CAP))
        return {"mean": mean.tolist(), "std": std.tolist(), "level_mean": float(level.mean()),
                "level_std": float(level.std()), "threshold": round(threshold, 3), "windows": len(feats)}

    def score(self, samples_16k: np.ndarray, state: dict) -> Score:
        """`state` is per DEVICE: it holds the learning windows, then the locked baseline."""
        t0 = time.perf_counter()
        f = band_energies_db(samples_16k)
        base = state.get("baseline")
        if base is None:
            learning = state.setdefault("learning", [])
            learning.append(f)
            state["progress"] = (len(learning), self.learn_windows)
            if len(learning) >= self.learn_windows:
                state["baseline"] = self.fit(learning)
                state.pop("learning")
                state["just_locked"] = True
            return Score(None, self.threshold, (time.perf_counter() - t0) * 1000)
        level = float(f.mean())
        value = _rms_z(f - level, np.asarray(base["mean"]), np.asarray(base["std"]))
        state["level_delta_db"] = level - base["level_mean"]
        return Score(value, base["threshold"], (time.perf_counter() - t0) * 1000)
