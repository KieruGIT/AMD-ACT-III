"""/api/v1 routes (PROJECT_PLAN.md §5 plus the proposed v1.1 project/device/stream additions)."""
from __future__ import annotations

import asyncio
import json
from dataclasses import asdict
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

from ..audio.wav import AudioError, decode_window
from ..db import hash_key, now_iso
from ..notify import deliver
from ..profiles import CONTRACT_VERSION, MAX_UPLOAD_BYTES, PROFILES, config_payload

router = APIRouter(prefix="/api/v1")


# --- auth ------------------------------------------------------------------------------------
def _device(request: Request, project_id: str | None, device_key: str | None):
    if not project_id or not device_key:
        raise HTTPException(401, "X-Project-Id and X-Device-Key headers are required")
    device = request.app.state.db.device_by_key(project_id, device_key)
    if not device:
        raise HTTPException(403, "unknown device key for this project")
    return device


def _reader(request: Request, project_id: str | None, viewer_key: str | None, device_key: str | None):
    """Viewers (dashboard) or the project's own devices may read events and acknowledge."""
    db = request.app.state.db
    if not project_id or not (viewer_key or device_key):
        raise HTTPException(401, "X-Project-Id and X-Viewer-Key (or X-Device-Key) headers are required")
    project = db.project(project_id)
    if not project:
        raise HTTPException(403, "unknown project")
    if viewer_key and hash_key(viewer_key) == project["viewer_key_hash"]:
        return project
    if device_key and db.device_by_key(project_id, device_key):
        return project
    raise HTTPException(403, "invalid key for this project")


# --- public ------------------------------------------------------------------------------------
@router.get("/health")
def health(request: Request):
    scorer = request.app.state.scorer
    return {"service": "ok", "model_ready": scorer.ready, "mode": scorer.mode, "model_version": scorer.version}


@router.get("/config")
def config(request: Request):
    return config_payload(request.app.state.scorer.score_name)


# --- device upload -------------------------------------------------------------------------------
@router.post("/analyze-window")
async def analyze_window(
    request: Request,
    background: BackgroundTasks,
    audio: UploadFile = File(...),
    machine_id: str = Form(...),
    session_id: str = Form(..., min_length=8, max_length=64),
    sequence: int = Form(..., ge=1),
    recorded_at: str = Form(...),
    x_project_id: str | None = Header(None),
    x_device_key: str | None = Header(None),
):
    app = request.app.state
    device = _device(request, x_project_id, x_device_key)
    if machine_id not in PROFILES:
        raise HTTPException(422, f"machine_id: unsupported profile {machine_id}")
    if machine_id != device["machine_id"]:
        raise HTTPException(422, f"machine_id: this device is registered for {device['machine_id']}")
    try:
        datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, "recorded_at: expected an ISO 8601 timestamp")

    state = app.hub.session(device["id"], session_id)
    if sequence in state.results:
        return state.results[sequence]  # duplicate retry: same answer, no double counting
    if sequence <= state.last_sequence:
        raise HTTPException(409, f"sequence {sequence} is older than the latest processed ({state.last_sequence})")

    data = await audio.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "audio: payload too large")
    scorer = app.scorer
    if not scorer.ready:
        raise HTTPException(503, "model not ready")

    started = asyncio.get_running_loop().time()
    try:
        window = await run_in_threadpool(decode_window, data)
    except AudioError as err:
        raise HTTPException(422, str(err))

    score, model_ms, note = None, None, None
    threshold = getattr(scorer, "threshold", None)
    if window.quality == "ok":
        s = await run_in_threadpool(scorer.score, window.samples, state.scorer_state)
        score, threshold, model_ms = s.value, s.threshold, round(s.model_ms, 1)
        if s.value is None:
            note = "learning this session's baseline"
    valid = score is not None
    is_anomaly = bool(valid and score > threshold)

    decision = state.aggregator.observe(valid=valid, is_anomaly=is_anomaly, score=score, threshold=threshold,
                                        recorded_at=recorded_at, session_id=session_id, machine_id=machine_id)
    event = asdict(decision.changed) if decision.changed else None
    if event:
        app.db.upsert_event(x_project_id, device["id"], decision.changed)
        recovered = event["ended_at"] is not None and event["ended_at"] == recorded_at
        if decision.triggered or recovered:
            project = dict(app.db.project(x_project_id))
            subs = [dict(r) for r in app.db.subscribers(x_project_id)]
            background.add_task(deliver, subs, "opened" if decision.triggered else "recovered", project, dict(device), event)

    result = {
        "contract_version": CONTRACT_VERSION,
        "session_id": session_id,
        "machine_id": machine_id,
        "sequence": sequence,
        "recorded_at": recorded_at,
        "status": "anomaly" if is_anomaly else "normal" if valid else "unable_to_assess",
        "signal_quality": window.quality,
        "anomaly_score": round(score, 6) if valid else None,
        "threshold": threshold if valid else None,
        "score_unit": scorer.score_name,
        "is_probability": False,
        "is_anomaly_window": is_anomaly if valid else None,
        "alert": {"triggered": decision.triggered, "event_id": decision.event_id, "reason": decision.reason},
        "processing": {"model_ms": model_ms, "server_ms": round((asyncio.get_running_loop().time() - started) * 1000, 1)},
        "model_version": scorer.version,
        "spectrogram_overlay": None,
        "note": note,
    }
    app.hub.remember(state, sequence, result)
    app.db.touch_device(device["id"])
    app.hub.publish(x_project_id, {
        "type": "window", "device_id": device["id"], "device_name": device["name"], "result": result, "event": event,
    })
    return result


