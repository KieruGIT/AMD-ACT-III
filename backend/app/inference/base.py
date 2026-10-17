from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import numpy as np


@dataclass
class Score:
    value: float | None  # None = not assessable yet (e.g. heuristic still learning its baseline)
    threshold: float
    model_ms: float


class Scorer(Protocol):
    """One trained model (or the dev heuristic) for one machine profile."""

    mode: str  # reported by /health: "heuristic" or "model"
    version: str
    score_name: str
    ready: bool

    def score(self, samples_16k: np.ndarray, state: dict) -> Score:
        """Score one 3 s mono window at 16 kHz. `state` is per device+session scratch space."""
        ...
