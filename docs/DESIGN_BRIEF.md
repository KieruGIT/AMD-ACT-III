# AI Machine Sound Monitoring System — UI/UX Design Brief

**Separate frontend design specification for Claude Code and visual-reference review**  
**Working title:** AI Machine Sound Monitoring System (do not brand it yet)  
**Companion file:** `PROJECT_PLAN.md`  
**Purpose:** Build a distinctive, credible real-time industrial monitoring interface without depending on the trained model being ready.

> **For Claude Code:** You will receive reference screenshots/images from the user. **Inspect those images first.** Use them as the primary visual direction, adapt them to our information architecture, and do not assume the files already exist. If no image has been attached, follow the design fallback described below. Do not copy a third-party product's branding, proprietary illustrations, or exact copyrighted screen wholesale.

---

## 1. Design objective

The app must let an operator answer four questions within seconds:

1. **Is the system actively listening to the selected machine?**
2. **Is the current audio consistent with the machine's learned normal behavior?**
3. **If something unusual happened, when and for how long?**
4. **What evidence is available, and what should the operator do next?**

This is a **monitoring console**, not a consumer music player, a generic analytics admin template, or a chatbot. Its visual identity should communicate trust, precision, and quiet urgency. The visualizations are functional evidence rather than decoration.

**Primary experience:** desktop at approximately 1440 × 900.  
**Secondary experience:** usable on tablets and phones, with monitoring controls and alerts always accessible.

---

## 2. Reference-image workflow

### 2.1 How to provide references

The user will attach screenshots or image files to Claude Code or place them inside `reference-images/` with meaningful names, such as:

```text
reference-images/
  reference-01-overall-layout.png
  reference-02-charts-and-waveform.png
  reference-03-navigation-and-cards.png
  reference-04-typography.png
```

These names are **examples**, not claims that the files exist. Do not create fake reference screenshots to satisfy the design request.

### 2.2 Required Claude Code steps

1. Inspect every supplied reference image at native or sufficiently high resolution.
2. Summarize which visual patterns to reuse: composition, information density, spacing, typography, hierarchy, chart treatment, color system, and interaction feel.
3. Note anything unsuitable for machine monitoring, such as unreadable labels or low-contrast status indicators.
4. Create a small design-tokens file and reusable components before building pages.
5. Implement a mock-mode dashboard and verify at desktop and mobile sizes.
6. Preserve functionality and accessibility even when matching a reference aesthetic.
7. Show a concise comparison of final screen to reference-derived visual goals, not a fabricated pixel-accuracy score.

### 2.3 Reference review worksheet

Complete these fields after viewing the actual images:

| Design aspect | Notes to extract from supplied references |
| --- | --- |
| Overall composition | Sidebar/topbar, card placement, main focal region |
| Theme | Light/dark, neutral palette, accent colors |
| Typography | Heading hierarchy, numeric typography, dense labels |
| Data visualization | Line weight, grid style, axes, tooltips, overlays |
| Cards | Radius, borders, elevation, internal spacing |
| Spacing | Density, vertical rhythm, left/right margins |
| Interactions | Active controls, selected states, loading, alert treatment |
| Mobile behavior | Any usable precedent; otherwise adapt logically |

---

## 3. Fallback visual direction when no references are supplied

Use a **premium industrial observability dashboard** style:

- Dark-neutral application shell with slightly lighter surfaces.
- Clean, restrained typography with exceptionally readable timestamps and numbers.
- A single distinct accent for active monitoring, with semantic colors reserved for actual health states.
- Hairline borders and subtle shadows, not oversized glassmorphism or glowing neon everywhere.
- Clear chart legends and subtle axis/gridlines.
- Larger monitoring state and primary controls; smaller supplementary performance metrics.
- No emojis, fake terminal noise, meaningless percentages, or decorative machinery stock photography.

**Fallback tokens (can be overridden by user reference images):**

```css
:root {
  --bg: #0b1016;
  --surface: #121b25;
  --surface-raised: #172330;
  --border: #293849;
  --text: #edf3f8;
  --text-muted: #94a7b9;
  --accent: #58b2ff;
  --normal: #45c99a;
  --warning: #f0bc5d;
  --anomaly: #f27777;
  --unknown: #a8b0bb;
  --radius-sm: 8px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --space-unit: 4px;
}
```

