# AI Machine Sound Monitoring System

**Project context, development plan, and AI–frontend integration specification**  
**Working title:** AI Machine Sound Monitoring System (no final brand name)  
**Event:** AMD Developer Hackathon: ACT III, Track 1 — Intelligent Industry  
**Document status:** Implementation brief for the development team and Claude Code  
**Updated:** October 16, 2026

> **One-sentence pitch:** A web-based monitoring system that continuously listens to machinery, uses a machine-learning model to detect unusual acoustic patterns, and alerts an operator with evidence of when and where the anomaly occurred.

> **Important scope statement:** This is an experimental acoustic anomaly detector, not a certified industrial safety system, fault diagnosis service, or proven predictor of impending failure.

---

## 1. Project background and decisions

### 1.1 How we arrived here

The team considered several concepts for the AMD hackathon, including interactive AI experiences. We selected industrial acoustic monitoring because it addresses a tangible problem, uses AI as the core technical capability, can be evaluated against public research datasets, and fits the Intelligent Industry track.

The initial prototype concept was an audio uploader that shows **Normal** or **Abnormal** from a trained model. The team agreed that this is insufficient as a product: workers should not have to upload audio files or file reports whenever they suspect a problem. The intended primary experience is **continuous live listening and automatic alerts**. Audio uploads remain a secondary testing and demonstration tool.

The approach is based on established anomalous sound detection research. Training an autoencoder on normal machine sounds is **not itself a novel technique**; the DCASE 2020 Task 2 baseline already does this. Our hackathon contribution is an integrated monitoring workflow with understandable alerts, temporal aggregation, source audio, and a credible evaluation on AMD GPU infrastructure. Claims of improved accuracy or industrial reliability require evidence.

### 1.2 Current team split

| Responsibility | Frontend developer | AI developer (brother) |
| --- | --- | --- |
| App layout, styling, responsiveness | **Owner** | Consulted |
| Microphone permission, capture, buffering | **Owner** | Defines input contract |
| Live waveform/spectrogram presentation | **Owner** | Defines feature conventions |
| Dashboard, history, alerts, settings | **Owner** | Consulted |
| Mock API and frontend states | **Owner** | Reviews contract |
| Dataset, preprocessing, train/validation/test | Consulted | **Owner** |
| Autoencoder design, training on AMD | Not owner | **Owner** |
| Threshold calibration and metrics | Displays results | **Owner** |
| Model inference endpoint and serialization | Integrates | **Owner** |
| End-to-end integration / demo / README | Shared | Shared |

**Team agreement:** UI work and model training proceed in parallel using a versioned, written API contract. Neither developer should change audio preprocessing or response fields silently. Prefer one shared repository or a contract file committed to both repositories.

### 1.3 Target users and situation

- **Primary user:** A maintenance technician or small-plant operator responsible for supervising a specific machine.
- **Target machines for the prototype:** One fan or pump family, depending on the dataset/model quality. The system should not pretend to support every machine with one model.
- **Current workflow:** The operator starts monitoring, grants microphone access, selects a supported machine profile, and can leave the dashboard displaying ongoing acoustic health and alerts.
- **Target value:** Earlier visibility into unusual acoustic behavior, with less dependence on manual incident reporting. Whether this saves downtime or costs must be tested in real deployments.

### 1.4 Clear product boundaries

**The system does:**
- Record audio from an authorized microphone while monitoring is active.
- Segment the audio into rolling windows and send supported input to the inference service.
- Score acoustic deviation against an appropriate learned reference model.
- Display live status, charts, recent score trends, anomaly events, and evidence.
- Raise alerts after repeated anomalous windows instead of reacting to every spike.
- Allow the user to replay or export an anomaly excerpt, if recording retention is enabled.
- Show model provenance and benchmark results without inventing accuracy claims.

**The system does not yet:**
- Predict the date or probability of machine failure.
- Identify the exact mechanical fault from a generic autoencoder score.
- Monitor all machines in a factory from one arbitrary microphone.
- Operate reliably in the background after a browser tab closes.
- Remotely stop equipment or replace technician judgment.
- Guarantee adaptation to a new machine after one minute of recording.

---

## 2. Success criteria and hackathon alignment

The ACT III Intelligent Industry brief calls for a *working product*, realistic industrial data, an operator-understandable output, and measurable improvement potential. AMD technology must support a meaningful part of the solution.

