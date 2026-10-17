# ML status and plan: AI Machine Sound Monitor (AMD Developer Hackathon ACT III)

Last updated: 2026-10-17. Written for an outside reviewer (ChatGPT) to check the approach and suggest next steps.

---

## 1. The project in one paragraph

A web app that listens to a machine (demo: a fan) through a phone microphone and warns when it starts to sound
abnormal. Architecture ("option A"): the phone browser records **3 s windows every 1 s** (16 kHz mono after
server-side resampling) and POSTs them to a **FastAPI backend**. The backend scores each window with an anomaly
detector and applies an alert policy (**3 of the last 5 windows** anomalous → one alert event, until recovery, then a
30 s cooldown). It notifies subscribers (email via Resend, Discord, Slack, webhooks) and streams results to a dashboard on any screen.
Hackathon rule: the AMD part (GPU/ROCm or AMD-hosted inference) must be in the working product shown to judges.
The online build window is **12-18 October 2026** (official page). The page gives no time or time zone for the
cutoff; "6pm PT" is unverified and must be confirmed on the lablab.ai platform or Discord.

Team: the user (frontend, now also running ML experiments) and "bro" (ML/backend; busy at the moment).

**Detector requirement:** unsupervised. It learns from **healthy audio only**, because fault recordings are not available
in real deployments, and it outputs an anomaly score plus a calibrated threshold.

---

## 2. Timeline of what happened

### 2.1 Bro's first model (`hacktuah.ipynb` + `fan_ae.pt`)
A CNN autoencoder on log-mel spectrograms (64 mels, n_fft 1024, hop 512, 49,151-sample crops → 64×96 input),
trained on Kaggle (MIMII 6 dB). Reported per-fan AUROC: **id_00 0.768, id_02 0.947, id_04 0.511, id_06 0.201**.

Problems found in review (confirmed by ChatGPT):
- **Preprocessing mismatch:** training fed raw dB values (loss ≈ 568), while scoring divided by 80.
- **Leakage:** training included `fan/id_00/normal`, and evaluation scored the same normal files.
- **Mixed training data:** trained on fan + pump + slider + valve id_00, but evaluated only on fans.
- **Unclear provenance:** the notebook saves `all_ae.pt` but loads `fan_ae.pt`, so we don't know which run produced the checkpoint.
- **Notebook can't run top to bottom:** `DataLoader` is never imported, `root_dir=` is not a valid argument, and `test_loader` wraps `train_dataset`.
- **Incomplete checkpoint:** no normalization statistics, no calibrated threshold, no version.
- **id_06 AUROC 0.201** means the scores are inverted. A threshold change cannot fix this, because AUROC depends only on ranking (a correction ChatGPT made to an earlier claim of mine).

**Decision (Option A):** don't adapt this checkpoint. Retrain through the repo's standardized pipeline (`ml/train.py`).

### 2.2 Existing standardized pipeline in the repo
- `backend/app/inference/features.py`: one log-mel implementation used by both training and serving (DCASE 2020 baseline settings: 128 mels, 1024 FFT, 512 hop, 5-frame context).
- `ml/train.py`: trains a **dense AE** (DCASE 2020 baseline shape 640-128×4-8-128×4-640) or a **conv AE** on normal clips only. It holds out 10% of the train clips (split by clip) for validation and sets the threshold at the 99th percentile of the validation normal windows. It saves the full metadata (normalization, threshold, version, features) and a JSON training report with GPU evidence.
- `ml/evaluate.py`: scores checkpoints through the **exact serving code path** on the held-out test split. It reports AUROC, pAUC(0.1), window TPR/FPR at the threshold, simulated false alerts per hour under the real 3-of-5 alert policy, the share of anomalous clips that raise an alert, and latency.
- `ml/run_amd.sh`: a one-shot script for an AMD GPU droplet (GPU check → deps → DCASE fan data → train dense + conv → evaluate → pack results).

### 2.3 "Any machine" idea: pretrained embeddings + kNN (built, tested, failed)
**Goal:** one detector that adapts to any new machine through a short healthy-audio "enrollment", without training per machine.
This is the approach from DCASE 2023/2024 first-shot work.

