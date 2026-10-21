"""Websocket commands the panel uses to follow and save its card config.

    ha_3dhome/config/subscribe  {entry_id}                  {config, rev} now, then again after every save
    ha_3dhome/config/save       {entry_id, config, rev?}    admins only; rev is the revision the edit started from
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN, SIGNAL_CONFIG_SAVED
from .store import PanelStore, RevisionConflict


@callback
def async_register_commands(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_subscribe_config)
    websocket_api.async_register_command(hass, ws_save_config)


def _store(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> PanelStore | None:
    store: PanelStore | None = hass.data.get(DOMAIN, {}).get(msg["entry_id"])
    if store is None:
        connection.send_error(msg["id"], websocket_api.ERR_NOT_FOUND, "There is no 3D Home panel with this id")
    return store


@websocket_api.websocket_command({vol.Required("type"): f"{DOMAIN}/config/subscribe", vol.Required("entry_id"): str})
@callback
def ws_subscribe_config(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if (store := _store(hass, connection, msg)) is None:
        return

    @callback
    def forward(snapshot: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], snapshot))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_CONFIG_SAVED.format(store.entry_id), forward
    )
    connection.send_result(msg["id"])
    forward(store.snapshot())


@websocket_api.websocket_command(
    {
        vol.Required("type"): f"{DOMAIN}/config/save",
        vol.Required("entry_id"): str,
        vol.Required("config"): dict,
        vol.Optional("rev"): int,
    }
)
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save_config(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if (store := _store(hass, connection, msg)) is None:
        return
    try:
        rev = await store.async_save(msg["config"], msg.get("rev"))
    except RevisionConflict:
        connection.send_error(
            msg["id"], "conflict", "The map was saved from another device meanwhile. Cancel to see it, then edit again."
        )
        return
    connection.send_result(msg["id"], {"rev": rev})
