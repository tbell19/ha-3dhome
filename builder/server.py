"""3D Home Scan Builder: turns the photos taken in the 3D Home panel into a 3D scan (a Gaussian splat).

A small HTTP server with no dependencies beyond Python's standard library. Home Assistant's ha_3dhome integration
(custom_components/ha_3dhome/scans.py) sends it the photos and follows the job:

    GET    /health            {"ok": true, "version"}
    POST   /jobs              a tar of images/*.jpg          -> 201 {"id"}
    GET    /jobs/<id>         {"state": queued|running|done|failed, "progress": 0-1, "message"}
    GET    /jobs/<id>/result  the trained splat (.ply)
    DELETE /jobs/<id>         stop it and delete its files

Jobs run one at a time:
    1. COLMAP finds features in every photo, matches them between photos (they come from a walk, so neighbours in time
       are matched, plus loop closure), and works out where each photo was taken (sparse reconstruction).
    2. OpenSplat trains the Gaussian splat from the photos and their poses.

Settings (environment, or the add-on's options in /data/options.json):
    TOKEN        when set, every request must carry "Authorization: Bearer <TOKEN>"
    STEPS        OpenSplat training steps (default 7000; fewer is faster and blurrier)
    MAX_SIZE     the long side COLMAP looks at (default 1600)
    DATA         where jobs live (default /data/jobs)
    PIPELINE     a command to run instead of COLMAP + OpenSplat (tests): run in the job folder, must write splat.ply
                 and may print "progress <0-1> <message>" lines
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tarfile
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from queue import Queue
from typing import Any

VERSION = "0.1.0"


def _options() -> dict[str, Any]:
    try:
        return json.loads(Path("/data/options.json").read_text())
    except (OSError, ValueError):
        return {}


OPTIONS = _options()
TOKEN = os.environ.get("TOKEN") or OPTIONS.get("token") or ""
STEPS = int(os.environ.get("STEPS") or OPTIONS.get("steps") or 7000)
MAX_SIZE = int(os.environ.get("MAX_SIZE") or OPTIONS.get("max_size") or 1600)
DATA = Path(os.environ.get("DATA") or "/data/jobs")
PIPELINE = os.environ.get("PIPELINE")
MAX_UPLOAD = 4 * 1024**3
JOB_ID = re.compile(r"^[a-f0-9]{32}$")


class Failed(Exception):
    """The job can't go on; the message is for the person who made the scan."""


class Job:
    def __init__(self, job_id: str) -> None:
        self.id = job_id
        self.dir = DATA / job_id
        self.state = "queued"
        self.progress = 0.0
        self.message = "Waiting for its turn"
        self.proc: subprocess.Popen[str] | None = None
        self.cancelled = False
        self.started = time.time()

    def status(self) -> dict[str, Any]:
        return {"state": self.state, "progress": round(self.progress, 3), "message": self.message}

    def set(self, progress: float, message: str) -> None:
        self.progress = max(self.progress, min(1.0, progress))
        self.message = message


JOBS: dict[str, Job] = {}
LOCK = threading.Lock()
QUEUE: Queue[Job] = Queue()


