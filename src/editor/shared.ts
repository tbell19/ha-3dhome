/* What the editor modules share: the core's helpers (published on window.__ha3dhome) and editor constants.
 */
import type { EditorApi } from "../editor-api";

const H = window.__ha3dhome as EditorApi; // checked by ha-3dhome-editor.ts before this module loads
export const {
  strategyCard,
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
  R1,
  ROOM_FILLS,
  ROTATABLE,
  SF,
  STRATEGY_TYPES,
  CARD_TYPES,
  STRUCT_TYPES,
  SURFACES,
  DOOR_STYLES,
  FIXTURES,
  TC_URL,
  bArr,
  entIcon,
  esc,
  ic,
  itemCenter,
  itemBase,
  itemZ,
  scaleItem,
  jclone,
  legacyWalls,
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
} = H;

export const YAML_URL = "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm";
export const SAVED = ["scene", "lights", "hotspots", "chips", "doors", "look", "ambient", "idle_view", "room_cards"]; // what Save writes back (a missing one is removed)
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
