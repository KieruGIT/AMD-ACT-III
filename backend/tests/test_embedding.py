"""Embedding scorer + evaluation protocol. Synthetic embeddings / a fake encoder: no dataset or PyTorch needed."""
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest
from scipy.io import wavfile

from app.inference.embedding import (EmbeddingScorer, build_profile, knn_distance, load_profile, prepare,
                                     save_profile)
from app.inference.heuristic import band_energies_db
from ml import embed_eval

from .conftest import fan_audio, to_wav

RATE = 16_000


class FakeEmbedder:
    """Deterministic stand-in for PANNs: band energies of each window (separates the synthetic fan's anomalies)."""

    name = "fake-encoder"
    sha256 = "f" * 64

    def embed_batch(self, wavs):
        e = np.stack([band_energies_db(w) for w in wavs]).astype(np.float32)
        return {"pooled": e, "fc1": e[:, ::-1].copy()}


def test_knn_matches_brute_force_both_metrics():
    rng = np.random.default_rng(0)
    bank_raw, q_raw = rng.standard_normal((50, 8)), rng.standard_normal((7, 8))
    for metric in ("cosine", "euclidean"):
        bank, q = prepare(bank_raw, metric), prepare(q_raw, metric)
        if metric == "cosine":
            full = 1 - q @ bank.T
        else:
            full = np.linalg.norm(q[:, None] - bank[None], axis=2)
        for k in (1, 3):
            want = np.sort(full, axis=1)[:, :k].mean(axis=1)
            got = knn_distance(bank, q, k, metric, chunk=3)  # chunking must not change results
            np.testing.assert_allclose(got, want, rtol=1e-5, atol=1e-5)
    assert knn_distance(prepare(bank_raw, "cosine"), prepare(q_raw, "cosine"), k=999).shape == (7,)  # k clamped


def test_identical_vector_has_zero_distance_and_unknown_metric_fails():
    v = np.array([[1.0, 2.0, 3.0]])
    assert knn_distance(prepare(v, "cosine"), prepare(v * 5, "cosine"))[0] == pytest.approx(0, abs=1e-6)
    with pytest.raises(ValueError):
        prepare(v, "manhattan")


def test_threshold_comes_from_disjoint_calibration_not_self_matches():
    rng = np.random.default_rng(1)
    ref, cal = rng.standard_normal((200, 16)), rng.standard_normal((60, 16))
    p = build_profile(ref, cal, metric="euclidean", k=1, layer="pooled", percentile=99, meta={})
    # Scoring the bank against itself would give ~0 and a useless threshold; calibration rows are new points.
    assert p.threshold > 1.0 and p.meta["calibration"]["windows"] == 60
    shifted = rng.standard_normal((60, 16)) + 4.0
    assert np.mean(knn_distance(p.bank, prepare(shifted, "euclidean"), 1, "euclidean") > p.threshold) > 0.95


@pytest.mark.parametrize("name", ["prof.npz", "prof.profile"])
def test_profile_roundtrip(tmp_path, name):
    rng = np.random.default_rng(2)
    p = build_profile(rng.standard_normal((20, 4)), rng.standard_normal((5, 4)), metric="cosine", k=5, layer="fc1",
                      percentile=95, meta={"version": "v-test", "encoder_sha256": "abc"})
    save_profile(tmp_path / name, p)
    q = load_profile(tmp_path / name)
    np.testing.assert_array_equal(q.bank, p.bank)
    assert (q.threshold, q.metric, q.k, q.layer, q.version) == (p.threshold, "cosine", 5, "fc1", "v-test")


def _profile_from_fan(tmp_path, sha="f" * 64) -> Path:
    emb = FakeEmbedder()
    wins = lambda seeds: np.stack([fan_audio(3.0, RATE, seed=s) for s in seeds])  # noqa: E731
    p = build_profile(emb.embed_batch(wins(range(0, 20)))["pooled"], emb.embed_batch(wins(range(20, 30)))["pooled"],
                      metric="euclidean", k=1, layer="pooled", percentile=99,
                      meta={"version": "emb-test", "encoder_sha256": sha})
    save_profile(tmp_path / "fan.npz", p)
    return tmp_path / "fan.npz"


def test_scorer_separates_synthetic_anomaly(tmp_path):
    s = EmbeddingScorer(str(_profile_from_fan(tmp_path)), "", embedder=FakeEmbedder())
    assert s.ready, s.load_error
    assert (s.mode, s.score_name, s.version) == ("model", "embedding_knn_distance", "emb-test")
    normal = [s.score(fan_audio(3.0, RATE, seed=100 + i), {}).value for i in range(5)]
    anomaly = [s.score(fan_audio(3.0, RATE, anomaly=True, seed=200 + i), {}).value for i in range(5)]
    assert min(anomaly) > max(normal) and min(anomaly) > s.threshold


def test_scorer_refuses_profile_from_another_encoder(tmp_path):
    s = EmbeddingScorer(str(_profile_from_fan(tmp_path, sha="0" * 64)), "", embedder=FakeEmbedder())
    assert not s.ready and "re-enroll" in s.load_error
    assert not EmbeddingScorer(str(tmp_path / "missing.npz"), "", embedder=FakeEmbedder()).ready


