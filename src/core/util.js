/* Small pure helpers: rounding, cloning, HTML escaping, polygon maths and a key-order-independent JSON.
 */

export const R1 = (v) => Math.round(v * 10) / 10;
export const jclone = (o) => JSON.parse(JSON.stringify(o));
export const ic = (name) => `<ha-icon icon="mdi:${name}"></ha-icon>`; // HA's own icon element, for buttons and labels
export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
export const rotPt = (x, y, cx, cy, deg) => {
  const r = (deg * Math.PI) / 180,
    c = Math.cos(r),
    s = Math.sin(r),
    dx = x - cx,
    dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
};
export const inPoly = (x, y, pts) => {
  // ray casting
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i],
      [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
export const polyArea = (pts) =>
  Math.abs(
    pts.reduce((s, p, i) => {
      const q = pts[(i + 1) % pts.length];
      return s + p[0] * q[1] - q[0] * p[1];
    }, 0),
  ) / 2;
export const roomTitle = (s) =>
  String(s)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
export const mean = (pts) => [
  pts.reduce((s, p) => s + p[0], 0) / pts.length,
  pts.reduce((s, p) => s + p[1], 0) / pts.length,
];
export const clamp01 = (v) => Math.min(1, Math.max(0, v));
export const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/* JSON with sorted keys, so configs compare equal whatever order HA builds them in */
export const stableJSON = (v) =>
  JSON.stringify(v, (k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((q) => [q, x[q]]),
        )
      : x,
  );
