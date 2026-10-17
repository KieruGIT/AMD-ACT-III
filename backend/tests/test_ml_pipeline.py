"""Train → calibrate → serve smoke test on synthetic data (skipped when PyTorch is not installed)."""
from datetime import datetime, timedelta, timezone

import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("sklearn")

from app.inference.autoencoder import AutoencoderScorer  # noqa: E402
from ml import evaluate, make_synthetic, train  # noqa: E402

from .conftest import to_wav  # noqa: E402


@pytest.fixture(scope="module")
def checkpoint(tmp_path_factory):
    root = tmp_path_factory.mktemp("ml")
    data = make_synthetic.make(root / "fan", train_per_id=6, test_per_id=3, seconds=6)
    return str(train.main(["--data", str(data), "--arch", "dense", "--epochs", "3", "--out", str(root / "m.pt"),
                                 "--report-dir", str(root / "reports")])), data


def test_checkpoint_loads_through_serving_path(checkpoint):
    path, _ = checkpoint
    s = AutoencoderScorer(path)
    assert s.ready, s.load_error
    assert s.mode == "model" and s.threshold > 0 and s.version.startswith("fan-dense-ae-")


def test_evaluate_reports_dcase_metrics(checkpoint):
    path, data = checkpoint
    r = evaluate.evaluate(path, str(data), None)
    assert set(r["per_id"]) == {"id_00", "id_02", "all"}
    assert r["per_id"]["all"]["roc_auc"] is not None and r["latency_ms_per_window"]["mean"] > 0


def test_api_serves_trained_model(checkpoint, app, client, project):
    path, _ = checkpoint
    app.state.scorer = AutoencoderScorer(path)
    assert client.get("/api/v1/health").json()["mode"] == "model"
    import numpy as np

    rng = np.random.default_rng(1)
    t = np.arange(48_000 * 3) / 48_000
    x = (0.15 * np.sin(2 * np.pi * 120 * t) + 0.03 * rng.standard_normal(t.size)).astype("float32")
    r = client.post("/api/v1/analyze-window",
                    headers={"X-Project-Id": project["id"], "X-Device-Key": project["device_key"]},
                    data={"machine_id": "fan_01", "session_id": "session-ml01", "sequence": "1",
                          "recorded_at": datetime.now(timezone.utc).isoformat()},
                    files={"audio": ("w.wav", to_wav(x), "audio/wav")}).json()
    assert r["score_unit"] == "reconstruction_error" and r["anomaly_score"] is not None
    assert r["model_version"].startswith("fan-dense-ae-") and r["note"] is None
