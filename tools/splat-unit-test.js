/* Unit tests for the scan view's pure helpers (src/core/splat.ts, src/core/capture.ts), in Node.
 *
 *   npm run test:unit
 */
const path = require("path");
const esbuild = require("esbuild");

const load = (file) => {
  const { outputFiles } = esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", file)],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
    logLevel: "warning",
  });
  const m = { exports: {} };
  new Function("module", "exports", "require", outputFiles[0].text)(m, m.exports, require);
  return m.exports;
};
const S = load("src/core/splat.ts");
const C = load("src/core/capture.ts");
const { sampleRoom, scanPoint } = require("./mock/build-sample-splat");

let failed = 0;
let n = 0;
const check = (name, ok, detail = "") => {
  n++;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const near = (a, b, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]) < eps);

/* formats */
check("formats by extension", S.splatFormat("a/b/Room.PLY?authSig=x") === "ply" && S.splatFormat("x.spz") === "spz");
check("not a splat", S.splatFormat("notes.txt") === null);

/* quaternions */
const q = S.quatFromUnitVectors([1, 0, 0], [0, 1, 0]);
check("a quarter turn", near(S.rotate(q, [1, 0, 0]), [0, 1, 0]));
const flip = S.quatFromUnitVectors([0, -1, 0], [0, 1, 0]);
check("upside down turns upright", near(S.rotate(flip, [0, -1, 0]), [0, 1, 0]));
check("inverse undoes", near(S.rotate(S.quatInvert(q), S.rotate(q, [0.3, -2, 5])), [0.3, -2, 5]));

/* levelling the sample room from three floor points */
const floor = [
  [0.5, 0, 0.5],
  [4.5, 0, 0.7],
  [2.2, 0, 3.6],
].map(scanPoint);
const up = S.sub(scanPoint([0, 1, 0]), scanPoint([0, 0, 0]));
const align = S.levelFromFloor(...floor, up);
const heights = [
  [1, 0, 1],
  [4, 0, 3],
  [3, 0, 0.2],
  [2, 2.5, 0],
].map((p) => S.toLevel(align, scanPoint(p))[1]);
check(
  "levelled floor is at height 0",
  heights.slice(0, 3).every((h) => Math.abs(h) < 1e-6),
  heights.map((h) => h.toFixed(4)).join(" "),
);
check("…and the ceiling at 2.5 m", Math.abs(heights[3] - 2.5) < 1e-6);
const down = S.levelFromFloor(...floor, S.scale(up, -1));
check("which side is up comes from the camera", S.toLevel(down, scanPoint([2, 2.5, 0]))[1] < -2.4);
check("points in a line can't level", S.levelFromFloor([0, 0, 0], [1, 0, 0], [2, 0, 0.001], [0, 1, 0]) === null);
const p0 = scanPoint([1, 1, 1]);
check("fromLevel undoes toLevel", near(S.fromLevel(align, S.toLevel(align, p0)), p0));
const spun = S.spinLevel(align, Math.PI / 2);
check("turning keeps the floor level", Math.abs(S.toLevel(spun, scanPoint([4, 0, 3]))[1]) < 1e-6);

/* extent */
const pts = sampleRoom().map((g) => S.toLevel(align, g.p));
pts.push([500, 500, 500]); // a stray splat far out
const e = S.robustExtent(pts);
check("extent ignores strays", e.max[0] < 10 && e.max[1] < 3, JSON.stringify(e.max.map((v) => +v.toFixed(2))));
const v = S.viewOf(e, true);
check("the first view looks down on the room", v.position[1] > v.target[1]);

/* pins */
check("lights toggle", S.pinTap({ entity: "light.a", p: [0, 0, 0] }) === "toggle");
check("sensors open details", S.pinTap({ entity: "sensor.a", p: [0, 0, 0] }) === "more-info");
check(
  "lights glow 1 m, sensors not",
  S.pinGlow({ entity: "light.a", p: [0, 0, 0] }) === 1 && !S.pinGlow({ entity: "sensor.a", p: [0, 0, 0] }),
);

/* lighting */
const rgb = (st) => st.attributes.rgb_color || [255, 255, 255];
const pins = [
  { entity: "light.a", p: [0, 0, 0] },
  { entity: "light.b", p: [1, 0, 0], glow: 2 },
  { entity: "light.c", p: [2, 0, 0], glow: 0 },
  { entity: "sensor.t", p: [3, 0, 0] },
];
const states = {
  "light.a": { state: "on", attributes: { brightness: 255, rgb_color: [255, 0, 0] } },
  "light.b": { state: "on", attributes: { brightness: 51 } },
  "light.c": { state: "on", attributes: {} },
  "sensor.t": { state: "on", attributes: {} },
};
const night = S.scanLighting(pins, states, { state: "below_horizon", attributes: { elevation: -20 } }, rgb);
check("night dims the scan", night.ambient === 0.25);
check("only lights that are on and glow light the scan", night.lights.length === 2);
check("brightest first", near(night.lights[0].c, [1, 0, 0]) && night.lights[1].r === 6);
check("brightness scales colour", near(night.lights[1].c, [0.2, 0.2, 0.2]));
check(
  "day leaves the scan as filmed",
  S.scanLighting(pins, states, { state: "above_horizon", attributes: { elevation: 30 } }, rgb).ambient === 1,
);
const dusk = S.scanLighting([], {}, { state: "below_horizon", attributes: { elevation: 1 } }, rgb).ambient;
check("dusk is in between", dusk > 0.25 && dusk < 1, dusk.toFixed(2));
check(
  "night: 1 turns dimming off",
  S.scanLighting([], {}, { state: "below_horizon", attributes: {} }, rgb, 1).ambient === 1,
);

/* choosing photos */
const W = 40;
const H = 30;
const pattern = (shift, blur = 0) => {
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = ((x + shift) >> 2) % 2 ? 220 : 30;
  if (!blur) return g;
  const out = new Float32Array(g);
  for (let k = 0; k < blur; k++) for (let i = 1; i < W * H - 1; i++) out[i] = (out[i - 1] + out[i] + out[i + 1]) / 3;
  return out;
};
check("blur lowers sharpness", C.sharpness(pattern(0, 4), W, H) < C.sharpness(pattern(0), W, H) * 0.5);
const picker = new C.FramePicker();
const verdicts = [];
let t = 0;
for (let i = 0; i < 8; i++) verdicts.push(picker.offer(pattern(i * 3), W, H, (t += 400)));
verdicts.push(picker.offer(pattern(24), W, H, (t += 100))); // too soon after the last kept one
verdicts.push(picker.offer(pattern(24, 6), W, H, (t += 400))); // blurry
verdicts.push(picker.offer(pattern(24), W, H, (t += 400))); // sharp, new
verdicts.push(picker.offer(pattern(24), W, H, (t += 400))); // the same again
check(
  "sharp, new frames are kept",
  verdicts.slice(0, 8).every((v) => v === "keep"),
  verdicts.join(" "),
);
check("not one too soon after the last", verdicts[8] === "soon");
check("nor a blurry one", verdicts[9] === "blurry");
check("a sharp one is again", verdicts[10] === "keep");
check("nor the same view twice", verdicts[11] === "same");
check("it counts", picker.kept === 9 && picker.seen === 12);

console.log(`\n${n - failed}/${n} unit checks passed.`);
process.exit(failed ? 1 : 0);
