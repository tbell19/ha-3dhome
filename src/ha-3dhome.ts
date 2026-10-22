/* 3D Home: a live 3D map of your home (Three.js) as a page in Home Assistant's sidebar, with an editor built in.
 *
 * The ha_3dhome integration loads this file on every page and adds one sidebar page per config entry; Home Assistant
 * then creates <ha-3dhome-panel>, which shows one <ha-3dhome-map> filling the page.
 * Config: `scene` (floors, walls, boxes, objects, overlays in plan units: x, y on the plan, z = height)
 * plus `lights`, `hotspots`, `chips`, `doors`, `weather`. The editor (ha-3dhome-editor.js) loads when Edit is first
 * pressed, and Save writes the layout into the integration's storage.
 */
import { Home3DCard } from "./card/card";
import { editorApi } from "./editor-api";
import { setEditorUrl } from "./card/editor-loader";
import { Home3DPanel } from "./panel/panel";

if (!customElements.get("ha-3dhome-map")) {
  // published before define() so the editor, which awaits whenDefined(), always finds it, and only by the core that owns the element
  window.__ha3dhome = editorApi;
  customElements.define("ha-3dhome-map", Home3DCard);
  /* The editor is loaded from next to this file when Edit is first pressed. The query string (?v=<version>) is kept.
   * Skipped when the core isn't a .js file (inlined into a test page). */
  const here = new URL(import.meta.url);
  if (here.pathname.endsWith(".js")) setEditorUrl(new URL("ha-3dhome-editor.js", here).href + here.search);
}
if (!customElements.get("ha-3dhome-panel")) customElements.define("ha-3dhome-panel", Home3DPanel);
