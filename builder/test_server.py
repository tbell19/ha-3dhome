"""The scan builder add-on's server (server.py), with a stand-in for COLMAP + OpenSplat.

    python3 builder/test_server.py      (npm run test:builder; plain Python, no Home Assistant needed)
"""

from __future__ import annotations

import importlib.util
import io
import json
import tarfile
import threading
import time
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import os
import tempfile

SERVER = Path(__file__).parent / "server.py"
# the stand-in: reports progress, then writes the splat from the photos it was given
PIPELINE = "echo 'progress 0.5 Training'; sleep 0.3; ls images | wc -l > splat.ply"


def start() -> str:
    os.environ.update(DATA=tempfile.mkdtemp() + "/jobs", PIPELINE=PIPELINE, TOKEN="KEY")
    spec = importlib.util.spec_from_file_location("builder_server", SERVER)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.DATA.mkdir(parents=True)
    threading.Thread(target=mod.worker, daemon=True).start()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), mod.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_port}"


def call(url: str, method: str = "GET", body: bytes | None = None, token: str = "KEY"):
    req = urllib.request.Request(url, data=body, method=method, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
            return resp.status, data
    except urllib.error.HTTPError as err:
        return err.code, err.read()


def photos(n: int, extra: dict[str, bytes] | None = None) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        files = {f"images/frame_{i:05d}.jpg": b"\xff\xd8 photo" for i in range(1, n + 1)} | (extra or {})
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


def test_a_job(builder) -> None:
    assert json.loads(call(builder + "/health")[1])["ok"]
    assert call(builder + "/jobs", "POST", photos(3), token="wrong")[0] == 401
    # only images/*.jpg are taken: nothing else lands on disk, wherever its name points
    status, data = call(builder + "/jobs", "POST", photos(25, {"../evil.jpg": b"x", "images/notes.txt": b"x"}))
    assert status == 201
    job = json.loads(data)["id"]
    seen = set()
    for _ in range(100):
        state = json.loads(call(f"{builder}/jobs/{job}")[1])
        seen.add(state["state"])
        if state["state"] in ("done", "failed"):
            break
        time.sleep(0.05)
    assert state["state"] == "done", state
    assert "running" in seen
    status, splat = call(f"{builder}/jobs/{job}/result")
    assert status == 200 and splat.strip() == b"25"
    assert call(f"{builder}/jobs/{job}", "DELETE")[0] == 200
    assert call(f"{builder}/jobs/{job}")[0] == 404


def test_bad_uploads(builder) -> None:
    assert call(builder + "/jobs", "POST", b"not a tar")[0] == 400
    assert call(builder + "/jobs", "POST", photos(0, {"x.txt": b"x"}))[0] == 400
    assert call(builder + "/jobs/../../etc")[0] == 404


if __name__ == "__main__":
    url = start()
    for test in (test_a_job, test_bad_uploads):
        test(url)
        print("PASS ", test.__name__)
    print("builder tests passed")
