"""Interference FLAGS for a window: speech (Silero VAD) and possible impacts/transients (spectral flux).

Enabled with INTERFERENCE=flag.

Flags only. They never change the anomaly score, the window status or the alert decision: speech can coincide with
a real fault, and a mechanical fault (knock, rattle) can itself produce impacts. They tell the person reading an
alert "this window may be contaminated" until suppression rules have been validated on mixed recordings.

A transient is an EVENT (counted once, by absolute time kept in the per-session state, because one dropped object
appears in three overlapping 3 s windows) but every window containing it is flagged. A flux spike can just as well
be the machine itself (a knock or rattle), hence "possible impact/transient", never "external noise".
A detector error only drops that flag (reported in `errors`); it never blocks scoring or alerting.

Concurrency: Silero VAD is stateful (it resets and carries state within a call), so one detector serves one window
at a time behind a lock. A request that cannot get the lock within BUSY_WAIT_S gets no flags ("busy") instead of
queueing; the API additionally caps the wait for flags (INTERFERENCE_BUDGET_S) so they can never stall monitoring.

`analyze` is pure: it returns the window's flags and the NEXT de-duplication state without touching the caller's.
A timed-out worker thread keeps running (cancelling the wait cannot stop it), so the caller commits the new state and
records the flags only for results it accepted.

"Recent" interference is reported for the SAME windows the alert policy is looking at (the aggregator's last valid
windows, emptied by its gap reset), by window identity (recorded_at). Windows whose flags were never computed (busy,
timeout, crash) count as "unchecked", not as clean.
"""
from __future__ import annotations

import threading
from collections import OrderedDict

import numpy as np

from ..profiles import SAMPLE_RATE_HZ

N_FFT, HOP = 512, 160  # 32 ms frames, 10 ms hop
IMPACT_Z = 8.0  # flux must exceed the window's median by this many robust standard deviations
IMPACT_JUMP_DB = 3.0  # and the frame must be this much louder than the window's median frame
DEDUP_S = 0.15
SPEECH_MIN_S = 0.3
BUSY_WAIT_S = 0.25
HISTORY = 20  # flags kept per session (≥ the alert policy's window count)


