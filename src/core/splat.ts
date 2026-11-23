/* Pure maths for 3D scans (Gaussian splats): which format a file is, levelling a scan from three points on its floor,
 * a scan's extent and the view it opens on, and what tapping a pin does. No Three.js here, so it is tested in Node
 * (tools/splat-unit-test.js).
 *
 * Coordinates: a scan comes out whichever way up the phone or the trainer decided. `align` (SplatConfig.align) turns it
 * level, floor at height 0, Y up: levelled = rotate(q, scan) + t. Pins stay in the scan's own coordinates.
 */
import type { SplatConfig, SplatFormat, SplatPin, V3 } from "../types";
import { TOGGLE_DOMAINS } from "./entities";

export type Quat = [number, number, number, number]; // x, y, z, w

export const SPLAT_FORMATS: readonly SplatFormat[] = ["ply", "splat", "ksplat", "spz"];

/** the format from a file name or URL (query string ignored), or null when it isn't a splat file */
export const splatFormat = (name: string): SplatFormat | null => {
  const ext = name.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  return (SPLAT_FORMATS as readonly string[]).includes(ext) ? (ext as SplatFormat) : null;
};

/* ----- vectors and quaternions ----- */

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const norm = (a: V3): V3 => scale(a, 1 / (len(a) || 1));

/** the shortest rotation taking unit vector `from` to unit vector `to` */
export const quatFromUnitVectors = (from: V3, to: V3): Quat => {
  let r = dot(from, to) + 1;
  let q: Quat;
  if (r < 1e-8) {
    // opposite: turn half way round any axis at right angles to `from`
    r = 0;
    q = Math.abs(from[0]) > Math.abs(from[2]) ? [-from[1], from[0], 0, r] : [0, -from[2], from[1], r];
  } else {
    const c = cross(from, to);
    q = [c[0], c[1], c[2], r];
  }
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};

export const quatMul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

export const quatInvert = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

/** rotate v by unit quaternion q */
export const rotate = (q: Quat, v: V3): V3 => {
  const u: V3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
};

/** a quaternion turning about +Y by `rad` (counter-clockwise seen from above) */
export const quatY = (rad: number): Quat => [0, Math.sin(rad / 2), 0, Math.cos(rad / 2)];

/* ----- levelling ----- */

export type Align = NonNullable<SplatConfig["align"]>;
export const NO_ALIGN: Align = { q: [0, 0, 0, 1], t: [0, 0, 0] };

/** scan coordinates → levelled */
export const toLevel = (a: Align | undefined, p: V3): V3 => (a ? add(rotate(a.q, p), a.t) : p);
/** levelled coordinates → scan */
export const fromLevel = (a: Align | undefined, p: V3): V3 => (a ? rotate(quatInvert(a.q), sub(p, a.t)) : p);

/**
 * The alignment that makes the plane through three floor points (in scan coordinates) the level floor: their normal
 * turns to +Y, they end up at height 0, and the middle of the three sits over the origin. `up` is a direction in scan
 * coordinates that points roughly upwards (the camera's up while the points were tapped): it says which side of the
 * floor is the room. Returns null when the points are (nearly) in a line.
 */
export const levelFromFloor = (a: V3, b: V3, c: V3, up: V3): Align | null => {
  const n0 = cross(sub(b, a), sub(c, a));
  const area = len(n0);
  const span = Math.max(len(sub(b, a)), len(sub(c, a)), len(sub(c, b)));
  if (!span || area < 0.02 * span * span) return null; // in a line: no plane
  let n = norm(n0);
  if (dot(n, up) < 0) n = scale(n, -1);
  const q = quatFromUnitVectors(n, [0, 1, 0]);
  const mid = scale(add(add(a, b), c), 1 / 3);
  const m = rotate(q, mid);
  return { q, t: [-m[0], -m[1], -m[2]] };
};

/** turn a levelled scan about the vertical by `rad` (keeps the floor where it is) */
export const spinLevel = (a: Align, rad: number): Align => {
  const r = quatY(rad);
  return { q: quatMul(r, a.q), t: rotate(r, a.t) };
};

/* ----- extent and the first view ----- */

export interface Extent {
  min: V3;
  max: V3;
  center: V3;
}

/** The extent of most of a scan's points: scans have stray splats far out (sky, reflections), so the 3rd and 97th
 * percentiles on each axis, not the min and max. */