What I built (pushed to `main` in commit `5f83aa7`):
- `backend/app/inference/panns.py`: frozen **PANNs CNN14-16k** (Kong et al. 2020; AudioSet; official Zenodo weights, CC BY 4.0, md5-verified and sha256-pinned). The architecture is copied from the official code and the weights load strictly. It outputs two 2048-d vectors per 3 s window: `pooled` (global max+mean pooling of the last conv block) and `fc1`.
- `backend/app/inference/embedding.py`: `SCORER=embedding`. The score is the mean distance to the k nearest **reference** embeddings (cosine or Euclidean).
  - **Threshold:** the 99th percentile of distances from separate healthy **calibration** clips to the reference bank. The bank is never compared with itself, which would give zero distances.
  - **Profile file:** the bank plus threshold, settings, version and encoder hash. The scorer refuses to load if the encoder doesn't match.
  - The Scorer interface and frontend API contract are unchanged.
- `ml/embed_eval.py`:
  - **`evaluate`:** MIMII or DCASE layouts. Splits are by source recording, so overlapping windows never cross sets. The primary config (`pooled`, cosine, k=1) was fixed in advance; the other layer/metric/k combinations are reported only as an exploratory grid. Produces the same metrics as `ml/evaluate.py`.
  - **`enroll`:** builds a profile from healthy recordings of a real machine.
- 13 unit tests with synthetic embeddings (no dataset or GPU needed). The full backend suite passes (40 tests).

**Result: DCASE 2020 Task 2 dev set, fan, official test split, Kaggle Tesla T4 (2026-10-17)**

| Fan | Ref / cal / test clips | ROC AUC | pAUC(0.1) | Window TPR @thr | Window FPR @thr | False alerts/h | Anomalous clips alerted |
|---|---|---|---|---|---|---|---|
| id_00 | 729 / 182 / 507 | 0.498 | 0.491 | 0.018 | 0.029 | 13.5 | 0.022 |
| id_02 | 733 / 183 / 459 | 0.587 | 0.530 | 0.017 | 0.005 | 0.0 | 0.025 |
| id_04 | 746 / 187 / 448 | 0.474 | 0.512 | 0.012 | 0.007 | 4.5 | 0.014 |
| id_06 | 732 / 183 / 461 | 0.815 | 0.598 | 0.076 | 0.016 | 0.0 | 0.086 |
| **mean** | | **0.594** | **0.533** | | | | |

- Exploratory grid (pooled/fc1 × cosine/Euclidean × k=1/5): every combination lands within about ±0.05 of the primary config. No setting rescues id_00 or id_04.
- Latency: 12 ms per window on the T4 (CNN14 forward + kNN over 5,832 reference windows).
- For reference, the published DCASE 2020 baseline dense AE on fan averages about **0.66** AUROC.

**Conclusion:** off-the-shelf PANNs embeddings with global pooling do not separate healthy from faulty fans. It's a sound-*category*
model: everything sounds like "fan" to it. At the 99th-percentile threshold it catches only 1–8% of anomalous windows.
**We will not claim "detects any machine".** The scorer stays in the code as an experiment, off by default. We
deliberately did **not** tune it on these test clips.

### 2.4 Practical notes (Kaggle)
- MIMII 6 dB attached as a Kaggle input never finished copying (11+ GB), so we switched to the DCASE 2020 fan dev zip from Zenodo (1.4 GB, same 4 fan IDs, official train/test split).
- The repo is private, so cloning needed a read-only GitHub token (to be revoked after use).
- Kaggle allows one GPU session at a time. Kaggle GPUs are NVIDIA, so these runs are **not** AMD evidence.

---

## 3. What is running right now

On the same Kaggle T4 session, with the same downloaded DCASE fan data and therefore the **same test clips**:

```bash
python -m ml.train --data data/dcase/fan --arch dense --epochs 100 --out models/fan_dense.pt
python -m ml.train --data data/dcase/fan --arch conv  --epochs 100 --out models/fan_conv.pt
python -m ml.evaluate --data data/dcase/fan models/fan_dense.pt models/fan_conv.pt
```

- One model per machine type, trained on all four fan IDs' normal train clips, like the DCASE 2020 baseline.
- Threshold: the 99th percentile of held-out normal train windows.
- Evaluation: the official `test/` folder, through the serving code path.

