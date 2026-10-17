"""WAV decoding, validation, resampling and signal-quality gating."""
from __future__ import annotations

import io
import wave
from dataclasses import dataclass
from math import gcd

import numpy as np
from scipy.signal import resample_poly

from ..profiles import ACCEPTED_INPUT_RATES, SAMPLE_RATE_HZ, WINDOW_MS

SILENCE_DBFS = -60.0
CLIP_LEVEL = 0.99
CLIP_FRACTION = 0.01
WINDOW_TOLERANCE = 0.05  # ±5 % of the configured window length


class AudioError(ValueError):
    """Client sent audio that does not match the contract (HTTP 422)."""


@dataclass
class Window:
    samples: np.ndarray  # float32 mono at SAMPLE_RATE_HZ, range [-1, 1]
    input_rate: int
    quality: str  # ok | silence | clipping


def decode_window(data: bytes) -> Window:
    try:
        with wave.open(io.BytesIO(data)) as w:
            channels, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
            raw = w.readframes(frames)
    except (wave.Error, EOFError) as err:
        raise AudioError(f"audio: not a valid PCM WAV file ({err})") from err

    if width != 2:
        raise AudioError("audio: expected 16-bit PCM")
    if rate not in ACCEPTED_INPUT_RATES:
        raise AudioError(f"audio: unsupported sample rate {rate} Hz")
    expected = rate * WINDOW_MS / 1000
    if frames == 0 or abs(frames - expected) > expected * WINDOW_TOLERANCE:
        raise AudioError(f"audio: window must be {WINDOW_MS} ms, got {frames / rate * 1000:.0f} ms")

    pcm = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)  # documented downmix: channel mean

    quality = signal_quality(pcm)
    if rate != SAMPLE_RATE_HZ:
        g = gcd(SAMPLE_RATE_HZ, rate)
        pcm = resample_poly(pcm, SAMPLE_RATE_HZ // g, rate // g).astype(np.float32)
    return Window(samples=pcm, input_rate=rate, quality=quality)


def signal_quality(pcm: np.ndarray) -> str:
    if np.mean(np.abs(pcm) >= CLIP_LEVEL) > CLIP_FRACTION:
        return "clipping"
    rms = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2)))
    if 20 * np.log10(rms + 1e-12) < SILENCE_DBFS:
        return "silence"
    return "ok"
