"""Service de transcription MonMeeting (API HTTP interne, appelée par le serveur Node).

POST /jobs            fichier audio/vidéo + options → {"id"}
GET  /jobs/{id}       état : queued | running | done | error, progression, résultat
GET  /health          disponibilité et modèle utilisé
Les fichiers sont supprimés dès la fin du traitement ; rien n'est conservé sur disque.
"""

from __future__ import annotations

import os
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

import pipeline

app = FastAPI(title="MonMeeting ASR")
# Une transcription à la fois : Whisper occupe déjà tous les cœurs.
executor = ThreadPoolExecutor(max_workers=int(os.environ.get("ASR_WORKERS", "1")))
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()
JOB_TTL = 6 * 3600  # les résultats non récupérés sont oubliés après 6 h


def _purge() -> None:
    limit = time.time() - JOB_TTL
    with jobs_lock:
        for key in [k for k, j in jobs.items() if j["updated"] < limit]:
            del jobs[key]


def _run(job_id: str, path: str, languages: list[str], speakers: int | None, vocabulary: list[str]):
    def progress(label: str, value: float) -> None:
        with jobs_lock:
            jobs[job_id].update(status="running", label=label, progress=round(value, 3), updated=time.time())

    try:
        result = pipeline.transcribe(path, languages, speakers, vocabulary, progress)
        with jobs_lock:
            jobs[job_id].update(status="done", progress=1.0, result=result, updated=time.time())
    except Exception as exc:  # noqa: BLE001 — l'erreur est renvoyée au client
        with jobs_lock:
            jobs[job_id].update(status="error", error=str(exc), updated=time.time())
    finally:
        os.unlink(path)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "whisperModel": pipeline.WHISPER_MODEL, "device": pipeline.WHISPER_DEVICE}


@app.post("/jobs")
async def create_job(
    audio: UploadFile = File(...),
    languages: str = Form(""),
    speakers: str = Form(""),
    vocabulary: str = Form(""),
) -> dict:
    _purge()
    suffix = os.path.splitext(audio.filename or "")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        while chunk := await audio.read(1024 * 1024):
            tmp.write(chunk)
    langs = [code for code in languages.split(",") if code.strip().isalpha() and len(code.strip()) <= 3]
    n_speakers = int(speakers) if speakers.strip().isdigit() else None
    terms = [t for t in vocabulary.replace(";", "\n").replace(",", "\n").split("\n")]

    job_id = uuid.uuid4().hex
    with jobs_lock:
        jobs[job_id] = {"status": "queued", "label": "En file d'attente", "progress": 0.0, "updated": time.time()}
    executor.submit(_run, job_id, tmp.name, [l.strip() for l in langs], n_speakers, terms)
    return {"id": job_id}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    with jobs_lock:
        job = jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "Tâche inconnue ou expirée.")
        return {k: v for k, v in job.items() if k != "updated"}