**Our submission evidence:**
1. **Working product:** Real microphone → short audio windows → real trained model → real scores → alert history.
2. **AMD contribution:** Show the model trained and/or inferred on an AMD GPU using PyTorch ROCm, with machine/runtime evidence and measured latency.
3. **Technical validity:** Evaluate on held-out normal and anomalous sounds, record the baseline comparison honestly, and show a score threshold chosen without leaking final test labels.
4. **Useful operator output:** Display abnormal acoustic intervals and an inspect/recheck recommendation, not unsupported mechanical diagnoses.
5. **Demonstration:** Replay a normal sample, then a labeled anomalous sample through the same inference pipeline; optionally use a microphone with an ordinary desk fan for environmental demonstration, without introducing an unsafe physical fault.
6. **Scalability story:** A future dedicated edge microphone agent could perform sustained capture and forward data to GPU inference, without pretending the browser prototype already does this.

**Avoid claiming:** patented novelty, 100% accuracy, zero false alarms, certain impending failure, deployment-grade uptime, guaranteed cost savings, or proprietary diagnostic expertise. All quantitative claims must come from recorded experiments.

---

## 3. Recommended technical architecture

```text
                             FRONTEND (React + TypeScript)
  ┌───────────────────────────────────────────────────────────────────┐
  │ Microphone permission and monitoring controls                    │
  │ AudioWorklet / Web Audio API → PCM rolling buffer                 │
  │ Live waveform, spectrogram, model-status cards                    │
  │ Anomaly trend, alerts, replay/evidence, machine selection         │
  └───────────────────────────────┬───────────────────────────────────┘
                                  │
               HTTPS + POST audio window (MVP; 1 request/window)
                                  │
                                  ▼
                              API SERVICE
  ┌───────────────────────────────────────────────────────────────────┐
  │ FastAPI                                                         │
  │ Validate sample format / machine profile / payload / session     │
  │ Audio standardization → inference adapter → result                │
  │ Session alert aggregation, event persistence, health endpoint     │
  └───────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
                   AMD GPU MODEL INFERENCE SERVICE
  ┌───────────────────────────────────────────────────────────────────┐
  │ PyTorch + ROCm (e.g. AMD Instinct MI300X if provisioned)          │
  │ Log-mel spectrogram → autoencoder → reconstruction error          │
  │ Raw anomaly score + calibrated threshold + metadata              │
  └───────────────────────────────────────────────────────────────────┘
```

**Deployment note:** The React frontend can run on a separate host. Only the AI workload(s) genuinely executed on AMD may be claimed as AMD-accelerated. A cloud-based GPU and ordinary browser microphone introduce network and monitoring-availability limitations.

### 3.1 Frontend stack

- React, TypeScript, Vite.
- Tailwind CSS for a consistent design system; plain CSS or SVG for graphs where suitable.
- Web Audio API / `AudioWorklet` for controlled PCM capture; use `getUserMedia` with explicit permission.
- Lightweight plotting library if necessary; prefer accessible SVG/Canvas charting rather than continuously re-rendering huge React arrays.
- Fetch with request cancellation and a small backpressure-aware client queue.
- Optional IndexedDB or backend storage for non-sensitive local event history; do **not** store raw microphone data by default.

### 3.2 AI/backend stack

- Python 3.11+, FastAPI, Pydantic v2, PyTorch + compatible ROCm build.
- `librosa` or `torchaudio` for a *single documented preprocessing pipeline*; verify library compatibility on the selected ROCm image.
- Machine-family-specific model profile, checkpoint, preprocessing metadata, and threshold.
- Optional SQLite for prototype sessions/alerts, or an in-memory store for first integration.
- No LLM is necessary for anomaly detection. Gemma-generated explanations are optional and must never invent diagnoses.

### 3.3 Audio preprocessing: one agreed configuration

**Provisional MVP settings, to be confirmed by the AI developer before integration:**

| Parameter | Proposed starting point | Owner / note |
| --- | --- | --- |
| Monitored machine | `fan` | AI developer chooses initial target |
| Input sample rate | 16,000 Hz | Consistent with original MIMII recordings; confirm model pipeline |
| Channels | Mono | Downmix consistently, document method |
| Window duration | 3.0 seconds | Provisional, tune with trained model |
| Window hop | 1.0 second | Overlap improves update frequency |
| Audio payload | 16-bit PCM WAV | Easy to inspect, no lossy codec ambiguity |
| Representation | Log-mel spectrogram | Parameters fixed in model metadata |
| Model | CNN autoencoder candidate | Compare with simple dense DCASE-style baseline |
| Decision metric | Reconstruction error | Raw numeric value, not automatically probability |
| Threshold | Calibrated on development data | Per supported profile, with version |
| Notification rule | 3 of last 5 valid windows > threshold | MVP heuristic, evaluate empirically |
| Cooldown | 30 seconds | MVP heuristic, tune before deployment |