def test_api_serves_embedding_scorer(tmp_path, app, client, project):
    app.state.scorer = EmbeddingScorer(str(_profile_from_fan(tmp_path)), "", embedder=FakeEmbedder())
    h = client.get("/api/v1/health").json()
    assert h["mode"] == "model" and h["model_version"] == "emb-test"
    assert client.get("/api/v1/config").json()["score"]["name"] == "embedding_knn_distance"
    r = client.post("/api/v1/analyze-window",
                    headers={"X-Project-Id": project["id"], "X-Device-Key": project["device_key"]},
                    data={"machine_id": "fan_01", "session_id": "session-emb01", "sequence": "1",
                          "recorded_at": datetime.now(timezone.utc).isoformat()},
                    files={"audio": ("w.wav", to_wav(fan_audio()), "audio/wav")}).json()
    assert r["score_unit"] == "embedding_knn_distance" and r["anomaly_score"] is not None


# ---- evaluation protocol -------------------------------------------------------------------------------------

def _write(path: Path, x: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    wavfile.write(path, RATE, (np.clip(x, -1, 1) * 32767).astype(np.int16))


def _mimii(root: Path, n_normal=12, n_abnormal=4, seconds=4.0) -> Path:
    for mid, seed0 in (("id_00", 0), ("id_02", 1000)):
        for i in range(n_normal):
            _write(root / "6_dB_fan" / "fan" / mid / "normal" / f"{i:08d}.wav", fan_audio(seconds, RATE, seed=seed0 + i))
        for i in range(n_abnormal):
            _write(root / "6_dB_fan" / "fan" / mid / "abnormal" / f"{i:08d}.wav",
                   fan_audio(seconds, RATE, anomaly=True, seed=seed0 + 500 + i))
    return root


def test_discover_mimii_and_dcase_layouts(tmp_path):
    items = embed_eval.discover(_mimii(tmp_path / "mimii"))
    assert {i.group for i in items} == {"fan/id_00", "fan/id_02"}
    assert sum(i.label == "anomaly" for i in items) == 8 and all(i.split is None for i in items)
    assert {i.group for i in embed_eval.discover(tmp_path / "mimii", ids=["id_02"])} == {"fan/id_02"}

    d = tmp_path / "dcase" / "fan"
    _write(d / "train" / "normal_id_00_00000000.wav", fan_audio(4, RATE))
    _write(d / "test" / "anomaly_id_00_00000000.wav", fan_audio(4, RATE, anomaly=True))
    got = embed_eval.discover(tmp_path / "dcase")
    assert {(i.machine_type, i.machine_id, i.label, i.split) for i in got} == {
        ("fan", "id_00", "normal", "train"), ("fan", "id_00", "anomaly", "test")}
    with pytest.raises(FileNotFoundError):
        embed_eval.discover(tmp_path / "dcase", types=["pump"])


def test_splits_are_disjoint_by_recording_and_anomalies_only_in_test(tmp_path):
    items = embed_eval.discover(_mimii(tmp_path))
    groups = embed_eval.split_groups(items, seed=0, calib_frac=0.25, ref_clips=3)
    for sets in groups.values():
        assert all(i.label == "normal" for i in sets["reference"] + sets["calibration"])
        assert sum(i.label == "anomaly" for i in sets["test"]) == 4
        assert sum(i.label == "normal" for i in sets["test"]) == 4  # balanced with the abnormal clips
        assert len(sets["reference"]) == 3 and len(sets["calibration"]) == 2
        paths = [{i.path for i in s} for s in sets.values()]
        assert not (paths[0] & paths[1]) and not (paths[0] & paths[2]) and not (paths[1] & paths[2])
    again = embed_eval.split_groups(items, seed=0, calib_frac=0.25, ref_clips=3)
    assert {g: [i.path for i in s["test"]] for g, s in groups.items()} == \
           {g: [i.path for i in s["test"]] for g, s in again.items()}  # reproducible with the same seed


def test_evaluate_group_end_to_end_with_fake_encoder(tmp_path):
    pytest.importorskip("sklearn")
    items = embed_eval.discover(_mimii(tmp_path))
    groups = embed_eval.split_groups(items, seed=0)
    sets = groups["fan/id_00"]
    emb = embed_eval.embed_items(FakeEmbedder(), [i for s in sets.values() for i in s], tmp_path / "cache", batch=5)
    assert all(e["pooled"].shape == (2, 32) for e in emb.values())  # 4 s clip → 2 windows at a 1 s hop
    cached = embed_eval.embed_items(FakeEmbedder(), [i for s in sets.values() for i in s], tmp_path / "cache")
    np.testing.assert_array_equal(cached[sets["test"][0].path]["pooled"], emb[sets["test"][0].path]["pooled"])
    m, profile = embed_eval.evaluate_group(sets, emb, layer="pooled", metric="euclidean", k=1, percentile=99)
    assert m["roc_auc"] == pytest.approx(1.0) and m["clips"] == {"normal": 4, "anomaly": 4}
    assert m["calibration"]["windows"] == 2 * len(sets["calibration"])
    assert m["reference_windows"] == 2 * len(sets["reference"]) == len(profile.bank)
    assert m["false_alerts_per_hour"] is not None and m["anomalous_clips_alerted"] is not None


def test_enroll_segments_never_split_a_window():
    segs = embed_eval.segments(np.zeros(RATE * 25, dtype=np.float32), 10)
    assert [s.size for s in segs] == [RATE * 10, RATE * 10, RATE * 5]
    assert all(embed_eval.clip_windows(s).shape[1] == RATE * 3 for s in segs)


def test_cnn14_architecture_shapes():
    torch = pytest.importorskip("torch")
    pytest.importorskip("torchlibrosa")
    from app.inference.panns import Cnn14_16k

    m = Cnn14_16k().eval()
    with torch.no_grad():
        pooled, fc1 = m(torch.zeros(2, RATE * 3))
    assert pooled.shape == fc1.shape == (2, 2048)
    assert "fc_audioset.weight" in m.state_dict() and "logmel_extractor.melW" in m.state_dict()
