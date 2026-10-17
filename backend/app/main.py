from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import Database
from .inference import build_scorer
from .live import Hub
from .routers.api import router
from .settings import settings


def create_app(db_path: str | None = None) -> FastAPI:
    app = FastAPI(title="Machine Sound Monitor API", version="1.0")
    app.state.db = Database(db_path or settings.db_path)
    app.state.scorer = build_scorer()
    app.state.hub = Hub()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["X-Project-Id", "X-Device-Key", "X-Viewer-Key", "Content-Type"],
    )
    app.include_router(router)
    return app


app = create_app()