**Do not lock these numbers without a trained model.** The UI should read window/hop/sample-rate requirements from a `/config` endpoint. The backend may resample to its required rate, but the client should not improvise feature extraction that differs from training. Log-mel calculation and normalization must match **exactly** at training and inference.

**Signal-quality states:** `ok`, `silence`, `clipping`, `noisy`, `unsupported`, and `unknown`. If quality is inadequate, display **Unable to assess** and suppress confident Normal/Abnormal claims. Acoustic anomalies can arise from microphone movement and ambient noise, not only equipment faults.

### 3.4 Continuous monitoring semantics

- Continuous means **repeated inference while monitoring is enabled**, not sample-by-sample neural inference.
- The browser maintains a rolling audio buffer and submits windows at the configured hop.
- One in-flight request at a time in the MVP. Skip stale windows if the service falls behind rather than letting a growing queue imply false real-time operation.
- On lost connection, permissions revoked, hidden/tab suspended, or backend failure, change status to **Monitoring interrupted / Unknown**. Never leave a stale green **Normal** status displayed as live.
- Microphone monitoring ends when the browser stops capture, closes, or otherwise cannot record; production always-on monitoring requires a separate edge capture service.
- Different profiles may require different audio preprocessing and per-machine thresholds.

---

## 4. ML approach and rigorous evaluation

### 4.1 Terminology

This project uses **normal-only anomaly detection**. The model learns to reconstruct normal acoustic patterns and assigns a larger score to sounds it reconstructs poorly. In some research settings this is called one-class or semi-supervised anomaly detection because normal-only training examples are explicitly selected. The DCASE 2020 task uses the label **unsupervised anomalous sound detection**. Do not confuse the task name with training on a completely unlabeled mixture of normal and abnormal recordings.

### 4.2 Baseline before improvement

- First implement or reproduce a small dense autoencoder baseline or equivalent well-documented method.
- Train the intended CNN autoencoder as an experimental comparison.
- Use **the same held-out evaluation split** for both approaches.
- Report training time, model size, validation/test ROC AUC, pAUC (where comparable), false-positive rates, and inference latency.
- If the CNN model is worse, use the better validated model. The product should not rely on a specific architecture for branding.

### 4.3 Dataset choice

Start with **DCASE 2020 Task 2 development data** for one machine family, or a manageable MIMII subset. MIMII includes sound data for fans, pumps, valves, and slide rails, with normal and anomalous recordings mixed with factory background noise. The original MIMII Zenodo release is large (approximately 100 GB across archives), so do not download everything immediately.

Recommended evaluation protocol:

1. Reserve normal-only training data for model learning.
2. Use separate normal development/validation data for early stopping and threshold calibration.
3. Keep labeled normal and anomalous test clips unseen until the model and threshold are chosen.
4. Avoid mixing overlapping windows from the **same original clip** across training and test splits.
5. Test on multiple machine IDs only where datasets and protocol support the claim.
6. For simulated live monitoring, stream held-out audio sequentially in short windows and measure both per-clip classification and event-level alert behavior.

### 4.4 Required metrics

| Metric | Why it matters |
| --- | --- |
| ROC AUC | Measures ranking discrimination over thresholds; **not** accuracy |
| pAUC | Focuses on a low false-positive region when matching benchmark protocol |
| True/false positives and precision/recall | Explain behavior at the chosen threshold |
| False alerts per hour | Operational burden in simulated monitoring |
| Detection delay | Time from onset of an annotated anomalous region to alert, if onset labels exist |
| End-to-end latency | Time from collected window through displayed result |
| Model inference latency | Isolates model cost from upload and UI rendering |
| Performance by machine ID / noise condition | Reveals generalization limitations |

**Critical:** If fault onset timestamps are unavailable, do not invent detection-delay results. If the dataset contains clip-level labels only, report clip-level evaluations and separately describe the assumptions behind any simulated event-onset tests.

