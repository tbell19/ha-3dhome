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

# 3D scans (Gaussian splats): the files live under <config>/ha_3dhome/<entry_id>/ (splats.py), and photos taken in the
# panel are turned into one by a scan builder (scans.py; the add-on in builder/ is one).
DATA_DIR: Final = "ha_3dhome"
SPLAT_EXTENSIONS: Final = (".ply", ".splat", ".ksplat", ".spz")
MAX_SPLAT_BYTES: Final = 2 * 1024**3
MAX_PHOTO_BYTES: Final = 25 * 1024**2
MIN_PHOTOS: Final = 20
CONF_BUILDER_URL: Final = "builder_url"
CONF_BUILDER_TOKEN: Final = "builder_token"


# Sent to everyone following a panel's scan job when it changes.
SIGNAL_SCAN_CHANGED: Final = "ha_3dhome_scan_changed_{}"
