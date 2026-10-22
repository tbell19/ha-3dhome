/* Floor plan geometry (pure functions): wall directions, how far wall ends reach into corners, the solid pieces of a
 * wall around its doors and windows, and the joints where wall ends meet.
 *
 *   wall segment  {a:[x,y], b:[x,y], t?, h?, low?, color?}   centre line from a to b
 *   opening       {kind, x, y, w, d, h, z, rot}              a "negative box" cut out of every wall it overlaps
 */
import type { Opening, Pt, WallSeg } from "../types";
import { rotPt } from "./util.js";
import { cross, distance, dot, perp, sub } from "./vec2.js";

const ENDS = ["a", "b"] as const;

/** a wall's unit direction and length: [ux, uy, length] */
export const segDir = (wall: WallSeg): [number, number, number] => {
  const [dx, dy] = sub(wall.b, wall.a);
  const length = Math.hypot(dx, dy) || 1e-6;
  return [dx / length, dy / length, length];
};

/** Wall ends that meet another wall at an angle reach on by half that wall's thickness, so corners close.
 * Returns how far each wall's [a, b] ends reach; `thickness` is the default wall thickness. */
export function wallExtensions(walls: WallSeg[], thickness: number): [number, number][] {
  return walls.map((wall, i) => {
    const [ux, uy] = segDir(wall);
    return ENDS.map((end) => {
      let reach = 0;
      walls.forEach((other, j) => {
        if (j === i || !ENDS.some((e) => distance(other[e], wall[end]) <= 1)) return;
        const [ox, oy] = segDir(other);
        const angled = Math.abs(cross([ux, uy], [ox, oy])) > 0.17; // about 10° or more
        if (angled) reach = Math.max(reach, (other.t ?? thickness) / 2);
      });
      return reach;
    }) as [number, number];
  });
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

/** a solid block of wall: [from, to] along the wall (distance from its `a` end), [bottom, top] in height */
export type WallPiece = [number, number, number, number];

/** Splits a wall into solid blocks around the openings that cut through it. `reach` is how far its ends extend
 * (wallExtensions), `height` and `thickness` the defaults for walls that don't set their own. */
export function wallPieces(
  wall: WallSeg,
  reach: [number, number],
  openings: Opening[],
  height: number,
  thickness: number,
): WallPiece[] {
  const [ux, uy, length] = segDir(wall);
  const along: Pt = [ux, uy];
  const across = perp(along);
  const depth = wall.t ?? thickness;
  const top = wall.h ?? height;
  const start = -reach[0];
  const end = length + reach[1];

  // each opening's box, measured along and across the wall
  const holes: WallPiece[] = [];
  for (const opening of openings) {
    const offsets = openingCorners(opening).map((corner) => sub(corner, wall.a));
    const alongs = offsets.map((p) => dot(p, along));
    const acrosses = offsets.map((p) => dot(p, across));
    const from = Math.min(...alongs);
    const to = Math.max(...alongs);
    const inWall = Math.min(Math.max(...acrosses), depth / 2) - Math.max(Math.min(...acrosses), -depth / 2);
    // it must go at least halfway through the wall: grazing a neighbouring wall at a corner doesn't cut it
    if (inWall < depth * 0.5 || to <= start || from >= end) continue;
    const bottom = Math.max(0, opening.z || 0);
    const holeTop = Math.min(top, (opening.z || 0) + opening.h);
    if (holeTop > bottom) holes.push([Math.max(start, from), Math.min(end, to), bottom, holeTop]);
  }

  // between each pair of cuts the wall is solid except where holes span it; neighbouring blocks of the same height merge
  const cuts = [...new Set([start, end, ...holes.flatMap((h) => [h[0], h[1]])])].sort((a, b) => a - b);
  const pieces: WallPiece[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    const middle = (from + to) / 2;
    if (to - from < 0.05) continue;
    const gaps = holes
      .filter((h) => h[0] <= middle && h[1] >= middle)
      .map((h) => [h[2], h[3]])
      .sort((p, q) => p[0] - q[0]);
    const solid: [number, number][] = [];
    let z = 0;
    for (const [gapBottom, gapTop] of gaps) {
      if (gapBottom > z) solid.push([z, gapBottom]);
      z = Math.max(z, gapTop);
    }
    if (z < top) solid.push([z, top]);
    for (const [bottom, blockTop] of solid) {
      const before = pieces.find((p) => p[1] === from && p[2] === bottom && p[3] === blockTop);
      if (before) before[1] = to;
      else pieces.push([from, to, bottom, blockTop]);
    }
  }
  return pieces;
}

/** a corner where wall ends meet: one draggable handle per joint */
export interface Joint {
  p: Pt;
  m: [number, "a" | "b"][]; // the wall ends that meet here: [wall index, end]
}

export function planJoints(walls: WallSeg[]) {
  const joints: Joint[] = [];
  walls.forEach((wall, i) =>
    ENDS.forEach((end) => {
      const p = wall[end];
      let joint = joints.find((j) => distance(j.p, p) < 0.6);
      if (!joint) joints.push((joint = { p: [p[0], p[1]], m: [] }));
      joint.m.push([i, end]);
    }),
  );
  return joints;
}
