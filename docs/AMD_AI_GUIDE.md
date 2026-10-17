# Training and serving the anomaly model on AMD

A step-by-step guide for the AI side: from an empty AMD GPU machine to the API scoring live phone audio with the
trained model. Everything here uses code already in the repo (`ml/` and `backend/app/inference/`).

---

## 0. Fastest path: one command on an AMD GPU droplet

1. [AMD Developer Cloud](https://www.amd.com/en/developer/resources/cloud-access/amd-developer-cloud.html) →
   **GPU Droplets → Create GPU Droplet** → region ATL1 → **MI300X × 1** (not ×8) → **PyTorch** image → add your SSH key.
2. `ssh root@<droplet-ip>`, then:
   ```bash
   git clone https://github.com/KieruGIT/AMD-ACT-III.git && cd AMD-ACT-III
   bash ml/run_amd.sh          # GPU check → deps → DCASE fan data → train dense + CNN → evaluate → pack
   ```
   If the image runs PyTorch inside a container, enter it first (e.g. `docker exec -it rocm /bin/bash`).
3. Download the archive it prints (`scp root@<ip>:…/amd-results-*.tgz .`), commit `ml/reports/*`, keep the `.pt` files.
4. **Snapshot (optional) → Destroy the droplet.** A powered-off droplet still bills (~$1.99/h for 1× MI300X).

`ALLOW_CPU=1 bash ml/run_amd.sh` runs the same pipeline on a laptop; the reports then say "cpu", so never cite
those as AMD results. The sections below explain each step.

---

## 1. What we are building, in plain words

1. **Learn "normal".** An autoencoder is a network that squeezes its input through a tiny bottleneck (8 numbers)
   and tries to rebuild it. We train it **only on healthy fan sound**, so it becomes good at rebuilding exactly that.
2. **Score new sound.** For each 3 s window, we measure how badly it rebuilds the sound: the **reconstruction
   error**. Normal sound → small error. Sound it has never learned (a whine, knocking) → large error.
3. **Pick a threshold.** Run the trained model on held-out *normal* windows and take, e.g., the 99th percentile of
   their errors. Above that line, a window is "unusual".
4. **Alert carefully.** The API only raises an alert when 3 of the last 5 windows are above the line, so one door
   slam never pages anyone.

The score is **not a probability** and not a diagnosis. It only says "this sounds different from what I learned".

```text
3 s audio → resample 16 kHz → log-mel spectrogram (128 bands) → autoencoder → error vs input → score
          (app/audio/wav.py)   (app/inference/features.py)      (app/inference/model.py)
```

**One rule above all:** training and serving must compute features **identically**. That is why both use the same
file, `backend/app/inference/features.py`. Never copy or tweak it in one place only.

## 2. What runs on AMD

| Work | Where | Why it counts for the hackathon |
| --- | --- | --- |
| Training both models (`ml/train.py`) | AMD GPU | Model built on AMD; the report records the GPU and ROCm version |
| Evaluation + latency (`ml/evaluate.py`) | AMD GPU | Measured inference time per window on AMD |
| Live inference (`backend`, `SCORER=autoencoder`) | AMD GPU | Every phone window is scored on AMD |

On ROCm builds of PyTorch, the AMD GPU appears through the usual `torch.cuda` API (`torch.cuda.is_available()`
returns `True`, and `torch.version.hip` is set). The code picks it automatically.

## 3. Step 0: check the machine

```bash
amd-smi static --asic        # or: rocm-smi --showproductname   → lists the AMD GPU (e.g. an Instinct MI300X)
```

If neither command exists, the machine has no ROCm driver stack; ask the hackathon support channel before going on.

## 4. Step 1: get PyTorch with ROCm

The least painful route is AMD's ready-made Docker image, which ships a matching ROCm + PyTorch:

```bash
git clone https://github.com/KieruGIT/AMD-ACT-III.git && cd AMD-ACT-III
docker run -it --device=/dev/kfd --device=/dev/dri --group-add video --ipc=host --shm-size 8G \
  -v "$PWD":/work -w /work -p 8000:8000 rocm/pytorch:latest
```

Inside the container (do **not** `pip install torch`; that would replace the ROCm build):

```bash
pip install -r backend/requirements.txt scikit-learn
python -c "import torch; print(torch.__version__, torch.version.hip, torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

You want `True` and the AMD GPU name. Without Docker, install the ROCm wheel from the selector on pytorch.org
(choose *Linux · Pip · ROCm*); the exact URL changes with each release, so copy it from there.

## 5. Step 2: smoke-test the pipeline (2 minutes)

```bash
python -m ml.make_synthetic data/synthetic/fan
python -m ml.train --data data/synthetic/fan --epochs 5 --out data/synthetic/m.pt --report-dir /tmp/reports
python -m ml.evaluate --data data/synthetic/fan data/synthetic/m.pt
```

This only proves the plumbing works on the GPU. Synthetic results are meaningless; never report them.

## 6. Step 3: get the real data

Use the **DCASE 2020 Task 2 development dataset**, fan only: `dev_data_fan.zip` (1.4 GB,
MD5 `649bdfc06263ae7a838963f43b6641e6`) from [Zenodo record 3678171](https://zenodo.org/records/3678171)
(`ml/run_amd.sh` downloads and verifies it). License: **CC BY-NC-SA 4.0, non-commercial**: fine for the hackathon,
but a commercial product needs its own recordings. The layout after unzipping is:

```text
data/dcase2020/fan/train/normal_id_00_00000000.wav ...   (normal only: what the model learns from)
data/dcase2020/fan/test/normal_id_00_...wav, anomaly_id_00_...wav   (held out: only for the final report)
```

The clips are 10 s, 16 kHz, recorded with real factory background noise. Datasets stay out of Git (`data/` is
ignored).

## 7. Step 4: train the baseline, then the CNN

```bash
python -m ml.train --data data/dcase2020/fan --arch dense --out models/fan_01_dense.pt   # DCASE-style baseline
python -m ml.train --data data/dcase2020/fan --arch conv  --out models/fan_01_conv.pt    # our experiment
```

What happens inside `ml/train.py`:

1. Lists `train/` normal clips and holds out 10 % **by clip** for validation (windows from one clip never end up on
   both sides, which would leak).
2. Computes log-mel features, normalises them with statistics from the training clips only, and trains with MSE.
3. Scores the held-out normal clips in the same 3 s / 1 s windows the phones send, and sets the threshold at the
   99th percentile (`--threshold-percentile`).
4. Saves the checkpoint (weights, feature config, normalisation, threshold, version) and writes
   `ml/reports/train-<version>.json` with the GPU name, ROCm/HIP version, `amd-smi` output and training time:
   that file is your AMD evidence.

Useful flags: `--ids id_00 id_02` (train on specific machines), `--epochs`, `--batch`, `--lr`, `--seed`.

## 8. Step 5: evaluate both on the same test split

```bash
python -m ml.evaluate --data data/dcase2020/fan models/fan_01_dense.pt models/fan_01_conv.pt
```

This scores every test clip **through the exact code the API uses** (`AutoencoderScorer`), then writes
`ml/reports/eval-<time>.md/.json` with:

| Column | Meaning | Why it matters |
| --- | --- | --- |
| ROC AUC | How well scores rank anomalous above normal clips, over all thresholds | The main DCASE metric; 0.5 = guessing |
| pAUC (0.1) | Same, but only where false positives stay below 10 % | What operators feel: few false alarms |
| Window TPR / FPR | Share of anomalous / normal windows above *our* threshold | Behaviour at the chosen line |
| False alerts / h | Normal test audio streamed through the real 3-of-5 policy | Alert burden in practice |
| Anomalous clips alerted | Share of anomalous clips that would raise an alert | Does it actually catch things |
| Latency | Features + model per 3 s window on this GPU | Proof it is real-time on AMD |

**How to read it honestly.** Compare against the official DCASE 2020 baseline results on the task page. If the
CNN is worse than the dense baseline, ship the dense one; the plan says the product must not depend on a
particular architecture. Report per machine ID: some IDs are much harder than others.

## 9. Step 6: serve the trained model

```bash
cp models/fan_01_dense.pt backend/models/fan_01.pt        # or whichever won
cd backend
SCORER=autoencoder MODEL_PATH=models/fan_01.pt CORS_ORIGINS=https://<frontend> PUBLIC_APP_URL=https://<frontend> \
  uvicorn app.main:app --host 0.0.0.0 --port 8000
curl localhost:8000/api/v1/health        # → "mode": "model", "model_ready": true, "model_version": "fan-dense-ae-…"
cloudflared tunnel --url http://localhost:8000          # gives the HTTPS URL the frontend needs
```

The console now shows **Live model** instead of "Dev scorer". If the checkpoint fails to load, `/health` says
`model_ready: false`, uploads return 503, and the UI shows the service warning instead of guessing.

## 10. Step 7: collect evidence for the submission

- `ml/reports/train-*.json`: GPU name, ROCm/HIP version, `amd-smi` output, training time, data split, threshold.
- `ml/reports/eval-*.md`: the comparison table above (commit the ones you cite).
- A screenshot of `amd-smi` (or `rocm-smi`) during training showing GPU utilisation.
- `/health` showing the model version, and the console's Model & system panel showing measured latency.

## 11. Things not to claim

- Accuracy from synthetic data, or from the desk fan at home (different sound from the industrial training data).
- "Predicts failure", "detects bearing faults", "zero false alarms", or a score as a percentage.
- Detection delay, unless you have labelled fault-onset times (DCASE clips only have clip-level labels).

## 12. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `torch.cuda.is_available()` is `False` | Wrong wheel (CPU/CUDA build) or the container started without `--device=/dev/kfd --device=/dev/dri --group-add video` |
| Out of GPU memory | Lower `--batch`; features already live on the GPU, so this is rare for these model sizes |
| Feature extraction feels slow | It runs on CPU with NumPy (same code as serving); fine for the fan subset |
| API says `model_ready: false` | Check `MODEL_PATH`; the load error is kept on the scorer (`load_error`) |
| Scores look fine offline but odd live | Phone audio differs from the dataset (domain shift). Demo accuracy with held-out clips; use the phone to show capture |