Colors and typefaces are **proposed defaults**, not fixed project requirements. Never rely on color alone to convey machine status. Respect accessible contrast, visible focus states, and reduced-motion preferences.

---

## 4. Information architecture

### Primary screens

| Screen | Priority | Purpose |
| --- | --- | --- |
| **Live Monitoring** | P0 | Main product: status, audio, score trend, alerts, controls |
| **Alert History** | P0 | Timestamped events with evidence and acknowledgment |
| **Audio Test / Upload** | P1 | Evaluate prerecorded WAV files through the same model |
| **Model & System Info** | P1 | Model status/version, supported machine, real benchmark metrics |
| **Settings** | P1 | Microphone and machine selection, display preferences |
| Fleet overview | Future | Only when independently monitored machines actually exist |

Do not build a large fake navigation menu full of empty routes. If only one page is implemented for M1, show a cohesive dashboard with functional drawers/tabs for secondary content.

### Suggested desktop shell

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ APP IDENTIFIER     Live Monitoring / Fan 01            Mock/Live  User controls │
├──────────────┬─────────────────────────────────────────────────────────────────┤
│ OVERVIEW     │ [ Machine / input ] [ Monitoring status ] [ Latest update ]    │
│              │                                                                 │
│ LIVE         │ ┌──────────────────────────────────────┬────────────────────┐ │
│ MONITORING   │ │ LIVE AUDIO WAVEFORM                  │ CURRENT ASSESSMENT │ │
│              │ │ real-time amplitude vs time          │ Normal / Abnormal  │ │
│ ALERTS       │ ├──────────────────────────────────────┤ score + threshold  │ │
│              │ │ SPECTROGRAM                          │ quality / latency  │ │
│ AUDIO TEST   │ │ time vs frequency intensity          │ Start / Stop       │ │
│              │ └──────────────────────────────────────┴────────────────────┘ │
│ MODEL INFO   │ ┌────────────────────────────────────────────────────────────┐ │
│              │ │ ANOMALY SCORE TREND / CALIBRATED THRESHOLD                 │ │
│ SETTINGS     │ └────────────────────────────────────────────────────────────┘ │
│              │ RECENT EVENTS / HISTORY                                      │
└──────────────┴─────────────────────────────────────────────────────────────────┘
```

This wireframe sets **information priority**, not exact pixel positions. The supplied reference images may suggest a different composition; keep the four main user questions immediately answerable.

---

## 5. Core component specifications

### 5.1 Monitoring header

**Must display:** selected machine/profile, microphone input name if available, monitoring connection state, model mode (`Simulation` or `Live model`), model version if available, and most recent successful reading time.

**Primary actions:**
- **Start monitoring:** requests microphone and initializes capture.
- **Stop monitoring:** stops all tracks and inference requests.
- **Select machine:** choices from the backend config; no unsupported fake choices.
- **Try demo audio:** functional fallback when microphone is unavailable.

**States:** idle, requesting permission, initializing, monitoring, interrupted, stopped. Show a spinner only while genuine initialization is ongoing. Display a clear difference between the app being connected and the model declaring the acoustic status normal.

### 5.2 Current assessment card

Show a prominent **Normal**, **Abnormal acoustic pattern**, or **Unable to assess** state. Also show raw anomaly score, profile-specific threshold, capture window time, and signal quality.

- `Normal` means the current *valid audio window* is under a calibrated detection threshold; it does not establish mechanical safety.
- `Abnormal acoustic pattern` means score exceeds the threshold, with a separate indication if a sustained alert has actually triggered.
- `Unable to assess` covers missing microphone, silence/clipping/poor quality where relevant, service unavailable, and unsupported audio.
- A score value such as `0.82` is **not** an 82% failure risk; avoid circular gauges with percentage labels unless calibrated probability exists.
- If the latest valid reading is old, show `Data stale` or `Monitoring interrupted`, never frozen green.

### 5.3 Live waveform

**Purpose:** Show that the microphone is receiving signal. This visual is about signal amplitude over time, **not directly the AI's anomaly decision**.

- X-axis: elapsed time (e.g., last 8–15 seconds).
- Y-axis: normalized amplitude; actual values or a simplified labeled range.
- Stable update rate via Web Audio/canvas/SVG without re-rendering the entire React tree per frame.
- Respect microphone muted/denied states.
- If audio source is simulation, mark the graph `Simulated audio`.

### 5.4 Spectrogram

**Purpose:** Explain the distribution of sound energy by frequency and time. Use color intensity to represent spectral energy; label time and frequency axes. This is not a generic image or literally a graph of wavelength.

- A log-mel or STFT spectrogram is acceptable for visualization; label which one is rendered.
- Do not claim the visible spectrogram is the **exact** model input unless frontend and backend use the same feature pipeline.
- If the backend supports reconstruction-error localization, overlay suspect time-frequency regions only from actual returned data and state what the overlay represents.
- No fabricated hotspots on the real model path.

### 5.5 Anomaly score trend

**Purpose:** Make changing scores and alert logic understandable.

- X-axis: timestamps for scored windows.
- Y-axis: `Reconstruction error` or the true returned score name, with no assumed 0–100 scale.
- A dashed horizontal threshold line when the current profile has a valid threshold.
- Hover/focus tooltip: timestamp, score, threshold, signal quality, model version.
- Visually distinguish gaps where inference was interrupted or quality invalid.
- Show alert events as annotated markers **separately** from mere high-scoring windows.
- Use a ring buffer (e.g. 60–120 recent results) to avoid unbounded client memory.

### 5.6 Recent alerts

An alert row should include:

- First detection timestamp and approximate duration where known.
- Machine/profile.
- Alert type: `Persistent acoustic anomaly`, not `bearing failed`.
- Representative score/threshold and count of qualifying windows.
- Evidence button (if excerpt has actually been retained).
- Acknowledge control (acknowledgment is not machine repair).

Empty state: `No alerts in this session` rather than `100% safe`.

### 5.7 System status / model info

Provide a transparent technical panel showing:

- Model profile and actual version.
- Device or backend readiness.
- Configured window/hop/sample rate.
- Real last measured inference latency and end-to-end latency when available.
- Benchmark results with dataset/split and evaluation date.
- Optional AMD GPU detail only if genuinely available from deployment metadata.
- No static fake precision or fabricated metrics.

---

## 6. Visual and interaction states

**Mandatory states for each core panel:**

| Situation | Expected behavior |
| --- | --- |
| First load | Helpful setup prompt; no fake live readings |
| Permission required | Explain microphone use and show actionable start button |
| Permission denied | Explain browser setting recovery and offer sample upload |
| Monitoring startup | Initializing; waveform can begin before AI scores |
| Normal operation | Calm green/neutral status with fresh timestamp |
| One anomalous window | Score spike; no automatic sustained alert yet |
| Several anomalous windows | Clear alert panel and optional sound cue |
| Silence/noise/clipping | Unable to assess or quality warning |
| Network unavailable | Interrupted, data stale, controlled retry |
| Backend/model unavailable | Explicit service warning, never guess classification |
| Stopped | Capture off, frozen/history visuals visibly historical |
| Simulation | Permanent visible mode label; cannot confuse with live AI |

**Notification UX:** A newly triggered event can show one non-blocking toast and an optional short sound if enabled. Avoid modal pop-ups every second; rate-limit repeated notifications and offer acknowledgment. Do not automatically play sound until a user gesture has enabled audio in the browser.

---

## 7. Responsive design

### Desktop (≥ 1200 px)

- Charts dominate the main content area.
- Primary status and Start/Stop controls stay above the fold.
- Sidebar may hold a short list of functional views.
- Alerts visible in a lower section or right-hand panel.

### Tablet (768–1199 px)

- Charts stack as needed; use a top navigation or compact sidebar.
- Score card remains adjacent to the most important chart where space allows.
- Controls always visible without horizontal scroll.

### Phone (< 768 px)

- One-column vertical flow: status → Start/Stop → score → waveform → spectrogram → trend → alerts.
- Charts have sufficiently large tap targets/tooltips and legible axes.
- If microphone monitoring from a locked/background phone is not reliable, communicate that limitation rather than presenting 24/7 monitoring.
- Avoid fixed dashboard dimensions and non-scrollable chart panels.

---

## 8. Motion and sound guidelines

Use motion only to communicate live signal, monitoring activation, a state transition, or a new alert.

- Chart updates should look steady rather than strobing.
- On a new valid reading, change values smoothly; never delay the actual alert to finish an animation.
- A small active-monitoring pulse is acceptable; no excessive glowing effects.
- A short, subtle alert animation may accompany a sustained event.
- Respect `prefers-reduced-motion` and provide a notification sound on/off setting.
- Charts must continue to make sense in screenshots and frozen states.

---

## 9. Accessibility and credibility

- All status labels include text and icons, not just green/red color.
- Buttons have keyboard access and visible focus rings.
- Charts have accessible text summaries, including latest score and threshold.
- Inputs have explicit labels; microphone permission status is announced appropriately.
- Time labels include timezone or local-time context.
- Units always match actual model/capture measurements.
- Show the distinction between **monitoring running** and **model assessment normal**.
- Include a small experimental-system disclaimer in model info/help, without overwhelming the main dashboard.

Avoid invented OEM logos, certification badges, patented innovation claims, diagnostic certainty, and implied industrial control integration.

---

## 10. Frontend implementation approach

### Component hierarchy

```text
<AppShell>
  <AppHeader />
  <Navigation />
  <DashboardPage>
    <MachineSelector />
    <MonitoringToolbar />
    <AssessmentCard />
    <AudioSignalPanel>
      <WaveformChart />
      <SpectrogramChart />
    </AudioSignalPanel>
    <AnomalyTrendChart />
    <RecentAlerts />
    <ModelInfoPanel />
  </DashboardPage>
  <AlertHistoryDrawer />
  <SettingsDrawer />
