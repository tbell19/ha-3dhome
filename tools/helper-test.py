"""The 3D Home helper program (custom_components/ha_3dhome/helper/ha3dhome_helper.py) against a stand-in for Home
Assistant's helper endpoints (worker.py), with a stand-in for COLMAP + OpenSplat.

    python3 tools/helper-test.py      (npm run test:helper; plain Python)

Checks: a wrong key stops the helper with a clear message; missing tools are named with how to install them; a scan is
claimed, its photos downloaded and unpacked (only images/*.jpg), progress reported, and the splat uploaded; a failing
build reports why; a scan stopped from the page stops the helper's work.
"""

from __future__ import annotations

import importlib.util
import io
import json
import sys
import tarfile
import tempfile
import threading
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HELPER = Path(__file__).parent.parent / "custom_components" / "ha_3dhome" / "helper" / "ha3dhome_helper.py"
KEY = "KEY"
spec = importlib.util.spec_from_file_location("ha3dhome_helper", HELPER)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
helper.WAIT = 0.05
helper.REPORT = 0


def photos_tar(n: int) -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        files = {f"images/frame_{i:05d}.jpg": b"\xff\xd8 photo" for i in range(1, n + 1)}
        files["../escape.jpg"] = b"x"  # never unpacked
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()


class FakeHA:
    """One page with one queued scan."""

    def __init__(self) -> None:
        self.queued = True
        self.state = "queued"
        self.progress: list[tuple[float, str]] = []
        self.result: bytes | None = None
        self.failed: str | None = None
        self.stop_after = None  # answer 409 after this many progress reports
        self.names: set[str] = set()


def serve(ha: FakeHA) -> str:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def _ok(self, status: int, body: bytes = b"{}", kind: str = "application/json") -> None:
            self.send_response(status)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _auth(self) -> bool:
            if self.headers.get("Authorization") != f"Bearer {KEY}":
                self._ok(401, b'{"message": "bad key"}')
                return False
            ha.names.add(self.headers.get("X-Helper-Name", ""))
            return True

        def do_GET(self):  # noqa: N802
            if not self._auth():
                return
            if self.path.endswith("/job"):
                if ha.queued:
                    ha.queued = False
                    ha.state = "building"
                    return self._ok(200, json.dumps({"scan_id": "s1", "photos": 25}).encode())
                return self._ok(204, b"")
            if self.path.endswith("/photos/s1"):
                return self._ok(200, photos_tar(25), "application/x-tar")
            self._ok(404)

        def do_POST(self):  # noqa: N802
            if not self._auth():
                return
            body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
            if "/progress/" in self.path:
                if ha.state != "building" or (ha.stop_after is not None and len(ha.progress) >= ha.stop_after):
                    return self._ok(409)
                b = json.loads(body)
                ha.progress.append((b["progress"], b["message"]))
                return self._ok(200)
            if "/result/" in self.path:
                ha.result = body
                ha.state = "done"
                return self._ok(200)
            if "/failed/" in self.path:
                ha.failed = json.loads(body)["message"]
                ha.state = "failed"
                return self._ok(200)
            self._ok(404)

    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{httpd.server_port}"


def run(url: str, *extra: str, key: str = KEY) -> tuple[int, str]:
    out = io.StringIO()
    with redirect_stdout(out):
        code = helper.main(["--url", url, "--page", "E1", "--key", key, "--name", "gpu-box", *extra])
    return code, out.getvalue()


results: list[tuple[str, bool]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail and not ok else ''}")


# a stand-in pipeline: reports progress the way OpenSplat does, then writes a splat named after the photos it got
GOOD = "echo 'progress 0.5 Training'; ls images | wc -l | tr -d ' ' > n; printf 'ply\\nphotos %s\\n' $(cat n) > splat.ply; echo $(printf 'x%.0s' $(seq 1 100)) >> splat.ply"
BAD = "echo 'something broke' && exit 3"

ha = FakeHA()
url = serve(ha)

code, out = run(url, "--once", "--pipeline", GOOD, key="wrong")
check("a wrong key stops it with a clear message", code == 3 and "doesn't accept this key" in out, out)

code, out = run(url, "--once", "--colmap", "no-such-colmap", "--opensplat", "no-such-opensplat")
check("missing tools are named, with how to install them", code == 2 and "no-such-colmap" in out and "apt install colmap" in out, out)

with tempfile.TemporaryDirectory() as work:
    code, out = run(url, "--once", "--pipeline", GOOD, "--work", work)
    check("it builds a waiting scan", code == 0 and ha.state == "done", out)
    check("it says who it is", ha.names == {"gpu-box"}, str(ha.names))
    check("only the photos were unpacked", ha.result is not None and b"photos 25" in ha.result, repr((ha.result or b"")[:40]))
    check("progress reached the page", any("Training" in m for _, m in ha.progress) and ha.progress[-1][0] >= 0.98, str(ha.progress))
    check("it cleans up after itself", not any(Path(work).iterdir()))

ha2 = FakeHA()
url2 = serve(ha2)
code, out = run(url2, "--once", "--pipeline", BAD)
check("a failing build tells the page why", ha2.state == "failed" and "Building failed" in (ha2.failed or ""), str(ha2.failed))

ha3 = FakeHA()
ha3.stop_after = 1
url3 = serve(ha3)
code, out = run(url3, "--once", "--pipeline", GOOD)
check("a scan stopped from the page stops the helper", "Stopped" in out and ha3.result is None, out)

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} helper checks passed.")
sys.exit(1 if failed else 0)
