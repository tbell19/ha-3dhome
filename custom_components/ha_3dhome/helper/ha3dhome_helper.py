#!/usr/bin/env python3
"""3D Home helper: builds the 3D scans for a Home Assistant 3D Home page on this computer's graphics card.

Copy the command from the page (3D Home → Build on another computer). It looks like:

    python3 ha3dhome_helper.py --url http://homeassistant.local:8123 --page <page id> --key <helper key>

The helper connects to Home Assistant (nothing needs to connect to this computer), waits for photos to build, and for
each scan: downloads the photos, works out where each was taken (COLMAP), trains the Gaussian splat (OpenSplat, on the
graphics card when it was built for one), shows its progress on the page, and sends the finished scan back. It keeps
waiting for the next one until you stop it (Ctrl+C); --once builds one scan and stops.

Needs Python 3.9 or newer (nothing else from Python), plus `colmap` and `opensplat` on the PATH (or --colmap and
--opensplat). On Linux with an NVIDIA card, the Docker image (Dockerfile next to this file) has both, built for CUDA.

The helper key only lets it fetch that page's photos and send back scans: it can't control anything in the home.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable

VERSION = "0.1.0"
WAIT = 10  # seconds between asking for work
REPORT = 3  # at most one progress report every this many seconds


class Stop(Exception):
    """Home Assistant said to stop (the scan was cancelled or given to another helper), or Ctrl+C."""


class Failed(Exception):
    """The scan can't be built; the message is shown on the page."""


def say(msg: str) -> None:
    print(time.strftime("%H:%M:%S"), msg, flush=True)


# ----- talking to Home Assistant -----


class HomeAssistant:
    def __init__(self, url: str, page: str, key: str, name: str, gpu: str) -> None:
        self.base = f"{url.rstrip('/')}/api/ha_3dhome/helper/{page}"
        self.headers = {
            "Authorization": f"Bearer {key}",
            "X-Helper-Name": name,
            "X-Helper-GPU": gpu,
            "User-Agent": f"ha3dhome-helper/{VERSION}",
        }

    def _open(self, path: str, data: Any = None, headers: dict[str, str] | None = None, timeout: float = 60):
        req = urllib.request.Request(self.base + path, data=data, headers={**self.headers, **(headers or {})})
        return urllib.request.urlopen(req, timeout=timeout)

    def _json(self, path: str, body: dict[str, Any]) -> int:
        data = json.dumps(body).encode()
        try:
            with self._open(path, data, {"Content-Type": "application/json"}) as resp:
                return resp.status
        except urllib.error.HTTPError as err:
            return err.code

    def next_job(self) -> dict[str, Any] | None:
        with self._open("/job", timeout=30) as resp:
            return json.loads(resp.read()) if resp.status == 200 else None

    def download(self, scan_id: str, target: Path) -> None:
        with self._open(f"/photos/{scan_id}", timeout=600) as resp, target.open("wb") as f:
            shutil.copyfileobj(resp, f, 1 << 20)

    def progress(self, scan_id: str, progress: float, message: str) -> None:
        if self._json(f"/progress/{scan_id}", {"progress": round(progress, 3), "message": message}) == 409:
            raise Stop("Home Assistant stopped this scan.")

    def upload(self, scan_id: str, splat: Path) -> None:
        size = splat.stat().st_size
        with splat.open("rb") as f:
            headers = {"Content-Type": "application/octet-stream", "Content-Length": str(size)}
            with self._open(f"/result/{scan_id}", f, headers, timeout=3600) as resp:
                resp.read()

    def failed(self, scan_id: str, message: str) -> None:
        try:
            self._json(f"/failed/{scan_id}", {"message": message})
        except (urllib.error.URLError, OSError):
            pass


# ----- building a scan -----