def impact_onsets(x: np.ndarray) -> list[float]:
    """Seconds (from window start) of sudden broadband onsets: a dropped tool, a slam, a clap."""
    if x.size < N_FFT * 2:
        return []
    win = np.hanning(N_FFT).astype(np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(x, N_FFT)[::HOP] * win
    logp = np.log10(np.abs(np.fft.rfft(frames, axis=1)) ** 2 + 1e-10) * 10  # dB per bin
    flux = np.maximum(np.diff(logp, axis=0), 0).mean(axis=1)  # positive spectral change per frame
    energy = 10 * np.log10((frames**2).mean(axis=1) + 1e-12)[1:]
    med = np.median(flux)
    z = (flux - med) / (1.4826 * np.median(np.abs(flux - med)) + 1e-6)
    hits = np.where((z > IMPACT_Z) & (energy - np.median(energy) > IMPACT_JUMP_DB))[0]
    out: list[float] = []
    for i in hits:  # one onset per burst of consecutive frames
        t = (i + 1) * HOP / SAMPLE_RATE_HZ
        if not out or t - out[-1] > DEDUP_S:
            out.append(round(float(t), 3))
    return out


class SpeechDetector:
    """Silero VAD (MIT, weights bundled with the `silero-vad` package). Unavailable → speech is reported as None."""

    def __init__(self):
        self.error: str | None = None
        try:
            from silero_vad import get_speech_timestamps, load_silero_vad

            self._model, self._ts = load_silero_vad(), get_speech_timestamps
            self.speech_seconds(np.zeros(SAMPLE_RATE_HZ * 3, dtype=np.float32))  # warm-up: first call takes seconds
        except Exception as err:
            self._model, self.error = None, f"{type(err).__name__}: {err}"

    @property
    def available(self) -> bool:
        return self._model is not None

    def speech_seconds(self, x: np.ndarray) -> float | None:
        if not self.available:
            return None
        import torch

        segs = self._ts(torch.from_numpy(np.ascontiguousarray(x, dtype=np.float32)), self._model,
                        sampling_rate=SAMPLE_RATE_HZ, return_seconds=True)
        return round(float(sum(s["end"] - s["start"] for s in segs)), 2)


class InterferenceDetector:
    def __init__(self, speech: SpeechDetector | None = None):
        self.speech = speech if speech is not None else SpeechDetector()
        self._lock = threading.Lock()

    def analyze(self, x: np.ndarray, state: dict, window_start_s: float) -> tuple[dict, dict]:
        """(flags for one window, next state). `state` is not modified. `window_start_s`: any session-consistent clock,
        used to de-duplicate transients."""
        if not self._lock.acquire(timeout=BUSY_WAIT_S):
            return unavailable("busy"), state
        try:
            return self._analyze(x, state, window_start_s)
        finally:
            self._lock.release()

    def _analyze(self, x: np.ndarray, state: dict, window_start_s: float) -> tuple[dict, dict]:
        errors: list[str] = []
        seen: list[float] = list(state.get("transients_seen", []))
        found, new = [], []
        try:
            found = impact_onsets(x)
        except Exception as err:
            errors.append(f"transient: {type(err).__name__}")
        for t in found:
            at = window_start_s + t
            if all(abs(at - s) > DEDUP_S for s in seen):
                seen.append(at)
                new.append(round(t, 2))
        del seen[:-50]  # bounded memory; old transients can no longer overlap new windows
        speech_s = None
        try:
            speech_s = self.speech.speech_seconds(x)
        except Exception as err:
            errors.append(f"speech: {type(err).__name__}")
        flags = (["speech"] if speech_s is not None and speech_s >= SPEECH_MIN_S else []) + (["transient"] if found else [])
        info = {"flags": flags, "checked": True, "speech_seconds": speech_s,
                "transients_in_window_s": [round(t, 2) for t in found],  # every window containing one is flagged
                "new_transients_at_s": new,  # counted once as an event
                "speech_detector": "silero-vad" if self.speech.available else None,
                "errors": errors, "affects_decision": False}
        return info, {**state, "transients_seen": seen}


def unavailable(reason: str) -> dict:
    """Result when flags could not be computed for this window (busy, timed out, crashed)."""
    return {"flags": [], "checked": False, "errors": [reason], "affects_decision": False}


def remember(history: OrderedDict, window_id: str, info: dict) -> None:
    """Record an ACCEPTED, computed result under its window identity (unchecked windows are left out)."""
    if info.get("checked"):
        history[window_id] = info["flags"]
        while len(history) > HISTORY:
            history.popitem(last=False)


def summarize(history: OrderedDict, window_ids: list[str]) -> dict:
    """Interference over exactly these windows (the ones the alert policy currently counts)."""
    known = [history[w] for w in window_ids if w in history]
    return {"recent_windows": len(window_ids), "recent_windows_flagged": sum(bool(f) for f in known),
            "recent_windows_unchecked": len(window_ids) - len(known),
            "recent_flags": sorted({f for fs in known for f in fs})}


def recent_summary(ctx: dict | None) -> str | None:
    """One line for an alert event / notification: interference in the windows behind the alert."""
    ctx = ctx or {}
    n, m, u = ctx.get("recent_windows_flagged") or 0, ctx.get("recent_windows") or 0, ctx.get("recent_windows_unchecked") or 0
    if not n and not u:
        return None
    kinds = ", ".join("impact/transient" if f == "transient" else f for f in ctx.get("recent_flags", []))
    parts = [f"possible interference in {n} of the {m} windows behind this alert" + (f" ({kinds})" if kinds else "")]
    if u:
        parts.append(f"{u} window(s) not checked for interference")
    return "; ".join(parts) + "; verify at the machine"


def describe(info: dict) -> str | None:
    if not info.get("flags"):
        return None
    parts = []
    if "speech" in info["flags"]:
        parts.append(f"speech ({info['speech_seconds']:.1f} s)")
    if "transient" in info["flags"]:
        parts.append("possible impact/transient")
    return "possible interference: " + ", ".join(parts) + "; score kept, treat with caution"
