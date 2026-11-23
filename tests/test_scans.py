"""3D scans: uploading and serving splats, photos of a scan, and building one with a (mocked) scan builder."""

from __future__ import annotations

from unittest.mock import patch

from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_3dhome.const import DOMAIN
from custom_components.ha_3dhome.splats import safe_splat_name, splat_dir

ENTRY_DATA = {"title": "Home", "icon": "mdi:floor-plan", "require_admin": False, "url_path": "3d-home"}
BUILDER = "http://builder.test:8099"
PLY = b"ply\nformat binary_little_endian 1.0\nelement vertex 0\nend_header\n"
JPEG = b"\xff\xd8\xff\xe0" + b"0" * 200


async def _setup(hass: HomeAssistant, options: dict | None = None) -> MockConfigEntry:
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data=ENTRY_DATA, options=options or {}, title="Home", unique_id="3d-home")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


def test_safe_names() -> None:
    assert safe_splat_name("room.ply") == "room.ply"
    assert safe_splat_name("../../secrets.yaml") is None
    assert safe_splat_name("../../evil.ply") == "evil.ply"
    assert safe_splat_name("My Lounge (2).SPLAT") == "My-Lounge-2-.SPLAT"
    assert safe_splat_name("notes.txt") is None


async def test_upload_and_serve_a_splat(hass: HomeAssistant, hass_client, hass_admin_user, tmp_path) -> None:
    hass.config.config_dir = str(tmp_path)
    entry = await _setup(hass)
    client = await hass_client()
    url = f"/api/ha_3dhome/splat/{entry.entry_id}"

    resp = await client.post(f"{url}?name=My lounge.ply", data=PLY)
    assert resp.status == 200, await resp.text()
    assert await resp.json() == {"src": "My-lounge.ply"}
    assert (splat_dir(hass, entry.entry_id) / "My-lounge.ply").read_bytes() == PLY

    got = await client.get(f"{url}/My-lounge.ply")
    assert got.status == 200
    assert await got.read() == PLY

    bad = await client.post(f"{url}?name=room.ply", data=b"not a ply")
    assert bad.status == 400
    assert "doesn't look like" in (await bad.json())["message"]
    assert not (splat_dir(hass, entry.entry_id) / "room.ply").exists()

    assert (await client.post(f"{url}?name=room.txt", data=PLY)).status == 400
    assert (await client.get(f"{url}/missing.ply")).status == 404
    assert (await client.post(f"/api/ha_3dhome/splat/nope?name=a.ply", data=PLY)).status == 404


async def test_splats_need_a_signed_in_user(hass: HomeAssistant, hass_client_no_auth, tmp_path) -> None:
    hass.config.config_dir = str(tmp_path)
    entry = await _setup(hass)
    client = await hass_client_no_auth()
    assert (await client.get(f"/api/ha_3dhome/splat/{entry.entry_id}/x.ply")).status == 401
    assert (await client.post(f"/api/ha_3dhome/splat/{entry.entry_id}?name=x.ply", data=PLY)).status == 401


async def test_only_admins_upload(hass: HomeAssistant, hass_client, hass_admin_user, tmp_path) -> None:
    hass.config.config_dir = str(tmp_path)
    entry = await _setup(hass)
    hass_admin_user.groups = []  # no longer an administrator
    client = await hass_client()
    resp = await client.post(f"/api/ha_3dhome/splat/{entry.entry_id}?name=x.ply", data=PLY)
    assert resp.status == 401
    resp = await client.post(f"/api/ha_3dhome/scan/{entry.entry_id}/s1/1", data=JPEG)
    assert resp.status == 401


async def test_photos_and_a_build_without_a_builder(hass: HomeAssistant, hass_client, hass_ws_client, tmp_path) -> None:
    hass.config.config_dir = str(tmp_path)
    entry = await _setup(hass)
    client = await hass_client()
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "ha_3dhome/scan/subscribe", "entry_id": entry.entry_id})
    assert (await ws.receive_json())["success"]
    assert (await ws.receive_json())["event"] == {"job": None}

    assert (await client.post(f"/api/ha_3dhome/scan/{entry.entry_id}/s1/1", data=b"GIF89a")).status == 400
    assert (await client.post(f"/api/ha_3dhome/scan/{entry.entry_id}/../1", data=JPEG)).status in (400, 404)
    resp = await client.post(f"/api/ha_3dhome/scan/{entry.entry_id}/s1/1", data=JPEG)
    assert resp.status == 200
    event = (await ws.receive_json())["event"]["job"]
    assert event["state"] == "uploading" and event["photos"] == 1

    await ws.send_json({"id": 2, "type": "ha_3dhome/scan/build", "entry_id": entry.entry_id, "scan_id": "s1"})
    reply = await ws.receive_json()
    assert not reply["success"]
    assert "scan builder" in reply["error"]["message"]


