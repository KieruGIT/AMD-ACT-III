"""Log-mel features — the ONE implementation used by both training (ml/) and serving (autoencoder.py).

Training and inference must compute features identically (PROJECT_PLAN.md §3.3); never fork this file.
Defaults follow the DCASE 2020 Task 2 baseline (128 mels, 1024-pt FFT, 512 hop, 5-frame context).
"""
from __future__ import annotations

import numpy as np

DEFAULT_CFG = {
    "sample_rate": 16_000,
    "n_fft": 1024,
    "hop": 512,
    "n_mels": 128,
    "fmin": 0.0,
    "fmax": 8_000.0,
    "frames": 5,  # dense AE: concatenated context frames
    "patch": 32,  # conv AE: frames per patch
    "patch_hop": 16,
}

_fb_cache: dict[tuple, np.ndarray] = {}


def _hz_to_mel(f):
    return 2595.0 * np.log10(1.0 + np.asarray(f) / 700.0)


def _mel_to_hz(m):
    return 700.0 * (10 ** (np.asarray(m) / 2595.0) - 1.0)


def mel_filterbank(sr: int, n_fft: int, n_mels: int, fmin: float, fmax: float) -> np.ndarray:
    key = (sr, n_fft, n_mels, fmin, fmax)
    if key not in _fb_cache:
        freqs = np.fft.rfftfreq(n_fft, 1 / sr)
        edges = _mel_to_hz(np.linspace(_hz_to_mel(fmin), _hz_to_mel(fmax), n_mels + 2))
        fb = np.zeros((n_mels, freqs.size), dtype=np.float32)
        for m in range(n_mels):
            lo, mid, hi = edges[m], edges[m + 1], edges[m + 2]
            fb[m] = np.clip(np.minimum((freqs - lo) / (mid - lo), (hi - freqs) / (hi - mid)), 0, None)
        _fb_cache[key] = fb
    return _fb_cache[key]


def logmel(x: np.ndarray, cfg: dict = DEFAULT_CFG) -> np.ndarray:
    """(T, n_mels) log-mel power in dB for mono float audio at cfg['sample_rate']."""
    n_fft, hop = cfg["n_fft"], cfg["hop"]
    if x.size < n_fft:
        x = np.pad(x, (0, n_fft - x.size))
    win = np.hanning(n_fft).astype(np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(x.astype(np.float32), n_fft)[::hop] * win
    power = np.abs(np.fft.rfft(frames, axis=1)) ** 2
    mel = power @ mel_filterbank(cfg["sample_rate"], n_fft, cfg["n_mels"], cfg["fmin"], cfg["fmax"]).T
    return (10.0 * np.log10(mel + 1e-10)).astype(np.float32)


def model_inputs(lm: np.ndarray, cfg: dict, arch: str) -> np.ndarray:
    """Normalised log-mel → model input batch: dense (N, frames*n_mels) or conv (N, 1, patch, n_mels)."""
    if arch == "dense":
        f = cfg["frames"]
        return np.lib.stride_tricks.sliding_window_view(lm, (f, lm.shape[1]))[:, 0].reshape(-1, f * lm.shape[1]).copy()
    if arch == "conv":
        p, h = cfg["patch"], cfg["patch_hop"]
        if lm.shape[0] < p:
            lm = np.pad(lm, ((0, p - lm.shape[0]), (0, 0)), mode="edge")
        return np.lib.stride_tricks.sliding_window_view(lm, (p, lm.shape[1]))[::h, 0][:, None].copy()
    raise ValueError(f"unknown arch {arch}")
