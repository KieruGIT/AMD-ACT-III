from __future__ import annotations

from ..settings import settings
from .base import Scorer


def build_scorer() -> Scorer:
    if settings.scorer == "autoencoder":
        from .autoencoder import AutoencoderScorer

        return AutoencoderScorer(settings.model_path)
    if settings.scorer == "embedding":
        from .embedding import EmbeddingScorer

        return EmbeddingScorer(settings.embedding_profile, settings.panns_checkpoint)
    from .heuristic import HeuristicScorer

    return HeuristicScorer()
