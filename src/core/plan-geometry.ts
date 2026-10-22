/* Floor plan geometry (pure functions): wall directions, joints, and wall pieces around openings.
 */
import type { Opening, Pt, WallSeg } from "../types";
import { rotPt } from "./util.js";

/*
 * wall segment  {a:[x,y], b:[x,y], t?, h?, low?, color?}   — centre line from a to b
 * opening       {kind, x, y, w, d, h, z, rot}              — a "negative box" cut out of every wall it overlaps
 * blueprint     {src, x, y, w, h, rot, opacity, locked?, show?} */
/** a wall's unit direction and length: [ux, uy, length] */
export const segDir = (s: WallSeg): [number, number, number] => {
  const dx = s.b[0] - s.a[0],
    dy = s.b[1] - s.a[1],
    L = Math.hypot(dx, dy) || 1e-6;
  return [dx / L, dy / L, L];
};
/* ends that meet another wall at an angle are pushed out by half that wall's thickness, so corners close */
export function wallExtensions(segs: WallSeg[], WT: number): [number, number][] {
  const ext = segs.map((): [number, number] => [0, 0]);
  segs.forEach((s, i) =>
    (["a", "b"] as const).forEach((e, ei) => {
      const p = s[e],
        di = segDir(s);
      segs.forEach((o, j) => {
        if (j === i) return;
        for (const f of ["a", "b"] as const) {
          if (Math.hypot(o[f][0] - p[0], o[f][1] - p[1]) > 1) continue;
          const dj = segDir(o);
          if (Math.abs(di[0] * dj[1] - di[1] * dj[0]) > 0.17) ext[i][ei] = Math.max(ext[i][ei], (o.t ?? WT) / 2);
        }
      });
    }),
  );
  return ext;
}
/** the four plan corners of an opening's box */
export const openingCorners = (o: Opening) =>
  (
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const
  ).map(([sx, sy]) => rotPt(o.x + (sx * o.w) / 2, o.y + (sy * (o.d ?? 6)) / 2, o.x, o.y, o.rot || 0));
/* split a wall into solid blocks [s0, s1, z0, z1] (s = distance along the wall from a) around the openings that overlap it */
export function wallPieces(s: WallSeg, ext: [number, number], openings: Opening[], H: number, WT: number) {
  const [ux, uy, L] = segDir(s),
    nx = -uy,
    ny = ux,
    t = s.t ?? WT,
    h = s.h ?? H,
    lo = -ext[0],
    hi = L + ext[1];
  const holes: [number, number, number, number][] = [];
  for (const o of openings) {
    let s0 = Infinity,
      s1 = -Infinity,
      q0 = Infinity,
      q1 = -Infinity;
    for (const p of openingCorners(o)) {
      const dx = p[0] - s.a[0],
        dy = p[1] - s.a[1],
        ss = dx * ux + dy * uy,
        qq = dx * nx + dy * ny;
      s0 = Math.min(s0, ss);
      s1 = Math.max(s1, ss);
      q0 = Math.min(q0, qq);
      q1 = Math.max(q1, qq);
    }
    if (Math.min(q1, t / 2) - Math.max(q0, -t / 2) < t * 0.5 || s1 <= lo || s0 >= hi) continue; // must go at least halfway through the wall — grazing a neighbouring wall at a corner doesn't cut it
    const z0 = Math.max(0, o.z || 0),
      z1 = Math.min(h, (o.z || 0) + o.h);
    if (z1 > z0) holes.push([Math.max(lo, s0), Math.min(hi, s1), z0, z1]);
  }
  const cuts = [...new Set([lo, hi, ...holes.flatMap((x) => [x[0], x[1]])])].sort((a, b) => a - b),
    pieces: [number, number, number, number][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i],
      b = cuts[i + 1],
      m = (a + b) / 2;
    if (b - a < 0.05) continue;
    const zs = holes
      .filter((x) => x[0] <= m && x[1] >= m)
      .map((x) => [x[2], x[3]])
      .sort((p, q) => p[0] - q[0]);
    let z = 0;
    const solid: [number, number][] = [];
    for (const [z0, z1] of zs) {
      if (z0 > z) solid.push([z, z0]);
      z = Math.max(z, z1);
    }
    if (z < h) solid.push([z, h]);
    for (const [z0, z1] of solid) {
      const prev = pieces.find((p) => p[1] === a && p[2] === z0 && p[3] === z1);
      if (prev) prev[1] = b;
      else pieces.push([a, b, z0, z1]);
    }
  }
  return pieces;
}
/* corners where wall ends meet: one draggable handle per joint */
export interface Joint {
  p: Pt;
  m: [number, "a" | "b"][]; // the wall ends that meet here: [wall index, end]
}
export function planJoints(segs: WallSeg[]) {
  const js: Joint[] = [];
  segs.forEach((s, i) =>
    (["a", "b"] as const).forEach((e) => {
      const p = s[e];
      let j = js.find((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < 0.6);
      if (!j) js.push((j = { p: [p[0], p[1]], m: [] }));
      j.m.push([i, e]);
    }),
  );
  return js;
}
