/* ha-3dhome-card (3D Home) — live 3D floor plan for Home Assistant (Three.js), with an in-card editor.
 * Config: `scene` (floors, walls, boxes, objects, overlays in plan units: x, y on the plan, z = height)
 * plus `lights`, `hotspots`, `chips`, `doors`, `weather`.
 * Edit mode (admins): move / rotate / duplicate / delete / group furniture and entities, add Sweet Home 3D
 * models (libraries downloaded into /config/www/sh3d via the Downloader integration), then Save writes the
 * card config back into the dashboard.
 */
import {
  VERSION3D,
  STRATEGY_NAME,
  OLD_NAMES,
  TC_URL,
  CX,
  CY,
  AMBIENT,
  lookOf,
  SF,
  LIBS,
  LIB_DIR,
} from "./core/constants.js";
import { R1, jclone, ic, esc, rotPt, inPoly, polyArea, roomTitle, mean, stableJSON } from "./core/util.js";
import { entIcon, ACTIVE, DOOR_CLASSES } from "./core/entities.js";
import {
  bArr,
  KINDS,
  ROTATABLE,
  PLAN,
  ROOM_FILLS,
  STRUCT_TYPES,
  itemCenter,
  shiftItem,
  itemZ,
  SIZED,
  itemBase,
  scaleItem,
  mapPts,
} from "./core/items.js";
import { FIXTURES, stringLen, stringCount, DOOR_STYLES } from "./core/fixtures.js";
import { SURFACES } from "./core/surfaces.js";
import { solarPosition, sunVector } from "./core/sun.js";
import { segDir, legacyWalls } from "./core/plan-geometry.js";
import { zipFind } from "./core/sh3d.js";
import { Home3DStrategy } from "./core/strategy.js";
import { Home3DCard } from "./card/card.js";

if (!customElements.get("ha-3dhome-card")) {
  /* helpers shared with the editor module (src/ha-3dhome-editor.js). Published before define() so the editor, which
   * awaits whenDefined(), always finds them — and only by the core that actually owns the element. */
  window.__ha3dhome = {
    VERSION3D,
    ACTIVE,
    ic,
    inPoly,
    CX,
    CY,
    DOOR_CLASSES,
    KINDS,
    LIBS,
    LIB_DIR,
    PLAN,
    R1,
    ROOM_FILLS,
    ROTATABLE,
    SF,
    STRATEGY_TYPES: ["custom:" + STRATEGY_NAME, "custom:" + OLD_NAMES.strategy],
    CARD_TYPES: ["custom:ha-3dhome-card", "custom:" + OLD_NAMES.card],
    STRUCT_TYPES,
    SURFACES,
    DOOR_STYLES,
    FIXTURES,
    TC_URL,
    bArr,
    entIcon,
    esc,
    itemCenter,
    itemBase,
    itemZ,
    scaleItem,
    SIZED,
    jclone,
    legacyWalls,
    lookOf,
    AMBIENT,
    mapPts,
    mean,
    stringCount,
    stringLen,
    solarPosition,
    stableJSON,
    strategyCard: (c) => Home3DStrategy.cardConfig(c),
    sunVector,
    polyArea,
    roomTitle,
    rotPt,
    segDir,
    shiftItem,
    zipFind,
  };
  customElements.define("ha-3dhome-card", Home3DCard);
  /* HACS registers only this file as a resource, so load the editor from next to it. The query string is kept, so an
   * editor that is also registered as its own resource (same folder, same ?v=) resolves to the same module. Skipped when
   * the core isn't a .js file (inlined into a test page). */
  const here = new URL(import.meta.url);
  if (here.pathname.endsWith(".js")) import(new URL("ha-3dhome-editor.js", here).href + here.search).catch(() => {});
}
for (const tag of ["ll-strategy-dashboard-" + STRATEGY_NAME, "ll-strategy-" + STRATEGY_NAME])
  if (!customElements.get(tag)) customElements.define(tag, class extends Home3DStrategy {});
/* The old names (iso-home-3d-card, custom:iso-home) are aliases for dashboards made before v5. If the old ha-iso-home card
 * is still installed as well, they stay with it: whichever module loaded first would otherwise claim them, and old
 * dashboards would randomly run this code. Home Assistant loads resources once it is connected, so ask it for the list. */
async function claimOldNames() {
  const ha = document.querySelector("home-assistant");
  for (let i = 0; ha && !ha.hass?.connection && i < 50; i++) await new Promise((r) => setTimeout(r, 100));
  try {
    const res = ha?.hass?.connection ? await ha.hass.callWS({ type: "lovelace/resources" }) : [];
    if (res?.some((r) => /iso-home-3d-card(\.min)?\.js/.test(r.url || ""))) {
      console.info(
        "3D Home: the old iso-home card is also installed, so it keeps the iso-home-3d-card and custom:iso-home names. Remove its resource to hand them to 3D Home.",
      );
      return;
    }
  } catch (e) {
    /* resources unknown (YAML mode, no permission): claim the names */
  }
  if (!customElements.get(OLD_NAMES.card)) customElements.define(OLD_NAMES.card, class extends Home3DCard {});
  for (const tag of ["ll-strategy-dashboard-" + OLD_NAMES.strategy, "ll-strategy-" + OLD_NAMES.strategy])
    if (!customElements.get(tag)) customElements.define(tag, class extends Home3DStrategy {});
}
if (customElements.get("ha-3dhome-card") === Home3DCard) claimOldNames();
// HA 2026.5+ lists registered dashboard strategies under Settings → Dashboards → Add dashboard → Community dashboards
window.customStrategies = window.customStrategies || [];
if (!window.customStrategies.some((s) => s.type === STRATEGY_NAME && s.strategyType === "dashboard"))
  window.customStrategies.push({
    type: STRATEGY_NAME,
    strategyType: "dashboard",
    name: "3D Home",
    description: "A live 3D map of your home, with an editor built in",
    documentationURL: "https://github.com/tbell19/ha-3dhome",
  });
window.customCards = window.customCards || [];
if (!window.customCards.find((c) => c.type === "ha-3dhome-card"))
  window.customCards.push({
    type: "ha-3dhome-card",
    name: "3D Home",
    description: `Live 3D floor plan with editor (${VERSION3D})`,
  });
