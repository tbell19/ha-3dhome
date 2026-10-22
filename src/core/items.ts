/* Plan items (boxes, objects, overlays, lights, hotspots, chips, doors) as plain data: their kinds, centres,
 * heights, and how to move, rotate and resize them. Pure functions, shared with the editor.
 */
import type { BoxArray, BoxEntry, Pt3 } from "../types";
import { CX, CY } from "./constants.js";
import { R1, mean } from "./util.js";

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
export function itemCenter(k: string, it: GenericItem): number[] | null {
  if (k === "b") {
    const b = bArr(it as BoxEntry);
    return [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, b[6] || 0];
  }
  if (!ROTATABLE.has(k)) {
    if (k === "w") return [(it.a[0] + it.b[0]) / 2, (it.a[1] + it.b[1]) / 2, 0];
    if (k === "r") return [...mean(it.pts), 0];
    if (it.x != null) return [it.x, it.y, it.z ?? ({ l: 40, c: 50, d: 22 } as Record<string, number>)[k] ?? 10];
    if (it.points?.length) return [...mean(it.points), it.z ?? 17];
    return [CX, CY, 0];
  }
  switch (it.type) {
    case "shelf":
      return [(it.box[0] + it.box[1]) / 2, (it.box[2] + it.box[3]) / 2, 0];
    case "sink":
      return [(it.rect[0] + it.rect[1]) / 2, (it.rect[2] + it.rect[3]) / 2, it.z];
    case "burners":
      return [...mean(it.pts), it.z || 0];
    default:
      return [it.x ?? CX, it.y ?? CY, it.type === "model" || it.type === "screen" ? it.z || 0 : 0];
  }
}
/* translate a rotatable item (box / object / overlay) by dx, dy (and dz where it means elevation) */
export function shiftItem(k: string, it: GenericItem, dx: number, dy: number, dz = 0) {
  const P = (p: number[]) => {
    p[0] = R1(p[0] + dx);
    p[1] = R1(p[1] + dy);
  };
  const bx = (b: BoxArray | number[]) => {
    b[0] = R1(b[0] + dx);
    b[1] = R1(b[1] + dx);
    b[2] = R1(b[2] + dy);
    b[3] = R1(b[3] + dy);
  };
  if (k === "b") {
    const b = bArr(it as BoxEntry);
    bx(b);
    if (dz) b[6] = R1(Math.max(0, (b[6] || 0) + dz));
    return;
  }
  switch (it.type) {
    case "shelf":
      bx(it.box);
      break;
    case "sink":
      bx(it.rect);
      if (it.faucet) P(it.faucet);
      break;
    case "burners":
      it.pts.forEach(P);
      break;
    default:
      it.x = R1((it.x ?? CX) + dx);
      it.y = R1((it.y ?? CY) + dy);
  }
  if (dz) {
    // raise or lower: every height the item is built from moves together
    const up = (o: GenericItem, f: string, d?: number) => {
      if (o[f] != null || d != null) o[f] = R1(Math.max(0, (o[f] ?? d) + dz));
    };
    if (!FLOOR_TYPES.has(it.type)) up(it, "z", ZDEF[it.type] ?? (it.type === "model" ? 0 : undefined)); // a pendant keeps its cord to the ceiling
  }
}
export const ZDEF: Record<string, number> = { fan: 44, screen: 20 }; // default heights of objects that may leave `z` out
export const FLOOR_TYPES = new Set(["shelf", "table", "floorlamp"]); // always stand on the floor (a lamp's `z` is its height)
/* the height an item's inspector shows as its elevation; null for things that always stand on the floor */
export function itemZ(k: string, it: GenericItem): number | null {
  if (k === "b" || !ROTATABLE.has(k)) return itemCenter(k, it)?.[2] ?? 0;
  if (FLOOR_TYPES.has(it.type)) return null;
  return it.z ?? ZDEF[it.type] ?? 0;
}
/* Objects with a fixed shape (no size fields of their own) take a `size` multiplier: a number, or [x, y, z] along the
 * object's own axes. It is applied about the point they stand on or hang from, so a fan stays on the ceiling. */
export const SIZED = new Set(["plant", "floorlamp", "tablelamp", "pendant", "fan", "burners", "sink"]);
export const sizeOf = (it: GenericItem): Pt3 =>
  Array.isArray(it.size) ? (it.size as Pt3) : [it.size ?? 1, it.size ?? 1, it.size ?? 1];
export const sizeAnchor = (o: GenericItem): number =>
  (({ pendant: o.top ?? 62, fan: o.ceiling ?? (o.z ?? 44) + 8, floorlamp: 0 }) as Record<string, number>)[o.type] ??
  (o.z || 0);
