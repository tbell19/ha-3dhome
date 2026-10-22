"""3D Home: a live 3D map of the home as its own sidebar panel.

The integration serves the map's two JavaScript files, adds a panel for each config entry, and keeps that panel's
config (its layout and options) in .storage (see store.py), which the panel follows and saves over the websocket (see
websocket.py). Home Assistant loads the files only when the panel is opened, so other pages don't pay for them.
"""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.loader import async_get_integration

from .const import (
    CONF_ICON,
    CONF_REQUIRE_ADMIN,
    CONF_TITLE,
    CONF_URL_PATH,
    CORE_FILE,
    DEFAULT_ICON,
    DEFAULT_TITLE,
    DOMAIN,
    PANEL_ELEMENT,
    URL_BASE,
)
from .store import PanelStore
from .websocket import async_register_commands

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

FRONTEND_DIR = Path(__file__).parent / "frontend"

async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the map's files and register the websocket commands (once per start)."""
    hass.data.setdefault(DOMAIN, {})
    await hass.http.async_register_static_paths([StaticPathConfig(URL_BASE, str(FRONTEND_DIR), True)])
    async_register_commands(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Load the panel's config and add the panel to the sidebar."""
    store = PanelStore(hass, entry.entry_id)
    await store.async_load()
    hass.data[DOMAIN][entry.entry_id] = store

    options = {**entry.data, **entry.options}
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=entry.data[CONF_URL_PATH],
        webcomponent_name=PANEL_ELEMENT,
        sidebar_title=options.get(CONF_TITLE, DEFAULT_TITLE),
        sidebar_icon=options.get(CONF_ICON, DEFAULT_ICON),
        module_url=await _module_url(hass),
        require_admin=options.get(CONF_REQUIRE_ADMIN, False),
        config={"entry_id": entry.entry_id},
        # Home Assistant would pad the page by the device's safe areas (status bar, home bar): the map draws edge to edge
        # and keeps only its controls inside them
        handle_safe_area=True,
    )
    entry.async_on_unload(entry.add_update_listener(_async_options_updated))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    frontend.async_remove_panel(hass, entry.data[CONF_URL_PATH])
    hass.data[DOMAIN].pop(entry.entry_id, None)
    return True


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """The panel was deleted: delete its saved config too."""
    await PanelStore(hass, entry.entry_id).async_remove()


async def _async_options_updated(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def _module_url(hass: HomeAssistant) -> str:
    """The map's URL, with the version in it so browsers fetch the new files after an update."""
    integration = await async_get_integration(hass, DOMAIN)
    return f"{URL_BASE}/{CORE_FILE}?v={integration.version}"