async def test_a_build(hass: HomeAssistant, hass_client, hass_ws_client, aioclient_mock, tmp_path) -> None:
    """Photos go to the builder as a tar, its progress is passed on, and the result becomes the panel's scan."""
    hass.config.config_dir = str(tmp_path)
    entry = await _setup(hass, {"builder_url": BUILDER + "/", "builder_token": "KEY"})
    store = hass.data[DOMAIN][entry.entry_id]
    await store.async_save({"splat": {"src": "old.ply", "pins": [{"entity": "light.lamp", "p": [1, 2, 3]}], "align": {}}}, None)
    client = await hass_client()
    for n in range(1, 21):
        assert (await client.post(f"/api/ha_3dhome/scan/{entry.entry_id}/s2/{n}", data=JPEG)).status == 200

    polls = iter([{"state": "queued"}, {"state": "running", "progress": 0.5, "message": "Training"}, {"state": "done"}])
    aioclient_mock.post(f"{BUILDER}/jobs", json={"id": "J1"})
    aioclient_mock.get(f"{BUILDER}/jobs/J1/result", content=PLY)
    aioclient_mock.delete(f"{BUILDER}/jobs/J1", json={})
    seen: list[dict] = []

    async def poll(method, url, data):
        from pytest_homeassistant_custom_component.test_util.aiohttp import AiohttpClientMockResponse

        status = next(polls)
        seen.append(status)
        return AiohttpClientMockResponse(method, url, json=status)

    aioclient_mock.get(f"{BUILDER}/jobs/J1", side_effect=poll)

    ws = await hass_ws_client(hass)
    with patch("custom_components.ha_3dhome.scans.POLL_SECONDS", 0):
        await ws.send_json({"id": 1, "type": "ha_3dhome/scan/build", "entry_id": entry.entry_id, "scan_id": "s2"})
        reply = await ws.receive_json()
        assert reply["success"], reply
        assert reply["result"]["state"] == "queued" and reply["result"]["photos"] == 20
        await hass.data[DOMAIN][entry.entry_id].scans._task  # the build runs in the background

    assert len(seen) == 3
    sent = next(c for c in aioclient_mock.mock_calls if c[0] == "POST")
    assert sent[3]["Authorization"] == "Bearer KEY"
    job = store.scans.snapshot()["job"]
    assert job["state"] == "done", job
    assert store.config["splat"] == {"src": "scan-s2.ply", "pins": [{"entity": "light.lamp", "p": [1, 2, 3]}]}
    assert (splat_dir(hass, entry.entry_id) / "scan-s2.ply").read_bytes() == PLY
    assert not (tmp_path / "ha_3dhome" / entry.entry_id / "scans" / "s2").exists()  # the photos are cleared up


async def test_a_failed_build(hass: HomeAssistant, hass_client, hass_ws_client, aioclient_mock, tmp_path) -> None:
    hass.config.config_dir = str(tmp_path)
    entry = await _setup(hass, {"builder_url": BUILDER})
    client = await hass_client()
    for n in range(1, 21):
        await client.post(f"/api/ha_3dhome/scan/{entry.entry_id}/s3/{n}", data=JPEG)
    aioclient_mock.post(f"{BUILDER}/jobs", json={"id": "J2"})
    aioclient_mock.get(f"{BUILDER}/jobs/J2", json={"state": "failed", "message": "Too few photos matched."})
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "ha_3dhome/scan/build", "entry_id": entry.entry_id, "scan_id": "s3"})
    assert (await ws.receive_json())["success"]
    with patch("custom_components.ha_3dhome.scans.POLL_SECONDS", 0):
        await hass.data[DOMAIN][entry.entry_id].scans._task
    job = hass.data[DOMAIN][entry.entry_id].scans.snapshot()["job"]
    assert job["state"] == "failed" and job["message"] == "Too few photos matched."


async def test_options_take_a_builder(hass: HomeAssistant, tmp_path) -> None:
    hass.config.config_dir = str(tmp_path)
    entry = await _setup(hass)
    flow = await hass.config_entries.options.async_init(entry.entry_id)
    bad = await hass.config_entries.options.async_configure(
        flow["flow_id"], {**{k: ENTRY_DATA[k] for k in ("title", "icon", "require_admin")}, "builder_url": "builder:8099"}
    )
    assert bad["errors"] == {"builder_url": "invalid_builder_url"}
    done = await hass.config_entries.options.async_configure(
        bad["flow_id"],
        {**{k: ENTRY_DATA[k] for k in ("title", "icon", "require_admin")}, "builder_url": "http://builder:8099/"},
    )
    assert done["data"]["builder_url"] == "http://builder:8099"
    await hass.async_block_till_done()
    assert hass.data[DOMAIN][entry.entry_id].scans.builder_url == "http://builder:8099"