### 4.5 Local machine demonstration

A typical home fan may have acoustic characteristics unlike the industrial training dataset. If the model flags a fan as abnormal, that **does not validate fault recognition**. Use test audio from the held-out dataset as the ground-truth part of the live demo; use the physical microphone only to demonstrate real capture and acknowledge domain shift.

Do not deliberately destabilize rotating equipment for the demo. A safer option is playback of prerecorded abnormal sound clips into the microphone or a preloaded audio simulator, clearly labeled as replay.

---

## 5. Backend API contract (v1)

These routes are **proposed endpoints the team will implement**, not external AMD APIs. Model server URLs and credentials stay in environment variables. Prefix all paths with `/api/v1`.

### 5.1 `GET /api/v1/health`

```json
{
  "service": "ok",
  "model_ready": true,
  "mode": "mock",
  "model_version": "mock-v1"
}
```

### 5.2 `GET /api/v1/config`

```json
{
  "contract_version": "1.0",
  "supported_profiles": [
    {"id": "fan_01", "label": "Demo Fan", "machine_type": "fan"}
  ],
  "input": {
    "sample_rate_hz": 16000,
    "channels": 1,
    "format": "wav_pcm_s16le",
    "window_ms": 3000,
    "hop_ms": 1000,
    "max_upload_bytes": 500000
  },
  "score": {
    "name": "reconstruction_error",
    "higher_means_more_anomalous": true,
    "is_probability": false
  },
  "alert_policy": {
    "min_anomalous_windows": 3,
    "consider_last_valid_windows": 5,
    "cooldown_seconds": 30
  }
}
```

### 5.3 `POST /api/v1/analyze-window`

`multipart/form-data`:

- `audio`: exactly one configured WAV window as bytes.
- `machine_id`: supported profile ID, e.g. `fan_01`.
- `session_id`: client-generated UUID or UUID returned by session start.
- `sequence`: monotonically increasing integer.
- `recorded_at`: ISO 8601 timestamp with offset; time refers to the **end of the window**.

**Illustrative response:**

```json
{
  "contract_version": "1.0",
  "session_id": "example-session-uuid",
  "machine_id": "fan_01",
  "sequence": 12,
  "recorded_at": "2026-10-16T15:00:12+08:00",
  "status": "anomaly",
  "signal_quality": "ok",
  "anomaly_score": 0.82,
  "threshold": 0.65,
  "score_unit": "reconstruction_error",
  "is_probability": false,
  "is_anomaly_window": true,
  "alert": {
    "triggered": true,
    "event_id": "event-uuid",
    "reason": "3 of the last 5 valid windows exceeded threshold"
  },
  "processing": {
    "model_ms": 64,
    "server_ms": 115
  },
  "model_version": "mock-v1",
  "spectrogram_overlay": null
}
```

**Status enum:** `normal | anomaly | unable_to_assess`. `alert.triggered` means a NEW aggregated alert event fired, not that this individual window alone proves a fault. Raw scores should have sufficient numerical precision; UI must not convert them to a false percentage of failure.

**Error behavior:** return a documented 4xx for invalid format/profile/window, 503 for model unavailable, 429 or 503 for overload; all cases must be handled without collapsing the dashboard. No fake green status after failures.

### 5.4 Events and metrics

- `GET /api/v1/sessions/{session_id}/events` → list of alert events, timestamps, anomaly-window counts, optional evidence references.
- `GET /api/v1/metrics` → benchmark/model metadata and actual service metrics, with missing data represented as `null` or `not_measured`.
- `POST /api/v1/analyze-file` → optional offline uploaded-audio path; produces scored windows using the same preprocessing and inference code.

**Alternative for a later phase:** WebSocket binary PCM frames, once the reliable HTTP-window pipeline is working. Do not introduce a custom streaming protocol before defining windowing, timestamps, out-of-order behavior, and reconnect semantics.

### 5.5 Frontend-facing TypeScript types

