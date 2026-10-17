"""Alert aggregation — the backend is the source of truth (PROJECT_PLAN.md §5.5).

Same rules as the frontend mock (frontend/src/api/mock/alertPolicy.ts):
an event fires when `min_anomalous_windows` of the last `consider_last_valid_windows` valid windows
exceed threshold; one event spans an uninterrupted anomaly and closes after that many consecutive
normal windows; a cooldown then blocks new events; long gaps between valid windows reset the count.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable


@dataclass
class AlertEvent:
    event_id: str
    session_id: str
    machine_id: str
    started_at: str
    last_anomalous_at: str
    anomalous_window_count: int
    peak_score: float
    threshold: float
    reason: str
    ended_at: str | None = None
    acknowledged_at: str | None = None


@dataclass
class Decision:
    triggered: bool
    event_id: str | None
    reason: str | None
    changed: AlertEvent | None = None  # event created/updated/closed by this window


@dataclass
class _Recent:
    anomaly: bool
    score: float | None
    recorded_at: str


def _ts(iso: str) -> float:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


@dataclass
class AlertAggregator:
    min_anomalous: int
    consider_last: int
    cooldown_s: float
    new_id: Callable[[], str]
    gap_reset_s: float = 10.0
    _recent: deque = field(default_factory=deque)
    _last_valid: float | None = None
    _normal_streak: int = 0
    _cooldown_until: float = float("-inf")
    active: AlertEvent | None = None

    def observe(self, *, valid: bool, is_anomaly: bool, score: float | None, threshold: float | None,
                recorded_at: str, session_id: str, machine_id: str) -> Decision:
        current = self.active.event_id if self.active else None
        if not valid:
            return Decision(False, current, None)

        at = _ts(recorded_at)
        if self._last_valid is not None and at - self._last_valid > self.gap_reset_s:
            self._recent.clear()
        self._last_valid = at
        self._recent.append(_Recent(is_anomaly, score, recorded_at))
        while len(self._recent) > self.consider_last:
            self._recent.popleft()

        if self.active:
            ev = self.active
            if is_anomaly:
                ev.anomalous_window_count += 1
                ev.last_anomalous_at = recorded_at
                ev.peak_score = max(ev.peak_score, score if score is not None else float("-inf"))
                self._normal_streak = 0
            else:
                self._normal_streak += 1
                if self._normal_streak >= self.consider_last:
                    ev.ended_at = recorded_at
                    self.active = None
                    self._recent.clear()
                    self._normal_streak = 0
                    self._cooldown_until = at + self.cooldown_s
            return Decision(False, ev.event_id, None, changed=ev)

        anomalous = [r for r in self._recent if r.anomaly]
        if len(anomalous) < self.min_anomalous or at < self._cooldown_until:
            return Decision(False, None, None)

        reason = f"{len(anomalous)} of the last {self.consider_last} valid windows exceeded threshold"
        ev = AlertEvent(
            event_id=self.new_id(),
            session_id=session_id,
            machine_id=machine_id,
            started_at=anomalous[0].recorded_at,
            last_anomalous_at=recorded_at,
            anomalous_window_count=len(anomalous),
            peak_score=max(r.score for r in anomalous if r.score is not None),
            threshold=threshold if threshold is not None else float("nan"),
            reason=reason,
        )
        self.active = ev
        self._normal_streak = 0
        return Decision(True, ev.event_id, reason, changed=ev)