Progress:
- **Dense AE trained:** 3,308 train / 367 validation clips (normal only); 1,015,556 windows of 640-d features.
  Loss went 0.461 → 0.400 over 100 epochs on standardized log-mel, flattening after about 30 epochs. Calibrated threshold 0.7036.
- **Conv AE trained:** 59,544 patches of 32 frames × 128 mels. Loss 0.504 → 0.0099, still slowly falling at epoch 100.
  Threshold 0.0150. A loss this low means the conv AE reconstructs its input almost perfectly. It may be close to
  an identity mapping that also reconstructs anomalies well, which would hurt discrimination. The evaluation will show whether that's the case.
- **Evaluation done (2026-10-17, Tesla T4, official DCASE fan test split):**

| Detector | id_00 | id_02 | id_04 | id_06 | Mean of IDs | Window TPR @thr (all) | False alerts/h (all) | Latency |
|---|---|---|---|---|---|---|---|---|
| **Dense AE (ours)** | 0.528 | 0.737 | 0.604 | 0.724 | **0.648** | 0.007 | 1.12 | 3.0 ms |
| Conv AE (ours) | 0.465 | 0.589 | 0.409 | 0.518 | 0.495 | 0.010 | 3.38 | 2.7 ms |
| PANNs + kNN | 0.498 | 0.587 | 0.474 | 0.815 | 0.594 | ~0.03 | ~4.5 | 12 ms |
| *Published DCASE 2020 baseline (dense AE)* | *0.544* | *0.734* | *0.616* | *0.739* | *0.658* | | | |

