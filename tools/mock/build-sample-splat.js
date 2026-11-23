/* A small fictional room as a Gaussian splat, for the tests and the demo: no real home is ever scanned into this repo.
 *
 *   const { sampleRoom, toSplat, toPly } = require("./mock/build-sample-splat");
 *   toSplat(sampleRoom())  -> Buffer in the .splat format (32 bytes a splat)
 *   toPly(sampleRoom())    -> Buffer in the 3DGS .ply format (what OpenSplat, Scaniverse and Polycam export)
 *   node tools/mock/build-sample-splat.js out.splat|out.ply
 *
 * The room is 5 m wide, 4 m deep and 2.5 m high, with a sofa, a table, a rug, a floor lamp and a window, and it is
 * deliberately tilted (TILT) and moved off the origin, the way a phone scan comes out, so "Level the floor" has work
 * to do. Units are metres. Deterministic: the same splats every time.
 */
const fs = require("fs");

const TILT = { x: 0.14, z: -0.09 }; // radians: the scan's floor isn't level
const OFFSET = [0.7, -1.3, 0.4]; // and isn't at the origin

/** a seeded random number generator, so every run gives the same room */
function rng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

function sampleRoom() {
  const rand = rng(7);
  const splats = [];
  const jitter = (c, amt = 18) => c.map((v) => Math.max(0, Math.min(255, v + (rand() - 0.5) * amt)));
  /** a flat rectangle of splats: origin o, edge vectors u and v, spacing d, colour fn(s, t) */
  const patch = (o, u, v, d, colour, thick = 0.006) => {
    const lu = Math.hypot(...u);
    const lv = Math.hypot(...v);
    const nu = Math.max(1, Math.round(lu / d));
    const nv = Math.max(1, Math.round(lv / d));
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const s = (i + rand()) / nu;
        const t = (j + rand()) / nv;
        const p = [0, 1, 2].map((k) => o[k] + u[k] * s + v[k] * t);
        // scale along u, v and the normal: flat discs that overlap a little
        const sc = [0, 1, 2].map((k) => (Math.abs(u[k]) / lu + Math.abs(v[k]) / lv) * d * 0.75 + thick);
        splats.push({ p, s: sc, c: [...jitter(colour(s, t)), 255] });
      }
  };
  /** a box: its five visible faces (no bottom) */
  const box = (x0, x1, y0, y1, z0, z1, colour, d = 0.04) => {
    patch([x0, y1, z0], [x1 - x0, 0, 0], [0, 0, z1 - z0], d, colour); // top
    patch([x0, y0, z1], [x1 - x0, 0, 0], [0, y1 - y0, 0], d, colour); // front
    patch([x0, y0, z0], [x1 - x0, 0, 0], [0, y1 - y0, 0], d, colour); // back
    patch([x0, y0, z0], [0, 0, z1 - z0], [0, y1 - y0, 0], d, colour); // left
    patch([x1, y0, z0], [0, 0, z1 - z0], [0, y1 - y0, 0], d, colour); // right
  };
  const W = 5;
  const D = 4;
  const H = 2.5;
  // floor: oak boards with darker seams
  patch([0, 0, 0], [W, 0, 0], [0, 0, D], 0.045, (s) => ((s * W * 6) % 1 < 0.06 ? [120, 82, 50] : [176, 128, 82]));
  // walls: warm white, with a window on the back wall
  patch([0, 0, 0], [W, 0, 0], [0, H, 0], 0.05, (s, t) =>
    s > 0.55 && s < 0.85 && t > 0.35 && t < 0.8 ? [190, 220, 245] : [232, 226, 214],
  );
  patch([0, 0, 0], [0, 0, D], [0, H, 0], 0.05, () => [222, 214, 200]);
  patch([W, 0, 0], [0, 0, D], [0, H, 0], 0.05, () => [214, 222, 210]);
  // rug, sofa, table, floor lamp
  patch([1.2, 0.01, 1.4], [2.4, 0, 0], [0, 0, 1.6], 0.04, (s, t) =>
    (((s * 8) | 0) + ((t * 6) | 0)) % 2 ? [150, 60, 55] : [200, 170, 120],
  );
  box(1.0, 3.6, 0, 0.45, 0.25, 1.15, () => [70, 92, 120]); // sofa seat
  box(1.0, 3.6, 0.45, 0.9, 0.25, 0.5, () => [62, 84, 112]); // sofa back
  box(1.9, 3.0, 0, 0.42, 2.0, 2.7, () => [96, 66, 44]); // coffee table
  box(4.2, 4.3, 0, 1.5, 0.5, 0.6, () => [40, 40, 40], 0.03); // lamp pole
  box(4.0, 4.5, 1.5, 1.85, 0.3, 0.8, () => [246, 232, 200], 0.03); // lamp shade
  return place(splats);
}

/** tilt and move the room the way a phone scan comes out */
function place(splats) {
  const { x: ax, z: az } = TILT;
  const rx = (p) => [p[0], p[1] * Math.cos(ax) - p[2] * Math.sin(ax), p[1] * Math.sin(ax) + p[2] * Math.cos(ax)];
  const rz = (p) => [p[0] * Math.cos(az) - p[1] * Math.sin(az), p[0] * Math.sin(az) + p[1] * Math.cos(az), p[2]];
  return splats.map((g) => ({ ...g, p: rz(rx(g.p)).map((v, k) => v + OFFSET[k]) }));
}

/** the .splat format: position (3 × f32), scale (3 × f32), colour (4 × u8), rotation (4 × u8, w x y z) */
function toSplat(splats) {
  const buf = Buffer.alloc(splats.length * 32);
  splats.forEach((g, i) => {
    const o = i * 32;
    g.p.forEach((v, k) => buf.writeFloatLE(v, o + k * 4));
    g.s.forEach((v, k) => buf.writeFloatLE(v, o + 12 + k * 4));
    g.c.forEach((v, k) => buf.writeUInt8(Math.round(v), o + 24 + k));
    [255, 128, 128, 128].forEach((v, k) => buf.writeUInt8(v, o + 28 + k)); // identity rotation
  });
  return buf;
}

/** the 3DGS .ply format: log scales, SH DC colour, logit opacity */
function toPly(splats) {
  const props = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity"];
  props.push("scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3");
  const header =
    `ply\nformat binary_little_endian 1.0\nelement vertex ${splats.length}\n` +
    props.map((p) => `property float ${p}\n`).join("") +
    "end_header\n";
  const SH_C0 = 0.28209479177387814;
  const body = Buffer.alloc(splats.length * props.length * 4);
  splats.forEach((g, i) => {
    const v = [...g.p, 0, 0, 0, ...g.c.slice(0, 3).map((c) => (c / 255 - 0.5) / SH_C0), 6];
    v.push(...g.s.map((s) => Math.log(s)), 1, 0, 0, 0);
    v.forEach((x, k) => body.writeFloatLE(x, (i * props.length + k) * 4));
  });
  return Buffer.concat([Buffer.from(header, "ascii"), body]);
}

/** a point of the room (metres, floor at y = 0) where the scan has it */
const scanPoint = (p) => place([{ p }])[0].p;

module.exports = { sampleRoom, toSplat, toPly, scanPoint, TILT, OFFSET };

if (require.main === module) {
  const out = process.argv[2] || "sample-room.splat";
  const room = sampleRoom();
  fs.writeFileSync(out, out.endsWith(".ply") ? toPly(room) : toSplat(room));
  console.log(`${room.length} splats -> ${out}`);
}