class Builder:
    """Runs the steps of one scan in `work`, reporting progress through `report(fraction, message)`."""

    def __init__(self, args: argparse.Namespace, gpu: bool, report: Callable[[float, str], None]) -> None:
        self.args = args
        self.gpu = gpu
        self.report = report
        self.proc: subprocess.Popen[str] | None = None

    def run(self, work: Path, cmd: list[str], start: float, end: float, message: str, steps: int = 0) -> None:
        """One step; OpenSplat's "Step N" lines (with `steps`) or "progress <0-1> <text>" lines move the progress."""
        self.report(start, message)
        say(f"{message}…")
        self.proc = subprocess.Popen(
            cmd, cwd=work, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, errors="replace"
        )
        tail: list[str] = []
        assert self.proc.stdout
        for line in self.proc.stdout:
            tail = (tail + [line.rstrip()])[-25:]
            if steps and (m := re.search(r"Step (\d+)", line)):
                n = int(m.group(1))
                self.report(start + (end - start) * n / steps, f"{message}: step {n} of {steps}")
            elif m := re.match(r"progress ([\d.]+) ?(.*)", line):
                self.report(start + (end - start) * float(m.group(1)), m.group(2) or message)
        code = self.proc.wait()
        self.proc = None
        if code:
            print("\n".join(tail), flush=True)
            raise Failed(f"{message} failed (see the helper's window for details)")

    def build(self, work: Path) -> Path:
        args = self.args
        images = work / "images"
        photos = len(list(images.glob("*.jpg")))
        if args.pipeline:
            self.run(work, ["sh", "-c", args.pipeline] if os.name != "nt" else ["cmd", "/c", args.pipeline], 0, 1, "Building")
        else:
            db = str(work / "database.db")
            extract = [args.colmap, "feature_extractor", "--database_path", db, "--image_path", str(images),
                       "--ImageReader.single_camera", "1", "--ImageReader.camera_model", "OPENCV"]
            try:
                self.run(work, [*extract, "--SiftExtraction.use_gpu", "1" if self.gpu else "0"],
                         0.0, 0.06, "Finding details in the photos")
            except Failed:
                if not self.gpu:
                    raise
                Path(db).unlink(missing_ok=True)  # a COLMAP built without CUDA: on the processor instead
                self.run(work, [*extract, "--SiftExtraction.use_gpu", "0"], 0.0, 0.06, "Finding details in the photos")
            self.run(work, [args.colmap, "sequential_matcher", "--database_path", db,
                            "--SiftMatching.use_gpu", "1" if self.gpu else "0",
                            "--SequentialMatching.overlap", "12", "--SequentialMatching.quadratic_overlap", "1"],
                     0.06, 0.15, "Matching the photos")
            (work / "sparse").mkdir(exist_ok=True)
            self.run(work, [args.colmap, "mapper", "--database_path", db, "--image_path", str(images),
                            "--output_path", str(work / "sparse")],
                     0.15, 0.3, "Working out where each photo was taken")
            model, placed = registered(work)
            if not model or placed < max(10, photos // 2):
                raise Failed(
                    f"Only {placed} of {photos} photos could be placed. Film again more slowly, keeping each wall in "
                    "view for a while, in good light."
                )
            if model.name != "0":
                target = work / "sparse" / "0"
                if target.exists():
                    shutil.rmtree(target)
                model.rename(target)
            self.run(work, [args.opensplat, str(work), "-n", str(args.steps), "-o", str(work / "splat.ply")],
                     0.3, 0.98, "Training the 3D scan", steps=args.steps)
        splat = work / "splat.ply"
        if not splat.exists() or splat.stat().st_size < 100:
            raise Failed("the 3D scan came out empty")
        return splat

    def stop(self) -> None:
        if self.proc:
            self.proc.terminate()


def registered(work: Path) -> tuple[Path | None, int]:
    """COLMAP's sparse model with the most photos placed, and how many."""
    best: tuple[Path | None, int] = (None, 0)
    for model in sorted((work / "sparse").glob("*")):
        images = model / "images.bin"
        if images.exists():
            with images.open("rb") as f:
                n = int.from_bytes(f.read(8), "little")
            if n > best[1]:
                best = (model, n)
    return best


def unpack(tar_path: Path, work: Path) -> int:
    """Only images/*.jpg are taken out of the tar, whatever else it holds."""
    with tarfile.open(tar_path) as tar:
        members = [m for m in tar.getmembers() if m.isfile() and re.fullmatch(r"images/[\w.-]+\.jpg", m.name)]
        if sys.version_info >= (3, 12):
            tar.extractall(work, members=members, filter="data")
        else:
            for m in members:
                tar.extract(m, work)
    tar_path.unlink()
    return len(members)


# ----- this computer -----


def gpu_name() -> str | None:
    """The graphics card's name, when there is one the tools can use (NVIDIA, through nvidia-smi)."""
    if shutil.which("nvidia-smi"):
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                                 capture_output=True, text=True, timeout=10).stdout.strip()
            return out.splitlines()[0] if out else None
        except (OSError, subprocess.SubprocessError):
            return None
    return None


def missing_tools(args: argparse.Namespace) -> list[str]:
    if args.pipeline:
        return []
    return [tool for tool in (args.colmap, args.opensplat) if not shutil.which(tool)]


