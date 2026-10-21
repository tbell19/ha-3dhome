"""The 3D Home integration: adding a panel, following and saving its config, removing it."""

from __future__ import annotations

from homeassistant import config_entries
from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL, DATA_PANELS
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.ha_3dhome.const import DOMAIN

ENTRY_DATA = {"title": "Home", "icon": "mdi:floor-plan", "require_admin": False, "url_path": "3d-home"}
CONFIG = {"scene": {"floors": [{"name": "lounge", "pts": [[0, 0], [10, 0], [10, 10]]}]}, "lights": []}


async def _setup(hass: HomeAssistant) -> MockConfigEntry:
    assert await async_setup_component(hass, "http", {})
    entry = MockConfigEntry(domain=DOMAIN, data=ENTRY_DATA, title="Home", unique_id="3d-home")
    entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    return entry


async def test_config_flow_adds_a_panel(hass: HomeAssistant) -> None:
    assert await async_setup_component(hass, "http", {})
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.FORM

    bad = await hass.config_entries.flow.async_configure(result["flow_id"], {**ENTRY_DATA, "url_path": "Not OK!"})
    assert bad["errors"] == {"url_path": "invalid_url_path"}

    taken = await hass.config_entries.flow.async_configure(result["flow_id"], {**ENTRY_DATA, "url_path": "config"})
    assert taken["errors"] == {"url_path": "url_path_taken"}

    done = await hass.config_entries.flow.async_configure(result["flow_id"], ENTRY_DATA)
    assert done["type"] is FlowResultType.CREATE_ENTRY
    await hass.async_block_till_done()
    panel = hass.data[DATA_PANELS]["3d-home"]
    assert panel.sidebar_title == "Home"
    assert panel.config["_panel_custom"]["name"] == "ha-3dhome-panel"
    assert panel.config["_panel_custom"]["module_url"].startswith("/ha_3dhome/ha-3dhome.js?v=")
    assert panel.config["entry_id"] == done["result"].entry_id
    # the card is loaded on every page too, so it works on dashboards without a resource
    assert panel.config["_panel_custom"]["module_url"] in hass.data[DATA_EXTRA_MODULE_URL].urls


async def test_options_rename_the_panel(hass: HomeAssistant) -> None:
    entry = await _setup(hass)
    flow = await hass.config_entries.options.async_init(entry.entry_id)
    await hass.config_entries.options.async_configure(
        flow["flow_id"], {"title": "Cabin", "icon": "mdi:home", "require_admin": True}
    )
    await hass.async_block_till_done()
    panel = hass.data[DATA_PANELS]["3d-home"]
    assert (panel.sidebar_title, panel.sidebar_icon, panel.require_admin) == ("Cabin", "mdi:home", True)
    assert entry.title == "Cabin"


async def test_follow_and_save(hass: HomeAssistant, hass_ws_client) -> None:
    entry = await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "ha_3dhome/config/subscribe", "entry_id": entry.entry_id})
    assert (await client.receive_json())["success"]
    first = await client.receive_json()
    assert first["event"] == {"config": {}, "rev": 0}

    await client.send_json_auto_id({"type": "ha_3dhome/config/save", "entry_id": entry.entry_id, "config": CONFIG, "rev": 0})
    pushed = await client.receive_json()  # everyone following gets the new config
    assert pushed["event"] == {"config": CONFIG, "rev": 1}
    saved = await client.receive_json()
    assert saved["success"] and saved["result"] == {"rev": 1}

    # a save that started before that one is refused rather than overwriting it
    await client.send_json_auto_id({"type": "ha_3dhome/config/save", "entry_id": entry.entry_id, "config": {}, "rev": 0})
    conflict = await client.receive_json()
    assert not conflict["success"] and conflict["error"]["code"] == "conflict"

    # the config survives a reload of the entry
    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert hass.data[DOMAIN][entry.entry_id].snapshot() == {"config": CONFIG, "rev": 1}


async def test_only_admins_save(hass: HomeAssistant, hass_ws_client, hass_admin_user) -> None:
    entry = await _setup(hass)
    hass_admin_user.groups = []  # no longer an administrator
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "ha_3dhome/config/save", "entry_id": entry.entry_id, "config": CONFIG})
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "unauthorized"


async def test_unknown_panel(hass: HomeAssistant, hass_ws_client) -> None:
    await _setup(hass)
    client = await hass_ws_client(hass)
    await client.send_json_auto_id({"type": "ha_3dhome/config/subscribe", "entry_id": "nope"})
    msg = await client.receive_json()
    assert not msg["success"] and msg["error"]["code"] == "not_found"


async def test_remove_deletes_panel_and_config(hass: HomeAssistant, hass_storage) -> None:
    entry = await _setup(hass)
    await hass.data[DOMAIN][entry.entry_id].async_save(CONFIG, None)
    assert f"{DOMAIN}.{entry.entry_id}" in hass_storage
    assert await hass.config_entries.async_remove(entry.entry_id)
    await hass.async_block_till_done()
    assert "3d-home" not in hass.data[DATA_PANELS]
    assert f"{DOMAIN}.{entry.entry_id}" not in hass_storage
