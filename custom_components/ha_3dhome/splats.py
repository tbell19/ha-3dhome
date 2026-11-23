"""3D scan files: uploading and serving a panel's Gaussian splats, and receiving the photos of a scan in progress.

    GET  /api/ha_3dhome/splat/<entry_id>/<name>          a stored splat (signed in, or a path signed with auth/sign_path)
    POST /api/ha_3dhome/splat/<entry_id>?name=<file>     upload one (admins); answers {"src": <stored name>}
    POST /api/ha_3dhome/scan/<entry_id>/<scan_id>/<n>    photo n of a scan (admins), a JPEG

Files live under <config>/ha_3dhome/<entry_id>/: splats in splats/, the photos of a scan in scans/<scan_id>/images/.
Splats can be hundreds of megabytes, so bodies are streamed to disk, never read whole.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

from aiohttp import web

from homeassistant.components.http import KEY_HASS, KEY_HASS_USER, HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import DATA_DIR, DOMAIN, MAX_PHOTO_BYTES, MAX_SPLAT_BYTES, SPLAT_EXTENSIONS

SAFE = re.compile(r"[^A-Za-z0-9._-]+")
SCAN_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def entry_dir(hass: HomeAssistant, entry_id: str) -> Path:
    return Path(hass.config.path(DATA_DIR, entry_id))


def splat_dir(hass: HomeAssistant, entry_id: str) -> Path:
    return entry_dir(hass, entry_id) / "splats"


def scan_dir(hass: HomeAssistant, entry_id: str, scan_id: str) -> Path:
    return entry_dir(hass, entry_id) / "scans" / scan_id


def safe_splat_name(name: str) -> str | None:
    """A file name that is safe to store: no folders, only plain characters, and a splat extension. None otherwise."""
    base = SAFE.sub("-", Path(name.replace("\\", "/")).name).strip(".-")[:100]
    if not base or not base.lower().endswith(SPLAT_EXTENSIONS):
        return None
    return base


def looks_like_splat(name: str, head: bytes, size: int) -> bool:
    """A quick look at the start of the file, so a wrong file is refused with a clear message."""
    ext = Path(name).suffix.lower()
    if ext == ".ply":
        return head.startswith(b"ply")
    if ext == ".spz":
        return head[:2] == b"\x1f\x8b"  # gzipped
    if ext == ".splat":
        return size > 0 and size % 32 == 0
    return size > 0


def remove_entry_files(hass: HomeAssistant, entry_id: str) -> None:
    """Delete a panel's files (in the executor)."""
    shutil.rmtree(entry_dir(hass, entry_id), ignore_errors=True)


def _error(status: int, message: str) -> web.Response:
    return web.json_response({"message": message}, status=status)


def _known(request: web.Request, entry_id: str) -> bool:
    return entry_id in request.app[KEY_HASS].data.get(DOMAIN, {})


async def _receive(hass: HomeAssistant, request: web.Request, target: Path, limit: int) -> tuple[int, bytes]:
    """Stream the request body to `target` (through a temporary file). Returns its size and first bytes."""
    tmp = target.with_name(target.name + ".part")
    await hass.async_add_executor_job(lambda: target.parent.mkdir(parents=True, exist_ok=True))
    f = await hass.async_add_executor_job(tmp.open, "wb")
    size = 0
    head = b""
    try:
        async for chunk in request.content.iter_chunked(1 << 20):
            size += len(chunk)
            if size > limit:
                raise ValueError("too big")
            if len(head) < 16:
                head += chunk[: 16 - len(head)]
            await hass.async_add_executor_job(f.write, chunk)
    except BaseException:
        await hass.async_add_executor_job(f.close)
        await hass.async_add_executor_job(lambda: tmp.unlink(missing_ok=True))
        raise
    await hass.async_add_executor_job(f.close)
    return size, head


class SplatFileView(HomeAssistantView):
    """Serves a stored splat."""

    url = "/api/ha_3dhome/splat/{entry_id}/{name}"
    name = "api:ha_3dhome:splat"
    requires_auth = True

    async def get(self, request: web.Request, entry_id: str, name: str) -> web.StreamResponse:
        hass = request.app[KEY_HASS]
        if not _known(request, entry_id) or safe_splat_name(name) != name:
            return _error(404, "There is no such 3D scan.")
        path = splat_dir(hass, entry_id) / name
        if not await hass.async_add_executor_job(path.is_file):
            return _error(404, "There is no such 3D scan.")
        return web.FileResponse(path, headers={"Content-Type": "application/octet-stream", "Cache-Control": "no-cache"})


class SplatUploadView(HomeAssistantView):
    """Takes an uploaded splat."""

    url = "/api/ha_3dhome/splat/{entry_id}"
    name = "api:ha_3dhome:splat_upload"
    requires_auth = True

    async def post(self, request: web.Request, entry_id: str) -> web.Response:
        hass = request.app[KEY_HASS]
        if not request[KEY_HASS_USER].is_admin:
            return _error(401, "Only administrators can add a 3D scan.")
        if not _known(request, entry_id):
            return _error(404, "There is no 3D Home panel with this id.")
        name = safe_splat_name(request.query.get("name", ""))
        if not name:
            return _error(400, "That isn't a 3D scan file (.ply, .splat, .ksplat or .spz).")
        target = splat_dir(hass, entry_id) / name
        try:
            size, head = await _receive(hass, request, target, MAX_SPLAT_BYTES)
        except ValueError:
            return _error(413, "The file is too big (2 GB at most).")
        tmp = target.with_name(target.name + ".part")
        if not looks_like_splat(name, head, size):
            await hass.async_add_executor_job(lambda: tmp.unlink(missing_ok=True))
            return _error(400, "That file doesn't look like a 3D scan.")
        await hass.async_add_executor_job(tmp.replace, target)
        return web.json_response({"src": name})


class ScanPhotoView(HomeAssistantView):
    """Takes one photo of a scan in progress."""

    url = "/api/ha_3dhome/scan/{entry_id}/{scan_id}/{n}"
    name = "api:ha_3dhome:scan_photo"
    requires_auth = True

    async def post(self, request: web.Request, entry_id: str, scan_id: str, n: str) -> web.Response:
        hass = request.app[KEY_HASS]
        if not request[KEY_HASS_USER].is_admin:
            return _error(401, "Only administrators can make a 3D scan.")
        if not _known(request, entry_id):
            return _error(404, "There is no 3D Home panel with this id.")
        if not SCAN_ID.match(scan_id) or not n.isdigit() or not 0 < int(n) < 100000:
            return _error(400, "That isn't a photo of a scan.")
        target = scan_dir(hass, entry_id, scan_id) / "images" / f"frame_{int(n):05d}.jpg"
        try:
            size, head = await _receive(hass, request, target, MAX_PHOTO_BYTES)
        except ValueError:
            return _error(413, "The photo is too big.")
        tmp = target.with_name(target.name + ".part")
        if head[:2] != b"\xff\xd8":
            await hass.async_add_executor_job(lambda: tmp.unlink(missing_ok=True))
            return _error(400, "The photo must be a JPEG.")
        await hass.async_add_executor_job(tmp.replace, target)
        jobs: Any = hass.data[DOMAIN][entry_id].scans
        jobs.photo_added(scan_id)
        return web.json_response({"n": int(n), "size": size})


def register_views(hass: HomeAssistant) -> None:
    hass.http.register_view(SplatFileView())
    hass.http.register_view(SplatUploadView())
    hass.http.register_view(ScanPhotoView())
