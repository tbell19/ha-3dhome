"""Turning the photos taken in the panel into a 3D scan (a Gaussian splat).

Training a splat needs hours of heavy computing, which Home Assistant itself must not do, so a *scan builder* does it:
the "3D Home Scan Builder" add-on (builder/ in this repository: COLMAP finds where each photo was taken, OpenSplat
trains the splat), or the same container on a faster computer. Its address is set in the integration's options.

One job per panel. Its state is kept in .storage, so a build survives a restart of Home Assistant:

    uploading  photos are arriving (photo_added)
    queued     sent to the builder, waiting for its turn
    building   the builder is working: progress 0–1 and what it's doing
    done       the splat was fetched into splats/ and the panel's config now shows it (pins kept, levelling reset)
    failed     message says why, in plain words
    cancelled

The builder's API (builder/server.py):
    POST   /jobs              a tar of the photos (images/frame_00001.jpg, …)  -> {"id"}
    GET    /jobs/<id>         {"state": queued|running|done|failed, "progress", "message"}
    GET    /jobs/<id>/result  the trained splat (.ply)
    DELETE /jobs/<id>
"""

from __future__ import annotations

import asyncio
import logging
import shutil
import tarfile
from pathlib import Path
from typing import TYPE_CHECKING, Any

import aiohttp

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import DOMAIN, MIN_PHOTOS, SIGNAL_SCAN_CHANGED
from .splats import scan_dir, splat_dir

if TYPE_CHECKING:
    from .store import PanelStore

_LOGGER = logging.getLogger(__name__)

POLL_SECONDS = 5
BUSY = ("queued", "building")


class ScanError(Exception):
    """A build can't start; the message says why, for the person who asked."""


