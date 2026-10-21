/* Light fixtures and door leaves: the choices offered, and the pure maths behind string lights.
 */

export const FIXTURES = { none: "Glow only", can: "Can light", ceiling: "Ceiling light", pendant: "Pendant", bulb: "Bare bulb",
  floorlamp: "Floor lamp", tablelamp: "Table lamp", string: "String lights" };
/* string lights: bulb count (fixed `count`, else one per `spacing` along the run), and where each bulb hangs.
 * Each span between points sags by `sag` (default 5% of its length) in a parabola. stringBulbs → [[x, y, drop], …]. */
export function stringLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
export function stringCount(L) { const len = stringLen(L.points || []); return Math.min(200, L.count > 0 ? Math.round(L.count) : Math.max(2, Math.round(len / (L.spacing || 14)) + 1)); }
export function spanSag(L, span) { return L.sag ?? Math.min(8, span * 0.05); }
export function stringBulbs(L) {
  const pts = L.points || [], n = stringCount(L), len = stringLen(pts), out = [];
  if (pts.length < 2 || !len) return out;
  for (let k = 0; k < n; k++) {
    let d = n === 1 ? len / 2 : (len * k) / (n - 1);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], span = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d <= span + 1e-6 || i === pts.length - 1) {
        const t = span ? Math.min(1, d / span) : 0;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, spanSag(L, span) * 4 * t * (1 - t)]);
        break;
      }
      d -= span;
    }
  }
  return out;
}
export const DOOR_STYLES = { none: ["Opening only"], panel: ["Solid door", "#7a5a40"], glass: ["Glass door", "#2f2f2f"], double: ["Double doors", "#7a5a40"],
  sliding: ["Sliding glass", "#3a3a3a"], barn: ["Barn door", "#6b4a32"], garage: ["Garage door", "#d9d4cc"] };
export const OPEN_STATES = new Set(["on", "open", "opening"]);
