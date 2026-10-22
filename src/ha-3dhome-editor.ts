/* 3D Home editor module (v-matched to the core module).
 *
 * The card core (src/ha-3dhome.ts) renders the map and handles viewing. This module adds everything behind the Edit
 * button: furniture/entity editing, the floor-plan editor, the model library and saving. The core loads it from its own
 * folder, so viewers who never edit don't pay for it up front.
 *
 * It waits for the core to define <ha-3dhome-map>, takes the shared helpers the core publishes on window.__ha3dhome,
 * and registers its Editor (src/editor/editor.ts) with the core, which makes one per map when Edit is pressed.
 */
export {}; // a module (it has top-level await)

const EDITOR_VERSION = "6.0.0";
await customElements.whenDefined("ha-3dhome-map");
const H = window.__ha3dhome;
if (!H || H.VERSION3D !== EDITOR_VERSION)
  throw new Error(
    `3D Home editor ${EDITOR_VERSION} doesn't match the card core ${H?.VERSION3D || "(missing)"} — refresh the page`,
  );

// loaded only now, because the editor's modules read the core's helpers as they load
const { Editor } = await import("./editor/editor");
H.provideEditor({ version: EDITOR_VERSION, create: (card) => new Editor(card) });
