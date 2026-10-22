/* Plan items (boxes, objects, overlays, lights, hotspots, chips, doors) as plain data: their kinds, centres,
 * heights, and how to move, rotate and resize them. Pure functions, shared with the editor.
 */
import type { BoxArray, BoxEntry, Pt3 } from "../types";
import { CX, CY } from "./constants.js";
import { round1, mean } from "./util.js";

/** Item kinds by key prefix: an item's key is `<kind>:<index in its list>`, e.g. "b:3" is scene.boxes[3]. */
export type ItemKind = "b" | "o" | "v" | "l" | "h" | "c" | "d" | "w" | "n" | "p" | "r";
/** These helpers work on an item of any list by its fields, so items are typed loosely here. */
export type GenericItem = Record<string, any>;

/** a box's array form, whichever form it is stored in */
export const bArr = (e: BoxEntry): BoxArray => (Array.isArray(e) ? e : e.b);
export const KINDS: Record<string, string> = {
  b: "box",
  o: "object",
  v: "fixture",
  l: "light",
  h: "hotspot",
  c: "chip",
  d: "door",
  w: "wall",
  n: "opening",
  p: "blueprint",
  r: "room",
};
export const ROTATABLE = new Set(["b", "o", "v", "n", "p"]);
export const PLAN = new Set(["w", "n", "p", "r"]); // items edited in floor-plan mode (walls, openings, blueprints, rooms)
export const ROOM_FILLS = ["#c9b99d", "#b7c2ae", "#c7b3a3", "#aebdca", "#d0c29b", "#bfb0c4"];
/** an item's centre [x, y, z] in plan units (null for markers that have no place) */
export function itemCenter(kind: string, item: GenericItem): number[] | null {
  if (kind === "b") {
    const b = bArr(item as BoxEntry);
    return [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, b[6] || 0];
  }
  if (!ROTATABLE.has(kind)) {
    if (kind === "w") return [(item.a[0] + item.b[0]) / 2, (item.a[1] + item.b[1]) / 2, 0];
    if (kind === "r") return [...mean(item.pts), 0];
    if (item.x != null)
      return [item.x, item.y, item.z ?? ({ l: 40, c: 50, d: 22 } as Record<string, number>)[kind] ?? 10];
    if (item.points?.length) return [...mean(item.points), item.z ?? 17];
    return [CX, CY, 0];
  }
  switch (item.type) {
    case "shelf":
      return [(item.box[0] + item.box[1]) / 2, (item.box[2] + item.box[3]) / 2, 0];
    case "sink":
      return [(item.rect[0] + item.rect[1]) / 2, (item.rect[2] + item.rect[3]) / 2, item.z];
    case "burners":
      return [...mean(item.pts), item.z || 0];
    default:
      return [item.x ?? CX, item.y ?? CY, item.type === "model" || item.type === "screen" ? item.z || 0 : 0];
  }
}
/* translate a rotatable item (box / object / overlay) by dx, dy (and dz where it means elevation) */
export function shiftItem(kind: string, item: GenericItem, dx: number, dy: number, dz = 0) {
  const P = (p: number[]) => {
    p[0] = round1(p[0] + dx);
    p[1] = round1(p[1] + dy);
  };
  const bx = (b: BoxArray | number[]) => {
    b[0] = round1(b[0] + dx);
    b[1] = round1(b[1] + dx);
    b[2] = round1(b[2] + dy);
    b[3] = round1(b[3] + dy);
  };
  if (kind === "b") {
    const b = bArr(item as BoxEntry);
    bx(b);
    if (dz) b[6] = round1(Math.max(0, (b[6] || 0) + dz));
    return;
  }
  switch (item.type) {
    case "shelf":
      bx(item.box);
      break;
    case "sink":
      bx(item.rect);
      if (item.faucet) P(item.faucet);
      break;
    case "burners":
      item.pts.forEach(P);
      break;
    default:
      item.x = round1((item.x ?? CX) + dx);
      item.y = round1((item.y ?? CY) + dy);
  }
  if (dz) {
    // raise or lower: every height the item is built from moves together
    const up = (o: GenericItem, f: string, d?: number) => {
      if (o[f] != null || d != null) o[f] = round1(Math.max(0, (o[f] ?? d) + dz));
    };
    if (!FLOOR_TYPES.has(item.type)) up(item, "z", ZDEF[item.type] ?? (item.type === "model" ? 0 : undefined)); // a pendant keeps its cord to the ceiling
  }
}
export const ZDEF: Record<string, number> = { fan: 44, screen: 20 }; // default heights of objects that may leave `z` out
export const FLOOR_TYPES = new Set(["shelf", "table", "floorlamp"]); // always stand on the floor (a lamp's `z` is its height)
/* the height an item's inspector shows as its elevation; null for things that always stand on the floor */
export function itemZ(kind: string, item: GenericItem): number | null {
  if (kind === "b" || !ROTATABLE.has(kind)) return itemCenter(kind, item)?.[2] ?? 0;
  if (FLOOR_TYPES.has(item.type)) return null;
  return item.z ?? ZDEF[item.type] ?? 0;
}
/* Objects with a fixed shape (no size fields of their own) take a `size` multiplier: a number, or [x, y, z] along the
 * object's own axes. It is applied about the point they stand on or hang from, so a fan stays on the ceiling. */