```ts
export type MonitoringStatus =
  | 'idle'
  | 'requesting_permission'
  | 'monitoring'
  | 'interrupted'
  | 'stopped';

export type AssessmentStatus =
  | 'normal'
  | 'anomaly'
  | 'unable_to_assess';

export type SignalQuality =
  | 'ok' | 'silence' | 'clipping' | 'noisy'
  | 'unsupported' | 'unknown';

export interface WindowResult {
  contract_version: '1.0';
  session_id: string;
  machine_id: string;
  sequence: number;
  recorded_at: string;
  status: AssessmentStatus;
  signal_quality: SignalQuality;
  anomaly_score: number | null;
  threshold: number | null;
  score_unit: string;
  is_probability: false;
  is_anomaly_window: boolean | null;
  alert: {
    triggered: boolean;
    event_id: string | null;
    reason: string | null;
  };
  processing: { model_ms: number | null; server_ms: number | null };
  model_version: string;
  spectrogram_overlay?: null | {
    time_bins: number;
    frequency_bins: number;
    values: number[];
  };
}
```

**Ownership and source of truth:** The backend (or a shared deterministic server module) owns score calibration, quality gating, alert aggregation, and event identity. The frontend renders results and may play a sound for newly received events, but must not independently invent alerts from arbitrary visualization thresholds.

---

## 6. Mock-first development

Set `VITE_MOCK_API=true` locally, with a deterministic mock adapter implementing the same TypeScript interface as the real API.

Include at least five scripted modes:

1. `normal`: low stable scores, valid signal quality.
2. `anomaly`: repeated high scores lead to **one** alert after the aggregation rule.
3. `transient_spike`: one high score does **not** cause an alert.
4. `mic_denied`: permission failure and retry instructions.
5. `backend_offline`: interruption and no misleading live status.

Additional edge cases: silence/clipping, delayed response, out-of-order sequence, lost network, profile change while monitoring, stopping during upload, and empty alert history.

Use fake timestamps and measured-looking values only within explicit **Demo / Simulated** mode. The real UI must clearly display **Live model** or **Simulation** so demo data is never presented as measured performance.

---

## 7. End-user workflow

### First visit

1. Open app and select a supported machine profile.
2. Read concise data/permission explanation, select microphone, and click **Start monitoring**.
3. Browser requests microphone permission. If denied, show recovery guidance and offer **Try sample audio**.
4. Show `Initializing` until the service receives the first valid analysis result.
5. Show `Normal`, `Abnormal acoustic pattern`, or `Unable to assess`, with the most recent reading time.

### During monitoring

1. Waveform responds instantly to captured audio.
2. Spectrogram displays frequency activity as an interpretive visual, with labeled axes.
3. New anomaly scores plot against their matching calibrated threshold.
4. After repeated anomalous windows, an alert appears with time, machine, score/evidence, and a short inspection recommendation.
5. An operator can acknowledge an alert without claiming the underlying mechanical condition has been resolved.
6. Connection errors visibly interrupt monitoring status; repeated alert notification spam is suppressed.

### Stop / review

1. Click **Stop monitoring**; browser stops every microphone track and flushes/discards buffers.
2. Review events and model metadata.
3. Replay audio only if the user explicitly enabled evidence retention. Otherwise store timestamps and scores without raw audio.

---

## 8. Proposed repository structure

```text
project-root/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── monitoring/
│   │   │   ├── charts/
│   │   │   ├── alerts/
│   │   │   └── layout/
│   │   ├── hooks/useMicrophoneStream.ts
│   │   ├── audio/rollingBuffer.ts
│   │   ├── audio/wavEncoder.ts
│   │   ├── api/monitoringClient.ts
│   │   ├── api/mockMonitoringClient.ts
│   │   ├── types/monitoring.ts
│   │   ├── pages/Dashboard.tsx
│   │   └── styles/
│   ├── .env.example
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── schemas.py
│   │   ├── routers/
│   │   ├── inference/
│   │   ├── audio/
│   │   └── alerting/
│   ├── tests/
│   └── requirements.txt
├── ml/
│   ├── train.py
│   ├── evaluate.py
│   ├── models/
│   ├── features/
│   ├── configs/
│   └── reports/
├── shared/
│   └── api-contract-v1.md
├── reference-images/      # only the user's supplied references
├── docs/
│   ├── PROJECT_PLAN.md
│   └── DESIGN_BRIEF.md
├── .gitignore
└── README.md
```

Keep raw datasets and large model weights outside Git; document download locations and model provenance. No credentials or unrestricted audio recordings in the public repository.

---

## 9. Milestones and acceptance tests

The order is intentionally **mock UI first** so the frontend can proceed while the model is trained. Each milestone should produce a runnable state and a commit.

### M1 — UI skeleton and mock integration (frontend lead)

