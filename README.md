# AI Machine Sound Monitoring System

AMD Developer Hackathon: ACT III, Track 1 (Intelligent Industry). A listening device next to a machine streams short
audio windows to an analysis API; the API scores them against the machine's learned normal sound, raises one alert
when unusual sound persists, notifies the registered people, and every dashboard sees it live. Experimental, not a
certified safety or diagnostic system.

Pitch video (2:38, live product on a real fan recording): [`media/pitch-video.mp4`](media/pitch-video.mp4).

Plan and design brief: [`docs/`](docs/). Visual references: [`reference-images/`](reference-images/).

```text
 Listening device (phone/Pi)        Analysis API (AMD GPU server)          Dashboards (any browser)
 project id + device key ──WAV──▶   validate → 16 kHz → score → 3-of-5  ──▶ live scores, alerts, acknowledge
                                    └─▶ email (Resend) / Discord / Slack / webhook to registered people
```

## Status

| Part | State |
| --- | --- |
| Frontend: landing page `/`, console `/app` | Done. Mock mode, device mode and watcher mode |
| Backend: [`backend/`](backend/) FastAPI | Done: contract, device keys, alert policy, notifications, live stream |
| Scoring | **Dev scorer** by default (labelled as such); `SCORER=autoencoder` serves a trained checkpoint |
| ML pipeline: [`ml/`](ml/) | Done: train dense baseline + conv AE, threshold calibration, DCASE metrics, alert simulation |
| AMD training / evaluation | **Pending real run** on the AMD GPU: follow [`docs/AMD_AI_GUIDE.md`](docs/AMD_AI_GUIDE.md) |

## Run it

```bash
# Frontend only, fully simulated (no backend needed)
cd frontend && npm install && npm run dev            # http://localhost:5173

# Real flow: backend + frontend in live mode
cd backend && pip install -r requirements.txt && uvicorn app.main:app --port 8000 --env-file .env
python -m app.admin create-project plant-a "Plant A"         # → dashboard link
python -m app.admin add-device plant-a "Phone at fan"        # → listener link
cd frontend && VITE_MOCK_API=false VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

Open the listener link on the device next to the machine and the dashboard link on any other screen. See
[`backend/README.md`](backend/README.md) for alert subscribers, scorers and the API reference.

## Tests

| Command | Covers |
| --- | --- |
| `cd backend && pytest` | WAV validation/resampling, quality gate, dev scorer, alert policy, auth, idempotency, notify-once, e-mail (Resend)/Discord delivery, no raw audio stored, train → evaluate → serve smoke test |
| `cd frontend && npm test` | WAV encoder, ring buffer, FFT, mock alert policy and scenarios, session reducer, assessment rendering |
| `cd frontend && npm run e2e` | Landing fits the first screen at 5 sizes, mobile overflow, reduced motion, mock console scenarios |
| `cd frontend && npm run e2e:live` | Real backend: device streams via mic, second screen watches the same session, stop → stale |

## Demo without a backend

In `/app` with mock mode, choose **Demo audio**, press **Start monitoring**, then switch the **Simulation scenario**:
normal, transient spike (no alert), sustained anomaly (exactly one alert), silence (`Unable to assess`), slow backend
(windows skipped), backend offline (`Monitoring interrupted`), microphone denied.

## Hosting

Two deployments: the frontend on **Vercel** (root `frontend`, `vercel.json` included) and the API on the **AMD GPU
machine** behind HTTPS (e.g. `cloudflared tunnel --url http://localhost:8000`). Build the frontend with
`VITE_MOCK_API=false` and `VITE_API_BASE_URL=<api https url>`; set the API's `CORS_ORIGINS` and `PUBLIC_APP_URL` to
the frontend URL.

## Open integration questions (for the AI developer)

1. Model checkpoint format, log-mel parameters, threshold and version for `autoencoder.py`.
2. Confirm window 3 s / hop 1 s / 16 kHz with the trained model (frontend reads them from `/config`).
3. Proposed v1.1 additions now implemented: events schema, acknowledge route, project/device keys, stream, `note`.
4. M3 consistency test: feed the same digital audio through upload and live paths.
