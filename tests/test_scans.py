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
    assert (await ws.receive_json())["event"] == {"job": None, "helpers": []}

    assert (await client.post(f"/api/ha_3dhome/scan/{entry.entry_id}/s1/1", data=b"GIF89a")).status == 400
    assert (await client.post(f"/api/ha_3dhome/scan/{entry.entry_id}/../1", data=JPEG)).status in (400, 404)
    resp = await client.post(f"/api/ha_3dhome/scan/{entry.entry_id}/s1/1", data=JPEG)
    assert resp.status == 200
    event = (await ws.receive_json())["event"]["job"]
    assert event["state"] == "uploading" and event["photos"] == 1

    await ws.send_json({"id": 2, "type": "ha_3dhome/scan/build", "entry_id": entry.entry_id, "scan_id": "s1"})
    reply = await ws.receive_json()
    assert not reply["success"]
    assert "at least 20" in reply["error"]["message"]


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


async def _photos(client, entry_id: str, scan_id: str, n: int = 20) -> None:
    for i in range(1, n + 1):
        assert (await client.post(f"/api/ha_3dhome/scan/{entry_id}/{scan_id}/{i}", data=JPEG)).status == 200


async def _key(hass_ws_client, hass, entry_id: str, new: bool = False) -> str:
    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "ha_3dhome/helper/key", "entry_id": entry_id, "new": new})
    reply = await ws.receive_json()
    assert reply["success"], reply
    return reply["result"]["key"]


def _helper(key: str, name: str = "gpu-box", gpu: str = "NVIDIA GeForce RTX 4090") -> dict[str, str]:
    return {"Authorization": f"Bearer {key}", "X-Helper-Name": name, "X-Helper-GPU": gpu}


async def test_a_helper_builds_a_scan(hass: HomeAssistant, hass_client, hass_client_no_auth, hass_ws_client, tmp_path) -> None:
    """With no builder address, a build waits for a helper; the helper claims it, gets the photos, reports progress
    and sends the splat, which goes on the page."""
    import io
    import tarfile

    hass.config.config_dir = str(tmp_path)
    entry = await _setup(hass)
    eid = entry.entry_id
    store = hass.data[DOMAIN][eid]
    await store.async_save({"splat": {"src": "old.ply", "pins": [{"entity": "light.lamp", "p": [1, 2, 3]}]}}, None)
    admin = await hass_client()
    await _photos(admin, eid, "s6")
    key = await _key(hass_ws_client, hass, eid)
    assert key == await _key(hass_ws_client, hass, eid)  # the same key until a new one is asked for
    helper = await hass_client_no_auth()
    base = f"/api/ha_3dhome/helper/{eid}"

    # a wrong key gets nothing
    assert (await helper.get(f"{base}/job", headers=_helper("nope"))).status == 401
    # nothing to build yet; the helper now shows as connected
    resp = await helper.get(f"{base}/job", headers=_helper(key))
    assert resp.status == 204
    assert store.scans.snapshot()["helpers"] == [{"name": "gpu-box", "gpu": "NVIDIA GeForce RTX 4090", "busy": False}]

    ws = await hass_ws_client(hass)
    await ws.send_json({"id": 1, "type": "ha_3dhome/scan/build", "entry_id": eid, "scan_id": "s6"})
    reply = await ws.receive_json()
    assert reply["success"], reply
    assert reply["result"]["state"] == "queued"
    assert "gpu-box" in reply["result"]["message"]

    resp = await helper.get(f"{base}/job", headers=_helper(key))
    assert await resp.json() == {"scan_id": "s6", "photos": 20}
    assert store.scans.job["state"] == "building" and store.scans.job["helper"] == "gpu-box"
    # another helper doesn't get the same job
    assert (await helper.get(f"{base}/job", headers=_helper(key, "other"))).status == 204
    assert (await helper.get(f"{base}/photos/s6", headers=_helper(key, "other"))).status == 409

    resp = await helper.get(f"{base}/photos/s6", headers=_helper(key))
    assert resp.status == 200
    with tarfile.open(fileobj=io.BytesIO(await resp.read())) as tar:
        assert len([m for m in tar.getnames() if m.startswith("images/frame_")]) == 20

    resp = await helper.post(f"{base}/progress/s6", headers=_helper(key), json={"progress": 0.5, "message": "Training"})
    assert resp.status == 200
    job = store.scans.snapshot()["job"]
    assert job["progress"] == 0.5 and job["message"] == "gpu-box: Training"
    assert store.scans.snapshot()["helpers"][0]["busy"]

    assert (await helper.post(f"{base}/result/s6", headers=_helper(key), data=b"not a splat")).status == 400
    resp = await helper.post(f"{base}/result/s6", headers=_helper(key), data=PLY)
    assert resp.status == 200, await resp.text()
    assert store.scans.job["state"] == "done"
    assert store.config["splat"] == {"src": "scan-s6.ply", "pins": [{"entity": "light.lamp", "p": [1, 2, 3]}]}
    assert (splat_dir(hass, eid) / "scan-s6.ply").read_bytes() == PLY
    assert not (tmp_path / "ha_3dhome" / eid / "scans" / "s6").exists()

    # a late progress report for a finished scan is told to stop
    assert (await helper.post(f"{base}/progress/s6", headers=_helper(key), json={"progress": 1})).status == 409


