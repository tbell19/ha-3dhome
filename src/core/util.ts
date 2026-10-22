/* Small pure helpers: rounding, cloning, HTML escaping, polygon maths and a key-order-independent JSON.
 */
import type { Pt } from "../types";

export const round1 = (v: number) => Math.round(v * 10) / 10;
export const jclone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
export const ic = (name: string) => `<ha-icon icon="mdi:${name}"></ha-icon>`; // HA's own icon element, for buttons and labels
export const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
/** rotate (x, y) about (cx, cy) by `deg` degrees, clockwise seen from above */
export const rotPt = (x: number, y: number, cx: number, cy: number, deg: number): Pt => {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = x - cx;
  const dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
};
/** is (x, y) inside the polygon? (ray casting) */
export const inPoly = (x: number, y: number, pts: Pt[]) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
export const polyArea = (pts: Pt[]) =>
  Math.abs(
    pts.reduce((s, p, i) => {
      const q = pts[(i + 1) % pts.length];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0),
  ) / 2;
/** "living_room" → "Living Room" */
export const roomTitle = (s: unknown) =>
  String(s)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
/** the average of some points */
export const mean = (pts: number[][]): Pt => [
  pts.reduce((s, p) => s + p[0], 0) / pts.length,
  pts.reduce((s, p) => s + p[1], 0) / pts.length,
];
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
/** smoothstep: 0 below a, 1 above b, an S-curve between */
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/* JSON with sorted keys, so configs compare equal whatever order HA builds them in */
export const stableJSON = (v: unknown) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((q) => [q, x[q]]),
        )
      : x,
  );
