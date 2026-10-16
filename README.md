# AI Machine Sound Monitoring System

AMD Developer Hackathon: ACT III, Track 1 (Intelligent Industry). An experimental web console that listens to a
supported machine, scores each audio window with an anomaly model, and raises a review alert when unusual sound
persists. Not a certified safety or diagnostic system.

Plan and design brief: [`docs/`](docs/). Visual references: [`reference-images/`](reference-images/).

## Status

**M1 (frontend, mock mode): done.** The dashboard runs against a deterministic in-browser mock backend that
implements the `/api/v1` contract. No trained model or GPU is involved yet, and the UI labels everything
**Simulation**.

## Frontend

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm test         # vitest
npm run build
```

Env (`frontend/.env.example`):

| Var | Default | |
| --- | --- | --- |
| `VITE_MOCK_API` | `true` | `false` switches to the real FastAPI service |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Backend origin; routes are under `/api/v1` |

### Demo without a microphone

Choose **Demo audio**, press **Start monitoring**, then switch the **Simulation scenario** while it runs:

| Scenario | What you should see |
| --- | --- |
| Normal operation | Low scores, `Normal`, no alerts |
| Transient spike | One window above threshold, **no** alert |
| Sustained anomaly | Scores stay high → exactly **one** alert (toast + history) until recovery |
| Silence / poor signal | `Unable to assess`, no score claimed |
| Slow backend | Responses slower than the hop; windows are skipped, not queued |
| Backend offline | `Monitoring interrupted`; never a stale `Normal` |
| Microphone denied | Permission error with recovery steps and a demo-audio fallback |

`Microphone` uses the real mic (native sample rate, echo cancellation/noise suppression/AGC off) with the mock scorer.

## Open integration questions (for the AI developer)

1. **Sample rate:** the frontend sends WAV at the browser's native rate (usually 44.1/48 kHz) and expects the
   backend to resample to 16 kHz. `/config` should say whether non-16 kHz input is accepted.
2. **Proposed v1.1 additions** (mocked, not yet agreed):
   - `GET /sessions/{id}/events` response shape (`AlertEvent` in `frontend/src/types/monitoring.ts`).
   - `POST /sessions/{id}/events/{event_id}/ack`: acknowledgment only, not resolution.
   - One event per uninterrupted anomaly, closed after N consecutive normal windows, then cooldown; long gaps
     reset the 3-of-5 count.
3. The real model version, profile IDs, window/hop, score range and threshold; the UI reads these from `/config`.
4. M3 consistency test: inject the same digital audio into both paths (speaker→mic playback changes the signal).
