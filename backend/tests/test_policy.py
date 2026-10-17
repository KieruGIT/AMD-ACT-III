"""Mirrors frontend/src/api/mock/alertPolicy.test.ts so both implementations agree."""
from datetime import datetime, timedelta, timezone

from app.alerting.policy import AlertAggregator

T0 = datetime(2026, 10, 16, 7, 0, tzinfo=timezone.utc)
A, N = True, False


def agg():
    n = iter(range(1, 1000))
    return AlertAggregator(min_anomalous=3, consider_last=5, cooldown_s=30, new_id=lambda: f"e{next(n)}")


def run(pattern, start=0, a=None):
    a = a or agg()
    out = [
        a.observe(valid=p is not None, is_anomaly=bool(p), score=0.9 if p else 0.3, threshold=0.65,
                  recorded_at=(T0 + timedelta(seconds=start + i)).isoformat(), session_id="s", machine_id="fan_01")
        for i, p in enumerate(pattern)
    ]
    return a, out, sum(d.triggered for d in out)


def test_single_spike_never_alerts():
    assert run([N, N, A, N, N, N, N])[2] == 0


def test_fires_once_at_third_anomaly_of_five():
    a, out, _ = run([N, A, N, A, A])
    assert [d.triggered for d in out] == [False, False, False, False, True]
    assert out[4].reason == "3 of the last 5 valid windows exceeded threshold"
    assert a.active.started_at == (T0 + timedelta(seconds=1)).isoformat()


def test_long_anomaly_is_one_event():
    a, _, triggered = run([A] * 120)
    assert triggered == 1 and a.active.anomalous_window_count == 120


def test_recovery_then_cooldown():
    a, _, _ = run([A, A, A, N, N, N, N, N])
    assert a.active is None
    assert run([A, A, A, A], 10, a)[2] == 0  # inside the 30 s cooldown
    assert run([N, A, A, A], 40, a)[2] == 1


def test_unassessable_windows_do_not_count():
    assert run([A, None, None, A, None, None, None])[2] == 0


def test_long_gap_resets_count():
    a, _, _ = run([A, A])
    assert run([A], 60, a)[2] == 0
