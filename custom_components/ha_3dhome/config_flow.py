"""Adding a 3D Home panel (Settings → Devices & services → Add integration → 3D Home), and changing it later."""

from __future__ import annotations

import re
from typing import Any

import voluptuous as vol

from homeassistant.components.frontend import DATA_PANELS
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.selector import IconSelector

from .const import (
    CONF_ICON,
    CONF_REQUIRE_ADMIN,
    CONF_TITLE,
    CONF_URL_PATH,
    DEFAULT_ICON,
    DEFAULT_TITLE,
    DEFAULT_URL_PATH,
    DOMAIN,
)

URL_PATH = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def _panel_schema(defaults: dict[str, Any]) -> dict[vol.Marker, Any]:
    """The fields a panel can change at any time: sidebar title and icon, and who may open it."""
    return {
        vol.Required(CONF_TITLE, default=defaults.get(CONF_TITLE, DEFAULT_TITLE)): str,
        vol.Required(CONF_ICON, default=defaults.get(CONF_ICON, DEFAULT_ICON)): IconSelector(),
        vol.Required(CONF_REQUIRE_ADMIN, default=defaults.get(CONF_REQUIRE_ADMIN, False)): bool,
    }


class Home3DConfigFlow(ConfigFlow, domain=DOMAIN):
    """Each entry is one panel in the sidebar, with its own layout."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            url_path = user_input[CONF_URL_PATH].strip().lower()
            if not URL_PATH.match(url_path):
                errors[CONF_URL_PATH] = "invalid_url_path"
            elif url_path in self.hass.data.get(DATA_PANELS, {}):
                errors[CONF_URL_PATH] = "url_path_taken"
            else:
                await self.async_set_unique_id(url_path)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=user_input[CONF_TITLE], data={**user_input, CONF_URL_PATH: url_path}
                )

        defaults = user_input or {}
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    **_panel_schema(defaults),
                    vol.Required(CONF_URL_PATH, default=defaults.get(CONF_URL_PATH, DEFAULT_URL_PATH)): str,
                }
            ),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return Home3DOptionsFlow()


class Home3DOptionsFlow(OptionsFlow):
    """Change the sidebar title, icon and access of a panel (its address stays)."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            # the entry is named after the panel, so the integrations page shows the same title as the sidebar
            self.hass.config_entries.async_update_entry(self.config_entry, title=user_input[CONF_TITLE])
            return self.async_create_entry(data=user_input)
        current = {**self.config_entry.data, **self.config_entry.options}
        return self.async_show_form(step_id="init", data_schema=vol.Schema(_panel_schema(current)))