**Deliver:** Dashboard shell, monitoring controls, responsive layout, fake signal/chart stream, model-mode badge, mock alert history. Reference `DESIGN_BRIEF.md`.

**Accept when:** A judge can trigger normal, sustained-anomaly, single-spike, and disconnected demonstrations without GPU access. App never crashes or shows a stale Normal status after disconnect.

### M2 — Model experiment and evaluation (AI lead, parallel with M1)

**Deliver:** One machine profile, documented dataset subset/split, dense baseline or equivalent, proposed CNN autoencoder, saved checkpoint, threshold-selection code, actual evaluation report.

**Accept when:** A held-out test script produces reproducible raw scores, test ROC AUC and pAUC when applicable, with no test-set leakage. Recorded AMD runtime/training evidence must reflect actual use.

### M3 — Contract and true integration (both)

**Deliver:** FastAPI config, health, and analyze-window routes; one shared encoding path; microphone windows sent to live inference; network/permission handling.

**Accept when:** A supported uploaded audio sample and the same audio replayed through the monitoring pipeline produce consistent scores within tolerance, and a status change uses actual model output.

### M4 — Useful monitoring and alerts (both)

**Deliver:** 3-of-5 alert policy or calibrated replacement, cooldown, trend/history, acknowledge action, signal-quality interruption, optional saved evidence.

**Accept when:** Sustained anomalies raise an event, a single isolated spike does not, and silence/disconnect creates Unknown rather than a false Normal state.

### M5 — Demo, proof, and submission (both)

**Deliver:** Benchmark page, measured timing, model/version labels, README, reproducible demo sequence, short video and presentation, publicly accessible repository and working app if required.

**Accept when:** Demo clearly separates mock vs real, shows AMD involvement truthfully, and presents actual model performance and limitations. Verify the final submission time in the event portal.

### What to cut if time is running out

Cut in this order: LLM explanations → push notifications → dedicated per-machine calibration → historical multi-machine fleet view → waveform evidence export → sophisticated animations. **Never cut the core microphone-to-model-to-alert demonstration or honest model evaluation.**

---

## 10. Test plan

### Frontend tests

- Microphone denied, permission later granted, missing input device.
- Start/stop repeated, page unload, stop during in-flight upload.
- PCM encoding sample count and WAV header correctness.
- Browser stream at 44.1/48 kHz converted or accepted correctly under agreed config.
- Scores displayed without claiming percentage probability.
- Alert list updates once per event ID, not once per anomalous window.
- Disconnected backend changes UI to Unknown/Interrupted immediately.
- Mobile/tablet narrow layout still exposes Start/Stop and alerts.

### Backend tests

- Reject mismatched sample rate, unsupported machine, corrupt WAV, overlong audio, invalid content type.
- Reject window/sequence mismatches and handle duplicates idempotently.
- Confirm same feature pipeline for training and inference.
- Check alert 3-of-5 and cooldown logic deterministically.
- Check score and threshold are model-profile-specific.
- Ensure unready model returns an explicit error.
- Check no raw audio is persisted when retention disabled.

### Model tests

- Zero/near-zero signal and very loud/clipped signal.
- Held-out normal and labeled anomaly clips.
- Known background-noise/domain-shift subsets.
- Repeated runs produce reproducible scores within expected numeric tolerance.
- Benchmark against a simple reference model on identical splits.

---

## 11. Risks and mitigation

| Risk | Mitigation |
| --- | --- |
| Frequent alerts due to unrelated room sounds | Signal-quality gate, temporal aggregation, supported microphone placement, noise/domain-shift evaluation |
| Poor generalization from industrial data to desk fan | Use held-out dataset replay for accuracy claims; label physical demo exploratory |
| Model does not classify a machine type well | Use the best supported profile rather than promise universal coverage |
| Frontend/backend audio mismatch | Versioned `/config`, canonical test WAV, contract tests, strict resampling |
| Slow cloud inference | Overlapping windows, one request in flight, drop stale work, report latency |
| ROCm compatibility or cloud limits | Run smoke test early; keep frontend fully demoable in mock mode |
| Browser background throttling or tab closure | Clearly state monitoring availability; future edge agent |
| Inadvertent voice/privacy capture | Explicit microphone permission, no raw audio by default, opt-in evidence retention |
| Novelty criticism | Admit method is established; demonstrate product integration, tested performance, and monitoring usability |
| False sense of industrial safety | Human-review language and explicit experimental limitations; no machine-stop automation |