async def test_a_helper_fails_stops_or_goes_quiet(
    hass: HomeAssistant, hass_client, hass_client_no_auth, hass_ws_client, tmp_path
) -> None:
    from custom_components.ha_3dhome import scans

    hass.config.config_dir = str(tmp_path)
    entry = await _setup(hass)
    eid = entry.entry_id
    jobs = hass.data[DOMAIN][eid].scans
    admin = await hass_client()
    await _photos(admin, eid, "s7")
    key = await _key(hass_ws_client, hass, eid)
    helper = await hass_client_no_auth()
    base = f"/api/ha_3dhome/helper/{eid}"
    await jobs.async_build("s7")

    # it fails: the page says why
    assert (await helper.get(f"{base}/job", headers=_helper(key))).status == 200
    await helper.post(f"{base}/failed/s7", headers=_helper(key), json={"message": "Only 3 of 20 photos could be placed."})
    assert jobs.job["state"] == "failed"
    assert jobs.job["message"] == "gpu-box couldn't build it: Only 3 of 20 photos could be placed."

    # it goes quiet: the job goes back to the queue, for any helper
    await jobs.async_build("s7")
    assert (await helper.get(f"{base}/job", headers=_helper(key))).status == 200
    with patch.object(scans, "HELPER_TIMEOUT", -1):
        jobs._tick()
    assert jobs.job["state"] == "queued" and jobs.job["helper"] is None
    assert (await helper.get(f"{base}/job", headers=_helper(key, "other"))).status == 200

    # it's stopped from the page: its next report is told to stop
    await jobs.async_cancel()
    assert (await helper.post(f"{base}/progress/s7", headers=_helper(key, "other"), json={"progress": 0.2})).status == 409

    # a new key disconnects the old one
    await _key(hass_ws_client, hass, eid, new=True)
    assert (await helper.get(f"{base}/job", headers=_helper(key))).status == 401


async def test_the_helper_is_served(hass: HomeAssistant, hass_client_no_auth, tmp_path) -> None:
    import io
    import tarfile

    hass.config.config_dir = str(tmp_path)
    await _setup(hass)
    client = await hass_client_no_auth()
    script = await client.get("/api/ha_3dhome/helper/files/ha3dhome_helper.py")
    assert script.status == 200
    assert "3D Home helper" in await script.text()
    context = await client.get("/api/ha_3dhome/helper/files/helper.tar.gz")
    with tarfile.open(fileobj=io.BytesIO(await context.read())) as tar:
        assert sorted(tar.getnames()) == ["Dockerfile", "ha3dhome_helper.py"]
    assert (await client.get("/api/ha_3dhome/helper/files/__init__.py")).status == 404