INSTALL = """\
This computer needs COLMAP and OpenSplat to build scans:
  - COLMAP: on Debian/Ubuntu `sudo apt install colmap`; elsewhere https://colmap.github.io/install.html
  - OpenSplat: build it for your graphics card from https://github.com/pierotofy/OpenSplat (README, "Build")
The easier way on Linux with an NVIDIA card is the Docker image, which has both built for CUDA: see the page's
"Build on another computer", Docker tab."""


# ----- the loop -----


def build_one(ha: HomeAssistant, args: argparse.Namespace, job: dict[str, Any], gpu: bool) -> None:
    scan_id = job["scan_id"]
    say(f"Building scan {scan_id} ({job.get('photos', '?')} photos)")
    last = 0.0

    def report(fraction: float, message: str) -> None:
        nonlocal last
        if time.monotonic() - last >= REPORT or fraction >= 0.98:
            last = time.monotonic()
            ha.progress(scan_id, fraction, message)

    builder = Builder(args, gpu, report)
    work = Path(tempfile.mkdtemp(prefix=f"ha3dhome-{scan_id}-", dir=args.work))
    try:
        report(0, "Downloading the photos")
        ha.download(scan_id, work / "photos.tar")
        if unpack(work / "photos.tar", work) == 0:
            raise Failed("there were no photos")
        splat = builder.build(work)
        ha.progress(scan_id, 0.99, "Sending the 3D scan")
        say("Sending the 3D scan to Home Assistant…")
        ha.upload(scan_id, splat)
        say("Done: it's on the page now.")
    except Stop as err:
        builder.stop()
        say(f"Stopped: {err}")
    except KeyboardInterrupt:
        builder.stop()
        ha.failed(scan_id, "the helper was stopped")
        raise
    except Failed as err:
        say(f"Couldn't build it: {err}")
        ha.failed(scan_id, str(err))
    except (urllib.error.URLError, OSError) as err:
        builder.stop()
        say(f"Lost Home Assistant while building ({err}); it will offer the scan again.")
    finally:
        if not args.keep:
            shutil.rmtree(work, ignore_errors=True)


def _stop(*_: Any) -> None:
    raise KeyboardInterrupt


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Build 3D Home scans on this computer.")
    p.add_argument("--url", required=True, help="Home Assistant's address, as in the browser")
    p.add_argument("--page", required=True, help="the 3D Home page's id (from the page's command)")
    p.add_argument("--key", default=os.environ.get("HA3DHOME_KEY"), help="the page's helper key (or HA3DHOME_KEY)")
    p.add_argument("--name", default=socket.gethostname(), help="this computer's name, shown on the page")
    p.add_argument("--steps", type=int, default=7000, help="training steps (more: sharper and slower)")
    p.add_argument("--colmap", default="colmap")
    p.add_argument("--opensplat", default="opensplat")
    p.add_argument("--cpu", action="store_true", help="don't use the graphics card")
    p.add_argument("--work", default=None, help="where to keep a scan's files while building (default: temp)")
    p.add_argument("--keep", action="store_true", help="keep each scan's working files")
    p.add_argument("--once", action="store_true", help="build one scan, then stop")
    p.add_argument("--pipeline", default=None, help=argparse.SUPPRESS)  # tests: a command that writes splat.ply
    args = p.parse_args(argv)
    if not args.key:
        p.error("--key is needed (copy the command from the page)")

    if missing := missing_tools(args):
        say("Missing: " + ", ".join(missing))
        print(INSTALL)
        return 2
    gpu = None if args.cpu else gpu_name()
    label = gpu or f"{platform.processor() or platform.machine()} (no graphics card)"
    ha = HomeAssistant(args.url, args.page, args.key, args.name[:40], label[:80])
    say(f"3D Home helper {VERSION} on {args.name}, building with {label}")
    signal.signal(signal.SIGTERM, _stop)  # docker stop: like Ctrl+C

    waiting = False
    failures = 0
    try:
        while True:
            try:
                job = ha.next_job()
                failures = 0
            except urllib.error.HTTPError as err:
                if err.code == 401:
                    say("Home Assistant doesn't accept this key. Copy the command from the page again.")
                    return 3
                failures += 1
                say(f"Home Assistant answered {err.code}; trying again.")
                job = None
            except (urllib.error.URLError, OSError) as err:
                failures += 1
                if failures == 1 or failures % 30 == 0:
                    say(f"Can't reach Home Assistant at {args.url} ({getattr(err, 'reason', err)}); trying again.")
                job = None
            if job:
                waiting = False
                build_one(ha, args, job, bool(gpu))
                if args.once:
                    return 0
                continue
            if not waiting and not failures:
                say("Connected. Waiting for a scan to build (Ctrl+C to stop)…")
                waiting = True
            time.sleep(WAIT)
    except KeyboardInterrupt:
        say("Stopped.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
