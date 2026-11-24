"""What the 3D Home helper program (helper/ha3dhome_helper.py) asks of Home Assistant while it builds scans.

The helper runs on a computer with a good graphics card and connects to Home Assistant itself, with the page's helper
key (`Authorization: Bearer <key>`, from ha_3dhome/helper/key) instead of a Home Assistant login. The key can only do
what is below, for that one page: it never controls the home. A wrong key counts as a failed login (IP bans apply).
The helper also says who it is: `X-Helper-Name` (its computer's name) and `X-Helper-GPU`.

    GET  /api/ha_3dhome/helper/<entry>/job                 the next scan to build: {scan_id, photos}, or 204
    GET  /api/ha_3dhome/helper/<entry>/photos/<scan>       its photos, a tar of images/*.jpg
    POST /api/ha_3dhome/helper/<entry>/progress/<scan>     {progress 0-1, message}; 409 when the scan isn't
                                                           this helper's any more (stopped, or given to another)
    POST /api/ha_3dhome/helper/<entry>/result/<scan>       the trained splat (.ply)
    POST /api/ha_3dhome/helper/<entry>/failed/<scan>       {message}

    GET  /api/ha_3dhome/helper/files/<name>                the helper itself, no key needed (it holds no secrets):
                                                           ha3dhome_helper.py, Dockerfile, helper.tar.gz (both, as
                                                           a Docker build context)
"""

from __future__ import annotations

import io
import json
import re
import tarfile
from pathlib import Path
from typing import Any

from aiohttp import web

from homeassistant.components.http import KEY_HASS, HomeAssistantView
from homeassistant.components.http.ban import process_wrong_login

from .const import DOMAIN, MAX_SPLAT_BYTES
from .splats import receive_file, splat_dir

HELPER_DIR = Path(__file__).parent / "helper"
HELPER_FILES = ("ha3dhome_helper.py", "Dockerfile")
SAFE_TEXT = re.compile(r"[^\w .,:()+/-]")


def _clean(value: str | None, limit: int) -> str:
    return SAFE_TEXT.sub("", value or "").strip()[:limit]


def _error(status: int, message: str) -> web.Response:
    return web.json_response({"message": message}, status=status)


class _HelperView(HomeAssistantView):
    """A helper endpoint: checks the page's helper key and notes the helper as connected."""

    requires_auth = False

    async def _jobs(self, request: web.Request, entry_id: str) -> tuple[Any, str] | web.Response:
        store = request.app[KEY_HASS].data.get(DOMAIN, {}).get(entry_id)
        auth = request.headers.get("Authorization", "")
        key = auth[7:] if auth.startswith("Bearer ") else None
        if store is None or not store.scans.helper_allowed(key):
            await process_wrong_login(request)
            return _error(401, "This helper key isn't valid for that page. Copy the command from the page again.")
        name = _clean(request.headers.get("X-Helper-Name"), 40) or "A helper"
        store.scans.helper_seen(name, _clean(request.headers.get("X-Helper-GPU"), 80) or None)
        return store.scans, name


class HelperJobView(_HelperView):
    url = "/api/ha_3dhome/helper/{entry_id}/job"
    name = "api:ha_3dhome:helper_job"

    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        found = await self._jobs(request, entry_id)
        if isinstance(found, web.Response):
            return found
        jobs, name = found
        job = jobs.helper_claim(name)
        return web.json_response(job) if job else web.Response(status=204)


class HelperPhotosView(_HelperView):
    url = "/api/ha_3dhome/helper/{entry_id}/photos/{scan_id}"
    name = "api:ha_3dhome:helper_photos"

    async def get(self, request: web.Request, entry_id: str, scan_id: str) -> web.StreamResponse:
        found = await self._jobs(request, entry_id)
        if isinstance(found, web.Response):
            return found
        jobs, name = found
        if not jobs.helper_job(name, scan_id):
            return _error(409, "That scan isn't this helper's to build.")
        tar = await jobs.async_photos_tar(scan_id)
        return web.FileResponse(tar, headers={"Content-Type": "application/x-tar"})


