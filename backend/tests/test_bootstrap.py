"""Startup bootstrap: a wiped disk must not break the dashboard/listener links."""
from app.bootstrap import bootstrap
from app.db import Database

ENV = {"BOOTSTRAP_PROJECT_ID": "demo", "BOOTSTRAP_VIEWER_KEY": "vk_test", "BOOTSTRAP_DEVICE_KEY": "dk_test",
       "BOOTSTRAP_SUBSCRIBERS": "email:Ops:ops@example.com,email:Chris:chris@example.com"}


def test_bootstrap_is_idempotent_and_keys_work(tmp_path):
    db = Database(str(tmp_path / "a.db"))
    assert bootstrap(db, ENV) == "demo" and bootstrap(db, ENV) == "demo"  # second start: no duplicates
    assert db.device_by_key("demo", "dk_test")["machine_id"] == "fan_01"
    assert len(db.devices("demo")) == 1 and len(db.subscribers("demo")) == 2
    assert [s["target"] for s in db.subscribers("demo")][0] == "ops@example.com"


def test_bootstrap_off_without_project_and_requires_keys(tmp_path):
    db = Database(str(tmp_path / "b.db"))
    assert bootstrap(db, {}) is None
    try:
        bootstrap(db, {"BOOTSTRAP_PROJECT_ID": "demo"})
    except RuntimeError as err:
        assert "BOOTSTRAP_VIEWER_KEY" in str(err)
    else:
        raise AssertionError("missing keys must fail loudly")


def test_dashboard_reads_with_bootstrapped_viewer_key(tmp_path, monkeypatch):
    import dataclasses

    from fastapi.testclient import TestClient

    import app.main as main

    for k, v in ENV.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(main, "settings", dataclasses.replace(main.settings, db_path=str(tmp_path / "c.db")))
    app = main.create_app()
    r = TestClient(app).get("/api/v1/projects/demo", headers={"X-Viewer-Key": "vk_test"})
    assert r.status_code == 200 and len(r.json()["devices"]) == 1


def test_single_origin_serves_frontend_without_shadowing_the_api(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.main import create_app, serve_frontend

    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text("<html>app</html>")
    (tmp_path / "assets" / "a.js").write_text("js")
    app = create_app(":memory:")
    serve_frontend(app, tmp_path)
    c = TestClient(app)
    assert c.get("/api/v1/health").json()["service"] == "ok"
    assert c.get("/api/v1/nope").status_code == 404  # never index.html for API typos
    assert c.get("/assets/a.js").text == "js"
    assert c.get("/app").text == "<html>app</html>" and c.get("/").text == "<html>app</html>"
    assert c.get("/../../etc/passwd").text == "<html>app</html>"  # no escaping the folder
    assert isinstance(app, FastAPI)
