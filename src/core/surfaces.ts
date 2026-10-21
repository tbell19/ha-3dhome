/* Surface textures: subtle, tileable greyscale patterns that are multiplied by a wall or floor colour.
 */

/** name → [label, real size of one texture tile in cm, where it fits: "f" floors, "w" walls] */
export const SURFACES: Record<string, [string, number, string]> = {
  wood: ["Wood planks", 120, "f"],
  tile: ["Tiles", 60, "fw"],
  stone: ["Stone slabs", 160, "f"],
  carpet: ["Carpet", 40, "f"],
  concrete: ["Concrete", 200, "fw"],
  brick: ["Brick", 90, "w"],
  plaster: ["Plaster", 150, "w"],
  boards: ["Wood panelling", 120, "w"],
};
/** A texture canvas, plus its average brightness (0..1). */
export type SurfaceCanvas = HTMLCanvasElement & { mean?: number };

/** Paint one tile of the named texture, S×S pixels. The pattern is seeded by the name, so it is the same every time. */
export function paintSurface(name: string, S = 256): SurfaceCanvas {
  const c: SurfaceCanvas = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  let seed = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const grey = (v: number, a = 1) => `rgba(${v},${v},${v},${a})`;
  const wrap = (fn: (dx: number, dy: number) => void) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy);
  }; // draw at 9 offsets so edges tile
  const blotch = (n: number, r0: number, r1: number, lo: number, hi: number, a: number) => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * S,
        y = rnd() * S,
        r = r0 + rnd() * (r1 - r0),
        v = Math.round(lo + rnd() * (hi - lo));
      wrap((dx, dy) => {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        gr.addColorStop(0, grey(v, a));
        gr.addColorStop(1, grey(v, 0));
        g.fillStyle = gr;
        g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
      });
    }
  };
  const speckle = (amp: number) => {
    const im = g.getImageData(0, 0, S, S),
      d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (rnd() - 0.5) * amp;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
    g.putImageData(im, 0, 0);
  };
  if (name === "boards") {
    // wood planks stood upright
    const w = paintSurface("wood", S);
    g.translate(S, 0);
    g.rotate(Math.PI / 2);
    g.drawImage(w, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    c.mean = w.mean;
    return c;
  }
  g.fillStyle = grey(244);
  g.fillRect(0, 0, S, S);
  if (name === "wood") {
    const rows = 5,
      rh = S / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh,
        j = rnd() * S;
      for (const [x0, x1] of [
        [j - S, j],
        [j, j + S],
      ]) {
        g.fillStyle = grey(Math.round(218 + rnd() * 30));
        g.fillRect(x0, y, x1 - x0, rh);
      }
      for (let k = 0; k < 7; k++) {
        // grain
        const gy = y + 3 + rnd() * (rh - 6),
          amp = 1 + rnd() * 2,
          ph = rnd() * 6.3;
        g.strokeStyle = grey(170, 0.18);
        g.lineWidth = 1;
        g.beginPath();
        for (let x = 0; x <= S; x += 8) g.lineTo(x, gy + amp * Math.sin((x / S) * 2 * Math.PI * 2 + ph));
        g.stroke();
      }
      g.fillStyle = grey(150, 0.55);
      g.fillRect(0, y, S, 1.5);
      g.fillRect(j - 0.75, y, 1.5, rh);
    }
  } else if (name === "tile" || name === "stone") {
    const n = 2,
      ts = S / n;
    for (let i = 0; i < n; i++)
      for (let k = 0; k < n; k++) {
        g.fillStyle = grey(Math.round(232 + rnd() * 18));
        g.fillRect(i * ts, k * ts, ts, ts);
      }
    if (name === "stone") {
      blotch(40, 10, 40, 205, 255, 0.35);
      speckle(14);
    }
    g.fillStyle = grey(name === "stone" ? 180 : 196);
    const gw = name === "stone" ? 3 : 4;
    for (let i = 0; i < n; i++) {
      g.fillRect(i * ts - gw / 2, 0, gw, S);
      g.fillRect(0, i * ts - gw / 2, S, gw);
    }
    g.fillRect(S - gw / 2, 0, gw, S);
    g.fillRect(0, S - gw / 2, S, gw);
  } else if (name === "brick") {
    const rows = 12,
      rh = S / rows,
      bw = S / 4;
    g.fillStyle = grey(250);
    g.fillRect(0, 0, S, S); // mortar
    for (let r = 0; r < rows; r++)
      for (let b = 0; b < 4; b++) {
        const x = b * bw + (r % 2 ? bw / 2 : 0),
          v = Math.round(200 + rnd() * 34);
        for (const dx of [0, -S]) {
          g.fillStyle = grey(v);
          g.fillRect(x + dx + 1.5, r * rh + 1.5, bw - 3, rh - 3);
        }
      }
    speckle(12);
  } else if (name === "carpet") {
    blotch(30, 20, 50, 220, 255, 0.4);
    speckle(34);
  } else if (name === "concrete") {
    blotch(60, 8, 50, 205, 255, 0.3);
    speckle(16);
  } else if (name === "plaster") {
    blotch(50, 15, 60, 225, 255, 0.35);
    speckle(8);
  }
  const d = g.getImageData(0, 0, S, S).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i];
  c.mean = sum / (d.length / 4) / 255; // _surfMat brightens the colour by 1/mean so a texture doesn't darken the surface
  return c;
}