def run(job: Job, cmd: list[str], start: float, end: float, message: str, steps: int | None = None) -> None:
    """Run one step of the pipeline; with `steps`, OpenSplat's "Step N" lines move the progress from start to end."""
    if job.cancelled:
        raise Failed("Stopped.")
    job.set(start, message)
    job.proc = subprocess.Popen(
        cmd, cwd=job.dir, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    tail: list[str] = []
    assert job.proc.stdout
    for line in job.proc.stdout:
        tail = (tail + [line.rstrip()])[-20:]
        if steps and (m := re.search(r"Step (\d+)", line)):
            n = int(m.group(1))
            job.set(start + (end - start) * n / steps, f"{message}: step {n} of {steps}")
        elif m := re.match(r"progress ([\d.]+) ?(.*)", line):
            job.set(start + (end - start) * float(m.group(1)), m.group(2) or message)
    code = job.proc.wait()
    job.proc = None
    if job.cancelled:
        raise Failed("Stopped.")
    if code:
        print(f"[{job.id}] {' '.join(cmd[:2])} failed ({code}):\n" + "\n".join(tail), flush=True)
        raise Failed(f"{message} failed. The add-on's log has the details.")


def registered(job: Job) -> tuple[Path | None, int]:
    """The sparse model with the most photos placed, and how many."""
    best: tuple[Path | None, int] = (None, 0)
    for model in sorted((job.dir / "sparse").glob("*")):
        images = model / "images.bin"
        if not images.exists():
            continue
        with images.open("rb") as f:
            n = int.from_bytes(f.read(8), "little")
        if n > best[1]:
            best = (model, n)
    return best


def pipeline(job: Job) -> None:
    images = job.dir / "images"
    photos = len(list(images.glob("*.jpg")))
    if PIPELINE:
        run(job, ["sh", "-c", PIPELINE], 0, 1, "Building")
    else:
        db = str(job.dir / "database.db")
        run(job, ["colmap", "feature_extractor", "--database_path", db, "--image_path", str(images),
                  "--ImageReader.single_camera", "1", "--ImageReader.camera_model", "OPENCV",
                  "--SiftExtraction.use_gpu", "0", "--SiftExtraction.max_image_size", str(MAX_SIZE)],
            0.0, 0.08, "Finding details in the photos")
        run(job, ["colmap", "sequential_matcher", "--database_path", db, "--SiftMatching.use_gpu", "0",
                  "--SequentialMatching.overlap", "12", "--SequentialMatching.quadratic_overlap", "1"],
            0.08, 0.2, "Matching the photos")
        (job.dir / "sparse").mkdir(exist_ok=True)
        run(job, ["colmap", "mapper", "--database_path", db, "--image_path", str(images),
                  "--output_path", str(job.dir / "sparse")],
            0.2, 0.35, "Working out where each photo was taken")
        model, n = registered(job)
        if not model or n < max(10, photos // 2):
            raise Failed(
                f"Only {n} of {photos} photos could be placed. Film again more slowly, keeping each wall in view "
                "for a while, in good light."
            )
        if model.name != "0":
            target = job.dir / "sparse" / "0"
            if target.exists():
                shutil.rmtree(target)
            model.rename(target)
        run(job, ["opensplat", str(job.dir), "-n", str(STEPS), "-o", str(job.dir / "splat.ply")],
            0.35, 0.99, "Training the 3D scan", steps=STEPS)
    if not (job.dir / "splat.ply").exists():
        raise Failed("The 3D scan came out empty.")


def worker() -> None:
    while True:
        job = QUEUE.get()
        if job.cancelled:
            continue
        job.state = "running"
        try:
            pipeline(job)
            job.state, job.progress, job.message = "done", 1.0, "Ready"
        except Failed as err:
            job.state, job.message = "failed", str(err)
        except Exception as err:  # noqa: BLE001 - anything else still ends the job, with a log entry
            print(f"[{job.id}] failed: {err!r}", flush=True)
            job.state, job.message = "failed", "The scan builder ran into a problem. The add-on's log has the details."
        finally:  # only the splat is kept, until Home Assistant fetches it and deletes the job
            for tmp in ("database.db", "images", "sparse", "photos.tar"):
                path = job.dir / tmp
                if path.is_dir():
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    path.unlink(missing_ok=True)


class Handler(BaseHTTPRequestHandler):
    server_version = f"ha3dhome-builder/{VERSION}"

    def log_message(self, fmt: str, *args: Any) -> None:  # quieter than the default: no polls
        if self.command != "GET" or "result" in self.path:
            print(f"{self.command} {self.path} {args[1] if len(args) > 1 else ''}", flush=True)

    def _send(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _allowed(self) -> bool:
        if TOKEN and self.headers.get("Authorization") != f"Bearer {TOKEN}":
            self._send(HTTPStatus.UNAUTHORIZED, {"message": "The scan builder's key doesn't match."})
            return False
        return True

    def _job(self) -> tuple[Job | None, str]:
        parts = self.path.strip("/").split("/")
        job_id = parts[1] if len(parts) > 1 else ""
        with LOCK:
            job = JOBS.get(job_id) if JOB_ID.match(job_id) else None
        if not job:
            self._send(HTTPStatus.NOT_FOUND, {"message": "There is no such job."})
        return job, parts[2] if len(parts) > 2 else ""

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            return self._send(HTTPStatus.OK, {"ok": True, "version": VERSION})
        if not self._allowed() or not self.path.startswith("/jobs/"):
            return None if self.path.startswith("/jobs/") else self._send(HTTPStatus.NOT_FOUND, {"message": "?"})
        job, what = self._job()
        if not job:
            return None
        if what == "result":
            path = job.dir / "splat.ply"
            if job.state != "done" or not path.exists():
                return self._send(HTTPStatus.CONFLICT, {"message": "The 3D scan isn't ready."})
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(path.stat().st_size))
            self.end_headers()
            with path.open("rb") as f:
                shutil.copyfileobj(f, self.wfile, 1 << 20)
            return None
        return self._send(HTTPStatus.OK, job.status())

    def do_POST(self) -> None:  # noqa: N802
        if not self._allowed():
            return
        if self.path != "/jobs":
            return self._send(HTTPStatus.NOT_FOUND, {"message": "?"})
        size = int(self.headers.get("Content-Length") or 0)
        if not 0 < size <= MAX_UPLOAD:
            return self._send(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"message": "Send the photos as one tar file."})
        job = Job(uuid.uuid4().hex)
        job.dir.mkdir(parents=True)
        tar_path = job.dir / "photos.tar"
        with tar_path.open("wb") as f:
            left = size
            while left:
                chunk = self.rfile.read(min(left, 1 << 20))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        try:
            with tarfile.open(tar_path) as tar:
                members = [m for m in tar.getmembers() if m.isfile() and re.fullmatch(r"images/[\w.-]+\.jpg", m.name)]
                tar.extractall(job.dir, members=members, filter="data")
        except (tarfile.TarError, OSError):
            shutil.rmtree(job.dir, ignore_errors=True)
            return self._send(HTTPStatus.BAD_REQUEST, {"message": "The photos couldn't be read."})
        tar_path.unlink()
        if not members:
            shutil.rmtree(job.dir, ignore_errors=True)
            return self._send(HTTPStatus.BAD_REQUEST, {"message": "There were no photos."})
        with LOCK:
            JOBS[job.id] = job
        QUEUE.put(job)
        print(f"[{job.id}] {len(members)} photos queued", flush=True)
        return self._send(HTTPStatus.CREATED, {"id": job.id})

    def do_DELETE(self) -> None:  # noqa: N802
        if not self._allowed():
            return
        job, _ = self._job()
        if not job:
            return
        job.cancelled = True
        if job.proc:
            job.proc.terminate()
        if job.state in ("queued", "running"):
            job.state, job.message = "failed", "Stopped."
        with LOCK:
            JOBS.pop(job.id, None)
        shutil.rmtree(job.dir, ignore_errors=True)
        self._send(HTTPStatus.OK, {})


def main() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    for old in DATA.iterdir():  # jobs from before a restart can't be followed any more
        shutil.rmtree(old, ignore_errors=True)
    threading.Thread(target=worker, daemon=True).start()
    port = int(os.environ.get("PORT") or 8099)
    print(f"3D Home Scan Builder {VERSION} on port {port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