export const robustExtent = (pts: readonly V3[], lo = 0.03, hi = 0.97): Extent | null => {
  if (!pts.length) return null;
  const pick = (k: number) => {
    const v = pts.map((p) => p[k]).sort((x, y) => x - y);
    const at = (f: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(f * (v.length - 1))))];
    return [at(lo), at(hi)];
  };
  const [x, y, z] = [pick(0), pick(1), pick(2)];
  const min: V3 = [x[0], y[0], z[0]];
  const max: V3 = [x[1], y[1], z[1]];
  return { min, max, center: scale(add(min, max), 0.5) };
};

/** a view of the whole extent: from above one corner, looking at its middle (levelled scans) or from in front of it */
export const viewOf = (e: Extent, levelled: boolean): { position: V3; target: V3 } => {
  const size = sub(e.max, e.min);
  const r = Math.max(size[0], size[2], levelled ? 0 : size[1], 1);
  const target: V3 = levelled ? [e.center[0], e.min[1] + size[1] * 0.25, e.center[2]] : e.center;
  const position: V3 = levelled
    ? add(target, [r * 0.55, r * 0.75, r * 0.85])
    : add(target, [0, 0, Math.max(size[2], r) * 1.2]);
  return { position, target };
};

/* ----- pins ----- */

/** what tapping a pin does: its own choice, else toggle for things that switch, else open its details */
export const pinTap = (pin: SplatPin) =>
  pin.tap || (TOGGLE_DOMAINS.has(pin.entity.split(".")[0]) ? "toggle" : "more-info");

/** a light pin's glow radius in metres (0: none) */
export const pinGlow = (pin: SplatPin) => (pin.entity.startsWith("light.") ? (pin.glow ?? 1) : (pin.glow ?? 0));

/** round a point to the millimetre for saving */
export const mm = (p: V3): V3 => [
  Math.round(p[0] * 1000) / 1000,
  Math.round(p[1] * 1000) / 1000,
  Math.round(p[2] * 1000) / 1000,
];

/* ----- live lighting ----- */

/** how many lights the scan's shader takes at once (the brightest win) */
export const MAX_SCAN_LIGHTS = 8;

/** One light's effect on the scan: its place (scan coordinates), reach in metres, and colour × strength (0–1 each). */
export interface ScanLight {
  p: V3;
  r: number;
  c: V3;
}

export interface ScanLighting {
  /** how much of the scan's own (filmed) light is left: 1 by day, `night` after dark */
  ambient: number;
  lights: ScanLight[];
}

/** a light pin's reach by default (metres) */
export const LIGHT_REACH = 3;

/**
 * The scan's lighting from entity states. A scan keeps the light it was filmed in, so "dynamic" lighting is an
 * approximation: after dark the whole scan dims to `night`, and each light that is on adds its colour to the splats
 * around it, fading to nothing at its reach (no normals, so it doesn't stop at walls). `sun` is sun.sun's state.
 */
export const scanLighting = (
  pins: readonly SplatPin[],
  states: Record<string, { state: string; attributes: Record<string, any> }>,
  sun: { state: string; attributes: Record<string, any> } | undefined,
  rgb: (st: { state: string; attributes: Record<string, any> }) => number[],
  night = 0.25,
): ScanLighting => {
  const elev = sun?.attributes?.elevation;
  const day =
    typeof elev === "number"
      ? Math.min(1, Math.max(0, (elev + 4) / 10)) // civil twilight: fades from 6° up to 4° below
      : sun?.state === "below_horizon"
        ? 0
        : 1;
  const lights: ScanLight[] = [];
  for (const pin of pins) {
    const st = states[pin.entity];
    if (!pin.entity.startsWith("light.") || st?.state !== "on") continue;
    const reach = pin.glow === 0 ? 0 : (pin.glow ?? 1) * LIGHT_REACH;
    if (!reach) continue;
    const k = (st.attributes.brightness ?? 255) / 255;
    const [r, g, b] = rgb(st);
    lights.push({ p: pin.p, r: reach, c: [(r / 255) * k, (g / 255) * k, (b / 255) * k] });
  }
  lights.sort((a, b) => b.c[0] + b.c[1] + b.c[2] - (a.c[0] + a.c[1] + a.c[2]));
  return { ambient: night + (1 - night) * day, lights: lights.slice(0, MAX_SCAN_LIGHTS) };
};
