import numpy as np
import pytest

from app.audio.wav import AudioError, decode_window
from app.inference.heuristic import HeuristicScorer

from .conftest import fan_audio, to_wav


def test_decodes_and_resamples_48k_to_16k():
    w = decode_window(to_wav(fan_audio()))
    assert w.input_rate == 48_000
    assert w.samples.shape == (48_000,)
    assert w.quality == "ok"


def test_downmixes_stereo():
    w = decode_window(to_wav(fan_audio(rate=44_100), rate=44_100, channels=2))
    assert w.samples.ndim == 1 and abs(w.samples.size - 48_000) <= 1


@pytest.mark.parametrize(
    "data, msg",
    [
        (b"not a wav", "valid PCM WAV"),
        (to_wav(fan_audio(seconds=1.0)), "window must be 3000 ms"),
        (to_wav(fan_audio(rate=11_025), rate=11_025), "unsupported sample rate"),
    ],
    ids=["junk", "too-short", "bad-rate"],
)
def test_rejects_bad_audio(data, msg):
    with pytest.raises(AudioError, match=msg):
        decode_window(data)


def test_quality_gate_flags_silence_and_clipping():
    assert decode_window(to_wav(np.zeros(144_000, np.float32))).quality == "silence"
    assert decode_window(to_wav(fan_audio(gain=8.0))).quality == "clipping"


def test_heuristic_learns_normal_then_separates_anomaly_regardless_of_volume():
    scorer, state = HeuristicScorer(learn_windows=8), {}
    w = lambda **k: decode_window(to_wav(fan_audio(**k))).samples  # noqa: E731
    for i in range(8):
        assert scorer.score(w(seed=i), state).value is None  # learning, not assessed
    assert state.pop("just_locked") and "learning" not in state
    threshold = state["baseline"]["threshold"]
    normal = [scorer.score(w(seed=100 + i, gain=g), state).value for i, g in enumerate([0.3, 0.6, 1, 1.5, 2.5, 3.5])]
    abnormal = [scorer.score(w(seed=200 + i, anomaly=True, gain=g), state).value for i, g in enumerate([0.5, 1, 2])]
    assert max(normal) < threshold < min(abnormal), (normal, threshold, abnormal)
