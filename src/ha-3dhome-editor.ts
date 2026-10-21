/* ha-3dhome-card — editor module (v-matched to the core module).
 *
 * The card core (src/ha-3dhome.ts) renders the map and handles viewing. This module adds everything behind
 * the Edit button: furniture/entity editing, the floor-plan editor, the model library and saving. The core loads it from
 * its own folder, so viewers who never edit don't pay for it up front.
 *
 * It waits for the core to define <ha-3dhome-card>, takes the shared helpers the core publishes on
 * window.__ha3dhome, and copies the methods of its parts (src/editor/) onto the card's prototype.
 */
export {}; // a module (it has top-level await)

const EDITOR_VERSION = "5.2.0";
await customElements.whenDefined("ha-3dhome-card");
const H = window.__ha3dhome;
if (!H || H.VERSION3D !== EDITOR_VERSION)
  throw new Error(
    `3D Home editor ${EDITOR_VERSION} doesn't match the card core ${H?.VERSION3D || "(missing)"} — refresh, or update both resources`,
  );

// loaded only now, because the parts read the core's helpers as they load
const parts = await import("./editor/index");
const proto = customElements.get("ha-3dhome-card")!.prototype;
for (const part of Object.values(parts))
  for (const k of Object.getOwnPropertyNames(part.prototype))
    if (k !== "constructor") Object.defineProperty(proto, k, Object.getOwnPropertyDescriptor(part.prototype, k)!);
window.dispatchEvent(new Event("ha-3dhome-editor-ready"));