export const SIZED = new Set(["plant", "floorlamp", "tablelamp", "pendant", "fan", "burners", "sink"]);
export const sizeOf = (item: GenericItem): Pt3 =>
  Array.isArray(item.size) ? (item.size as Pt3) : [item.size ?? 1, item.size ?? 1, item.size ?? 1];
export const sizeAnchor = (o: GenericItem): number =>
  (({ pendant: o.top ?? 62, fan: o.ceiling ?? (o.z ?? 44) + 8, floorlamp: 0 }) as Record<string, number>)[o.type] ??
  (o.z || 0);
/* the height that stays put when an item is resized on its own */
export function itemBase(kind: string, item: GenericItem): number {
  if (kind === "b") return bArr(item as BoxEntry)[6] || 0;
  if (!ROTATABLE.has(kind)) return itemCenter(kind, item)?.[2] ?? 0;
  if (SIZED.has(item.type)) return sizeAnchor(item);
  return FLOOR_TYPES.has(item.type) ? 0 : (itemZ(kind, item) ?? 0);
}
/* Resize an item by sx, sy (its own plan axes, before rotation) and sz (heights, about z0; default: its own base).
 * Rotatable items scale about their own centre. Point items (light / hotspot / chip / door) store world points, so the
 * caller maps those (mapPts); here they only change height and size. */
export function scaleItem(kind: string, item: GenericItem, sx: number, sy: number, sz: number, z0?: number) {
  z0 ??= itemBase(kind, item);
  const c = itemCenter(kind, item) || [CX, CY, 0];
  const u = sx !== 1 ? sx : sy;
  const base = z0;
  const X = (x: number) => round1(c[0] + (x - c[0]) * sx);
  const Y = (y: number) => round1(c[1] + (y - c[1]) * sy);
  const Z = (z: number) => round1(Math.max(0, base + (z - base) * sz));
  const mul = (v: number, f: number, min = 0.3) => round1(Math.max(min, v * f));
  const R2 = (v: number) => Math.round(v * 100) / 100;
  const setSize = (s: number[]) => {
    s = s.map(R2);
    if (s.every((v) => v === 1)) delete item.size;
    else item.size = s.every((v) => v === s[0]) ? s[0] : s;
  };
  if (!ROTATABLE.has(kind)) {
    const z = itemCenter(kind, item)![2];
    const nz = Z(z);
    if (nz !== round1(z)) item.z = nz;
    if (item.gz != null) item.gz = Z(item.gz);
    if (kind === "h") item.hit = mul(item.hit ?? 12, sx, 1);
    else if (kind !== "l" || item.fixture) setSize([sizeOf(item)[0] * sx]);
    return;
  }
  if (kind === "b") {
    const b = bArr(item as BoxEntry);
    b[0] = X(b[0]);
    b[1] = X(b[1]);
    b[2] = Y(b[2]);
    b[3] = Y(b[3]);
    b[4] = mul(b[4], sz);
    if (b[6] || z0) b[6] = Z(b[6] || 0);
    return;
  }
  if (SIZED.has(item.type)) {
    const s = sizeOf(item);
    const da = Z(sizeAnchor(item)) - sizeAnchor(item);
    setSize([s[0] * sx, s[1] * sy, s[2] * sz]);
    if (da) shiftItem(kind, item, 0, 0, da);
    return;
  }
  switch (item.type) {
    case "model":
      item.w = mul(item.w, sx, 0.5);
      item.d = mul(item.d, sy, 0.5);
      item.h = mul(item.h, sz, 0.5);
      if (item.z || z0) item.z = Z(item.z || 0);
      break;
    case "screen": {
      const f = sx !== 1 ? sx : sz;
      item.w = mul(item.w || 32, f, 2);
      item.z = Z(item.z ?? 20);
      break;
    }
    case "shelf": {
      const b = item.box;
      b[0] = X(b[0]);
      b[1] = X(b[1]);
      b[2] = Y(b[2]);
      b[3] = Y(b[3]);
      b[4] = mul(b[4], sz);
      if (item.shelves) item.shelves = item.shelves.map((z: number) => round1(z * sz));
      break;
    }
    case "table":
      item.r = mul(item.r, u, 1);
      item.z = Z(item.z);
      break;
  }
}
/* map every plan point of an entity-like item (light / hotspot / chip / door) */
export function mapPts(item: GenericItem, f: (x: number, y: number) => number[], dz = 0) {
  const m = (xk: string, yk: string) => {
    if (item[xk] != null && item[yk] != null) {
      const [a, b] = f(item[xk], item[yk]);
      item[xk] = round1(a);
      item[yk] = round1(b);
    }
  };
  m("x", "y");
  m("gx", "gy");
  m("hx", "hy");
  if (item.points) item.points = item.points.map((p: number[]) => f(p[0], p[1]).map(round1));
  if (dz && item.x != null) item.z = round1(Math.max(0, (item.z ?? 40) + dz));
  if (item.a && item.b) {
    item.a = f(item.a[0], item.a[1]).map(round1);
    item.b = f(item.b[0], item.b[1]).map(round1);
  } // wall segment ends
  if (item.pts) item.pts = item.pts.map((p: number[]) => f(p[0], p[1]).map(round1)); // room outline
}
