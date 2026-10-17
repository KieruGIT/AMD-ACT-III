from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .auth import build_verifier
from .bootstrap import bootstrap
from .db import Database
from .inference import build_scorer
from .live import Hub
from .routers.api import router
from .routers.workspace import router as workspace_router
from .settings import settings


def create_app(db_path: str | None = None) -> FastAPI:
    app = FastAPI(title="Machine Sound Monitor API", version="1.0")
    app.state.db = Database(db_path or settings.database_url or settings.db_path)
    if db_path is None:  # tests pass their own database and stay unaffected by host secrets
        bootstrap(app.state.db)
    app.state.scorer = build_scorer()
    app.state.verify_token = build_verifier()  # None unless SUPABASE_URL is set (sign-in disabled)
    app.state.hub = Hub()
    app.state.interference = None
    if settings.interference == "flag":
        from .inference.interference import InterferenceDetector

        app.state.interference = InterferenceDetector()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Authorization", "X-Project-Id", "X-Device-Key", "X-Viewer-Key", "X-Guest-Key", "Content-Type"],
    )
    app.include_router(router)
    app.include_router(workspace_router)
    if settings.static_dir:
        serve_frontend(app, Path(settings.static_dir))
    return app


def serve_frontend(app: FastAPI, root: Path) -> None:
    """Serve the built dashboard/listener app from the API's origin (one HTTPS URL, no CORS). Registered after the
    API routes; unknown /api paths still 404 and client-side routes (/app, ...) fall back to index.html."""
    root = root.resolve()
    if not (root / "index.html").is_file():
        raise RuntimeError(f"STATIC_DIR={root} has no index.html (build the frontend first)")

    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "not found")
        f = (root / path).resolve()
        if path and f.is_file() and root in f.parents:
            return FileResponse(f)
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})


app = create_app()
