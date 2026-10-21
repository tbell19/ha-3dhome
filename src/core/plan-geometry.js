/* Floor plan geometry (pure functions): wall joints, wall pieces around openings, and the legacy wall format.
 */
import { R1, rotPt } from "./util.js";

/* ---------- floor plan geometry (pure functions) ----------
 * wall segment  {a:[x,y], b:[x,y], t?, h?, low?, color?}   — centre line from a to b
 * opening       {kind, x, y, w, d, h, z, rot}              — a "negative box" cut out of every wall it overlaps
 * blueprint     {src, x, y, w, h, rot, opacity, locked?, show?} */
export const segDir = (s) => { const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], L = Math.hypot(dx, dy) || 1e-6; return [dx / L, dy / L, L]; };
/* ends that meet another wall at an angle are pushed out by half that wall's thickness, so corners close */
export function wallExtensions(segs, WT) {
  const ext = segs.map(() => [0, 0]);
  segs.forEach((s, i) => ["a", "b"].forEach((e, ei) => {
    const p = s[e], di = segDir(s);
    segs.forEach((o, j) => {
      if (j === i) return;
      for (const f of ["a", "b"]) {
        if (Math.hypot(o[f][0] - p[0], o[f][1] - p[1]) > 1) continue;
        const dj = segDir(o);
        if (Math.abs(di[0] * dj[1] - di[1] * dj[0]) > 0.17) ext[i][ei] = Math.max(ext[i][ei], (o.t ?? WT) / 2);
      }
    });
  }));
  return ext;
}
export const openingCorners = (o) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => rotPt(o.x + (sx * o.w) / 2, o.y + (sy * (o.d ?? 6)) / 2, o.x, o.y, o.rot || 0));
/* split a wall into solid blocks [s0, s1, z0, z1] (s = distance along the wall from a) around the openings that overlap it */
export function wallPieces(s, ext, openings, H, WT) {
  const [ux, uy, L] = segDir(s), nx = -uy, ny = ux, t = s.t ?? WT, h = s.h ?? H, lo = -ext[0], hi = L + ext[1];
  const holes = [];
  for (const o of openings) {
    let s0 = Infinity, s1 = -Infinity, q0 = Infinity, q1 = -Infinity;
    for (const p of openingCorners(o)) {
      const dx = p[0] - s.a[0], dy = p[1] - s.a[1], ss = dx * ux + dy * uy, qq = dx * nx + dy * ny;
      s0 = Math.min(s0, ss); s1 = Math.max(s1, ss); q0 = Math.min(q0, qq); q1 = Math.max(q1, qq);
    }
    if (Math.min(q1, t / 2) - Math.max(q0, -t / 2) < t * 0.5 || s1 <= lo || s0 >= hi) continue;   // must go at least halfway through the wall — grazing a neighbouring wall at a corner doesn't cut it
    const z0 = Math.max(0, o.z || 0), z1 = Math.min(h, (o.z || 0) + o.h);
    if (z1 > z0) holes.push([Math.max(lo, s0), Math.min(hi, s1), z0, z1]);
  }
  const cuts = [...new Set([lo, hi, ...holes.flatMap((x) => [x[0], x[1]])])].sort((a, b) => a - b), pieces = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const a = cuts[i], b = cuts[i + 1], m = (a + b) / 2;
    if (b - a < 0.05) continue;
    const zs = holes.filter((x) => x[0] <= m && x[1] >= m).map((x) => [x[2], x[3]]).sort((p, q) => p[0] - q[0]);
    let z = 0; const solid = [];
    for (const [z0, z1] of zs) { if (z0 > z) solid.push([z, z0]); z = Math.max(z, z1); }
    if (z < h) solid.push([z, h]);
    for (const [z0, z1] of solid) {
      const prev = pieces.find((p) => p[1] === a && p[2] === z0 && p[3] === z1);
      if (prev) prev[1] = b; else pieces.push([a, b, z0, z1]);
    }
  }
  return pieces;
}
/* corners where wall ends meet: one draggable handle per joint */
export function planJoints(segs) {
  const js = [];
  segs.forEach((s, i) => ["a", "b"].forEach((e) => {
    const p = s[e]; let j = js.find((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < 0.6);
    if (!j) js.push((j = { p: [p[0], p[1]], m: [] }));
    j.m.push([i, e]);
  }));
  return js;
}
/* the original axis-aligned walls ({axis, at, spans, doors}) → free segments + door openings; looks identical */
export function legacyWalls(sc) {
  const H = sc.wall_height ?? 46, LIN = sc.lintel ?? 8, LOW = sc.low ?? 8, WT = sc.wall_thickness ?? 4, segs = [], opens = [];
  const pt = (axis, at, v) => (axis === "y" ? [at, v] : [v, at]);
  const run = (w, low) => {
    const h = w.h ?? (low ? LOW : H);
    const iv = [...(w.spans || []).map(([a, b]) => [Math.min(a, b), Math.max(a, b), 0]),
      ...(low ? [] : (w.doors || []).map(([a, b]) => [Math.min(a, b), Math.max(a, b), 1]))].sort((p, q) => p[0] - q[0]);
    let cur = null;
    const flush = () => { if (cur) segs.push({ a: pt(w.axis, w.at, cur[0]), b: pt(w.axis, w.at, cur[1]), ...(h !== H ? { h } : {}), ...(low ? { low: true } : {}), ...(w.note ? { note: w.note } : {}) }); };
    for (const [a, b, door] of iv) {
      if (door) {
        const [x, y] = pt(w.axis, w.at, (a + b) / 2);
        opens.push({ kind: "door", x, y, w: R1(b - a), d: WT + 2, h: h - LIN, z: 0, ...(w.axis === "y" ? { rot: 90 } : {}) });
      }
      if (cur && a <= cur[1] + 0.01) cur[1] = Math.max(cur[1], b); else { flush(); cur = [a, b]; }
    }
    flush();
  };
  for (const w of sc.walls || []) run(w, false);
  for (const w of sc.front_walls || []) run(w, true);
  return { segs, opens };
}