# --- events (contract §5.4 + proposed ack) ---------------------------------------------------------
@router.get("/sessions/{session_id}/events")
def session_events(session_id: str, request: Request, x_project_id: str | None = Header(None),
                   x_viewer_key: str | None = Header(None), x_device_key: str | None = Header(None)):
    project = _reader(request, x_project_id, x_viewer_key, x_device_key)
    return request.app.state.db.events(project["id"], session_id)


@router.post("/sessions/{session_id}/events/{event_id}/ack")
def acknowledge(session_id: str, event_id: str, request: Request, x_project_id: str | None = Header(None),
                x_viewer_key: str | None = Header(None), x_device_key: str | None = Header(None)):
    project = _reader(request, x_project_id, x_viewer_key, x_device_key)
    ev = request.app.state.db.acknowledge(project["id"], event_id)
    if not ev or ev["session_id"] != session_id:
        raise HTTPException(404, "event not found")
    request.app.state.hub.publish(project["id"], {"type": "event", "event": ev})
    return ev


# --- project views for the dashboard (proposed v1.1) ------------------------------------------------
@router.get("/projects/{project_id}")
def project_overview(project_id: str, request: Request, x_viewer_key: str | None = Header(None)):
    project = _reader(request, project_id, x_viewer_key, None)
    app = request.app.state
    devices = []
    for d in app.db.devices(project_id):
        latest = app.hub.latest_by_device.get(d["id"])
        devices.append({**dict(d), "latest": latest["result"] if latest else None})
    return {"id": project["id"], "name": project["name"], "devices": devices,
            "events": app.db.events(project_id, limit=50)}


@router.get("/projects/{project_id}/stream")
async def project_stream(project_id: str, request: Request, x_viewer_key: str | None = Header(None)):
    """Server-Sent Events: recent messages first, then live window results and event changes."""
    _reader(request, project_id, x_viewer_key, None)
    hub = request.app.state.hub
    queue, backlog = hub.subscribe(project_id)

    async def gen():
        try:
            yield "retry: 2000\n\n"
            for msg in backlog:
                yield f"data: {json.dumps({**msg, 'replay': True})}\n\n"  # watchers must not re-notify old alerts
            while not await request.is_disconnected():
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {json.dumps(msg)}\n\n"
                except asyncio.TimeoutError:
                    yield f": keep-alive {now_iso()}\n\n"
        finally:
            hub.unsubscribe(project_id, queue)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
