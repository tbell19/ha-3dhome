/* What the core shares with the editor module. The editor is bundled on its own, so rather than carrying its own copy of
 * these helpers it reads them from window.__ha3dhome, which the core sets before it defines the card.
 */
import { VERSION3D, TC_URL, CX, CY, AMBIENT, lookOf, SF, LIBS, LIB_DIR, LAYOUT_KEYS } from "./core/constants";
import { R1, jclone, ic, esc, rotPt, inPoly, polyArea, roomTitle, mean, stableJSON } from "./core/util";
import { entIcon, ACTIVE, DOOR_CLASSES } from "./core/entities";
import {
  bArr,
  KINDS,
  ROTATABLE,
  PLAN,
  ROOM_FILLS,
  itemCenter,
  shiftItem,
  itemZ,
  SIZED,
  itemBase,
  scaleItem,
  mapPts,
} from "./core/items";
import { FIXTURES, stringLen, stringCount, DOOR_STYLES } from "./core/fixtures";
import { SURFACES } from "./core/surfaces";
import { solarPosition, sunVector } from "./core/sun";
import { segDir } from "./core/plan-geometry";
import { zipFind } from "./core/sh3d";
import { provideEditor } from "./card/editor-loader";

export const editorApi = {
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
  lookOf,
  AMBIENT,
  mapPts,
  mean,
  stringCount,
  stringLen,
  solarPosition,
  stableJSON,
  sunVector,
  polyArea,
  roomTitle,
  rotPt,
  segDir,
  shiftItem,
  zipFind,
  LAYOUT_KEYS,
  /** the editor module registers itself with this */
  provideEditor,
};

export type EditorApi = typeof editorApi;