---

## 12. Business case and future roadmap

**Candidate buyers:** Small industrial facilities and maintenance contractors needing an inexpensive acoustic indication layer on selected non-critical equipment. This buyer hypothesis is **not validated** and requires interviews and trials.

**Revenue hypothesis:** Per monitored machine/month or per on-prem/edge gateway. Include costs for microphones, inference hosting, data transfer, model calibration, maintenance, and false-alarm handling before claiming cost advantages over established predictive-maintenance products.

**After the hackathon:**
1. Replace browser dependence with a local device/edge agent for sustained capture.
2. Run controlled pilot studies on actual equipment with recorded operating modes.
3. Add per-machine adaptation with robust baseline validation.
4. Compare modern audio anomaly algorithms and multi-sensor fusion if the data supports it.
5. Evaluate long-term alert burden and operator trust, not just per-clip AUC.
6. Consider fleet-management UI only when multiple machines have separate sensors and profiles.

---

## 13. Submission narrative

### Short description

A live AI acoustic-monitoring web app that listens to supported machines, detects unusual sound patterns with an AMD-trained anomaly model, and alerts operators with time-based visual evidence.

### 30-second explanation

Many machines produce distinctive sound patterns during normal operation. Our system uses microphone audio and a model trained on normal machine recordings to flag unusual acoustic deviations. Instead of requiring workers to upload a clip or report a problem, the prototype runs repeated inference while monitoring is active, presents the anomaly history, and issues review alerts. We evaluate the detector on a public benchmark and report its limitations.

### 2-minute demo outline

1. **0:00–0:20:** Identify a single monitored fan profile and explain why acoustic changes matter.
2. **0:20–0:40:** Show active audio capture and live waveform/spectrogram.
3. **0:40–1:10:** Play held-out normal and anomalous samples through the real model pipeline; show raw anomaly scores and time windows.
4. **1:10–1:30:** Sustained high scores produce an alert; a transient spike does not.
5. **1:30–1:50:** Show AMD GPU training/inference evidence and real benchmark metrics.
6. **1:50–2:00:** Describe target buyer, limits, and the edge-monitoring roadmap.

---

## 14. Immediate handoff to Claude Code

Give Claude Code **this file and `DESIGN_BRIEF.md`**, plus any reference-image files you attach. Say:

> Build only Milestone M1 in the `frontend/` directory. Implement the full dashboard using the mock API contract in this document. Do not invent GPU endpoints, accuracy statistics, training results, or customer claims. Read `DESIGN_BRIEF.md` and inspect all supplied reference images before choosing layout or styling. Run the app, run frontend tests, and make one focused commit. Stop after M1 and report files changed, decisions, and any unresolved integration assumptions.

**Before live integration, have the AI developer explicitly confirm:** model name/version, profile ID(s), PCM format, sample rate, exact window/hop, preprocessing parameters, raw score range, threshold, signal quality handling, inference shape, and latency limits.

---

## References

1. lablab.ai. (2026). *AMD Developer Hackathon: ACT III*. https://lablab.ai/ai-hackathons/amd-developer-hackathon-act-iii
2. DCASE. (2020). *Unsupervised Detection of Anomalous Sounds for Machine Condition Monitoring, Task 2*. https://dcase.community/challenge2020/task-unsupervised-detection-of-anomalous-sounds
3. Kawaguchi, Y., et al. (2020). *DCASE 2020 Task 2 baseline system* [Code]. GitHub. https://github.com/y-kawagu/dcase2020_task2_baseline
4. Purohit, H., et al. (2019). *MIMII Dataset: Sound Dataset for Malfunctioning Industrial Machine Investigation and Inspection* [Dataset]. Zenodo. https://doi.org/10.5281/zenodo.3384388
5. DCASE. (2021). *Unsupervised Anomalous Sound Detection for Machine Condition Monitoring under Domain Shifted Conditions*. https://dcase.community/challenge2021/task-unsupervised-detection-of-anomalous-sounds
6. AMD. (n.d.). *ROCm documentation*. https://rocm.docs.amd.com/

**Date note:** The official event page currently lists the online phase as October 12–18, 2026. The team's stated submission cutoff of October 18 at 6:00 p.m. Pacific would equal October 19 at 9:00 a.m. Philippine time, but the exact hour must be confirmed on the actual submission portal, which may differ from the general event page.
