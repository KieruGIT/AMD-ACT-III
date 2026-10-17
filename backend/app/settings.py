"""Runtime settings from environment variables (see backend/.env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _list(name: str, default: str) -> list[str]:
    return [v.strip() for v in os.getenv(name, default).split(",") if v.strip()]


@dataclass(frozen=True)
class Settings:
    db_path: str = field(default_factory=lambda: os.getenv("DB_PATH", "data/monitor.db"))
    # Postgres (e.g. Supabase session pooler) instead of the SQLite file: accounts and history survive restarts.
    database_url: str | None = field(default_factory=lambda: os.getenv("DATABASE_URL") or None)
    # Sign-in (Supabase Auth). Unset = no accounts (guest mode, device pairing and CLI viewer links still work).
    supabase_url: str | None = field(default_factory=lambda: os.getenv("SUPABASE_URL") or None)
    supabase_publishable_key: str | None = field(default_factory=lambda: os.getenv("SUPABASE_PUBLISHABLE_KEY") or None)
    # "heuristic" (dev scorer, no trained model), "autoencoder" (trained checkpoint) or
    # "embedding" (pretrained PANNs CNN14 + nearest-neighbour distance to an enrolled healthy profile).
    scorer: str = field(default_factory=lambda: os.getenv("SCORER", "heuristic"))
    model_path: str = field(default_factory=lambda: os.getenv("MODEL_PATH", "models/fan_01.pt"))
    embedding_profile: str = field(default_factory=lambda: os.getenv("EMBEDDING_PROFILE", "models/fan_01_emb.npz"))
    panns_checkpoint: str = field(default_factory=lambda: os.getenv("PANNS_CHECKPOINT", "models/panns/Cnn14_16k_mAP=0.438.pth"))
    # "off" (default) or "flag": mark windows with speech/impacts. Flags never change scores or alerts.
    interference: str = field(default_factory=lambda: os.getenv("INTERFERENCE", "off"))
    # Optional: folder with the built frontend (frontend/dist) to serve from the same origin (single-URL deploys).
    static_dir: str | None = field(default_factory=lambda: os.getenv("STATIC_DIR") or None)
    cors_origins: list[str] = field(default_factory=lambda: _list("CORS_ORIGINS", "http://localhost:5173"))
    public_app_url: str = field(default_factory=lambda: os.getenv("PUBLIC_APP_URL", "http://localhost:5173"))
    # E-mail alerts via Resend (https://resend.com). EMAIL_FROM must be on a domain verified in Resend; the default
    # test sender onboarding@resend.dev only delivers to the e-mail address of your own Resend account.
    resend_api_key: str | None = field(default_factory=lambda: os.getenv("RESEND_API_KEY") or None)
    email_from: str = field(default_factory=lambda: os.getenv("EMAIL_FROM", "Machine Sound Monitor <onboarding@resend.dev>"))


settings = Settings()
