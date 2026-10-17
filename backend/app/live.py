"""In-memory live state: per device+session aggregation, recent results, and stream subscribers.

shortcut: single-process memory; run one worker. Move to Redis pub/sub if the API is scaled out.
"""
from __future__ import annotations

import asyncio
import secrets
from collections import OrderedDict, deque
from dataclasses import dataclass, field

from .alerting.policy import AlertAggregator
from .profiles import ALERT_POLICY

RECENT_PER_PROJECT = 120
CACHED_RESULTS_PER_SESSION = 20


@dataclass
class SessionState:
    aggregator: AlertAggregator
    scorer_state: dict = field(default_factory=dict)
    last_sequence: int = 0
    results: OrderedDict = field(default_factory=OrderedDict)  # sequence → response (idempotent retries)


def _new_aggregator() -> AlertAggregator:
    return AlertAggregator(
        min_anomalous=ALERT_POLICY["min_anomalous_windows"],
        consider_last=ALERT_POLICY["consider_last_valid_windows"],
        cooldown_s=ALERT_POLICY["cooldown_seconds"],
        new_id=lambda: f"evt_{secrets.token_hex(6)}",
    )


class Hub:
    def __init__(self) -> None:
        self._sessions: dict[tuple[str, str], SessionState] = {}
        self._recent: dict[str, deque] = {}
        self._subs: dict[str, set[asyncio.Queue]] = {}
        self.latest_by_device: dict[str, dict] = {}

    def session(self, device_id: str, session_id: str) -> SessionState:
        key = (device_id, session_id)
        if key not in self._sessions:
            # A new monitoring session starts aggregation from scratch.
            self._sessions = {k: v for k, v in self._sessions.items() if k[0] != device_id}
            self._sessions[key] = SessionState(_new_aggregator())
        return self._sessions[key]

    def remember(self, state: SessionState, sequence: int, response: dict) -> None:
        state.last_sequence = max(state.last_sequence, sequence)
        state.results[sequence] = response
        while len(state.results) > CACHED_RESULTS_PER_SESSION:
            state.results.popitem(last=False)

    def publish(self, project_id: str, message: dict) -> None:
        self._recent.setdefault(project_id, deque(maxlen=RECENT_PER_PROJECT)).append(message)
        if message.get("type") == "window":
            self.latest_by_device[message["device_id"]] = message
        for q in list(self._subs.get(project_id, ())):
            if q.full():
                q.get_nowait()  # slow watcher: drop its oldest message rather than block the API
            q.put_nowait(message)

    def subscribe(self, project_id: str) -> tuple[asyncio.Queue, list[dict]]:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subs.setdefault(project_id, set()).add(q)
        return q, list(self._recent.get(project_id, ()))

    def unsubscribe(self, project_id: str, q: asyncio.Queue) -> None:
        self._subs.get(project_id, set()).discard(q)
