# Analysis API container (CPU). Any Docker host: Render, Koyeb, a VM. Listens on $PORT (default 7860).
# On an AMD GPU machine use the rocm/pytorch base image instead (docs/AMD_AI_GUIDE.md); this image is CPU-only.
FROM python:3.13-slim

RUN useradd -m -u 1000 user
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt silero-vad==6.2.3

COPY --chown=user app ./app
# Model files are not in Git (*.pt is gitignored); SCORER=heuristic needs none. For a trained model, bake it in
# from a release/download step or mount it, and set MODEL_PATH.
RUN mkdir -p /app/data /app/models && chown user /app/data /app/models

USER user
ENV DB_PATH=/app/data/monitor.db \
    SCORER=heuristic \
    MODEL_PATH=models/model.pt \
    PYTHONUNBUFFERED=1
EXPOSE 7860
# One worker: live session state is in memory (app/live.py).
# Render (and most hosts) pass the port in $PORT. Shell form so it expands.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860} --workers 1 --proxy-headers --forwarded-allow-ips "*"
