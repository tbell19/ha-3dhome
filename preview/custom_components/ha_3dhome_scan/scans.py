"""Turning the photos taken in the panel into a 3D scan (a Gaussian splat).

Training a splat takes heavy computing for a long time: a graphics card does it in minutes, Home Assistant's own small
computer can't do it at all (and must not try: it would stall the home). So another computer builds it, in one of two
ways:

- **A helper** (the default): the 3D Home helper program (helper/ha3dhome_helper.py, served by Home Assistant) runs on a
  computer with a good graphics card. It connects *to* Home Assistant with the page's helper key, so that computer
  needs no address of its own: it asks for work (claim), downloads the photos, builds the splat with COLMAP and
  OpenSplat, reports its progress and uploads the result (worker.py has those endpoints). Several helpers may wait; the
  first to ask gets the job. A helper that stops reporting for HELPER_TIMEOUT gives the job back to the queue.
- **A scan builder at an address** (builder/server.py, set in the integration's options): Home Assistant sends it the
  photos and polls it.

One job per panel. Its state is kept in .storage, so a build survives a restart of Home Assistant:

    uploading  photos are arriving (photo_added)
    queued     waiting for a helper (or for the builder's turn)
    building   a helper or the builder is working: progress 0-1 and what it's doing
    done       the splat is in splats/ and the panel's config now shows it (pins kept, levelling reset)
    failed     message says why, in plain words
    cancelled

The builder's API (builder/server.py):
    POST   /jobs              a tar of the photos (images/frame_00001.jpg, ...)  -> {"id"}
    GET    /jobs/<id>         {"state": queued|running|done|failed, "progress", "message"}
    GET    /jobs/<id>/result  the trained splat (.ply)
    DELETE /jobs/<id>
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import shutil
import tarfile
import time
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

import aiohttp

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.event import async_track_time_interval
from homeassistant.helpers.storage import Store

from .const import DOMAIN, MIN_PHOTOS, SIGNAL_SCAN_CHANGED
from .splats import scan_dir, splat_dir

if TYPE_CHECKING:
    from .store import PanelStore

_LOGGER = logging.getLogger(__name__)

POLL_SECONDS = 5
BUSY = ("queued", "building")
HELPER_ONLINE = 90  # a helper that asked for work within this many seconds is shown as connected
HELPER_TIMEOUT = 15 * 60  # a building helper silent this long gives the job back


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
        self.helper_key: str | None = None  # what a helper program shows Home Assistant
        self.helpers: dict[str, dict[str, Any]] = {}  # by name: {name, gpu, seen (monotonic s)}
        self._online: frozenset[str] = frozenset()
        self._task: asyncio.Task[None] | None = None
        self._unsub_tick: Any = None

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.job = data.get("job")
        self.helper_key = data.get("helper_key")
        if self.job and self.job.get("state") in BUSY and self.job.get("builder_id"):
            self._start(self._follow())  # carry on following a build that was running before the restart
        if self.job and self.job.get("helper"):
            self.job["beat"] = time.monotonic()  # the helper gets a fresh HELPER_TIMEOUT after a restart
        self._unsub_tick = async_track_time_interval(self.hass, self._tick, timedelta(seconds=30))

    async def async_unload(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        if self._unsub_tick:
            self._unsub_tick()
            self._unsub_tick = None

    @callback
    def snapshot(self) -> dict[str, Any]:
        job = self.job
        helpers = [
            {"name": h["name"], "gpu": h.get("gpu"), "busy": bool(job and job.get("helper") == h["name"])}
            for h in self.helpers.values()
            if h["name"] in self._online
        ]
        if job is None:
            return {"job": None, "helpers": helpers}
        return {"job": {k: v for k, v in job.items() if k not in ("builder_id", "beat")}, "helpers": helpers}

    def _save(self) -> None:
        self._store.async_delay_save(lambda: {"job": self.job, "helper_key": self.helper_key}, 1)

    def _push(self) -> None:
        async_dispatcher_send(self.hass, SIGNAL_SCAN_CHANGED.format(self.entry_id), self.snapshot())

    def _set(self, **changes: Any) -> None:
        self.job = {**(self.job or {}), **changes}
        self._save()
        self._push()

    @callback
    def _tick(self, _now: Any = None) -> None:
        """Every 30 s: which helpers are still connected, and whether a building helper went quiet."""
        self._refresh_online()
        job = self.job
        if job and job.get("state") == "building" and job.get("helper"):
            if time.monotonic() - job.get("beat", 0) > HELPER_TIMEOUT:
                self._set(state="queued", helper=None, progress=0, message=f"{job['helper']} stopped. Waiting for a helper.")

    def _refresh_online(self) -> None:
        now = time.monotonic()
        online = frozenset(n for n, h in self.helpers.items() if now - h["seen"] < HELPER_ONLINE)
        if online != self._online:
            self._online = online
            self._push()

    # ----- helpers (worker.py serves these to the helper program) -----

    async def async_helper_key(self, new: bool = False) -> str:
        """The page's helper key, made the first time it is asked for (or anew, which disconnects every helper)."""
        if new or not self.helper_key:
            self.helper_key = secrets.token_urlsafe(24)
            self._save()
        return self.helper_key

    def helper_allowed(self, key: str | None) -> bool:
        return bool(key and self.helper_key and secrets.compare_digest(key, self.helper_key))

    @callback
    def helper_seen(self, name: str, gpu: str | None) -> None:
        self.helpers[name] = {"name": name, "gpu": gpu, "seen": time.monotonic()}
        if name not in self._online:
            self._refresh_online()
            if self.job and self.job.get("state") == "queued" and not self.builder_url:
                self._set(message=self._waiting())

    @callback
    def helper_claim(self, name: str) -> dict[str, Any] | None:
        """Give a waiting job to a helper. A helper that asks again for the job it has (after a restart) gets it."""
        job = self.job
        if self.builder_url or not job:
            return None
        mine = job.get("state") == "building" and job.get("helper") == name
        if job.get("state") != "queued" and not mine:
            return None
        self._set(state="building", helper=name, beat=time.monotonic(), progress=0, message=f"{name} is getting the photos")
        return {"scan_id": job["scan_id"], "photos": job.get("photos", 0)}

    def helper_job(self, name: str, scan_id: str) -> bool:
        """Whether this helper is building this scan (anything else it says is stale and ignored)."""
        job = self.job
        return bool(job and job.get("scan_id") == scan_id and job.get("state") == "building" and job.get("helper") == name)

    @callback
    def helper_progress(self, name: str, progress: float, message: str | None) -> None:
        old = self.job or {}
        changes: dict[str, Any] = {"beat": time.monotonic(), "progress": max(0.0, min(1.0, float(progress)))}
        if message:
            changes["message"] = f"{name}: {message}"[:200]
        self.job = {**old, **changes}
        # the beat alone isn't news: save and tell the pages only when what they show changed
        if round(old.get("progress", 0), 2) != round(changes["progress"], 2) or (
            message and old.get("message") != changes["message"]
        ):
            self._save()
            self._push()

    @callback
    def helper_failed(self, name: str, message: str | None) -> None:
        self._set(state="failed", helper=None, message=f"{name} couldn't build it: {message or 'no reason given'}"[:300])

    async def async_helper_done(self, scan_id: str) -> None:
        """The helper uploaded splats/<result_name(scan_id)>."""
        await self._show(scan_id, self.result_name(scan_id))

    async def async_photos_tar(self, scan_id: str) -> Path:
        images = scan_dir(self.hass, self.entry_id, scan_id) / "images"
        return await self.hass.async_add_executor_job(_tar, images)

    @staticmethod
    def result_name(scan_id: str) -> str:
        return f"scan-{scan_id}.ply"

    @callback
    def photo_added(self, scan_id: str) -> None:
        job = self.job
        if job and job.get("scan_id") == scan_id and job.get("state") == "uploading":
            self._set(photos=job.get("photos", 0) + 1)
        elif not job or job.get("state") not in BUSY:
            self._set(scan_id=scan_id, state="uploading", photos=1, progress=0, message=None)

    @property
    def url(self) -> str | None:
        """The scan builder's address (options), or None when helpers build"""
        return self.builder_url

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
        images = scan_dir(self.hass, self.entry_id, scan_id) / "images"
        count = await self.hass.async_add_executor_job(lambda: len(list(images.glob("*.jpg"))) if images.is_dir() else 0)
        if count < MIN_PHOTOS:
            raise ScanError(f"There are only {count} photos. A 3D scan needs at least {MIN_PHOTOS}.")
        if self.builder_url:
            self._set(scan_id=scan_id, state="queued", photos=count, progress=0, message="Sending the photos")
            self._start(self._run(scan_id, images))
        else:
            self._set(scan_id=scan_id, state="queued", photos=count, progress=0, helper=None, message=self._waiting())
        return self.snapshot()["job"]

    def _waiting(self) -> str:
        if self._online:
            return "Waiting for " + ", ".join(sorted(self._online)) + " to start"
        return "Waiting for a computer to build it. Start the 3D Home helper on a computer with a graphics card."

    async def async_cancel(self) -> None:
        job = self.job
        if self._task:
            self._task.cancel()
            self._task = None
        if job and job.get("builder_id") and self.url:
            try:
                session = async_get_clientsession(self.hass)
                await session.delete(f"{self.url}/jobs/{job['builder_id']}", headers=self._headers())
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
                    f"{self.url}/jobs",
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
            _LOGGER.warning("Couldn't send the scan to %s: %s", self.url, err)
            self._set(state="failed", message="The scan builder couldn't be reached. Is it running?")
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
                async with session.get(f"{self.url}/jobs/{builder_id}", headers=self._headers()) as resp:
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
        name = self.result_name(scan_id)
        target = splat_dir(self.hass, self.entry_id) / name
        self._set(state="building", progress=1, message="Fetching the 3D scan")
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(
                f"{self.url}/jobs/{builder_id}/result",
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
        try:
            await session.delete(f"{self.url}/jobs/{builder_id}", headers=self._headers())
        except aiohttp.ClientError:
            pass
        await self._show(scan_id, name)

    async def _show(self, scan_id: str, name: str) -> None:
        """A finished splat (splats/<name>) goes on the page: the pins stay (move them if the new scan sits
        differently), the old levelling doesn't fit any more. The photos are deleted."""
        config = dict(self.panel.config)
        old = config.get("splat") or {}
        config["splat"] = {"src": name, "pins": old.get("pins", [])}
        await self.panel.async_save(config, None)
        await self.hass.async_add_executor_job(
            lambda: shutil.rmtree(scan_dir(self.hass, self.entry_id, scan_id), ignore_errors=True)
        )
        self._set(state="done", progress=1, message=None, helper=None)


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
