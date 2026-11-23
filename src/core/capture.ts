/* Choosing photos while scanning a room with the camera (or reading a video): a 3D scan needs sharp photos that each
 * show something a little new. Every sampled frame is shrunk to a small greyscale image; it is kept when it is sharp
 * for this scan (compared with the frames just before it) and different enough from the last one kept. Pure, so
 * tools/splat-unit-test.js tests it in Node.
 */

/** RGBA pixels → greyscale (0–255) */
export const greyscale = (rgba: ArrayLike<number>, w: number, h: number): Float32Array => {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return out;
};

/** how sharp an image is: the variance of its Laplacian (blur flattens edges, so it drops) */
export const sharpness = (g: ArrayLike<number>, w: number, h: number) => {
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
      sum += l;
      sum2 += l * l;
      n++;
    }
  if (!n) return 0;
  const mean = sum / n;
  return sum2 / n - mean * mean;
};

/** how different two same-sized greyscale images are: the mean absolute difference, 0–255 */
export const difference = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return a.length ? d / a.length : 0;
};

export type FrameVerdict = "keep" | "blurry" | "same" | "soon";

export interface PickerOptions {
  /** at least this many ms between kept frames */
  minGap: number;
  /** a frame is blurry below this share of the recent frames' median sharpness */
  blurRatio: number;
  /** and always below this sharpness (a lens cap, a blank wall in the dark) */
  minSharpness: number;
  /** a frame shows nothing new below this mean difference from the last kept one */
  minDifference: number;
}

export const PICKER_DEFAULTS: PickerOptions = { minGap: 350, blurRatio: 0.55, minSharpness: 8, minDifference: 7 };

/** Decides, frame by frame, which to keep. Feed it every sampled frame in order. */
export class FramePicker {
  private recent: number[] = [];
  private last: Float32Array | null = null;
  private lastAt = -Infinity;
  kept = 0;
  seen = 0;
  /** why the last frames were dropped, for the hint on screen */
  verdict: FrameVerdict = "soon";
  readonly opts: PickerOptions;

  constructor(opts: Partial<PickerOptions> = {}) {
    this.opts = { ...PICKER_DEFAULTS, ...opts };
  }

  /** `g` is the frame in greyscale, `at` its time in ms */
  offer(g: Float32Array, w: number, h: number, at: number): FrameVerdict {
    this.seen++;
    const s = sharpness(g, w, h);
    this.recent.push(s);
    if (this.recent.length > 15) this.recent.shift();
    const median = [...this.recent].sort((a, b) => a - b)[this.recent.length >> 1];
    let v: FrameVerdict;
    if (at - this.lastAt < this.opts.minGap) v = "soon";
    else if (s < this.opts.minSharpness || (this.recent.length >= 5 && s < median * this.opts.blurRatio)) v = "blurry";
    else if (this.last && difference(g, this.last) < this.opts.minDifference) v = "same";
    else v = "keep";
    if (v === "keep") {
      this.last = g;
      this.lastAt = at;
      this.kept++;
    }
    if (v !== "soon") this.verdict = v;
    return v;
  }
}

/** how many photos a good scan of one room takes, for the progress on screen */
export const SCAN_TARGET = { min: 60, good: 150, max: 400 };
