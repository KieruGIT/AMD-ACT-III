from __future__ import annotations

import io
import wave

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def fan_audio(seconds: float = 3.0, rate: int = 48_000, anomaly: bool = False, seed: int = 0, gain: float = 1.0) -> np.ndarray:
    """Synthetic fan: hum + harmonics + noise; anomaly adds a 2.75 kHz whine and knocks."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * rate)) / rate
    x = 0.16 * np.sin(2 * np.pi * 120 * t) + 0.08 * np.sin(2 * np.pi * 360 * t) + 0.05 * np.sin(2 * np.pi * 720 * t)
    x += 0.03 * rng.standard_normal(t.size)
    if anomaly:
        x += 0.07 * np.sin(2 * np.pi * 2750 * t)
        knocks = (t % 0.45) < 0.012
        x[knocks] += 0.4 * rng.standard_normal(knocks.sum())
    return (x * gain).astype(np.float32)


def to_wav(x: np.ndarray, rate: int = 48_000, channels: int = 1) -> bytes:
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    if channels == 2:
        pcm = np.repeat(pcm, 2)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


@pytest.fixture
def app():
    return create_app(":memory:")


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def project(app):
    db = app.state.db
    viewer = db.create_project("plant-a", "Plant A")
    device_id, device_key = db.create_device("plant-a", "Fan line 1", "fan_01")
    return {"id": "plant-a", "viewer": viewer, "device_id": device_id, "device_key": device_key}
