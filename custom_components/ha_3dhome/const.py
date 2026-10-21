"""Constants for 3D Home."""

from typing import Final

DOMAIN: Final = "ha_3dhome"

# The built card files (ha-3dhome.js and ha-3dhome-editor.js) are served from here.
URL_BASE: Final = "/ha_3dhome"
CORE_FILE: Final = "ha-3dhome.js"

# The custom element the panel shows, defined in ha-3dhome.js.
PANEL_ELEMENT: Final = "ha-3dhome-panel"

CONF_TITLE: Final = "title"
CONF_ICON: Final = "icon"
CONF_URL_PATH: Final = "url_path"
CONF_REQUIRE_ADMIN: Final = "require_admin"

DEFAULT_TITLE: Final = "3D Home"
DEFAULT_ICON: Final = "mdi:floor-plan"
DEFAULT_URL_PATH: Final = "3d-home"

# Sent to everyone following a panel's config when it is saved.
SIGNAL_CONFIG_SAVED: Final = "ha_3dhome_config_saved_{}"
