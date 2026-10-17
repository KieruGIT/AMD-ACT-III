"""Training and evaluation for the anomaly model. Run from the repo root: python -m ml.train ...

Shares feature extraction and model code with the API (backend/app/inference) so serving matches training.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
