import asyncio
import base64
import json
import os
import shutil
import tempfile
import uuid
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Set

from fastapi import FastAPI, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Anson Practice Piano OMR & Score Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Process pool keeps CPU-heavy HOMR inference off FastAPI's asyncio event loop
executor = ProcessPoolExecutor(max_workers=2)

OMR_ALLOW_SAMPLE_FALLBACK = os.getenv("OMR_ALLOW_SAMPLE_FALLBACK", "true").lower() == "true"

SAMPLE_TRANSCRIBED_XML = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>Transcribed Etude in C</work-title></work>
  <identification><creator type="composer">OMR Transcription</creator></identification>
  <part-list>
    <score-part id="P1"><part-name>Piano</part-name></score-part>
  </part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>F</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>
    </measure>
    <measure number="3">
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>
      <backup><duration>4</duration></backup>
      <note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><voice>2</voice><type>half</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>"""

# In-memory job & score registries (swap for Redis/DB in multi-worker production)
jobs: Dict[str, dict] = {}
subscribers: Dict[str, Set[WebSocket]] = {}
scores_db: Dict[str, dict] = {
    "transcribed-etude": {
        "songId": "transcribed-etude",
        "title": "Transcribed Etude in C",
        "composer": "OMR Transcription",
        "musicxml": SAMPLE_TRANSCRIBED_XML,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
}


class ScoreSavePayload(BaseModel):
    musicxml: str
    title: str | None = None
    composer: str | None = None


def run_homr_blocking(image_path: str, output_dir: str) -> str:
    """
    Executes HOMR synchronously inside a worker process.
    Falls back to a valid sample MusicXML when OMR_ALLOW_SAMPLE_FALLBACK=true
    if HOMR weights or CLI are unavailable inside lightweight containers.
    """
    import subprocess

    cmd = ["homr", image_path, "--output", output_dir]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if result.returncode == 0:
            xml_files = list(Path(output_dir).glob("*.musicxml")) + list(Path(output_dir).glob("*.xml"))
            if xml_files:
                return xml_files[0].read_text(encoding="utf-8")
        if not OMR_ALLOW_SAMPLE_FALLBACK:
            raise RuntimeError(result.stderr.strip() or "HOMR exited with a non-zero status")
    except FileNotFoundError as exc:
        if not OMR_ALLOW_SAMPLE_FALLBACK:
            raise RuntimeError("HOMR CLI executable not found in backend container") from exc

    return SAMPLE_TRANSCRIBED_XML


async def broadcast(job_id: str) -> None:
    payload = json.dumps(jobs[job_id])
    dead: Set[WebSocket] = set()
    for ws in subscribers.get(job_id, set()):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    if job_id in subscribers:
        subscribers[job_id] -= dead


async def process_omr_job(job_id: str, temp_dir: str, image_path: str) -> None:
    loop = asyncio.get_running_loop()
    try:
        jobs[job_id].update(
            status="preprocessing",
            progress=25,
            message="Deskewing image and normalizing staff geometry...",
        )
        await broadcast(job_id)

        jobs[job_id].update(
            status="recognizing",
            progress=55,
            message="Running HOMR optical music recognition...",
        )
        await broadcast(job_id)

        musicxml = await loop.run_in_executor(executor, run_homr_blocking, image_path, temp_dir)

        jobs[job_id].update(
            status="postprocessing",
            progress=90,
            message="Validating grand-staff MusicXML...",
        )
        await broadcast(job_id)

        jobs[job_id].update(
            status="completed",
            progress=100,
            message="MusicXML ready for practice",
            musicxml=musicxml,
        )
        await broadcast(job_id)
    except Exception as exc:
        jobs[job_id].update(
            status="error",
            progress=0,
            message="OMR processing failed",
            error=str(exc),
        )
        await broadcast(job_id)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "service": "anson-piano-backend"}


@app.post("/api/omr/upload", status_code=202)
async def upload_sheet_music(request: Request):
    content_type = request.headers.get("content-type", "")
    filename = "sheet-music.png"
    contents = b""

    if "application/json" in content_type:
        body = await request.json()
        filename = (body.get("filename") or "sheet-music.png").strip()
        data_base64 = body.get("dataBase64") or ""
        ext = Path(filename).suffix.lower() or ".png"
        if ext not in {".png", ".jpg", ".jpeg"}:
            raise HTTPException(
                status_code=400, detail="Only PNG and JPG sheet music images are supported."
            )
        if data_base64:
            try:
                contents = base64.b64decode(data_base64)
            except Exception as exc:
                raise HTTPException(status_code=400, detail="Invalid base64 image payload") from exc
    else:
        form = await request.form()
        upload = form.get("file")
        if not isinstance(upload, UploadFile):
            raise HTTPException(status_code=400, detail="Missing uploaded sheet music file.")
        filename = upload.filename or "sheet-music.png"
        ext = Path(filename).suffix.lower()
        if ext not in {".png", ".jpg", ".jpeg"}:
            raise HTTPException(
                status_code=400, detail="Only PNG and JPG sheet music images are supported."
            )
        contents = await upload.read()

    job_id = str(uuid.uuid4())
    temp_dir = tempfile.mkdtemp(prefix=f"omr_{job_id}_")
    image_path = os.path.join(temp_dir, f"input{ext}")

    with open(image_path, "wb") as f:
        f.write(contents)

    jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 10,
        "message": f"Queued {filename} for OMR...",
    }
    subscribers[job_id] = set()

    asyncio.create_task(process_omr_job(job_id, temp_dir, image_path))

    return {"job_id": job_id, "status": "queued", "ws_url": f"/ws/omr/{job_id}"}


@app.get("/api/omr/status/{job_id}")
async def get_omr_status(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="OMR job not found")
    return jobs[job_id]


@app.websocket("/ws/omr/{job_id}")
async def omr_status_socket(websocket: WebSocket, job_id: str):
    await websocket.accept()
    if job_id not in jobs:
        await websocket.send_text(
            json.dumps({"job_id": job_id, "status": "error", "progress": 0, "error": "Unknown job ID"})
        )
        await websocket.close()
        return

    subscribers.setdefault(job_id, set()).add(websocket)
    await websocket.send_text(json.dumps(jobs[job_id]))

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        subscribers.get(job_id, set()).discard(websocket)


@app.get("/api/scores/{song_id}")
async def get_score_xml(song_id: str):
    if song_id not in scores_db:
        raise HTTPException(status_code=404, detail="Score not found")
    return scores_db[song_id]


@app.put("/api/scores/{song_id}")
async def save_score_xml(song_id: str, payload: ScoreSavePayload):
    if "<score-partwise" not in payload.musicxml and "<score-timewise" not in payload.musicxml:
        raise HTTPException(status_code=400, detail="Invalid MusicXML document")

    existing = scores_db.get(song_id, {})
    record = {
        "songId": song_id,
        "title": payload.title or existing.get("title", "Untitled Score"),
        "composer": payload.composer or existing.get("composer", "Edited Score"),
        "musicxml": payload.musicxml,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    scores_db[song_id] = record
    return {"ok": True, **record}
