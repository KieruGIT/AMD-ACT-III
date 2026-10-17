"""Runtime settings from environment variables (see backend/.env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _list(name: str, default: str) -> list[str]:
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    db_path: str = field(default_factory=lambda: os.getenv("DB_PATH", "data/monitor.db"))
    # "heuristic" (dev scorer, no trained model), "autoencoder" (trained checkpoint) or
    # "embedding" (pretrained PANNs CNN14 + nearest-neighbour distance to an enrolled healthy profile).
    scorer: str = field(default_factory=lambda: os.getenv("SCORER", "heuristic"))
    model_path: str = field(default_factory=lambda: os.getenv("MODEL_PATH", "models/fan_01.pt"))
    embedding_profile: str = field(default_factory=lambda: os.getenv("EMBEDDING_PROFILE", "models/fan_01_emb.npz"))
    panns_checkpoint: str = field(default_factory=lambda: os.getenv("PANNS_CHECKPOINT", "models/panns/Cnn14_16k_mAP=0.438.pth"))
    cors_origins: list[str] = field(default_factory=lambda: _list("CORS_ORIGINS", "http://localhost:5173"))
    public_app_url: str = field(default_factory=lambda: os.getenv("PUBLIC_APP_URL", "http://localhost:5173"))
    telegram_bot_token: str | None = field(default_factory=lambda: os.getenv("TELEGRAM_BOT_TOKEN"))
    smtp_host: str | None = field(default_factory=lambda: os.getenv("SMTP_HOST"))
    smtp_port: int = field(default_factory=lambda: int(os.getenv("SMTP_PORT", "587")))
    smtp_user: str | None = field(default_factory=lambda: os.getenv("SMTP_USER"))
    smtp_password: str | None = field(default_factory=lambda: os.getenv("SMTP_PASSWORD"))
    smtp_from: str | None = field(default_factory=lambda: os.getenv("SMTP_FROM"))


settings = Settings()