/* the height that stays put when an item is resized on its own */
export function itemBase(k: string, it: GenericItem): number {
  if (k === "b") return bArr(it as BoxEntry)[6] || 0;
  if (!ROTATABLE.has(k)) return itemCenter(k, it)?.[2] ?? 0;
  if (SIZED.has(it.type)) return sizeAnchor(it);
  return FLOOR_TYPES.has(it.type) ? 0 : (itemZ(k, it) ?? 0);
}
/* Resize an item by sx, sy (its own plan axes, before rotation) and sz (heights, about z0; default: its own base).
 * Rotatable items scale about their own centre. Point items (light / hotspot / chip / door) store world points, so the
 * caller maps those (mapPts); here they only change height and size. */
export function scaleItem(k: string, it: GenericItem, sx: number, sy: number, sz: number, z0?: number) {
  z0 ??= itemBase(k, it);
  const c = itemCenter(k, it) || [CX, CY, 0],
    u = sx !== 1 ? sx : sy;
  const base = z0;
  const X = (x: number) => R1(c[0] + (x - c[0]) * sx),
    Y = (y: number) => R1(c[1] + (y - c[1]) * sy),
    Z = (z: number) => R1(Math.max(0, base + (z - base) * sz));
  const mul = (v: number, f: number, min = 0.3) => R1(Math.max(min, v * f)),
    R2 = (v: number) => Math.round(v * 100) / 100;
  const setSize = (s: number[]) => {
    s = s.map(R2);
    if (s.every((v) => v === 1)) delete it.size;
    else it.size = s.every((v) => v === s[0]) ? s[0] : s;
  };
  if (!ROTATABLE.has(k)) {
    const z = itemCenter(k, it)![2],
      nz = Z(z);
    if (nz !== R1(z)) it.z = nz;
    if (it.gz != null) it.gz = Z(it.gz);
    if (k === "h") it.hit = mul(it.hit ?? 12, sx, 1);
    else if (k !== "l" || it.fixture) setSize([sizeOf(it)[0] * sx]);
    return;
  }
  if (k === "b") {
    const b = bArr(it as BoxEntry);
    b[0] = X(b[0]);
    b[1] = X(b[1]);
    b[2] = Y(b[2]);
    b[3] = Y(b[3]);
    b[4] = mul(b[4], sz);
    if (b[6] || z0) b[6] = Z(b[6] || 0);
    return;
  }
  if (SIZED.has(it.type)) {
    const s = sizeOf(it),
      da = Z(sizeAnchor(it)) - sizeAnchor(it);
    setSize([s[0] * sx, s[1] * sy, s[2] * sz]);
    if (da) shiftItem(k, it, 0, 0, da);
    return;
  }
  switch (it.type) {
    case "model":
      it.w = mul(it.w, sx, 0.5);
      it.d = mul(it.d, sy, 0.5);
      it.h = mul(it.h, sz, 0.5);
      if (it.z || z0) it.z = Z(it.z || 0);
      break;
    case "screen": {
      const f = sx !== 1 ? sx : sz;
      it.w = mul(it.w || 32, f, 2);
      it.z = Z(it.z ?? 20);
      break;
    }
    case "shelf": {
      const b = it.box;
      b[0] = X(b[0]);
      b[1] = X(b[1]);
      b[2] = Y(b[2]);
      b[3] = Y(b[3]);
      b[4] = mul(b[4], sz);
      if (it.shelves) it.shelves = it.shelves.map((z: number) => R1(z * sz));
      break;
    }
    case "table":
      it.r = mul(it.r, u, 1);
      it.z = Z(it.z);
      break;
  }
}
/* map every plan point of an entity-like item (light / hotspot / chip / door) */
export function mapPts(it: GenericItem, f: (x: number, y: number) => number[], dz = 0) {
  const m = (xk: string, yk: string) => {
    if (it[xk] != null && it[yk] != null) {
      const [a, b] = f(it[xk], it[yk]);
      it[xk] = R1(a);
      it[yk] = R1(b);
    }
  };
  m("x", "y");
  m("gx", "gy");
  m("hx", "hy");
  if (it.points) it.points = it.points.map((p: number[]) => f(p[0], p[1]).map(R1));
  if (dz && it.x != null) it.z = R1(Math.max(0, (it.z ?? 40) + dz));
  if (it.a && it.b) {
    it.a = f(it.a[0], it.a[1]).map(R1);
    it.b = f(it.b[0], it.b[1]).map(R1);
  } // wall segment ends
  if (it.pts) it.pts = it.pts.map((p: number[]) => f(p[0], p[1]).map(R1)); // room outline
}
