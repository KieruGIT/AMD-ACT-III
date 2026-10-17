"""Demo-fan loop: fresh prepare, phase separation (train/calib/dev/final), calibration, production-faithful replay."""
import json

import numpy as np
import pytest

torch = pytest.importorskip("torch")
pytest.importorskip("sklearn")

from ml import demo_fan, train  # noqa: E402

from .conftest import fan_audio  # noqa: E402

RATE = 16_000


def _wav(path, x, rate=RATE):
    demo_fan.write_wav(path, x, rate)


@pytest.fixture(scope="module")
def recordings(tmp_path_factory):
    root = tmp_path_factory.mktemp("rec")
    _wav(root / "train_healthy" / "a.wav", fan_audio(60, RATE, seed=1))
    _wav(root / "calib_healthy" / "b.wav", fan_audio(30, 48_000, seed=2), 48_000)  # phones record at 48 kHz
    _wav(root / "test_healthy" / "c.wav", fan_audio(30, 48_000, seed=3), 48_000)
    _wav(root / "fault_rub" / "d.wav", fan_audio(30, RATE, anomaly=True, seed=4))
    _wav(root / "final_healthy" / "e.wav", fan_audio(30, RATE, seed=5))
    _wav(root / "final_fault_rub" / "f.wav", fan_audio(30, RATE, anomaly=True, seed=6))
    _wav(root / "noise_impact" / "g.wav", np.full(RATE * 2, 0.95, np.float32))  # loud enough to clip when mixed
    return root


@pytest.fixture(scope="module")
def prepared(recordings, tmp_path_factory):
    out = tmp_path_factory.mktemp("data") / "demo_v1"
    manifest = demo_fan.prepare(recordings, out)
    ckpt = train.main(["--data", str(out), "--arch", "dense", "--epochs", "2", "--out", str(out.parent / "m.pt"),
                       "--report-dir", str(out.parent / "reports")])
    return out, manifest, str(ckpt)


def test_roles_map_to_phases():
    assert demo_fan.role("final_fault_rub") == ("final", "anomaly")
    assert demo_fan.role("fault_rub") == ("dev", "anomaly")
    assert demo_fan.role("calib_healthy") == ("calib", "normal")
    assert demo_fan.role("recordings_misc") is None


def test_final_and_calib_audio_never_enter_train_or_test_clips(prepared):
    out, manifest, _ = prepared
    groups = {v["group"] for v in manifest["clips"].values()}
    assert groups == {"train_healthy", "test_healthy", "fault_rub"}
    phases = {s["group"]: s["phase"] for s in manifest["streams"]}
    assert phases["final_healthy"] == "final" and phases["calib_healthy"] == "calib"
    assert "calib_healthy+impact" not in phases and phases["final_healthy+impact"] == "final"
    mixed = next(s for s in manifest["streams"] if s.get("mixed"))
    assert mixed["clipped_fraction"] > 0


def test_prepare_never_reuses_or_deletes_a_folder(recordings, tmp_path):
    out = tmp_path / "v1"
    demo_fan.prepare(recordings, out)
    marker = out / "train" / "normal_id_00_99999999.wav"
    marker.write_bytes(b"old")
    with pytest.raises(SystemExit):
        demo_fan.prepare(recordings, out)
    assert marker.exists()  # refused, nothing touched
    with pytest.raises(SystemExit):  # never inside (or around) the source recordings
        demo_fan.prepare(recordings, recordings / "prepared")


def test_streams_keep_the_native_rate(prepared):
    _, manifest, _ = prepared
    rates = {s["group"]: s["rate"] for s in manifest["streams"] if "mixed" not in s}
    assert rates["test_healthy"] == 48_000 and rates["calib_healthy"] == 48_000 and rates["final_healthy"] == RATE


def test_replay_applies_the_api_quality_gate(prepared):
    _, _, ckpt = prepared
    scorer = demo_fan.load_scorer(ckpt)
    from app.alerting.policy import AlertAggregator

    new_agg = lambda: AlertAggregator(3, 5, 30, new_id=lambda: "e")  # noqa: E731
    silent = demo_fan.replay(scorer, np.zeros(RATE * 10, np.float32), RATE, new_agg)
    assert silent["windows"] == 0 and silent["unassessable_windows"] == 8 and silent["alerts"] == 0
    clipped = demo_fan.replay(scorer, np.full(RATE * 10, 1.0, np.float32), RATE, new_agg)
    assert clipped["windows"] == 0 and clipped["alerts"] == 0


def test_quality_is_judged_before_resampling_like_the_api():
    """A 48 kHz window whose clipping sits above 8 kHz: clipping for the API, clean once resampled to 16 kHz."""
    from app.audio.wav import decode_window, signal_quality

    rate = 48_000
    t = np.arange(rate * 3) / rate
    x = (0.2 * np.sin(2 * np.pi * 200 * t)).astype(np.float32)
    x[::2] += 0.85
    x[1::2] -= 0.85  # 24 kHz square-ish component pushes many samples to full scale
    x = np.clip(x, -1, 1)
    api = decode_window(demo_fan.window_bytes(x, rate))
    assert api.quality == "clipping" and signal_quality(api.samples) == "ok"  # the mismatch that was reproduced
    (_, w), = list(demo_fan.production_windows(x, rate))
    assert w.quality == "clipping"  # replay now agrees with the API


def test_false_alert_upper_bound_is_honest_for_short_tests():
    assert demo_fan.rate_upper95(0, 5 / 60) == pytest.approx(36, rel=0.01)  # 0 alerts in 5 min: bound ≈ 36/h
    assert demo_fan.rate_upper95(0, 10) == pytest.approx(0.3, rel=0.01)


def test_calibrate_then_dev_and_final_streams(prepared, recordings):
    out, _, ckpt = prepared
    cal = str(out.parent / "m_cal.pt")
    thr = demo_fan.calibrate(out, ckpt, cal)
    scorer = demo_fan.load_scorer(cal)
    assert scorer.threshold == pytest.approx(thr) and scorer.version.endswith("-cal")

    dev = demo_fan.stream(out, cal, report_dir=out.parent)["summary"]
    assert dev["phase"] == "dev" and dev["run"]["checkpoint_sha256"] == demo_fan.sha256(cal)
    assert "calib_healthy" in dev["run"]["threshold_source"]
    assert set(dev["healthy"]) == {"test_healthy", "test_healthy+impact"}
    assert dev["healthy"]["test_healthy"]["alerts_per_hour_upper95_approx"] is not None
    assert dev["healthy"]["test_healthy+impact"]["unassessable_windows"] > 0  # clipped bursts are not scored

    final = demo_fan.stream(out, cal, phase="final", report_dir=out.parent)["summary"]
    assert set(final["faults"]) == {"final_fault_rub", "final_fault_rub+impact"}
    # Re-preparing the same recordings into a new folder must not reset the final-test history
    again = out.parent / "demo_v2"
    demo_fan.prepare(recordings, again)
    demo_fan.stream(again, cal, phase="final", report_dir=out.parent)
    runs = json.loads((out.parent / demo_fan.FINAL_LOG).read_text())
    assert len(runs) == 2 and runs[0]["final_set"] == runs[1]["final_set"]
    assert not (out / demo_fan.FINAL_LOG).exists()  # the audit lives outside the dataset
