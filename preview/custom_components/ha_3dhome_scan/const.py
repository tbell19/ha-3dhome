"""Constants for 3D Home."""

from typing import Final

DOMAIN: Final = "ha_3dhome_scan"

# The built card files (ha-3dhome-scan.js and ha-3dhome-scan-editor.js) are served from here.
URL_BASE: Final = "/ha_3dhome_scan"
CORE_FILE: Final = "ha-3dhome-scan.js"

# The custom element the panel shows, defined in ha-3dhome-scan.js.
PANEL_ELEMENT: Final = "ha-3dhome-scan-panel"

CONF_TITLE: Final = "title"
CONF_ICON: Final = "icon"
CONF_URL_PATH: Final = "url_path"
CONF_REQUIRE_ADMIN: Final = "require_admin"

DEFAULT_TITLE: Final = "3D Home (scan preview)"
DEFAULT_ICON: Final = "mdi:cube-scan"
DEFAULT_URL_PATH: Final = "3d-home-scan"

# Sent to everyone following a panel's config when it is saved.
SIGNAL_CONFIG_SAVED: Final = "ha_3dhome_scan_config_saved_{}"

# 3D scans (Gaussian splats): the files live under <config>/ha_3dhome_scan/<entry_id>/ (splats.py), and photos taken in the
# panel are turned into one by a scan builder (scans.py; the add-on in builder/ is one).
DATA_DIR: Final = "ha_3dhome_scan"
SPLAT_EXTENSIONS: Final = (".ply", ".splat", ".ksplat", ".spz")
MAX_SPLAT_BYTES: Final = 2 * 1024**3
MAX_PHOTO_BYTES: Final = 25 * 1024**2
MIN_PHOTOS: Final = 20
CONF_BUILDER_URL: Final = "builder_url"
CONF_BUILDER_TOKEN: Final = "builder_token"

# Where the scan builder app comes from when Home Assistant sets it up itself (Home Assistant OS and Supervised): this
# repository is also an app repository (repository.yaml). The fragment picks the branch the app is on.
BUILDER_REPOSITORY: Final = "https://github.com/tbell19/ha-3dhome#claude/elegant-wright-ob0a1v"
BUILDER_SLUG: Final = "home3d_scan_builder"  # Supervisor prefixes it with the repository's id
BUILDER_PORT: Final = 8099

# Sent to everyone following a panel's scan job when it changes.
SIGNAL_SCAN_CHANGED: Final = "ha_3dhome_scan_scan_changed_{}"
