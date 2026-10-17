# Backend: analysis API (FastAPI)

Option A architecture: **listening devices** (a phone browser for the demo, a Pi script later) upload 3 s audio
windows; **this API** checks the device key, scores each window, aggregates alerts (3 of the last 5 windows, one
event per anomaly until it recovers, then a cooldown), notifies the project's registered people, and streams results
to **dashboards** on any screen.

```text
device (project id + device key) ──POST /analyze-window──▶ API: validate → resample 16 kHz → score → alert policy
                                                             ├─▶ e-mail alert recipients (Resend)
dashboard (project id + viewer key) ◀──GET /projects/{id}/stream (SSE)──┘
```

Raw audio is never stored. Events, devices and subscribers live in SQLite (`DB_PATH`).

## Run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --port 8000 --env-file .env
pytest
```

## Set up a project, a device and who gets alerted

```bash
python -m app.admin create-project plant-a "Plant A"            # prints the dashboard link (viewer key)
python -m app.admin add-device plant-a "Phone at fan" --machine fan_01   # prints the listener link (device key)
python -m app.admin add-subscriber plant-a "Maintenance" --email maintenance@example.com
python -m app.admin add-subscriber plant-a "Chris" --email chris@example.com   # needs RESEND_API_KEY in .env
python -m app.admin list plant-a
```

Open the **listener link** on the phone next to the machine and the **dashboard link** on the laptop. Keys are shown
once, stored only as SHA-256 hashes, and travel in the URL fragment so they never reach server logs.

## Scorers

| `SCORER` | What it is | UI label |
| --- | --- | --- |
| `heuristic` (default) | **Dev scorer, not a model.** Learns the first 5 windows of each session as its normal and scores band-energy drift. Lets the full flow run before training is done. | "Dev scorer (no trained model)" |
| `autoencoder` | The trained model: a checkpoint from `python -m ml.train` (`MODEL_PATH`). Same feature code as training. Until it loads, `/health` says `model_ready: false` and uploads get 503. See [`docs/AMD_AI_GUIDE.md`](../docs/AMD_AI_GUIDE.md). | "Live model" |
| `embedding` | **Experimental, runs alongside the autoencoder.** Frozen pretrained PANNs CNN14 (AudioSet, Kong et al. 2020; we do not train it) + nearest-neighbour distance to a profile enrolled from this machine's healthy audio (`EMBEDDING_PROFILE`, `PANNS_CHECKPOINT`). See below. | "Live model" |

### Embedding scorer: evaluate, enroll, serve

Needs `pip install -r requirements-ml.txt` (adds `torchlibrosa`, `librosa`). The PANNs weights (~360 MB, CC BY 4.0,
hash-pinned) download on first use to `backend/models/panns/`. Run from the repo root:

```bash
# 1. Evaluate (MIMII <root>/<type>/id_XX/{normal,abnormal} or DCASE <root>/{train,test}); reports → ml/reports/
python -m ml.embed_eval evaluate --data /kaggle/input/datasets/jeandw/mimii-6db --types fan --ids id_00 id_02 id_04 id_06
python -m ml.embed_eval evaluate --data /kaggle/input/datasets/jeandw/mimii-6db            # every type and id
python -m ml.embed_eval evaluate --data <root> --types fan --ref-clips 12                   # ~2 min enrollment
# 2. Enroll the real demo machine from healthy recordings (same mic placement as in the demo)
python -m ml.embed_eval enroll --wavs recordings/fan_healthy/ --machine fan_01 --out backend/models/fan_01_emb.npz
# 3. Serve (from backend/)
SCORER=embedding EMBEDDING_PROFILE=models/fan_01_emb.npz uvicorn app.main:app --port 8000
```

Protocol: splits are by source recording (overlapping windows never cross sets); the threshold is the 99th
percentile of distances from healthy **calibration** clips to the **reference** bank (never the bank to itself);
abnormal clips are used only for the final metrics. The primary config (`pooled` layer, cosine, k=1) is fixed in
advance; the layer/metric/k grid is exploratory. For a fair comparison with the autoencoder, use the DCASE layout:
both then train/enroll on `train/` and are scored on the identical `test/` clips (`ml/run_amd.sh` does this).

### Interference flags (`INTERFERENCE=flag`, default `off`)

Marks windows that contain **speech** (Silero VAD, MIT, `pip install silero-vad`) or a **possible impact/transient**
(spectral flux). Flags never change the score, the status or the alert decision: speech can coincide with a real
fault, and a knock or rattle from the machine itself looks like an impact. A transient is counted once as an event
but flags every overlapping window that contains it; a detector error only drops the flag. When enabled, responses
carry an extra `interference` object (proposed v1.1 field; absent when off) and the dashboard shows
"possible interference in N of the last M windows". Those M windows are exactly the ones the alert policy is counting
(by `recorded_at`, reset by its gap rule). Windows whose flags were never computed count as unchecked, not clean.
When an alert opens, that summary is stored with the event (`interference_note`) and included in the notification.
Silero is stateful, so one window is analyzed at a time (a request that cannot get the detector within 0.25 s is
reported `busy`). Flags run alongside scoring, and the API waits at most 0.8 s for them (`timeout`), so they never
delay alerting. A timed-out result is discarded, never committed to the session state. Measure them on the real fan with
`python -m ml.demo_fan stream ... --interference` before relying on them.

## API (prefix `/api/v1`)

| Route | Auth | Notes |
| --- | --- | --- |
| `GET /health`, `GET /config` | none | config lists accepted input rates; the server resamples to 16 kHz |
| `POST /analyze-window` | `X-Project-Id`, `X-Device-Key` | contract §5.3 plus an optional `note`; duplicates return the cached result, older sequences get 409 |
| `GET /sessions/{id}/events` | viewer or device key | contract §5.4 |
| `POST /sessions/{id}/events/{event_id}/ack` | viewer or device key | acknowledgment, not resolution |
| `GET /projects/{id}` | `X-Viewer-Key` | devices with last seen and latest result, recent events |
| `GET /projects/{id}/stream` | `X-Viewer-Key` | Server-Sent Events: backlog (flagged `replay`) then live |

Errors: 401/403 auth, 409 stale sequence, 413 too large, 422 invalid audio/profile/timestamp, 503 model not ready.

## Hosting

- Run on the AMD GPU machine: `uvicorn app.main:app --host 0.0.0.0 --port 8000` (one worker; live state is in memory).
- It **must be HTTPS** (browsers block mic pages from calling `http://`). Quickest: `cloudflared tunnel --url http://localhost:8000`.
- Set `CORS_ORIGINS` and `PUBLIC_APP_URL` to the deployed frontend URL.