class HelperProgressView(_HelperView):
    url = "/api/ha_3dhome/helper/{entry_id}/progress/{scan_id}"
    name = "api:ha_3dhome:helper_progress"

    async def post(self, request: web.Request, entry_id: str, scan_id: str) -> web.Response:
        found = await self._jobs(request, entry_id)
        if isinstance(found, web.Response):
            return found
        jobs, name = found
        if not jobs.helper_job(name, scan_id):
            return _error(409, "Stop: this scan isn't being built here any more.")
        try:
            body = await request.json()
            progress = float(body.get("progress", 0))
        except (ValueError, TypeError, json.JSONDecodeError):
            return _error(400, "Send {progress, message} as JSON.")
        jobs.helper_progress(name, progress, _clean(body.get("message"), 120) or None)
        return web.json_response({"ok": True})


class HelperResultView(_HelperView):
    url = "/api/ha_3dhome/helper/{entry_id}/result/{scan_id}"
    name = "api:ha_3dhome:helper_result"

    async def post(self, request: web.Request, entry_id: str, scan_id: str) -> web.Response:
        found = await self._jobs(request, entry_id)
        if isinstance(found, web.Response):
            return found
        jobs, name = found
        if not jobs.helper_job(name, scan_id):
            return _error(409, "That scan isn't this helper's to build.")
        hass = request.app[KEY_HASS]
        target = splat_dir(hass, entry_id) / jobs.result_name(scan_id)
        try:
            _size, head = await receive_file(hass, request, target, MAX_SPLAT_BYTES)
        except ValueError:
            return _error(413, "The 3D scan is too big (2 GB at most).")
        tmp = target.with_name(target.name + ".part")
        if not head.startswith(b"ply"):
            await hass.async_add_executor_job(lambda: tmp.unlink(missing_ok=True))
            return _error(400, "The result must be a .ply splat.")
        await hass.async_add_executor_job(tmp.replace, target)
        await jobs.async_helper_done(scan_id)
        return web.json_response({"src": target.name})


class HelperFailedView(_HelperView):
    url = "/api/ha_3dhome/helper/{entry_id}/failed/{scan_id}"
    name = "api:ha_3dhome:helper_failed"

    async def post(self, request: web.Request, entry_id: str, scan_id: str) -> web.Response:
        found = await self._jobs(request, entry_id)
        if isinstance(found, web.Response):
            return found
        jobs, name = found
        if jobs.helper_job(name, scan_id):
            try:
                message = (await request.json()).get("message")
            except (ValueError, json.JSONDecodeError):
                message = None
            jobs.helper_failed(name, _clean(message, 200) or None)
        return web.json_response({"ok": True})


class HelperFilesView(HomeAssistantView):
    """The helper program itself: public code, the same as in the repository, so no key is needed."""

    url = "/api/ha_3dhome/helper/files/{name}"
    name = "api:ha_3dhome:helper_files"
    requires_auth = False

    async def get(self, request: web.Request, name: str) -> web.StreamResponse:
        hass = request.app[KEY_HASS]
        if name in HELPER_FILES:
            data = await hass.async_add_executor_job((HELPER_DIR / name).read_bytes)
            kind = "text/x-python" if name.endswith(".py") else "text/plain"
            return web.Response(
                body=data,
                content_type=kind,
                headers={"Content-Disposition": f'attachment; filename="{name}"'},
            )
        if name == "helper.tar.gz":
            return web.Response(body=await hass.async_add_executor_job(_context), content_type="application/gzip")
        return _error(404, "There is no such file.")


def _context() -> bytes:
    """The helper's folder as a Docker build context (docker build <url>)."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for name in HELPER_FILES:
            tar.add(HELPER_DIR / name, arcname=name)
    return buf.getvalue()


def register_helper_views(hass: Any) -> None:
    for view in (HelperJobView, HelperPhotosView, HelperProgressView, HelperResultView, HelperFailedView):
        hass.http.register_view(view())
    hass.http.register_view(HelperFilesView())