(The evaluate script's own "all" row is 0.646, an AUROC pooled over every ID. The 0.648 in the table is the mean of the per-ID AUROCs, which is how DCASE reports it.)

**Reading:**
- **Dense AE:** our pipeline reproduces the published DCASE baseline almost exactly, ID by ID. The pipeline is correct, and this is the best of the three detectors.
- **Conv AE:** chance level. Its near-zero training loss meant it learned something close to an identity mapping, so it rebuilds faulty sound as well as healthy sound.
- **PANNs + kNN:** below the baseline.
- **Biggest practical problem:** at the 99th-percentile window threshold, every detector catches **under 1–3% of anomalous windows**. DCASE fan anomalies are subtle and buried in factory noise, so healthy and faulty score distributions overlap heavily. AUROC around 0.65–0.74 ranks clips somewhat, but one 3 s window at a strict threshold almost never fires.

This gives a three-way comparison on identical test clips: PANNs+kNN (0.594) vs dense AE vs conv AE.

---

## 4. Plan

**Decision after the comparison:** the dense AE is the primary detector. Drop the conv AE. Keep PANNs as an
off-by-default experiment. The open problem is the near-zero detection rate at the alert threshold.

**Next experiment: the real demo fan.** This is the evidence the demo actually needs, and DCASE results cannot show it.
1. Record **healthy** audio of the demo fan with the phone in its demo position: about 10 min, across speed settings
   if those will be used. Split it into 10 s clips.
2. Record **induced faults** (several minutes each), all reversible and safe:
   - a paper or card strip lightly touching the blades (rubbing/ticking);
   - a small piece of tape or a coin taped to one blade (imbalance/wobble);
   - partial obstruction of the intake;
   - a loose grille or a rattle, if it can be done safely.
3. Lay it out in the DCASE format (`train/normal_id_00_*.wav`; `test/normal_id_00_*.wav` from **separate, later**
   recordings; `test/anomaly_id_00_*.wav`). Train the dense AE on the train clips, then run `ml/evaluate.py`. Report
   AUROC, window TPR/FPR, false alerts/h, and time-to-alert for each fault type.
4. If induced faults are still missed at the 99th-percentile threshold, evaluate (on the validation split, not test):
   - temporal smoothing (the mean score over the last N windows);
   - a lower percentile combined with the 3-of-5 rule, targeting a false-alerts/h budget.

**Reviewer feedback (2026-10-17), accepted:**
- Any scoring change (time smoothing, per-band normalized top-k) needs **its own threshold**, calibrated on held-out
  healthy audio. Per-band normalization needs healthy *reconstruction-error* statistics, with a minimum scale per band.
- Long averaging is not assumed to help: it can dilute intermittent ticks and delay alerts, and overlapping windows
  are correlated. Keep the short-window score and test any sustained-anomaly score **alongside** it, on continuous recordings.
- Dilution by averaging over 640 features is a plausible cause of the low detection rate, not a proven one.
- Speech/impact detectors stay **flags only**: scoring continues and the window is marked uncertain, never auto-normal.
- Further looks at the same DCASE test clips are **exploratory**.
- "PANNs first" from the second review is already done (section 2.3: mean AUROC 0.594).

**Tooling for the demo fan (built):** `ml/demo_fan.py`. Recording roles, each a separate session:
`train_healthy/` (training), `calib_healthy/` (threshold), `test_healthy/` + `fault_<name>/` (**development**: tune
freely), `final_healthy/` + `final_fault_<name>/` (**held out**: evaluated once with the frozen configuration).
- `prepare` decodes any format with ffmpeg into DCASE-style clips, so `ml/train.py` and `ml/evaluate.py` run unchanged.
  Only train and dev audio become clips; calib and final audio stay out of `test/`. It never overwrites or deletes:
  it refuses a non-empty `--out` and any folder overlapping the recordings, so each dataset version gets a new folder.
  Calib/dev/final recordings are kept at their native sample rate (48 kHz if the API would reject the original).
- `calibrate` re-sets the threshold to the 99th percentile of the calib session's windows. It records the source in
  the checkpoint, because a same-session threshold is optimistic for another day.
- `stream --phase dev|final` (and `calibrate`) replay each recording like production uploads: every 3 s window is
  encoded as 16-bit WAV at the native rate and passed through the API's own decoder (`decode_window`): same downmix,
  silence/clipping gate **before** resampling, same resampler. Then the serving scorer, the interference flags (same
  commit-on-accept logic as the API) and the 3-of-5 policy, with state reset between recordings. It reports false
  alerts/h with an **approximate** one-sided 95 % upper bound (Poisson assumption; alerts from the policy are not
  independent, so indicative only: 0 alerts in 5 min gives a bound of about 36/h, which is not proof the rate is
  below it). It also reports detection and time-to-alert per fault and unassessable windows. Every report records the scorer, the
  checkpoint SHA-256, the threshold source, the device/GPU/ROCm and the host. Each `final` run is appended to
  `ml/reports/final_runs.json` (outside the dataset), keyed by a hash of the final source recordings, so re-preparing
  does not reset the history; a warning is printed from the second look onward.
Verified end to end on synthetic recordings, including an .m4a file (`backend/tests/test_demo_fan.py`).

**Interference flagging layer (built, `INTERFERENCE=flag`, default off):** Silero VAD (speech) + spectral-flux
"possible impact/transient" flags. Flags only: score, status and alerts are unchanged (tested). Transients are
de-duplicated as events but every containing window is flagged; detector errors never block a window.
Measured so far, on synthetic fan audio + real TTS speech + synthetic claps (indicative only):
- Speech is detected when it is louder than about -8 dB relative to the fan. Quieter speech is missed, and it also
  barely moves the fan score.
- Speech and impacts mixed into **healthy** audio caused 3 false alerts each in 120 s. **All 6 carried a flag**, so the
  layer explains them, but it does not prevent them.
- **False speech flags:** 30 of 118 clean windows on one synthetic fan (a modulated harmonic); 0 on another. Must be measured on the real fan.
- Fault knocks are flagged as transients, as expected. A transient flag is not evidence that an alert is external noise.
- Concurrency: Silero is stateful, so one detector analyzes one window at a time behind a lock. A request that waits
  more than 0.25 s gets no flags (`busy`). The API runs flags alongside scoring and waits at most 0.8 s (`timeout`), so
  flags can never stall alerting. `analyze` is pure (returns flags plus the next state); the API commits the state and
  records the flags only for results it accepted, because a timed-out worker thread keeps running after the wait is
  cancelled (regression test: `test_timed_out_worker_never_changes_session_state`).
- "Recent" interference covers exactly the windows the alert policy is counting (its last valid windows, by
  `recorded_at`, emptied by its gap reset); windows whose flags were never computed count as "unchecked", not clean.
  When an alert opens, that summary is stored with the event (`interference_note`) and added to the notification
  text. The dashboard shows it on the alert row; the alert itself still stands.
`ml/demo_fan.py` now supports `noise_speech/` and `noise_impact/` recordings, which are mixed digitally into the test
streams (6 s bursts every 20 s). `stream --interference` reports flagged windows and alerts-with-flag per group.

General rules (unchanged):

1. **Pick the detector from measured results only.** The highest mean AUROC/pAUC on the DCASE fan test split goes into
   the demo, provided its false-alerts/hour and alert rate are acceptable. Report its real numbers, per ID, in the README and pitch.
2. **If the dense AE reaches about the DCASE baseline (~0.66), use it.** Possible quick improvements, each validated without
   using test anomalies for selection:
   - per-machine-ID models or per-ID normalization (the machines differ, as id_06 showed in bro's notebook);
   - a **Mahalanobis/GMM** distance on log-mel statistics as a cheap non-neural baseline;
   - the conv AE if it wins.
3. **Demo machine:** enroll or calibrate on the actual demo fan using healthy phone recordings, with the phone placed exactly as in the demo. Profiles and thresholds depend on the microphone and its position.
4. **AMD requirement (still open):** the chosen model must run on AMD for the judges. Options:
   - an AMD GPU droplet running `ml/run_amd.sh` plus serving the API (costs money; the $100 credit never arrived);
   - AMD-hosted inference if the event provides it;
   - the event's free "Token Factory" (runs on AMD) as an AMD component. It would have to do something real, e.g. an LLM explanation of alert events, not decoration.
5. **Interference handling (speech/impacts):** spectral flux plus optional Silero VAD as **flags only**, behind a feature flag and off by default. They must never suppress alerts until evaluated on healthy+speech, healthy+impact, faulty, and faulty+speech mixes.
6. **Frozen until a detector is validated:** no new features. Keep the frontend API contract unchanged unless we agree on a versioned update.

---

## 5. Questions for the reviewer

1. Given 0.594 mean AUROC for PANNs CNN14 (global pooled embedding + kNN) on DCASE 2020 fan, is there a **cheap, well-established** change worth one more try? Examples: frame-level or un-pooled embeddings, a different pretrained encoder (BEATs, EAT, OpenL3), or the kNN on per-frequency features. Or is the right call to drop it before the deadline?
2. For a 1–2 day timeline, which gives the best chance of a reliable demo detector:
   - the DCASE-baseline dense AE;
   - per-ID AEs;
   - a Gaussian/Mahalanobis model on log-mel statistics;
   - a machine-ID classification approach (MobileNetV2 trained to tell fan IDs apart, using its confidence as the anomaly score)? This last one is the stronger DCASE 2020 baseline, but it needs several machine IDs at train time.
3. Our threshold is the 99th percentile of held-out normal windows, combined with a 3-of-5 window alert policy. Is that sensible, or should calibration target a false-alerts-per-hour budget directly?
4. How should we demonstrate the AMD requirement honestly if a paid AMD GPU isn't available? Is running the chosen model's inference through an AMD-hosted service acceptable, and what counts as "meaningful"?
5. Anything in the evaluation protocol (section 2.3) that would make the numbers misleading?

---

## 6. File map

| Path | What |
|---|---|
| `backend/app/inference/features.py` | log-mel features shared by training and serving |
| `backend/app/inference/model.py`, `autoencoder.py` | dense/conv AE and its scorer (`SCORER=autoencoder`) |
| `backend/app/inference/panns.py`, `embedding.py` | PANNs encoder and kNN scorer (`SCORER=embedding`, experimental) |
| `backend/app/inference/heuristic.py` | dev-only band-energy scorer (labelled "not a model" in the UI) |
| `backend/app/alerting/policy.py` | 3-of-5 alert aggregation |
| `ml/train.py`, `ml/evaluate.py`, `ml/run_amd.sh` | AE training, evaluation, AMD one-shot run |
| `ml/embed_eval.py` | embedding evaluation and machine enrollment |
| `ml/reports/` | JSON/Markdown reports from every run |
| `hacktuah.ipynb`, `fan_ae.pt` | bro's original notebook/checkpoint (not used; kept locally for reference) |
