"""Where a panel's config lives (its layout plus the card's options): one file per panel in .storage, plus a revision
number.

The revision goes up with every save. A save names the revision it started from, so two devices editing the same
home can't silently overwrite each other's work.
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.helpers.storage import Store

from .const import DOMAIN, SIGNAL_CONFIG_SAVED

STORAGE_VERSION = 1


class RevisionConflict(Exception):
    """The config was saved from somewhere else since this editor loaded it."""


class PanelStore:
    """The saved card config of one 3D Home panel (one config entry)."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry_id}")
        self.config: dict[str, Any] = {}
        self.rev = 0

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.config = data.get("config") or {}
        self.rev = data.get("rev", 0)

    async def async_save(self, config: dict[str, Any], base_rev: int | None) -> int:
        """Save the config and tell everyone following it. Returns the new revision."""
        if base_rev is not None and base_rev != self.rev:
            raise RevisionConflict
        self.config = config
        self.rev += 1
        await self._store.async_save({"config": self.config, "rev": self.rev})
        async_dispatcher_send(self.hass, SIGNAL_CONFIG_SAVED.format(self.entry_id), self.snapshot())
        return self.rev

    async def async_remove(self) -> None:
        await self._store.async_remove()

    @callback
    def snapshot(self) -> dict[str, Any]:
        return {"config": self.config, "rev": self.rev}