class FakeSupervisor:
    """The Supervisor's API as scans.py uses it: an app store that gains the builder once its repository is added."""

    def __init__(self) -> None:
        from types import SimpleNamespace

        self.calls: list[str] = []
        self.repo_added = False
        self.installed = False
        self.started = False
        ns = SimpleNamespace
        self.store = ns(
            addons_list=self._list, add_repository=self._add_repo, install_addon=self._install
        )
        self.addons = ns(addon_info=self._info, start_addon=self._start)

    async def _list(self):
        from types import SimpleNamespace

        apps = [SimpleNamespace(slug="core_mosquitto")]
        return apps + ([SimpleNamespace(slug="0a1b2c3d_home3d_scan_builder")] if self.repo_added else [])

    async def _add_repo(self, options):
        self.calls.append(f"add_repository {options.repository}")
        self.repo_added = True

    async def _install(self, slug):
        self.calls.append(f"install {slug}")
        self.installed = True

    async def _info(self, slug):
        from types import SimpleNamespace

        from aiohasupervisor import SupervisorNotFoundError
        from aiohasupervisor.models import AddonState

        if not self.installed:
            raise SupervisorNotFoundError("not installed")
        state = AddonState.STARTED if self.started else AddonState.STOPPED
        return SimpleNamespace(state=state, hostname="0a1b2c3d-home3d-scan-builder")

    async def _start(self, slug):
        self.calls.append(f"start {slug}")
        self.started = True


async def test_home_assistant_sets_up_the_builder(
    hass: HomeAssistant, hass_client, hass_ws_client, aioclient_mock, tmp_path
) -> None:
    """On Home Assistant OS with no address set, the first build installs and starts the builder app itself."""
    hass.config.config_dir = str(tmp_path)
    entry = await _setup(hass)
    client = await hass_client()
    for n in range(1, 21):
        await client.post(f"/api/ha_3dhome/scan/{entry.entry_id}/s4/{n}", data=JPEG)
    app = "http://0a1b2c3d-home3d-scan-builder:8099"
    aioclient_mock.get(f"{app}/health", json={"ok": True})
    aioclient_mock.post(f"{app}/jobs", json={"id": "J3"})
    aioclient_mock.get(f"{app}/jobs/J3", json={"state": "done"})
    aioclient_mock.get(f"{app}/jobs/J3/result", content=PLY)
    aioclient_mock.delete(f"{app}/jobs/J3", json={})
    supervisor = FakeSupervisor()
    ws = await hass_ws_client(hass)
    with (
        patch("custom_components.ha_3dhome.scans.is_hassio", return_value=True),
        patch("custom_components.ha_3dhome.scans.supervisor_client", return_value=supervisor),
        patch("custom_components.ha_3dhome.scans.POLL_SECONDS", 0),
    ):
        await ws.send_json({"id": 1, "type": "ha_3dhome/scan/build", "entry_id": entry.entry_id, "scan_id": "s4"})
        assert (await ws.receive_json())["success"]
        await hass.data[DOMAIN][entry.entry_id].scans._task

        assert supervisor.calls == [
            "add_repository https://github.com/tbell19/ha-3dhome#claude/elegant-wright-ob0a1v",
            "install 0a1b2c3d_home3d_scan_builder",
            "start 0a1b2c3d_home3d_scan_builder",
        ]
        store = hass.data[DOMAIN][entry.entry_id]
        assert store.scans.snapshot()["job"]["state"] == "done"
        assert store.config["splat"]["src"] == "scan-s4.ply"

        # the next build finds it installed and running
        supervisor.calls.clear()
        assert await store.scans._auto_builder() == app
        assert supervisor.calls == []


async def test_a_build_without_the_supervisor_needs_an_address(hass: HomeAssistant, hass_client, tmp_path) -> None:
    hass.config.config_dir = str(tmp_path)
    entry = await _setup(hass)
    with patch("custom_components.ha_3dhome.scans.is_hassio", return_value=False):
        from custom_components.ha_3dhome.scans import ScanError

        try:
            await hass.data[DOMAIN][entry.entry_id].scans.async_build("s5")
        except ScanError as err:
            assert "address" in str(err)
        else:
            raise AssertionError("expected a ScanError")
