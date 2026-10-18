"""Supported machine profiles and the audio contract (PROJECT_PLAN.md §3.3, §5.2).

Provisional until the AI developer confirms window/hop/sample rate with the trained model.
"""
from __future__ import annotations

CONTRACT_VERSION = "1.0"
SAMPLE_RATE_HZ = 16_000  # model input rate; uploads at other rates are resampled
WINDOW_MS = 3_000
HOP_MS = 1_000
MAX_UPLOAD_BYTES = 500_000
ACCEPTED_INPUT_RATES = (8_000, 16_000, 22_050, 32_000, 44_100, 48_000)

ALERT_POLICY = {"min_anomalous_windows": 3, "consider_last_valid_windows": 5, "cooldown_seconds": 30}

PROFILES = {
    # one profile for now; the id is kept for stored devices. The on-site scorer learns whatever machine it hears.
    "fan_01": {"id": "fan_01", "label": "Machine", "machine_type": "any"},
}


def config_payload(score_name: str) -> dict:
    return {
        "contract_version": CONTRACT_VERSION,
        "supported_profiles": list(PROFILES.values()),
        "input": {
            "sample_rate_hz": SAMPLE_RATE_HZ,
            "accepted_sample_rates_hz": list(ACCEPTED_INPUT_RATES),
            "channels": 1,
            "format": "wav_pcm_s16le",
            "window_ms": WINDOW_MS,
            "hop_ms": HOP_MS,
            "max_upload_bytes": MAX_UPLOAD_BYTES,
        },
        "score": {"name": score_name, "higher_means_more_anomalous": True, "is_probability": False},
        "alert_policy": ALERT_POLICY,
    }
