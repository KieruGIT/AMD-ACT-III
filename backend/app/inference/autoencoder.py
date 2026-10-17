"""Trained autoencoder scorer (SCORER=autoencoder, MODEL_PATH=<checkpoint from ml/train.py>).

Input: one 3 s mono window, float32, already resampled to 16 kHz by the API.
Output: raw mean reconstruction error (not a probability) and the threshold calibrated during training.
If the checkpoint cannot be loaded the API stays up, /health reports model_ready=false and uploads get 503.
"""
from __future__ import annotations

import time

import numpy as np

from .base import Score
from .features import logmel, model_inputs


def window_scores(model, inputs: np.ndarray, device) -> float:
    import torch

    with torch.no_grad():
        x = torch.from_numpy(inputs).to(device)
        err = torch.mean((model(x) - x) ** 2, dim=tuple(range(1, x.dim())))
    return float(err.mean().item())


class AutoencoderScorer:
    mode = "model"
    score_name = "reconstruction_error"

    def __init__(self, model_path: str):
        self.model_path = model_path
        self.version = "unloaded"
        self.ready = False
        self.threshold = float("nan")
        self.load_error: str | None = None
        try:
            self._load()
        except Exception as err:  # report not-ready instead of crashing the API
            self.load_error = f"{type(err).__name__}: {err}"

    def _load(self) -> None:
        import torch

        from .model import build_model, pick_device

        ckpt = torch.load(self.model_path, map_location="cpu", weights_only=True)
        self.cfg, self.arch = ckpt["features"], ckpt["arch"]
        self.mean, self.std = ckpt["norm_mean"].numpy(), ckpt["norm_std"].numpy()
        self.device = pick_device()
        self.model = build_model(self.arch, self.cfg).to(self.device).eval()
        self.model.load_state_dict(ckpt["state_dict"])
        self.threshold = float(ckpt["threshold"])
        self.version = ckpt["version"]
        self.ready = True

    def inputs(self, samples_16k: np.ndarray) -> np.ndarray:
        lm = (logmel(samples_16k, self.cfg) - self.mean) / self.std
        return model_inputs(lm, self.cfg, self.arch)

    def score(self, samples_16k: np.ndarray, state: dict) -> Score:
        t0 = time.perf_counter()
        value = window_scores(self.model, self.inputs(samples_16k), self.device)
        return Score(value, self.threshold, (time.perf_counter() - t0) * 1000)