</AppShell>
```

### Behavior separation

- `useMicrophoneStream`: microphone ownership, device permission lifecycle, cleanup.
- `useAudioWindows`: PCM rolling buffer, sample count/timestamps, window/hop scheduling.
- `useMonitoringSession`: request lifecycle and state transitions.
- `useAnomalySeries`: fixed-length data storage for trend chart.
- `monitoringClient`: HTTP integration matching `PROJECT_PLAN.md`.
- `mockMonitoringClient`: deterministic simulated windows/events using same contract.

Keep any simulated waveform and mock anomaly-scores deterministic and labeled. In production mode, show a real spectrogram calculated from browser audio or suppress the visualization if it is unavailable, rather than substituting simulated activity.

---

## 11. Design acceptance criteria

Before saying the design is complete, verify:

- [ ] User reference screenshots inspected, with key patterns documented.
- [ ] Desktop view has strong hierarchy with assessment and controls visible immediately.
- [ ] Phone layout supports usable monitoring and alert review.
- [ ] Both waveform and spectrogram have meaningful labels.
- [ ] Score chart distinguishes raw score, threshold, anomaly windows, and triggered alerts.
- [ ] Normal, anomaly, unknown, interrupted, and simulation modes look distinct.
- [ ] One-spike mock example does not produce a sustained alert.
- [ ] No unimplemented primary navigation or decorative buttons.
- [ ] Accessible keyboard states and non-color status cues are present.
- [ ] No fake model precision, GPU metrics, or probability percentages.
- [ ] Monitoring can be stopped, which releases microphone tracks.

---

## 12. Paste-this instruction for Claude Code

> Read `PROJECT_PLAN.md` and `DESIGN_BRIEF.md` as the source of truth for product behavior. I will also attach UI reference images; inspect all of them before implementing the visual design. Build the **frontend only** in mock mode first. Use React, Vite, TypeScript, and Tailwind. Implement the monitoring dashboard, responsive charts, permission/control states, alert history, and mocked backend interface. Do not train an ML model, invent AMD endpoints, or fabricate performance data. Respect the documented `/api/v1` contract. Run the app and tests, visually verify desktop and mobile, and stop after the first working milestone with a list of remaining integration questions.

**Design principle to preserve:** The app is useful only if the operator can distinguish (a) microphone connected, (b) an audio window processed, (c) an unusual score, and (d) a validated sustained alert. Those are four different events and must not collapse into one glowing red/green indicator.
