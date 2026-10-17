"""Pretrained-embedding scorer (SCORER=embedding): frozen PANNs CNN14 features + nearest-neighbour distance.

A machine is *enrolled* from healthy recordings only (unsupervised, no fault examples):
    reference windows   → embeddings stored as the machine's memory bank
    calibration windows → distance to the bank; the alert threshold is a percentile of these
Reference and calibration come from DIFFERENT source recordings, so no window (or 3 s window overlapping it)
is ever compared with itself. Monitoring: anomaly score = mean distance from the new window's embedding to its
k nearest reference embeddings. Higher = less like this machine's normal sound. Not a probability.

Profiles are built by `python -m ml.embed_eval enroll ...` (or `evaluate --save-profiles`). Everything here except
EmbeddingScorer's encoder is plain numpy so it can be tested without PyTorch.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .base import Score

METRICS = ("cosine", "euclidean")


def prepare(x: np.ndarray, metric: str) -> np.ndarray:
    """Rows as float32; L2-normalised for cosine so distance = 1 - dot product."""
    x = np.atleast_2d(np.asarray(x, dtype=np.float32))
    if metric == "cosine":
        return x / np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-12)
    if metric == "euclidean":
        return x
    raise ValueError(f"unknown metric {metric!r}, expected one of {METRICS}")


def knn_distance(bank: np.ndarray, queries: np.ndarray, k: int = 1, metric: str = "cosine",
                 chunk: int = 1024) -> np.ndarray:
    """Mean distance from each (prepared) query row to its k nearest (prepared) bank rows."""
    if len(bank) == 0:
        raise ValueError("empty reference bank")
    k = max(1, min(k, len(bank)))
    out = np.empty(len(queries), dtype=np.float32)
    bank_sq = (bank**2).sum(axis=1) if metric == "euclidean" else None
    for i in range(0, len(queries), chunk):
        q = queries[i : i + chunk]
        if metric == "cosine":
            d = 1.0 - q @ bank.T
        else:
            d = np.sqrt(np.maximum((q**2).sum(axis=1, keepdims=True) + bank_sq - 2.0 * q @ bank.T, 0.0))
        d = np.maximum(d, 0.0)
        out[i : i + chunk] = np.partition(d, k - 1, axis=1)[:, :k].mean(axis=1)
    return out


def calibrate(bank: np.ndarray, calibration: np.ndarray, k: int, metric: str, percentile: float) -> tuple[float, dict]:
    """Threshold = percentile of calibration-window distances. Calibration rows must not be in the bank."""
    scores = knn_distance(bank, calibration, k, metric)
    thr = float(np.percentile(scores, percentile))
    return thr, {"method": f"{percentile}th percentile of held-out healthy calibration windows",
                 "windows": int(len(scores)), "mean": float(scores.mean()), "max": float(scores.max())}


@dataclass
class Profile:
    bank: np.ndarray  # prepared (normalised for cosine) reference embeddings
    threshold: float
    metric: str
    k: int
    layer: str
    meta: dict = field(default_factory=dict)  # version, encoder, encoder_sha256, machine, clip counts, calibration

    @property
    def version(self) -> str:
        return self.meta.get("version", "unversioned")


def build_profile(reference: np.ndarray, calibration: np.ndarray, *, metric: str, k: int, layer: str,
                  percentile: float, meta: dict) -> Profile:
    bank = prepare(reference, metric)
    thr, cal = calibrate(bank, prepare(calibration, metric), k, metric, percentile)
    return Profile(bank, thr, metric, k, layer, {**meta, "calibration": cal})


def save_profile(path: str | Path, p: Profile) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    meta = {**p.meta, "metric": p.metric, "k": p.k, "layer": p.layer, "threshold": p.threshold}
    with open(path, "wb") as f:  # file handle: np.savez would otherwise append ".npz" to other suffixes
        np.savez_compressed(f, bank=p.bank, meta=np.array(json.dumps(meta)))


def load_profile(path: str | Path) -> Profile:
    with np.load(path, allow_pickle=False) as z:
        meta = json.loads(str(z["meta"]))
        bank = z["bank"].astype(np.float32)
    return Profile(bank, float(meta["threshold"]), meta["metric"], int(meta["k"]), meta["layer"], meta)


class EmbeddingScorer:
    mode = "model"
    score_name = "embedding_knn_distance"

    def __init__(self, profile_path: str, encoder_path: str, embedder=None):
        self.version = "unloaded"
        self.ready = False
        self.threshold = float("nan")
        self.load_error: str | None = None
        try:
            self.profile = load_profile(profile_path)
            if embedder is None:
                from .panns import PannsEmbedder

                embedder = PannsEmbedder(encoder_path)
            want = self.profile.meta.get("encoder_sha256")
            if want and getattr(embedder, "sha256", None) not in (None, want):
                raise ValueError("encoder checkpoint differs from the one this machine was enrolled with; re-enroll")
            self.embedder = embedder
            self.threshold = self.profile.threshold
            self.version = self.profile.version
            self.ready = True
        except Exception as err:  # report not-ready instead of crashing the API
            self.load_error = f"{type(err).__name__}: {err}"

    def score(self, samples_16k: np.ndarray, state: dict) -> Score:
        t0 = time.perf_counter()
        p = self.profile
        emb = self.embedder.embed_batch(samples_16k[None, :])[p.layer]
        value = float(knn_distance(p.bank, prepare(emb, p.metric), p.k, p.metric)[0])
        return Score(value, self.threshold, (time.perf_counter() - t0) * 1000)
