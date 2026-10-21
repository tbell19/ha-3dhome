/* What the core shares with the editor module. The editor is bundled on its own, so rather than carrying its own copy of
 * these helpers it reads them from window.__ha3dhome, which the core sets before it defines the card.
 */
import type { StrategyConfig } from "./types";
import { VERSION3D, TC_URL, CX, CY, AMBIENT, lookOf, SF, LIBS, LIB_DIR, LAYOUT_KEYS } from "./core/constants";
import { R1, jclone, ic, esc, rotPt, inPoly, polyArea, roomTitle, mean, stableJSON } from "./core/util";
import { entIcon, ACTIVE, DOOR_CLASSES } from "./core/entities";
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
} from "./core/items";
import { FIXTURES, stringLen, stringCount, DOOR_STYLES } from "./core/fixtures";
import { SURFACES } from "./core/surfaces";
import { solarPosition, sunVector } from "./core/sun";
import { segDir, legacyWalls } from "./core/plan-geometry";
import { zipFind } from "./core/sh3d";
import { Home3DStrategy } from "./core/strategy";
import { provideEditor } from "./card/editor-loader";
import { STRATEGY_TYPES, CARD_TYPES, findCard } from "./core/lovelace";

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
  STRATEGY_TYPES,
  CARD_TYPES,
  findCard,
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
  strategyCard: (c: StrategyConfig) => Home3DStrategy.cardConfig(c),
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
