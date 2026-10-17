# Full stack in one container: the built frontend (dashboard + phone listener) served by the analysis API from the
# same origin. Build context = repository root (deploy/hf_space.py stages it). CPU only; NOT AMD hardware.
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# Live mode, API on the same origin (relative /api/v1)
ENV VITE_MOCK_API=false VITE_API_BASE_URL=""
RUN npm run build

FROM python:3.13-slim
RUN useradd -m -u 1000 user
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir torch==2.14.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt silero-vad==6.2.3
COPY --chown=user backend/app ./app
COPY --chown=user backend/models ./models
COPY --from=web --chown=user /web/dist ./static
RUN mkdir -p /app/data && chown user /app/data

USER user
ENV DB_PATH=/app/data/monitor.db \
    SCORER=autoencoder \
    MODEL_PATH=models/model.pt \
    STATIC_DIR=static \
    PYTHONUNBUFFERED=1
EXPOSE 7860
# One worker: live session state is in memory (app/live.py).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1", "--proxy-headers"]