class ScanJobs:
    """The scan job of one panel."""

    def __init__(self, hass: HomeAssistant, store: PanelStore, builder_url: str | None, token: str | None) -> None:
        self.hass = hass
        self.panel = store
        self.entry_id = store.entry_id
        self.builder_url = (builder_url or "").rstrip("/") or None
        self.token = token or None
        self._store: Store[dict[str, Any]] = Store(hass, 1, f"{DOMAIN}.{store.entry_id}.scan")
        self.job: dict[str, Any] | None = None
        self._task: asyncio.Task[None] | None = None

    async def async_load(self) -> None:
        self.job = (await self._store.async_load() or {}).get("job")
        if self.job and self.job.get("state") in BUSY and self.job.get("builder_id"):
            self._start(self._follow())  # carry on following a build that was running before the restart

    async def async_unload(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None

    @callback
    def snapshot(self) -> dict[str, Any]:
        job = self.job
        if job is None:
            return {"job": None}
        return {"job": {k: v for k, v in job.items() if k != "builder_id"}}

    def _set(self, **changes: Any) -> None:
        self.job = {**(self.job or {}), **changes}
        self._store.async_delay_save(lambda: {"job": self.job}, 1)
        async_dispatcher_send(self.hass, SIGNAL_SCAN_CHANGED.format(self.entry_id), self.snapshot())

    @callback
    def photo_added(self, scan_id: str) -> None:
        job = self.job
        if job and job.get("scan_id") == scan_id and job.get("state") == "uploading":
            self._set(photos=job.get("photos", 0) + 1)
        elif not job or job.get("state") not in BUSY:
            self._set(scan_id=scan_id, state="uploading", photos=1, progress=0, message=None)

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"} if self.token else {}

    def _start(self, coro: Any) -> None:
        if self._task:
            self._task.cancel()
        self._task = self.hass.async_create_background_task(coro, f"{DOMAIN} scan {self.entry_id}")

    async def async_build(self, scan_id: str) -> dict[str, Any]:
        """Send a scan's photos to the builder. Raises ScanError when it can't start."""
        if self.job and self.job.get("state") in BUSY:
            raise ScanError("A 3D scan is already being built for this page. Stop it first.")
        if not self.builder_url:
            raise ScanError(
                "Home Assistant needs a scan builder to turn photos into a 3D scan. Install the 3D Home Scan Builder "
                "add-on, then enter its address in the 3D Home integration's options."
            )
        images = scan_dir(self.hass, self.entry_id, scan_id) / "images"
        count = await self.hass.async_add_executor_job(lambda: len(list(images.glob("*.jpg"))) if images.is_dir() else 0)
        if count < MIN_PHOTOS:
            raise ScanError(f"There are only {count} photos. A 3D scan needs at least {MIN_PHOTOS}.")
        self._set(scan_id=scan_id, state="queued", photos=count, progress=0, message="Sending the photos")
        self._start(self._run(scan_id, images))
        return self.snapshot()["job"]

    async def async_cancel(self) -> None:
        job = self.job
        if self._task:
            self._task.cancel()
            self._task = None
        if job and job.get("builder_id") and self.builder_url:
            try:
                session = async_get_clientsession(self.hass)
                await session.delete(f"{self.builder_url}/jobs/{job['builder_id']}", headers=self._headers())
            except aiohttp.ClientError:
                pass
        if job and job.get("state") in (*BUSY, "uploading"):
            self._set(state="cancelled", message=None)

    async def _run(self, scan_id: str, images: Path) -> None:
        try:
            tar = await self.hass.async_add_executor_job(_tar, images)
            body = await self.hass.async_add_executor_job(tar.open, "rb")
            session = async_get_clientsession(self.hass)
            try:
                resp = await session.post(
                    f"{self.builder_url}/jobs",
                    data=body,
                    headers={**self._headers(), "Content-Type": "application/x-tar"},
                    timeout=aiohttp.ClientTimeout(total=1800),
                )
            finally:
                await self.hass.async_add_executor_job(body.close)
                await self.hass.async_add_executor_job(lambda: tar.unlink(missing_ok=True))
            async with resp:
                if resp.status >= 400:
                    raise ScanError(await _reason(resp, "The scan builder refused the photos"))
                builder_id = (await resp.json())["id"]
            self._set(builder_id=builder_id, message="Waiting for the scan builder")
        except asyncio.CancelledError:
            raise
        except ScanError as err:
            self._set(state="failed", message=str(err))
            return
        except (aiohttp.ClientError, TimeoutError, KeyError, ValueError) as err:
            _LOGGER.warning("Couldn't send the scan to %s: %s", self.builder_url, err)
            self._set(state="failed", message="The scan builder couldn't be reached. Is the add-on running?")
            return
        await self._follow()

    async def _follow(self) -> None:
        """Poll the builder until the job ends, then fetch the result."""
        job = self.job or {}
        builder_id = job.get("builder_id")
        session = async_get_clientsession(self.hass)
        failures = 0
        while True:
            try:
                async with session.get(f"{self.builder_url}/jobs/{builder_id}", headers=self._headers()) as resp:
                    if resp.status == 404:
                        self._set(state="failed", message="The scan builder lost this scan (was it restarted?).")
                        return
                    status = await resp.json()
                failures = 0
            except asyncio.CancelledError:
                raise
            except (aiohttp.ClientError, TimeoutError, ValueError):
                failures += 1
                if failures >= 60:  # five minutes without an answer
                    self._set(state="failed", message="The scan builder stopped answering.")
                    return
                await asyncio.sleep(POLL_SECONDS)
                continue
            state = status.get("state")
            if state == "failed":
                self._set(state="failed", message=status.get("message") or "The scan builder couldn't make a 3D scan.")
                return
            if state == "done":
                break
            changes = {"state": "building" if state == "running" else "queued", "progress": status.get("progress", 0)}
            if status.get("message"):
                changes["message"] = status["message"]
            if any(self.job.get(k) != v for k, v in changes.items()):
                self._set(**changes)
            await asyncio.sleep(POLL_SECONDS)
        await self._fetch(builder_id)

    async def _fetch(self, builder_id: str) -> None:
        scan_id = self.job["scan_id"]
        name = f"scan-{scan_id}.ply"
        target = splat_dir(self.hass, self.entry_id) / name
        self._set(state="building", progress=1, message="Fetching the 3D scan")
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(
                f"{self.builder_url}/jobs/{builder_id}/result",
                headers=self._headers(),
                timeout=aiohttp.ClientTimeout(total=3600),
            ) as resp:
                if resp.status >= 400:
                    raise ScanError(await _reason(resp, "The scan builder has no result"))
                await self.hass.async_add_executor_job(lambda: target.parent.mkdir(parents=True, exist_ok=True))
                tmp = target.with_name(name + ".part")
                f = await self.hass.async_add_executor_job(tmp.open, "wb")
                try:
                    async for chunk in resp.content.iter_chunked(1 << 20):
                        await self.hass.async_add_executor_job(f.write, chunk)
                finally:
                    await self.hass.async_add_executor_job(f.close)
                await self.hass.async_add_executor_job(tmp.replace, target)
        except (aiohttp.ClientError, TimeoutError, ScanError) as err:
            self._set(state="failed", message=str(err) if isinstance(err, ScanError) else "The 3D scan couldn't be fetched.")
            return
        # show it: the pins stay (move them if the new scan sits differently), the old levelling doesn't fit any more
        config = dict(self.panel.config)
        old = config.get("splat") or {}
        config["splat"] = {"src": name, "pins": old.get("pins", [])}
        await self.panel.async_save(config, None)
        await self.hass.async_add_executor_job(
            lambda: shutil.rmtree(scan_dir(self.hass, self.entry_id, scan_id), ignore_errors=True)
        )
        try:
            await session.delete(f"{self.builder_url}/jobs/{builder_id}", headers=self._headers())
        except aiohttp.ClientError:
            pass
        self._set(state="done", progress=1, message=None)


def _tar(images: Path) -> Path:
    """The photos as one tar file next to them (sent as a stream, never held in memory)."""
    path = images.parent / "photos.tar"
    with tarfile.open(path, mode="w") as tar:
        for f in sorted(images.glob("*.jpg")):
            tar.add(f, arcname=f"images/{f.name}")
    return path


async def _reason(resp: aiohttp.ClientResponse, fallback: str) -> str:
    try:
        return (await resp.json()).get("message") or f"{fallback} ({resp.status})."
    except (aiohttp.ClientError, ValueError):
        return f"{fallback} ({resp.status})."
