import time

from fastapi.testclient import TestClient

import app as service


def test_job_lifecycle(monkeypatch):
    calls = {}

    def fake(path, languages, speakers, vocabulary, progress):
        calls.update(languages=languages, speakers=speakers, vocabulary=[v for v in vocabulary if v])
        progress("Transcription", 0.5)
        segment = {"start": 0, "end": 1000, "speaker": "Locuteur 1", "text": "Bonjour"}
        return {"segments": [segment], "languages": ["fr"]}

    monkeypatch.setattr(service.pipeline, "transcribe", fake)
    client = TestClient(service.app)
    res = client.post(
        "/jobs",
        files={"audio": ("reunion.webm", b"\x00" * 10, "audio/webm")},
        data={"languages": "fr", "speakers": "3", "vocabulary": "OSCE, Gao"},
    )
    job_id = res.json()["id"]
    for _ in range(50):
        job = client.get(f"/jobs/{job_id}").json()
        if job["status"] == "done":
            break
        time.sleep(0.02)
    assert job["status"] == "done"
    assert job["result"]["segments"][0]["text"] == "Bonjour"
    assert calls == {"languages": ["fr"], "speakers": 3, "vocabulary": ["OSCE", " Gao"]}


def test_unknown_job():
    assert TestClient(service.app).get("/jobs/inconnu").status_code == 404


def test_upload_too_large(monkeypatch):
    monkeypatch.setattr(service, "MAX_UPLOAD", 5)
    res = TestClient(service.app).post("/jobs", files={"audio": ("a.webm", b"\x00" * 10, "audio/webm")})
    assert res.status_code == 413
