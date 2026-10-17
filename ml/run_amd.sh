#!/usr/bin/env bash
# One-shot training run for a paid AMD GPU droplet: check GPU → deps → DCASE fan data → train both models →
# evaluate → pretrained-embedding comparison on the same test split → pack results. Run from anywhere inside the repo:   bash ml/run_amd.sh
#
# Env overrides:
#   EPOCHS=100        training epochs per model
#   FAN_DIR=...       use an existing dataset folder (with train/ and test/) and skip the download
#   ALLOW_CPU=1       run without a GPU (e.g. on a laptop); reports will honestly say "cpu"
set -euo pipefail
cd "$(dirname "$0")/.."

EPOCHS="${EPOCHS:-100}"
DATA_ROOT=data/dcase2020
ZIP_URL="https://zenodo.org/records/3678171/files/dev_data_fan.zip?download=1"
ZIP_MD5="649bdfc06263ae7a838963f43b6641e6"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
mkdir -p ml/reports models

echo "== 1/6 GPU check"
python - <<'PY'
import os, sys, torch
ok = torch.cuda.is_available()
print(f"torch {torch.__version__} | hip {getattr(torch.version, 'hip', None)} | gpu available: {ok}")
if ok:
    print("device:", torch.cuda.get_device_name(0))
elif os.environ.get("ALLOW_CPU") != "1":
    sys.exit("No GPU visible to PyTorch. Use the ROCm PyTorch image (not pip's default torch), or set ALLOW_CPU=1.")
PY
(amd-smi static --asic 2>/dev/null || rocm-smi --showproductname 2>/dev/null || echo "no AMD SMI tool found") \
  | tee "ml/reports/gpu-evidence-${STAMP}.txt"

echo "== 2/6 Python deps (keeps the preinstalled ROCm PyTorch)"
python -m pip install -q -r backend/requirements.txt "scikit-learn>=1.5" "torchlibrosa==0.1.0" librosa

echo "== 3/6 Data"
if [[ -n "${FAN_DIR:-}" ]]; then
  echo "using FAN_DIR=${FAN_DIR}"
else
  if [[ ! -d "${DATA_ROOT}/fan/train" ]]; then
    mkdir -p "${DATA_ROOT}"
    echo "downloading DCASE 2020 Task 2 fan dev set (1.4 GB, CC BY-NC-SA 4.0)…"
    curl -L --fail --retry 3 -o "${DATA_ROOT}/dev_data_fan.zip" "${ZIP_URL}"
    echo "${ZIP_MD5}  ${DATA_ROOT}/dev_data_fan.zip" | md5sum -c -
    python -m zipfile -e "${DATA_ROOT}/dev_data_fan.zip" "${DATA_ROOT}"
    rm "${DATA_ROOT}/dev_data_fan.zip"
  fi
  FAN_DIR="$(dirname "$(find "${DATA_ROOT}" -type d -name train | head -1)")"
fi
echo "train clips: $(ls "${FAN_DIR}/train" | wc -l)   test clips: $(ls "${FAN_DIR}/test" | wc -l)"

echo "== 4/6 Train (dense baseline, then CNN)"
python -m ml.train --data "${FAN_DIR}" --arch dense --epochs "${EPOCHS}" --out models/fan_01_dense.pt
python -m ml.train --data "${FAN_DIR}" --arch conv --epochs "${EPOCHS}" --out models/fan_01_conv.pt

echo "== 5/6 Evaluate both on the same held-out test split"
python -m ml.evaluate --data "${FAN_DIR}" models/fan_01_dense.pt models/fan_01_conv.pt
echo "   + pretrained PANNs CNN14 + kNN, enrolled on train/ normal, tested on the same test/ clips"
python -m ml.embed_eval evaluate --data "${FAN_DIR}" --save-profiles models/emb

echo "== 6/6 Pack results"
OUT="amd-results-${STAMP}.tgz"
tar czf "${OUT}" models ml/reports
cat <<EOF

Done. Results: $(pwd)/${OUT}
Download to your PC:   scp root@<droplet-ip>:$(pwd)/${OUT} .
Then, if you are on a paid droplet: Snapshot (optional) → DESTROY it. A powered-off droplet still bills.
EOF
