/* The scan view's module: loaded by the panel (src/panel/panel.ts) the first time a page shows a 3D scan, or has
 * nothing yet, so the floor plan map doesn't pay for the splat renderer. */
import { SplatView } from "./view";

if (!customElements.get("ha-3dhome-splat")) customElements.define("ha-3dhome-splat", SplatView);
