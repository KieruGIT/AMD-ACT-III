"""Deploy the whole app (dashboard + phone listener + analysis API, one HTTPS URL) to a free Hugging Face Space.

Docker, CPU only: NOT AMD hardware.

    pip install huggingface_hub          # once
    hf auth login                        # paste a WRITE token from huggingface.co/settings/tokens (never in chat)
    python deploy/hf_space.py --space <hf-user>/machine-sound-monitor \\
        --model backend/models/fan_dense.pt [--interference]

What it does:
- generates the demo viewer/device keys once (kept in deploy/.space.env, gitignored) and stores them as Space
  SECRETS, so the startup bootstrap (backend/app/bootstrap.py) recreates the project after every restart;
- uploads deploy/Dockerfile with the frontend sources, backend/app, requirements.txt and the chosen model
  (as models/model.pt); the Space builds the frontend and serves it from the API's origin (STATIC_DIR);
- sets SCORER/MODEL_PATH/CORS_ORIGINS/PUBLIC_APP_URL/INTERFERENCE as Space variables;
- prints the API URL and writes the dashboard + listener links to deploy/.space-links.txt (gitignored).

Free Spaces keep no disk across restarts: alert history (SQLite) resets; the project, device and subscribers come back.
Secrets copied from backend/.env when set: DATABASE_URL, RESEND_API_KEY, BOOTSTRAP_SUBSCRIBERS.
Public variables copied when set: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, EMAIL_FROM.
"""
from __future__ import annotations

import argparse
import os
import secrets
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
KEYS = Path(__file__).parent / ".space.env"
LINKS = Path(__file__).parent / ".space-links.txt"

SPACE_README = """---
title: Machine Sound Monitor API
emoji: 🔊
colorFrom: blue
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

AI Machine Sound Monitoring System: dashboard, phone listener page and analysis API (FastAPI) in one container. Phones upload 3 s audio windows; the API scores
them with an autoencoder trained on healthy machine sound, applies a 3-of-5 alert policy and streams results to the
dashboard. Health check: `/api/v1/health`.

Runs on the free Hugging Face CPU tier, not on AMD hardware.
"""


def load_env(path: Path) -> None:
    """KEY=VALUE lines into os.environ (existing variables win). Values are never printed."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            if v.strip():
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def load_keys() -> dict[str, str]:
    if KEYS.exists():
        return dict(line.split("=", 1) for line in KEYS.read_text().split() if "=" in line)
    keys = {"BOOTSTRAP_VIEWER_KEY": f"vk_{secrets.token_urlsafe(24)}", "BOOTSTRAP_DEVICE_KEY": f"dk_{secrets.token_urlsafe(24)}"}
    KEYS.write_text("".join(f"{k}={v}\n" for k, v in keys.items()))
    return keys


FRONTEND_SKIP = shutil.ignore_patterns("node_modules", "dist", "test-results", "playwright-report", "e2e", "e2e-live",
                                       ".env", ".env.*", "*.local", ".vercel")


def stage(model: Path | None) -> Path:
    """Build context for deploy/Dockerfile: frontend sources + backend app + the model (as models/model.pt)."""
    d = Path(tempfile.mkdtemp(prefix="space-"))
    shutil.copy(Path(__file__).parent / "Dockerfile", d / "Dockerfile")
    shutil.copytree(ROOT / "frontend", d / "frontend", ignore=FRONTEND_SKIP)
    (d / "backend" / "models").mkdir(parents=True)
    shutil.copy(BACKEND / "requirements.txt", d / "backend" / "requirements.txt")
    shutil.copytree(BACKEND / "app", d / "backend" / "app", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    if model:
        shutil.copy(model, d / "backend" / "models" / "model.pt")
    else:
        (d / "backend" / "models" / ".keep").write_text("")
    (d / "README.md").write_text(SPACE_README, encoding="utf-8")
    return d


def space_host(space: str) -> str:
    owner, name = space.split("/")
    return f"https://{owner}-{name}".lower().replace("_", "-").replace(".", "-") + ".hf.space"


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--space", help="<hf-user>/<space-name> (default: HF_SPACE in backend/.env)")
    p.add_argument("--model", help="checkpoint to serve (omit with --scorer heuristic)")
    p.add_argument("--scorer", default="autoencoder", choices=["autoencoder", "heuristic"])
    p.add_argument("--frontend-url", help="only if the dashboard is hosted elsewhere (e.g. Vercel); default: this Space")
    p.add_argument("--project-id", default="demo")
    p.add_argument("--interference", action="store_true", help="INTERFERENCE=flag (speech/impact flags)")
    a = p.parse_args(argv)
    load_env(BACKEND / ".env")  # HF_TOKEN, HF_SPACE etc. may live in the gitignored backend/.env (never uploaded)
    a.space = a.space or os.getenv("HF_SPACE")
    if not a.space or "/" not in a.space or a.space.startswith("your-hf-username"):
        p.error("set --space or HF_SPACE=<hf-username>/<space-name> in backend/.env")
    if a.scorer == "autoencoder" and not a.model:
        p.error("--model is required with --scorer autoencoder")

    from huggingface_hub import HfApi

    api = HfApi(token=os.getenv("HF_TOKEN"))
    user = api.whoami()["name"]  # fails clearly if `hf auth login` was not run
    print(f"logged in to Hugging Face as {user}")
    keys = load_keys()
    frontend = (a.frontend_url or space_host(a.space)).rstrip("/")
    api.create_repo(a.space, repo_type="space", space_sdk="docker", exist_ok=True, private=False)
    secrets_ = {**keys}
    for k in ("DATABASE_URL", "RESEND_API_KEY", "BOOTSTRAP_SUBSCRIBERS"):
        if os.getenv(k):
            secrets_[k] = os.environ[k]
    for k, v in secrets_.items():
        api.add_space_secret(a.space, k, v)
    variables = {"BOOTSTRAP_PROJECT_ID": a.project_id, "BOOTSTRAP_PROJECT_NAME": "Demo", "SCORER": a.scorer,
                 "MODEL_PATH": "models/model.pt", "CORS_ORIGINS": frontend, "PUBLIC_APP_URL": frontend,
                 "INTERFERENCE": "flag" if a.interference else "off",
                 **{k: os.environ[k] for k in ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "EMAIL_FROM") if os.getenv(k)}}
    for k, v in variables.items():
        api.add_space_variable(a.space, k, v)
    folder = stage(Path(a.model) if a.model else None)
    api.upload_folder(repo_id=a.space, repo_type="space", folder_path=str(folder),
                      commit_message=f"Deploy API ({a.scorer}{', ' + Path(a.model).name if a.model else ''})",
                      delete_patterns=["frontend/**", "backend/**"])
    shutil.rmtree(folder, ignore_errors=True)

    host = space_host(a.space)
    links = (f"App + API: {host}\n"
             f"Health: {host}/api/v1/health\n"
             f"Dashboard link: {frontend}/app?project={a.project_id}#viewer={keys['BOOTSTRAP_VIEWER_KEY']}\n"
             f"Listener link (open on the phone): {frontend}/app?project={a.project_id}#device={keys['BOOTSTRAP_DEVICE_KEY']}\n")
    LINKS.write_text(links)
    print(f"Space: https://huggingface.co/spaces/{a.space} (building; first build takes a few minutes)")
    print(f"API: {host}")
    print(f"Dashboard and listener links (contain keys) written to {LINKS}")


if __name__ == "__main__":
    main()
