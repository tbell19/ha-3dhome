/* What the editor modules share: the core's helpers (published on window.__ha3dhome) and editor constants.
 */
import type { EditorApi } from "../editor-api";

const H = window.__ha3dhome as EditorApi; // checked by ha-3dhome-editor.ts before this module loads
export const {
  stableJSON,
  inPoly,
  ACTIVE,
  CX,
  CY,
  DOOR_CLASSES,
  KINDS,
  LIBS,
  LIB_DIR,
  PLAN,
  round1,
  ROOM_FILLS,
  ROTATABLE,
  SF,
  SURFACES,
  DOOR_STYLES,
  FIXTURES,
  bArr,
  entIcon,
  esc,
  ic,
  itemCenter,
  itemBase,
  itemZ,
  scaleItem,
  jclone,
  lookOf,
  AMBIENT,
  mapPts,
  mean,
  stringCount,
  stringLen,
  polyArea,
  roomTitle,
  rotPt,
  segDir,
  shiftItem,
  zipFind,
  LAYOUT_KEYS,
  actionChoice,
  actionChoices,
  choiceAction,
} = H;

/* The editor's third-party modules, bundled like the core's (src/core/libs.ts) and loaded when first needed. They share
 * the core's Three.js file, so the gizmo works on the same Three.js the map draws with. */
export const loadTransformControls = () => import("three/examples/jsm/controls/TransformControls.js");
/** js-yaml, for card code pasted into the room controls panel */
export const loadYaml = () => import("js-yaml");

export const IDLE_AFTER: [number, string][] = [
  [0, "Never"],
  [30, "After 30 seconds"],
  [60, "After 1 minute"],
  [120, "After 2 minutes"],
  [300, "After 5 minutes"],
  [600, "After 10 minutes"],
  [900, "After 15 minutes"],
  [1800, "After 30 minutes"],
  [3600, "After 1 hour"],
];
/** hours → "HH:MM" */
export const hm = (hours: number) => {
  const m = Math.round(hours * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};
