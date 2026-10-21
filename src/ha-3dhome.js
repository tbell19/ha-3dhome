/* ha-3dhome-card (3D Home) — live 3D floor plan for Home Assistant (Three.js), with an in-card editor.
 * Config: `scene` (floors, walls, boxes, objects, overlays in plan units: x, y on the plan, z = height)
 * plus `lights`, `hotspots`, `chips`, `doors`, `weather`.
 * Edit mode (admins): move / rotate / duplicate / delete / group furniture and entities, add Sweet Home 3D
 * models (libraries downloaded into /config/www/sh3d via the Downloader integration), then Save writes the
 * card config back into the dashboard.
 */
const VERSION3D = "5.0.0";
const STRATEGY_NAME = "ha-3dhome";
const OLD_NAMES = { card: "iso-home-3d-card", strategy: "iso-home" };   // the project was called ha-iso-home before v5; both still work
const CDN = "https://cdn.jsdelivr.net/npm/";
const THREE_URL = CDN + "three@0.160.0/+esm";
const JSM = CDN + "three@0.160.0/examples/jsm/";
const ORBIT_URL = JSM + "controls/OrbitControls.js/+esm";
const TC_URL = JSM + "controls/TransformControls.js/+esm";
const OBJ_URL = JSM + "loaders/OBJLoader.js/+esm";
const MTL_URL = JSM + "loaders/MTLLoader.js/+esm";
const JSZIP_URL = CDN + "jszip@3.10.1/+esm";
const CX = 296, CY = 391;
/* render looks, each a strength 0..1 under `look:`. A missing key or true uses the default strength, 0 or false turns it off, and `look: false` turns them all off. */
const LOOKS = { light: 1, ao: 1, stage: 1, bloom: 0.5 };
const AMBIENT = 0.35;   // default `ambient`: how much flat daytime fill lights every surface
const lookOf = (cfg) => Object.fromEntries(Object.entries(LOOKS).map(([k, d]) => { const v = cfg?.look === false ? 0 : cfg?.look?.[k]; return [k, v === true || v == null ? d : Math.max(0, Math.min(1, +v || 0))]; }));
const OUTDOOR = /balcony|patio|deck|porch|terrace|garden|yard/i;   // rooms left without a roof (set `roof: true/false` on a room to override)
const SF = "https://downloads.sourceforge.net/project/sweethome3d/SweetHome3D-models/3DModels-1.9.3/";
const LIBS = [
  { file: "3DModels-LucaPresidente-1.9.3.zip", title: "Luca Presidente", size: "3.7 MB", n: 64, lic: "Free Art License" },
  { file: "3DModels-Trees-1.9.3.zip", title: "Trees", size: "6.7 MB", n: 10, lic: "Free Art License" },
  { file: "3DModels-KatorLegaz-1.9.3.zip", title: "Kator Legaz", size: "8.9 MB", n: 90, lic: "CC-BY" },
  { file: "3DModels-Reallusion-1.9.3.zip", title: "Reallusion", size: "10.7 MB", n: 25, lic: "CC-BY" },
  { file: "3DModels-BlendSwap-CC-0-1.9.3.zip", title: "BlendSwap CC-0", size: "23.8 MB", n: 175, lic: "Public domain (CC0)" },
  { file: "3DModels-BlendSwap-CC-BY-1.9.3.zip", title: "BlendSwap CC-BY", size: "23.9 MB", n: 135, lic: "CC-BY" },
  { file: "3DModels-Contributions-1.9.3.zip", title: "Contributions", size: "29 MB", n: 511, lic: "Free Art License" },
  { file: "3DModels-Scopia-1.9.3.zip", title: "Scopia", size: "69.5 MB", n: 500, lic: "CC-BY" },
];
const LIB_DIR = "/local/sh3d/";

const WEATHER_ICON3 = {
  "clear-night": "mdi:weather-night", cloudy: "mdi:weather-cloudy", fog: "mdi:weather-fog", hail: "mdi:weather-hail",
  lightning: "mdi:weather-lightning", "lightning-rainy": "mdi:weather-lightning-rainy", partlycloudy: "mdi:weather-partly-cloudy",
  pouring: "mdi:weather-pouring", rainy: "mdi:weather-rainy", snowy: "mdi:weather-snowy", "snowy-rainy": "mdi:weather-snowy-rainy",
  sunny: "mdi:weather-sunny", windy: "mdi:weather-windy", "windy-variant": "mdi:weather-windy-variant", exceptional: "mdi:alert-circle-outline",
};
function k2rgb(k) {
  const t = k / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
  const c = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return [c(r), c(g), c(b)];
}
const stateRgb = (st) => {
  const a = (st && st.attributes) || {};
  if (Array.isArray(a.rgb_color)) return a.rgb_color;
  if (a.color_temp_kelvin) return k2rgb(a.color_temp_kelvin);
  return [255, 205, 140];
};

/* ---------- plan-item helpers (pure data) ---------- */
const R1 = (v) => Math.round(v * 10) / 10;
const jclone = (o) => JSON.parse(JSON.stringify(o));
const ic = (name) => `<ha-icon icon="mdi:${name}"></ha-icon>`;   // HA's own icon element, for buttons and labels
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const bArr = (e) => (Array.isArray(e) ? e : e.b);
const rotPt = (x, y, cx, cy, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
};
const inPoly = (x, y, pts) => {   // ray casting
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const KINDS = { b: "box", o: "object", v: "fixture", l: "light", h: "hotspot", c: "chip", d: "door", w: "wall", n: "opening", p: "blueprint", r: "room" };
const ROTATABLE = new Set(["b", "o", "v", "n", "p"]);
const PLAN = new Set(["w", "n", "p", "r"]);   // items edited in floor-plan mode (walls, openings, blueprints, rooms)
const ROOM_FILLS = ["#c9b99d", "#b7c2ae", "#c7b3a3", "#aebdca", "#d0c29b", "#bfb0c4"];
const polyArea = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const roomTitle = (s) => String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ---------- light fixtures a light can build for itself (`fixture` on a light) ---------- */
const FIXTURES = { none: "Glow only", can: "Can light", ceiling: "Ceiling light", pendant: "Pendant", bulb: "Bare bulb",
  floorlamp: "Floor lamp", tablelamp: "Table lamp", string: "String lights" };
/* string lights: bulb count (fixed `count`, else one per `spacing` along the run), and where each bulb hangs.
 * Each span between points sags by `sag` (default 5% of its length) in a parabola. stringBulbs → [[x, y, drop], …]. */
function stringLen(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
function stringCount(L) { const len = stringLen(L.points || []); return Math.min(200, L.count > 0 ? Math.round(L.count) : Math.max(2, Math.round(len / (L.spacing || 14)) + 1)); }
function spanSag(L, span) { return L.sag ?? Math.min(8, span * 0.05); }
function stringBulbs(L) {
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

/* ---------- door leaves for door openings: style → [label, default colour] ---------- */
const DOOR_STYLES = { none: ["Opening only"], panel: ["Solid door", "#7a5a40"], glass: ["Glass door", "#2f2f2f"], double: ["Double doors", "#7a5a40"],
  sliding: ["Sliding glass", "#3a3a3a"], barn: ["Barn door", "#6b4a32"], garage: ["Garage door", "#d9d4cc"] };
const OPEN_STATES = new Set(["on", "open", "opening"]);

/* ---------- surface textures: subtle, tileable greyscale patterns multiplied by the wall / floor colour ---------- */
// name → [label, real size of one texture tile in cm, where it fits: "f" floors, "w" walls]
const SURFACES = { wood: ["Wood planks", 120, "f"], tile: ["Tiles", 60, "fw"], stone: ["Stone slabs", 160, "f"], carpet: ["Carpet", 40, "f"],
  concrete: ["Concrete", 200, "fw"], brick: ["Brick", 90, "w"], plaster: ["Plaster", 150, "w"], boards: ["Wood panelling", 120, "w"] };
function paintSurface(name, S = 256) {
  const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");
  let seed = [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const grey = (v, a = 1) => `rgba(${v},${v},${v},${a})`;
  const wrap = (fn) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy); };   // draw at 9 offsets so edges tile
  const blotch = (n, r0, r1, lo, hi, a) => {
    for (let i = 0; i < n; i++) {
      const x = rnd() * S, y = rnd() * S, r = r0 + rnd() * (r1 - r0), v = Math.round(lo + rnd() * (hi - lo));
      wrap((dx, dy) => { const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r); gr.addColorStop(0, grey(v, a)); gr.addColorStop(1, grey(v, 0)); g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r); });
    }
  };
  const speckle = (amp) => {
    const im = g.getImageData(0, 0, S, S), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * amp; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(im, 0, 0);
  };
  if (name === "boards") {   // wood planks stood upright
    const w = paintSurface("wood", S); g.translate(S, 0); g.rotate(Math.PI / 2); g.drawImage(w, 0, 0); g.setTransform(1, 0, 0, 1, 0, 0);
    c.mean = w.mean; return c;
  }
  g.fillStyle = grey(244); g.fillRect(0, 0, S, S);
  if (name === "wood") {
    const rows = 5, rh = S / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rh, j = rnd() * S;
      for (const [x0, x1] of [[j - S, j], [j, j + S]]) { g.fillStyle = grey(Math.round(218 + rnd() * 30)); g.fillRect(x0, y, x1 - x0, rh); }
      for (let k = 0; k < 7; k++) {   // grain
        const gy = y + 3 + rnd() * (rh - 6), amp = 1 + rnd() * 2, ph = rnd() * 6.3;
        g.strokeStyle = grey(170, 0.18); g.lineWidth = 1; g.beginPath();
        for (let x = 0; x <= S; x += 8) g.lineTo(x, gy + amp * Math.sin((x / S) * 2 * Math.PI * 2 + ph));
        g.stroke();
      }
      g.fillStyle = grey(150, 0.55); g.fillRect(0, y, S, 1.5); g.fillRect(j - 0.75, y, 1.5, rh);
    }
  } else if (name === "tile" || name === "stone") {
    const n = 2, ts = S / n;
    for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) { g.fillStyle = grey(Math.round(232 + rnd() * 18)); g.fillRect(i * ts, k * ts, ts, ts); }
    if (name === "stone") { blotch(40, 10, 40, 205, 255, 0.35); speckle(14); }
    g.fillStyle = grey(name === "stone" ? 180 : 196);
    const gw = name === "stone" ? 3 : 4;
    for (let i = 0; i < n; i++) { g.fillRect(i * ts - gw / 2, 0, gw, S); g.fillRect(0, i * ts - gw / 2, S, gw); }
    g.fillRect(S - gw / 2, 0, gw, S); g.fillRect(0, S - gw / 2, S, gw);
  } else if (name === "brick") {
    const rows = 12, rh = S / rows, bw = S / 4;
    g.fillStyle = grey(250); g.fillRect(0, 0, S, S);   // mortar
    for (let r = 0; r < rows; r++) for (let b = 0; b < 4; b++) {
      const x = b * bw + (r % 2 ? bw / 2 : 0), v = Math.round(200 + rnd() * 34);
      for (const dx of [0, -S]) { g.fillStyle = grey(v); g.fillRect(x + dx + 1.5, r * rh + 1.5, bw - 3, rh - 3); }
    }
    speckle(12);
  } else if (name === "carpet") { blotch(30, 20, 50, 220, 255, 0.4); speckle(34); }
  else if (name === "concrete") { blotch(60, 8, 50, 205, 255, 0.3); speckle(16); }
  else if (name === "plaster") { blotch(50, 15, 60, 225, 255, 0.35); speckle(8); }
  const d = g.getImageData(0, 0, S, S).data; let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += d[i];
  c.mean = sum / (d.length / 4) / 255;   // _surfMat brightens the colour by 1/mean so a texture doesn't darken the surface
  return c;
}
const STRUCT_TYPES = new Set(["glasswall", "cornerglass", "railing", "frontwalls", "doorpanel"]);   // stay visible while editing the plan
const DOMAIN_ICON = {
  light: "mdi:lightbulb", switch: "mdi:toggle-switch", fan: "mdi:fan", sensor: "mdi:eye", binary_sensor: "mdi:radiobox-marked",
  climate: "mdi:thermostat", media_player: "mdi:speaker", cover: "mdi:window-shutter", lock: "mdi:lock", camera: "mdi:cctv",
  vacuum: "mdi:robot-vacuum", person: "mdi:account", device_tracker: "mdi:map-marker", input_boolean: "mdi:toggle-switch-outline",
  script: "mdi:script-text", scene: "mdi:palette", button: "mdi:gesture-tap-button", input_button: "mdi:gesture-tap-button",
  automation: "mdi:robot", weather: "mdi:weather-partly-cloudy", humidifier: "mdi:air-humidifier", water_heater: "mdi:water-boiler",
  alarm_control_panel: "mdi:shield-home", select: "mdi:format-list-bulleted", input_select: "mdi:format-list-bulleted",
  number: "mdi:ray-vertex", input_number: "mdi:ray-vertex", remote: "mdi:remote", siren: "mdi:bullhorn", valve: "mdi:valve",
  update: "mdi:package-up", event: "mdi:gesture-double-tap", todo: "mdi:clipboard-list", calendar: "mdi:calendar", zone: "mdi:map-marker-radius",
};
const CLASS_ICON = {
  temperature: "mdi:thermometer", humidity: "mdi:water-percent", illuminance: "mdi:brightness-5", power: "mdi:flash", energy: "mdi:lightning-bolt",
  battery: "mdi:battery", motion: "mdi:motion-sensor", occupancy: "mdi:account", presence: "mdi:account", door: "mdi:door", window: "mdi:window-closed-variant",
  garage_door: "mdi:garage", opening: "mdi:square-outline", moisture: "mdi:water-alert", smoke: "mdi:smoke-detector", co2: "mdi:molecule-co2",
  pm25: "mdi:blur", carbon_dioxide: "mdi:molecule-co2", tv: "mdi:television", speaker: "mdi:speaker",
};
const entIcon = (st, id) => st?.attributes?.icon || CLASS_ICON[st?.attributes?.device_class] || DOMAIN_ICON[(id || st?.entity_id || "").split(".")[0]] || "mdi:shape-outline";
const ACTIVE = new Set(["on", "open", "opening", "playing", "home", "unlocked", "heat", "cool", "heat_cool", "cleaning", "triggered"]);
const TOGGLE_DOMAINS = new Set(["light", "switch", "fan", "input_boolean"]);
const DOOR_CLASSES = new Set(["door", "window", "garage_door", "opening"]);
const SCREEN_OFF = new Set(["off", "standby", "unavailable", "unknown"]);
const mean = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
/* Sun position (NOAA approximation, good to ~0.5°). Returns compass azimuth (0 = north, clockwise) and elevation, in degrees.
 * Only a fallback: HA's sun.sun already carries azimuth/elevation attributes. */
function solarPosition(date, lat, lon) {
  const rad = Math.PI / 180, d = date.getTime() / 86400000 + 2440587.5 - 2451545;   // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad, e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((gmst * 15 + lon) * rad) - ra, la = lat * rad;
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(ha));
  return { azimuth: ((az / rad) % 360 + 360) % 360, elevation: el / rad };
}
/* Unit vector (Three.js X, Y, Z) pointing at the sun. `north` is how far north is turned clockwise from "up" on the
 * floor plan (towards the back wall, −y), in degrees: 0 = north is up, 90 = north is to the right. */
function sunVector(azimuth, elevation, north = 0) {
  const b = ((azimuth + (north || 0)) * Math.PI) / 180, e = (elevation * Math.PI) / 180;
  return [Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e)];
}

function itemCenter(k, it) {
  if (k === "b") { const b = bArr(it); return [(b[0] + b[1]) / 2, (b[2] + b[3]) / 2, b[6] || 0]; }
  if (!ROTATABLE.has(k)) {
    if (k === "w") return [(it.a[0] + it.b[0]) / 2, (it.a[1] + it.b[1]) / 2, 0];
    if (k === "r") return [...mean(it.pts), 0];
    if (it.x != null) return [it.x, it.y, it.z ?? ({ l: 40, c: 50, d: 22 }[k] ?? 10)];
    if (it.points?.length) return [...mean(it.points), it.z ?? 17];
    if (it.rect) return [(it.rect[0] + it.rect[1]) / 2, it.rect[4], (it.rect[2] + it.rect[3]) / 2];
    return [CX, CY, 0];
  }
  switch (it.type) {
    case "doorpanel": return it.axis === "y" ? [it.at, (it.span[0] + it.span[1]) / 2, 0] : [(it.span[0] + it.span[1]) / 2, it.at, 0];
    case "shelf": return [(it.box[0] + it.box[1]) / 2, (it.box[2] + it.box[3]) / 2, 0];
    case "plantwall": return [(it.x1 + it.x2) / 2, it.y, it.z1];
    case "sink": return [(it.rect[0] + it.rect[1]) / 2, (it.rect[2] + it.rect[3]) / 2, it.z];
    case "burners": case "bulbs": return [...mean(it.pts), it.z || 0];
    case "line": return [(it.a[0] + it.b[0]) / 2, (it.a[1] + it.b[1]) / 2, 0];
    case "track": return [(it.a[0] + it.b[0]) / 2, (it.a[1] + it.b[1]) / 2, it.z || 0];
    case "glasswall": return [it.x, (it.y1 + it.y2) / 2, 0];
    case "cornerglass": return [(it.x1 + it.x2) / 2, it.y, 0];
    case "railing": return [(it.x + it.x_end) / 2, (it.y1 + it.y2) / 2, 0];
    case "frontwalls": return null;
    default: return [it.x ?? CX, it.y ?? CY, it.type === "model" || it.type === "screen" ? it.z || 0 : 0];
  }
}
/* translate a rotatable item (box / object / overlay) by dx, dy (and dz where it means elevation) */
function shiftItem(k, it, dx, dy, dz = 0) {
  const P = (p) => { p[0] = R1(p[0] + dx); p[1] = R1(p[1] + dy); };
  const bx = (b) => { b[0] = R1(b[0] + dx); b[1] = R1(b[1] + dx); b[2] = R1(b[2] + dy); b[3] = R1(b[3] + dy); };
  if (k === "b") { const b = bArr(it); bx(b); if (dz) b[6] = R1(Math.max(0, (b[6] || 0) + dz)); return; }
  switch (it.type) {
    case "doorpanel":
      if (it.axis === "y") { it.at = R1(it.at + dx); it.span = it.span.map((v) => R1(v + dy)); }
      else { it.at = R1(it.at + dy); it.span = it.span.map((v) => R1(v + dx)); }
      break;
    case "shelf": bx(it.box); break;
    case "plantwall": it.x1 = R1(it.x1 + dx); it.x2 = R1(it.x2 + dx); it.y = R1(it.y + dy); break;
    case "sink": bx(it.rect); if (it.faucet) P(it.faucet); break;
    case "burners": case "bulbs": it.pts.forEach(P); break;
    case "line": case "track": P(it.a); P(it.b); break;
    case "glasswall": it.x = R1(it.x + dx); it.y1 = R1(it.y1 + dy); it.y2 = R1(it.y2 + dy);
      it.posts = (it.posts || []).map((v) => R1(v + dy)); if (it.handle != null) it.handle = R1(it.handle + dy); break;
    case "cornerglass": it.x1 = R1(it.x1 + dx); it.x2 = R1(it.x2 + dx); it.y = R1(it.y + dy); break;
    case "railing": it.x = R1(it.x + dx); it.x_end = R1(it.x_end + dx); it.y1 = R1(it.y1 + dy); it.y2 = R1(it.y2 + dy); break;
    default: it.x = R1((it.x ?? CX) + dx); it.y = R1((it.y ?? CY) + dy);
  }
  if (dz) {   // raise or lower: every height the item is built from moves together
    const up = (o, f, d) => { if (o[f] != null || d != null) o[f] = R1(Math.max(0, (o[f] ?? d) + dz)); };
    if (it.type === "plantwall") { up(it, "z1"); up(it, "z2"); }
    else if (it.type === "line") { it.a[2] = R1(Math.max(0, it.a[2] + dz)); it.b[2] = R1(Math.max(0, it.b[2] + dz)); }
    else if (!FLOOR_TYPES.has(it.type)) up(it, "z", ZDEF[it.type] ?? (it.type === "model" ? 0 : undefined));   // a pendant keeps its cord to the ceiling
  }
}
const ZDEF = { fan: 44, screen: 20 };   // default heights of objects that may leave `z` out
const FLOOR_TYPES = new Set([...STRUCT_TYPES, "shelf", "table", "floorlamp"]);   // always stand on the floor (a lamp's `z` is its height)
/* the height an item's inspector shows as its elevation; null for things that always stand on the floor */
function itemZ(k, it) {
  if (k === "b" || !ROTATABLE.has(k)) return itemCenter(k, it)?.[2] ?? 0;
  if (FLOOR_TYPES.has(it.type)) return null;
  if (it.type === "plantwall") return it.z1;
  if (it.type === "line") return Math.min(it.a[2], it.b[2]);
  return it.z ?? ZDEF[it.type] ?? 0;
}
/* Objects with a fixed shape (no size fields of their own) take a `size` multiplier: a number, or [x, y, z] along the
 * object's own axes. It is applied about the point they stand on or hang from, so a fan stays on the ceiling. */
const SIZED = new Set(["plant", "floorlamp", "tablelamp", "pendant", "fan", "burners", "bulbs", "sink"]);
const sizeOf = (it) => (Array.isArray(it.size) ? it.size : [it.size ?? 1, it.size ?? 1, it.size ?? 1]);
const sizeAnchor = (o) => ({ pendant: o.top ?? 62, fan: o.ceiling ?? (o.z ?? 44) + 8, floorlamp: 0 }[o.type] ?? (o.z || 0));
/* the height that stays put when an item is resized on its own */
function itemBase(k, it) {
  if (k === "b") return bArr(it)[6] || 0;
  if (!ROTATABLE.has(k)) return itemCenter(k, it)?.[2] ?? 0;
  if (SIZED.has(it.type)) return sizeAnchor(it);
  return FLOOR_TYPES.has(it.type) ? 0 : itemZ(k, it);
}
/* Resize an item by sx, sy (its own plan axes, before rotation) and sz (heights, about z0; default: its own base).
 * Rotatable items scale about their own centre. Point items (light / hotspot / chip / door) store world points, so the
 * caller maps those (mapPts); here they only change height and size. */
function scaleItem(k, it, sx, sy, sz, z0) {
  z0 ??= itemBase(k, it);
  const c = itemCenter(k, it) || [CX, CY, 0], u = sx !== 1 ? sx : sy;
  const X = (x) => R1(c[0] + (x - c[0]) * sx), Y = (y) => R1(c[1] + (y - c[1]) * sy), Z = (z) => R1(Math.max(0, z0 + (z - z0) * sz));
  const mul = (v, f, min = 0.3) => R1(Math.max(min, v * f)), R2 = (v) => Math.round(v * 100) / 100;
  const setSize = (s) => { s = s.map(R2); if (s.every((v) => v === 1)) delete it.size; else it.size = s.every((v) => v === s[0]) ? s[0] : s; };
  if (!ROTATABLE.has(k)) {
    if (it.rect) { const r = it.rect; r[0] = X(r[0]); r[1] = X(r[1]); r[2] = Z(r[2]); r[3] = Z(r[3]); return; }
    const z = itemCenter(k, it)[2], nz = Z(z); if (nz !== R1(z)) it.z = nz;
    if (it.gz != null) it.gz = Z(it.gz);
    if (k === "h") it.hit = mul(it.hit ?? 12, sx, 1);
    else if (k !== "l" || it.fixture) setSize([sizeOf(it)[0] * sx]);
    return;
  }
  if (k === "b") { const b = bArr(it); b[0] = X(b[0]); b[1] = X(b[1]); b[2] = Y(b[2]); b[3] = Y(b[3]); b[4] = mul(b[4], sz); if (b[6] || z0) b[6] = Z(b[6] || 0); return; }
  if (SIZED.has(it.type)) {
    const s = sizeOf(it), da = Z(sizeAnchor(it)) - sizeAnchor(it);
    setSize([s[0] * sx, s[1] * sy, s[2] * sz]);
    if (da) shiftItem(k, it, 0, 0, da);
    return;
  }
  switch (it.type) {
    case "model": it.w = mul(it.w, sx, 0.5); it.d = mul(it.d, sy, 0.5); it.h = mul(it.h, sz, 0.5); if (it.z || z0) it.z = Z(it.z || 0); break;
    case "screen": { const f = sx !== 1 ? sx : sz; it.w = mul(it.w || 32, f, 2); it.z = Z(it.z ?? 20); break; }
    case "doorpanel": it.span = it.span.map(it.axis === "y" ? Y : X); break;
    case "shelf": { const b = it.box; b[0] = X(b[0]); b[1] = X(b[1]); b[2] = Y(b[2]); b[3] = Y(b[3]); b[4] = mul(b[4], sz); if (it.shelves) it.shelves = it.shelves.map((z) => R1(z * sz)); break; }
    case "table": it.r = mul(it.r, u, 1); it.z = Z(it.z); break;
    case "plantwall": it.x1 = X(it.x1); it.x2 = X(it.x2); it.z1 = Z(it.z1); it.z2 = Z(it.z2); break;
    case "line": it.a = [X(it.a[0]), Y(it.a[1]), Z(it.a[2])]; it.b = [X(it.b[0]), Y(it.b[1]), Z(it.b[2])]; it.w = mul(it.w || 0.6, u, 0.1); break;
    case "track": it.a = [X(it.a[0]), Y(it.a[1])]; it.b = [X(it.b[0]), Y(it.b[1])]; it.z = Z(it.z || 0); break;
    case "glasswall": it.y1 = Y(it.y1); it.y2 = Y(it.y2); it.posts = (it.posts || []).map(Y); if (it.handle != null) it.handle = Y(it.handle); if (it.h != null) it.h = mul(it.h, sz); break;
    case "cornerglass": it.x1 = X(it.x1); it.x2 = X(it.x2); break;
    case "railing": it.x = X(it.x); it.x_end = X(it.x_end); it.y1 = Y(it.y1); it.y2 = Y(it.y2); it.h = mul(it.h, sz); break;
  }
}
/* map every plan point of an entity-like item (light / hotspot / chip / door) */
function mapPts(it, f, dz = 0) {
  const m = (xk, yk) => { if (it[xk] != null && it[yk] != null) { const [a, b] = f(it[xk], it[yk]); it[xk] = R1(a); it[yk] = R1(b); } };
  m("x", "y"); m("gx", "gy"); m("hx", "hy");
  if (it.points) it.points = it.points.map((p) => f(p[0], p[1]).map(R1));
  if (it.rect) { const r = it.rect, cx = (r[0] + r[1]) / 2, [nx, ny] = f(cx, r[4]); r[0] = R1(r[0] + nx - cx); r[1] = R1(r[1] + nx - cx); r[4] = R1(ny); }
  if (dz && it.x != null) it.z = R1(Math.max(0, (it.z ?? 40) + dz));
  if (it.a && it.b) { it.a = f(it.a[0], it.a[1]).map(R1); it.b = f(it.b[0], it.b[1]).map(R1); }   // wall segment ends
  if (it.pts) it.pts = it.pts.map((p) => f(p[0], p[1]).map(R1));                                  // room outline
}

/* ---------- floor plan geometry (pure functions) ----------
 * wall segment  {a:[x,y], b:[x,y], t?, h?, low?, color?}   — centre line from a to b
 * opening       {kind, x, y, w, d, h, z, rot}              — a "negative box" cut out of every wall it overlaps
 * blueprint     {src, x, y, w, h, rot, opacity, locked?, show?} */
const segDir = (s) => { const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], L = Math.hypot(dx, dy) || 1e-6; return [dx / L, dy / L, L]; };
/* ends that meet another wall at an angle are pushed out by half that wall's thickness, so corners close */
function wallExtensions(segs, WT) {
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
const openingCorners = (o) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => rotPt(o.x + (sx * o.w) / 2, o.y + (sy * (o.d ?? 6)) / 2, o.x, o.y, o.rot || 0));
/* split a wall into solid blocks [s0, s1, z0, z1] (s = distance along the wall from a) around the openings that overlap it */
function wallPieces(s, ext, openings, H, WT) {
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
function planJoints(segs) {
  const js = [];
  segs.forEach((s, i) => ["a", "b"].forEach((e) => {
    const p = s[e]; let j = js.find((q) => Math.hypot(q.p[0] - p[0], q.p[1] - p[1]) < 0.6);
    if (!j) js.push((j = { p: [p[0], p[1]], m: [] }));
    j.m.push([i, e]);
  }));
  return js;
}
/* the original axis-aligned walls ({axis, at, spans, doors}) → free segments + door openings; looks identical */
function legacyWalls(sc) {
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
function parseProps(text) {
  const unesc = (s) => s.replace(/\\(u([0-9a-fA-F]{4})|.)/g, (m, a, u) => (u ? String.fromCharCode(parseInt(u, 16)) : ({ t: "\t", n: "\n", r: "\r", f: "\f" }[a] ?? a)));
  const out = {}; let buf = "";
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/^\s+/, "");
    if (!buf && (!line || line[0] === "#" || line[0] === "!")) continue;
    const tail = line.match(/\\+$/);
    if (tail && tail[0].length % 2 === 1) { buf += line.slice(0, -1); continue; }
    line = buf + line; buf = "";
    let i = 0, key = "";
    for (; i < line.length; i++) {
      const ch = line[i];
      if (ch === "\\") { key += ch + (line[i + 1] || ""); i++; continue; }
      if (ch === "=" || ch === ":" || ch === " " || ch === "\t") break;
      key += ch;
    }
    out[unesc(key)] = unesc(line.slice(i).replace(/^\s*[=:]?\s*/, ""));
  }
  return out;
}
function zipFind(zip, p) {
  if (!p) return null;
  const a = p.replace(/^\/+/, "");
  let f = zip.file(a);
  if (!f) { try { f = zip.file(decodeURIComponent(a)); } catch (e) { /* ignore */ } }
  if (!f) { const low = a.toLowerCase(); const n = Object.keys(zip.files).find((n) => n.toLowerCase() === low); if (n) f = zip.file(n); }
  return f;
}
const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");

/* ---------- small IndexedDB cache (per device) for extracted model files ---------- */
const IDB = {
  db() {
    return (this._db ||= new Promise((res, rej) => {
      const r = indexedDB.open("ha-3dhome", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("models");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  },
  async get(k) { try { const db = await this.db(); return await new Promise((res) => { const q = db.transaction("models").objectStore("models").get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }); } catch (e) { return null; } },
  async put(k, v) { try { const db = await this.db(); db.transaction("models", "readwrite").objectStore("models").put(v, k); } catch (e) { /* cache is optional */ } },
};
const LIBCACHE = new Map();   // file -> Promise<{sh3fs, items}>
const MODELCACHE = new Map(); // key  -> Promise<{node, size, center, min}>
/* JSON with sorted keys, so configs compare equal whatever order HA builds them in */
const stableJSON = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
/* Cards that HA detached but haven't torn down yet, by dashboard + card_id. HA rebuilds a strategy dashboard's cards
 * whenever its config changes (every editor save), and the new element adopts the parked one instead of starting a
 * second WebGL scene from scratch: same camera, no reload, no flash. */
const PARKED = new Map();
/* every entity id the card config mentions (room_cards excluded: those cards follow hass themselves), plus the sun */
const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
const watchedEntities = (cfg) => {
  const out = new Set([cfg.sun_entity || "sun.sun"]);
  const walk = (v) => {
    if (typeof v === "string") { if (ENTITY_ID.test(v)) out.add(v); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "room_cards") walk(x);
  };
  walk(cfg);
  return [...out];
};
const cardIdent = (cfg) => `${cfg.dashboard || decodeURIComponent(location.pathname.split("/")[1] || "lovelace")}|${cfg.card_id || ""}`;

class Home3DCard extends HTMLElement {
  setConfig(config) {
    if (this._inner) return this._inner.setConfig(config);   // a shell around an adopted card
    // HA hands cards a fresh (but often identical) config whenever it re-renders — e.g. strategy dashboards are
    // regenerated on every entity/device/area registry change. Rebuilding the whole WebGL scene each time leaked
    // contexts, so ignore no-op updates and fully tear down before a real rebuild.
    const json = stableJSON(config || {});
    if (json === this._cfgJSON && (this._ready || this._loading)) return;
    this._cfgJSON = json;
    this._config = config || {};
    this._ident = cardIdent(this._config);
    this._teardown();
    this._kick();
  }
  /* start up, a tick later: HA may attach this card before it detaches the one it replaces, which we'd rather adopt */
  _kick() {
    if (this._kickT || this._inner) return;
    this._kickT = setTimeout(() => {
      this._kickT = null;
      if (!this.isConnected || !this._hass || !this._config || this._ready || this._loading || this._inner) return;
      const old = PARKED.get(this._ident);
      if (old && old !== this && !old.isConnected && old._ready && old._ident === this._ident) {
        PARKED.delete(this._ident); clearTimeout(old._idleT);
        this._inner = old;
        const root = this.shadowRoot || this.attachShadow({ mode: "open" });
        root.innerHTML = "<style>:host { display: block; }</style>";
        root.append(old);
        old.hass = this._hass; old.setConfig(this._config);   // usually identical, so nothing is rebuilt
        return;
      }
      this._loading = true; this._init().catch((e) => this._fail(e));
    }, 0);
  }
  /* release everything the card holds: GPU resources, the WebGL context, listeners, timers */
  _teardown() {
    this._gen = (this._gen || 0) + 1;          // invalidates in-flight async work (_init, model loads)
    if (this._raf) cancelAnimationFrame(this._raf); this._raf = null; this._fly = null; this._focus = null;
    clearTimeout(this._backT); this._backT = null;
    if (this._keys) window.removeEventListener("keydown", this._keys);
    if (this._texListener) document.removeEventListener("ha-3dhome-tex", this._texListener);
    if (this._visListener) document.removeEventListener("visibilitychange", this._visListener);
    if (this._edReady) window.removeEventListener("ha-3dhome-editor-ready", this._edReady);
    this._ro?.disconnect(); this._ro = null;
    for (const hp of this._helpers || []) { this._scene?.remove(hp); hp.dispose?.(); }
    this._helpers = [];
    this._disposePreview?.(); this._plan = false;
    if (this._world) this._disposeWorld();
    for (const t of this._bpTex?.values() || []) t.dispose();
    this._bpTex = null;
    this._world = null;
    try { this._tc?.detach(); this._tc?.dispose(); } catch (e) { /* ignore */ }
    this._tc = null;
    this._controls?.dispose(); this._controls = null;
    for (const m of Object.values(this._mats || {})) m.dispose();
    this._mats = null;
    this._glowTex?.dispose(); this._glowTex = null;
    for (const ps of this._composer?.passes || []) ps.dispose?.();
    this._composer?.dispose(); this._composer = this._aoPass = this._bloomPass = null; this._usePP = false;
    this._lkSig = null; this._bgKey = undefined;
    for (const t of Object.values(this._surfTexs || {})) t.dispose();
    this._surfTexs = null;
    if (this._renderer) {
      this._renderer.renderLists?.dispose();
      this._renderer.dispose();
      this._renderer.forceContextLoss();      // give the context back to the browser now, not at GC time
      this._renderer.domElement.remove();
      this._renderer = null;
    }
    this._rcCache = null; this._camK = null; this._seen = null; this._seenCfg = null;
    if (this._hassRaf) cancelAnimationFrame(this._hassRaf); this._hassRaf = null;
    this._scene = null; this._edit = null; this._work = null; this._ready = false; this._loading = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
  }
  getCardSize() { return 12; }
  getGridOptions() { return { columns: "full", rows: "auto" }; }
  set hass(hass) {
    if (this._inner) { this._inner.hass = hass; return; }
    this._hass = hass;
    if (!this._loading && !this._ready) this._kick();
    // HA hands over a new hass for every state change anywhere in the house, often dozens in a burst. Apply them once
    // per frame (none while the tab is hidden), and redo the scene only when an entity the map shows has changed.
    if (this._ready && !this._hassRaf) this._hassRaf = requestAnimationFrame(() => { this._hassRaf = null; this._applyHass(); });
  }
  _applyHass() {
    const h = this._hass;
    if (!this._ready || !h) return;
    if (this._edit || this._hassChanged(h)) this._update();
    this._rcHass();
    if (this._edBtn) this._edBtn.style.display = h.user?.is_admin && !this._edit && this._enterEdit ? "" : "none";   // Edit shows once the editor module has loaded
  }
  /* → true when anything _update() reads differs from the last applied hass: a watched entity's state object (HA keeps
   * the object of an unchanged entity), the locale or location, or a minute has passed (the sun moves) */
  _hassChanged(h) {
    const seen = this._seen, now = Date.now();
    let changed = !seen || this._seenCfg !== this._cfg() || seen.config !== h.config || seen.locale !== h.locale || seen.user !== h.user || now - seen.at > 60000;
    if (!changed) for (const id of this._watch || []) if (seen.states.get(id) !== h.states[id]) { changed = true; break; }
    if (!changed) return false;
    const cfg = this._cfg();
    if (this._seenCfg !== cfg) { this._watch = watchedEntities(cfg); this._seenCfg = cfg; }
    this._seen = { config: h.config, locale: h.locale, user: h.user, at: now, states: new Map(this._watch.map((id) => [id, h.states[id]])) };
    return true;
  }
  disconnectedCallback() {
    if (this._inner) return;   // the adopted card parks itself
    this._ro?.disconnect();
    // HA detaches cards when you switch views / dashboards and may never reattach this instance:
    // free the GPU after a grace period (unless there are unsaved edits). Meanwhile a replacement card may adopt it.
    if (this._ready && this._ident) PARKED.set(this._ident, this);
    clearTimeout(this._idleT);
    this._idleT = setTimeout(() => {
      if (this.isConnected) return;
      if (PARKED.get(this._ident) === this) PARKED.delete(this._ident);
      if (!this._edit?.dirty) this._teardown();
    }, 30000);
  }
  connectedCallback() {
    if (this._inner) { if (!this._inner.isConnected && this.shadowRoot) this.shadowRoot.append(this._inner); return; }
    clearTimeout(this._idleT);
    if (PARKED.get(this._ident) === this) PARKED.delete(this._ident);
    if (this._ro && this._wrap) this._ro.observe(this._wrap);
    else this._kick();
  }
  _cfg() { return this._work || this._config; }

  _fail(e) {
    console.error("ha-3dhome-card", e);
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `<ha-card><div style="padding:16px">3D map failed to load: ${esc(e && e.message || e)}</div></ha-card>`;
  }

  async _init() {
    const cfg = this._config, gen = this._gen;
    const T = (this.T = await import(cfg.three_url || THREE_URL));
    const { OrbitControls } = await import(cfg.orbit_url || ORBIT_URL);
    if (gen !== this._gen || !this.isConnected) { this._loading = false; return; }   // torn down / detached meanwhile
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        ha-card { overflow: hidden; background: var(--ha-3dhome-bg, var(--iso-bg, #1b1a18)); ${cfg.fill ? "border-radius: 0; border: 0;" : ""} }
        .wrap { position: relative; width: 100%; container-type: inline-size; touch-action: none; font-family: var(--ha-font-family-body, system-ui);
          ${cfg.fill ? "height: calc(100vh - var(--header-height, 56px) - env(safe-area-inset-top, 0px)); min-height: 360px;" : `aspect-ratio: ${cfg.aspect_ratio || "16 / 10"};`} }
        canvas { display: block; width: 100% !important; height: 100% !important; }
        .ov { position: absolute; inset: 0; pointer-events: none; }
        .editing .ov { opacity: .45; } .editing .ov * { pointer-events: none !important; }
        .chip { position: absolute; transform: translate(-50%,-50%); display: flex; gap: .55em; align-items: center; pointer-events: auto;
          padding: .28em .7em; border-radius: 999px; background: rgba(20,18,16,.72); color: #f2ebe0; cursor: pointer; user-select: none;
          font: 500 max(9px, 1.1cqw)/1.2 var(--ha-font-family-body, system-ui); white-space: nowrap; border: 1px solid rgba(255,255,255,.08); }
        .chip ha-icon { --mdc-icon-size: 1.15em; opacity: .85; }
        .chip .occ { color: #ffd27a; } .chip .item { display: inline-flex; gap: .2em; align-items: center; }
        .door { position: absolute; transform: translate(-50%,-50%); width: max(14px,1.8cqw); height: max(14px,1.8cqw); pointer-events: auto;
          border-radius: 50%; display: grid; place-items: center; cursor: pointer; color: #fff; }
        .door ha-icon { --mdc-icon-size: 70%; }
        .door.open { background: #c2483d; box-shadow: 0 0 0 3px rgba(194,72,61,.3); } .door.closed { background: rgba(40,90,60,.85); }
        .weather { position: absolute; left: 2.5%; top: 3.5%; color: #f2ebe0; pointer-events: auto;
          display: grid; grid-template-columns: auto auto; column-gap: .6em; align-items: center; cursor: pointer; }
        .weather ha-icon { --mdc-icon-size: max(26px, 4cqw); color: #f5d27a; grid-row: span 2; }
        .weather .t { font-size: max(18px, 3.2cqw); font-weight: 600; line-height: 1; } .weather .s { font-size: max(9px, 1.1cqw); opacity: .8; }
        .pill, .bar button, .insp button, .lib button { background: rgba(20,18,16,.78); color: #f2ebe0; border: 1px solid rgba(255,255,255,.12);
          border-radius: 999px; padding: .38em .85em; font: 500 12px var(--ha-font-family-body, system-ui); cursor: pointer; white-space: nowrap; }
        .nav { position: absolute; right: 12px; bottom: 12px; display: flex; gap: 2px; padding: 3px; border-radius: 999px;
          background: rgba(20,18,16,.72); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(6px); }
        .nav button { background: none; border: 0; color: #f2ebe0; min-width: 32px; height: 32px; border-radius: 999px; cursor: pointer;
          font: 500 15px/1 var(--ha-font-family-body, system-ui); padding: 0 8px; }
        .nav button:hover { background: rgba(255,255,255,.1); } .nav button.on { background: #f2c76b; color: #1b1a18; }
        .nav .edbtn { font-size: 12px; border-left: 1px solid rgba(255,255,255,.12); border-radius: 0 999px 999px 0; padding: 0 12px; }
        .rooms { position: absolute; left: 12px; bottom: 12px; right: 290px; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none;
          mask-image: linear-gradient(90deg, #000 85%, transparent); padding-right: 24px; }
        .rooms::-webkit-scrollbar { display: none; }
        .rooms button { flex: none; background: rgba(20,18,16,.72); color: #f2ebe0; border: 1px solid rgba(255,255,255,.1); border-radius: 999px;
          padding: 7px 12px; font: 500 12px var(--ha-font-family-body, system-ui); cursor: pointer; backdrop-filter: blur(6px); }
        .rooms button:hover { background: rgba(60,54,46,.9); }
        .rooms button.on { background: #f2c76b; color: #1b1a18; border-color: #f2c76b; }
        @container (max-width: 640px) { .rooms { right: 12px; bottom: 58px; } }
        .bar button:hover, .insp button:hover, .lib button:hover, .pill:hover { background: rgba(60,54,46,.9); }
        .bar button.on { background: #f2c76b; color: #1b1a18; border-color: #f2c76b; }
        .bar button.primary, .lib button.primary { background: #3f7d5a; border-color: #4f9a6f; }
        .bar button:disabled, .insp button:disabled { opacity: .4; cursor: default; }
        .bar { position: absolute; left: 0; right: 0; margin: 0 auto; width: max-content; top: 10px; display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
          max-width: calc(100% - 20px); padding: 6px; border-radius: 16px; background: rgba(12,11,10,.55); backdrop-filter: blur(6px); }
        .bar .sep { width: 1px; background: rgba(255,255,255,.15); margin: 2px 2px; }
        .bar .top, .bar .tools { display: contents; } .bar .tools > * { order: 1; }
        .bar .acts { order: 2; display: inline-flex; gap: 6px; padding-left: 8px; border-left: 1px solid rgba(255,255,255,.15); }
        .bar [data-m] ha-icon:last-child { --mdc-icon-size: 14px; margin-left: -3px; opacity: .7; }
        .bar [data-m].open { background: rgba(60,54,46,.9); }
        .pop { z-index: 7; min-width: 190px; box-shadow: 0 10px 30px rgba(0,0,0,.45); }
        .pop button { background: none; color: #f2ebe0; border: 0; padding: 8px 10px; font: 500 13px var(--ha-font-family-body, system-ui); cursor: pointer; white-space: nowrap; }
        .bar button, .pop button { -webkit-tap-highlight-color: transparent; }
        .pop button:hover { background: rgba(255,255,255,.08); } .pop button.on { background: #f2c76b; color: #1b1a18; }
        .pop button:disabled { opacity: .4; cursor: default; background: none; }
        .menu { position: absolute; z-index: 5; display: grid; gap: 4px; padding: 6px; border-radius: 12px; background: #24211d; border: 1px solid rgba(255,255,255,.12); }
        .menu button { border-radius: 8px; text-align: left; }
        .insp { position: absolute; left: 10px; top: 112px; width: min(290px, 46%); max-height: calc(100% - 180px); overflow: auto; color: #f2ebe0;
          background: rgba(12,11,10,.78); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; padding: 10px 12px; font-size: 12px; }
        .insp h4 { margin: 0 0 6px; font-size: 13px; font-weight: 600; } .insp .sub { opacity: .65; margin-bottom: 8px; }
        .insp .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 8px; }
        .insp label { display: grid; gap: 2px; font-size: 10px; opacity: .85; text-transform: uppercase; letter-spacing: .04em; }
        .insp input, .insp textarea, .lib input, .lib select { background: #11100e; color: #f2ebe0; border: 1px solid rgba(255,255,255,.15); border-radius: 6px;
          padding: 4px 6px; font: 12px ui-monospace, monospace; min-width: 0; width: 100%; box-sizing: border-box; }
        .insp input[type=color] { padding: 0; height: 24px; }
        .insp textarea { height: 110px; resize: vertical; }
        .insp .row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
        .insp .credit { margin-top: 8px; opacity: .7; font-size: 11px; }
        .toast { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); background: rgba(12,11,10,.85); color: #f2ebe0; padding: 6px 12px;
          border-radius: 999px; font-size: 12px; pointer-events: none; transition: opacity .3s; }
        .lib { position: absolute; inset: 3%; z-index: 6; display: flex; flex-direction: column; background: #1f1d1a; color: #f2ebe0; border-radius: 16px;
          border: 1px solid rgba(255,255,255,.12); box-shadow: 0 10px 40px rgba(0,0,0,.5); font-size: 13px; overflow: hidden; }
        .lib header { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .lib header .ttl { font-weight: 600; flex: 1; }
        .lib .body { flex: 1; overflow: auto; padding: 10px 12px; }
        .lib .libs { display: grid; gap: 6px; }
        .lib .librow { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.04); }
        .lib .librow .meta { opacity: .65; font-size: 11px; }
        .lib .tools { display: flex; gap: 8px; } .lib .tools input { flex: 1; } .lib .tools select { width: auto; }
        .lib .items { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; margin-top: 10px; }
        .lib .it { background: rgba(255,255,255,.05); border-radius: 10px; padding: 6px; cursor: pointer; text-align: center; font-size: 11px; border: 1px solid transparent; }
        .lib .it:hover { border-color: #f2c76b; }
        .lib .it img { width: 100%; aspect-ratio: 1; object-fit: contain; background: #f4f1ea; border-radius: 6px; }
        .lib .it .n { margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .lib .note { opacity: .7; font-size: 11px; margin: 8px 0; line-height: 1.4; }
        .chip.act ha-icon { color: #ffd27a; opacity: 1; }
        .lookp { position: absolute; right: 10px; top: 112px; width: min(260px, calc(100% - 20px)); box-sizing: border-box; display: grid; gap: 10px; padding: 0 12px 12px; color: #f2ebe0;
          background: rgba(12,11,10,.86); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; font-size: 12px; z-index: 4; max-height: calc(100% - 122px); overflow-y: auto; }
        .lookp header { display: flex; align-items: center; margin: 0 -12px; padding: 8px 10px 8px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .lookp header .ttl { flex: 1; font-weight: 600; font-size: 13px; }
        .lookp header button { background: rgba(255,255,255,.06); color: #f2ebe0; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; padding: 4px 10px; cursor: pointer; }
        .lookp label { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; }
        .lookp .n { font-weight: 600; } .lookp output { opacity: .75; font-variant-numeric: tabular-nums; }
        .lookp input { grid-column: 1 / -1; width: 100%; margin: 2px 0; accent-color: #f2c76b; }
        .lookp .d { grid-column: 1 / -1; opacity: .6; font-size: 11px; }
        .lookp .idle { display: grid; gap: 6px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.08); }
        .lookp select { width: 100%; box-sizing: border-box; background: rgba(255,255,255,.06); color: #f2ebe0; border: 1px solid rgba(255,255,255,.14); border-radius: 8px; padding: 6px 8px; font: inherit; }
        .lookp select option { background: #2a2622; color: #f2ebe0; }
        .lookp select:disabled { opacity: .45; }
        .ltune { margin: 0 0 8px; } .ltune summary { cursor: pointer; opacity: .85; margin-bottom: 6px; }
        .ltune label { text-transform: none; letter-spacing: normal; font-size: 12px; display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center; margin-bottom: 6px; }
        .ltune .n { font-weight: 600; } .ltune output { opacity: .75; font-variant-numeric: tabular-nums; }
        .ltune input { grid-column: 1 / -1; width: 100%; margin: 2px 0; accent-color: #f2c76b; }
        .ltune .d { grid-column: 1 / -1; opacity: .6; font-size: 11px; }
        .ents { position: absolute; right: 10px; top: 112px; bottom: 64px; width: min(300px, 44%); display: flex; flex-direction: column; color: #f2ebe0;
          background: rgba(12,11,10,.86); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; font-size: 12px; overflow: hidden; z-index: 4; }
        .ents header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .ents header .ttl { flex: 1; font-weight: 600; font-size: 13px; }
        .ents button { background: rgba(255,255,255,.06); color: #f2ebe0; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; padding: 4px 10px;
          font: 500 11.5px var(--ha-font-family-body, system-ui); cursor: pointer; }
        .ents button.on { background: #f2c76b; color: #1b1a18; border-color: #f2c76b; }
        .ents .quick, .ents .doms { display: flex; gap: 5px; flex-wrap: wrap; padding: 8px 10px 0; }
        .ents input { margin: 8px 10px 0; width: calc(100% - 20px); box-sizing: border-box; background: #11100e; color: #f2ebe0; border: 1px solid rgba(255,255,255,.15);
          border-radius: 8px; padding: 6px 8px; font: 12px var(--ha-font-family-body, system-ui); }
        .ents .list { flex: 1; overflow: auto; padding: 6px 6px 10px; margin-top: 6px; }
        .ents .erow { display: grid; grid-template-columns: 22px 1fr auto; gap: 8px; align-items: center; padding: 6px 6px; border-radius: 8px; cursor: grab;
          user-select: none; touch-action: none; }
        .ents .erow:hover { background: rgba(255,255,255,.07); }
        .ents .list { touch-action: pan-y; overscroll-behavior: contain; } @media (pointer: coarse) { .ents .erow { touch-action: pan-y; cursor: pointer; } }
        .ents .erow ha-icon { --mdc-icon-size: 18px; opacity: .85; } .ents .erow.act ha-icon { color: #ffd27a; opacity: 1; }
        .ents .erow .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ents .erow .id { opacity: .5; font-size: 10.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ents .erow .ok { color: #6fd39a; font-size: 11px; }
        .ents .hint { padding: 6px 10px 0; opacity: .6; font-size: 11px; }
        .ghost { position: absolute; z-index: 9; pointer-events: none; transform: translate(-50%, -130%); background: #f2c76b; color: #1b1a18;
          padding: 5px 10px; border-radius: 999px; font: 600 12px var(--ha-font-family-body, system-ui); white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,.4); }
        .ghost.off { background: rgba(20,18,16,.85); color: #f2ebe0; }
        .insp select { background: #11100e; color: #f2ebe0; border: 1px solid rgba(255,255,255,.15); border-radius: 6px; padding: 4px 6px; font: 12px var(--ha-font-family-body, system-ui); }
        .insp h4 { cursor: pointer; display: flex; gap: 6px; align-items: center; } .insp h4 .tw { margin-left: auto; opacity: .55; font-size: 11px; }
        .insp.min > :not(h4) { display: none; } .insp.min h4 { margin: 0; }
        .insp details.tips summary { cursor: pointer; opacity: .7; margin-top: 4px; }
        @container (max-width: 640px) {
          .bar { left: 8px; right: 8px; width: auto; transform: none; max-width: none; flex-direction: column; flex-wrap: nowrap; padding: 4px; border-radius: 12px; gap: 4px; }
          .bar .top { display: flex; justify-content: space-between; gap: 4px; }
          .bar .acts { display: flex; gap: 4px; padding-left: 0; border-left: 0; }
          .bar .tools { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; } .bar .tools::-webkit-scrollbar { display: none; }
          .bar button { flex: none; padding: .5em .7em; font-size: 13px; }
          .bar .ico .lbl, .bar .modes button:not(.on) .lbl { display: none; }
          .insp { top: auto; bottom: 108px; left: 8px; right: 8px; width: auto; max-height: 32%; padding: 8px 10px; }
          .ents { top: auto; bottom: 108px; left: 8px; right: 8px; width: auto; height: 60%; }
          .ents .doms { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; } .ents .doms::-webkit-scrollbar { display: none; } .ents .doms button { flex: none; }
          .weather { display: none; }
        }
        .bar .seg { display: inline-flex; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; overflow: hidden; flex: none; }
        .bar .seg button { border: 0; border-radius: 0; }
        .plan .ov { display: none; }
        .rlabels { position: absolute; inset: 0; pointer-events: none; }
        .rlabel { position: absolute; transform: translate(-50%, -50%); display: grid; text-align: center; padding: 3px 9px; border-radius: 10px;
          background: rgba(255,255,255,.72); color: #1b1a18; font: 600 11px/1.25 var(--ha-font-family-body, system-ui); white-space: nowrap; }
        .rlabel small { font-weight: 500; opacity: .65; font-size: 10px; }
        @container (max-width: 640px) { .rlabel { font-size: 10px; padding: 2px 6px; } .rlabel small { display: none; } }
        .editing .toast { bottom: 62px; }
        @container (max-width: 640px) { .editing .toast { bottom: auto; top: 96px; max-width: calc(100% - 32px); white-space: normal; text-align: center; } }
        .tool canvas { cursor: crosshair !important; }
        .tip { position: absolute; z-index: 8; pointer-events: none; transform: translate(14px, -140%); background: #f2c76b; color: #1b1a18;
          padding: 3px 9px; border-radius: 999px; font: 600 12px var(--ha-font-family-body, system-ui); white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
        .xf { display: grid; grid-template-columns: 54px repeat(3, minmax(0, 1fr)); gap: 4px 5px; align-items: center; margin-bottom: 5px; }
        .xf > b { font-size: 11px; font-weight: 600; opacity: .85; } .xf > b button { font-size: 10px; padding: 0 4px; margin-left: 2px; }
        .insp .xf label { display: flex; align-items: center; gap: 3px; text-transform: none; letter-spacing: 0; font-size: 11px; }
        .xf label i { font-style: normal; font-weight: 700; width: 9px; } .xf .ax-x i { color: #ef6b5b; } .xf .ax-y i { color: #6fd39a; } .xf .ax-z i { color: #5aa9ff; }
        .xf input { min-width: 0; width: 100%; } .xf input:disabled { opacity: .3; }
        .insp label.chk { display: flex; gap: 8px; align-items: center; text-transform: none; letter-spacing: 0; font-size: 12px; margin: 4px 0; }
        .insp label.chk input { width: auto; }
        .insp input[type=range] { padding: 0; accent-color: #f2c76b; }
        .insp .row .primary, .insp button.primary { background: #3f7d5a; border-color: #4f9a6f; }
        .rcards { position: absolute; right: 10px; top: 10px; width: min(340px, 42%); max-height: calc(100% - 76px); display: flex; flex-direction: column;
          z-index: 3; color: #f2ebe0; font-family: var(--ha-font-family-body, system-ui); }
        .rcards header { flex: none; display: flex; align-items: center; gap: 6px; align-self: flex-end; margin-bottom: 6px; padding: 4px 4px 4px 12px; border-radius: 999px;
          background: rgba(20,18,16,.72); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(6px); font: 600 12px var(--ha-font-family-body, system-ui); cursor: pointer; user-select: none; }
        .rcards header button { background: none; border: 0; color: inherit; width: 24px; height: 24px; border-radius: 999px; cursor: pointer; font: 600 13px/1 var(--ha-font-family-body, system-ui); }
        .rcards header button:hover { background: rgba(255,255,255,.1); }
        .rcards .rcbody { overflow: auto; display: flex; flex-direction: column; gap: 8px; touch-action: pan-y; overscroll-behavior: contain; scrollbar-width: thin; border-radius: var(--ha-card-border-radius, 12px); }
        .rcards .rcbody > * { flex: none; }
        /* Room controls keep the map's dark palette whatever the HA theme: a light theme's dark text on pale cards is unreadable here.
         * Theme variables inherit into the cards' shadow DOM, so redefining them here restyles built-in and most custom cards. */
        .rcards .rcbody, .rcp .rcprev { color-scheme: dark; color: #f2ebe0;
          --primary-text-color: #f2ebe0; --secondary-text-color: rgba(242,235,224,.68); --disabled-text-color: rgba(242,235,224,.38); --text-primary-color: #f2ebe0;
          --rgb-primary-text-color: 242, 235, 224; --rgb-secondary-text-color: 242, 235, 224; --rgb-card-background-color: 28, 26, 23;
          --card-background-color: rgba(28,26,23,.86); --ha-card-background: rgba(28,26,23,.86); --primary-background-color: #1b1a18; --secondary-background-color: #24211d;
          --ha-card-border-color: rgba(255,255,255,.1); --ha-card-border-width: 1px; --ha-card-box-shadow: 0 4px 16px rgba(0,0,0,.35); --divider-color: rgba(255,255,255,.12);
          --state-icon-color: rgba(242,235,224,.8); --paper-item-icon-color: rgba(242,235,224,.8); --state-inactive-color: rgba(242,235,224,.55);
          --mdc-theme-surface: #24211d; --mdc-theme-text-primary-on-background: #f2ebe0; --mdc-theme-on-surface: #f2ebe0; --mdc-dialog-content-ink-color: #f2ebe0;
          --input-fill-color: rgba(255,255,255,.06); --input-ink-color: #f2ebe0; --input-label-ink-color: rgba(242,235,224,.68); --slider-track-color: rgba(255,255,255,.2);
          --ha-color-text-primary: #f2ebe0; --ha-color-text-secondary: rgba(242,235,224,.68); --ha-color-surface-default: #1b1a18; --ha-color-surface-low: #24211d;
          --ha-color-fill-neutral-quiet-resting: rgba(255,255,255,.06); --ha-color-fill-neutral-normal-resting: rgba(255,255,255,.1); --ha-color-border-neutral-quiet: rgba(255,255,255,.1); }
        .rcards .rcbody > *, .rcp .rcprev > * { backdrop-filter: blur(6px); border-radius: var(--ha-card-border-radius, 12px); }
        .rcards.min .rcbody { display: none; }
        .editing .rcards { display: none; }
        @container (max-width: 640px) { .rcards { left: 8px; right: 8px; top: 8px; width: auto; max-height: 44%; } }
        .rcp { position: absolute; right: 10px; top: 112px; bottom: 64px; width: min(320px, 46%); display: flex; flex-direction: column; color: #f2ebe0; z-index: 4;
          background: rgba(12,11,10,.9); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,.1); border-radius: 14px; font-size: 12px; overflow: hidden; }
        .rcp header { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.08); }
        .rcp header .ttl { flex: 1; font-weight: 600; font-size: 13px; }
        .rcp button { background: rgba(255,255,255,.06); color: #f2ebe0; border: 1px solid rgba(255,255,255,.12); border-radius: 999px; padding: 4px 10px;
          font: 500 11.5px var(--ha-font-family-body, system-ui); cursor: pointer; }
        .rcp button:disabled { opacity: .35; cursor: default; } .rcp button.primary { background: #3f7d5a; border-color: #4f9a6f; }
        .rcp .rcb { flex: 1; overflow: auto; padding: 8px 10px 12px; display: flex; flex-direction: column; gap: 8px; touch-action: pan-y; }
        .rcp select, .rcp input, .rcp textarea { background: #11100e; color: #f2ebe0; border: 1px solid rgba(255,255,255,.15); border-radius: 8px; padding: 6px 8px;
          font: 12px var(--ha-font-family-body, system-ui); box-sizing: border-box; width: 100%; min-width: 0; }
        .rcp textarea { height: 160px; resize: vertical; font: 11.5px ui-monospace, monospace; }
        .rcp .hint { opacity: .6; font-size: 11px; line-height: 1.35; }
        .rcp .rcadd { display: flex; gap: 6px; flex-wrap: wrap; } .rcp .rcadd input { flex: 1; width: auto; }
        .rcp .rccode { display: grid; gap: 6px; }
        .rcp .rcl { display: grid; gap: 4px; }
        .rcp .rcrow { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 8px; background: rgba(255,255,255,.05); }
        .rcp .rcrow .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } .rcp .rcrow .id { opacity: .5; font-size: 10.5px; }
        .rcp .rcrow button { padding: 2px 7px; margin-left: 2px; }
        .rcp .rcprev { display: flex; flex-direction: column; gap: 8px; }
        @container (max-width: 640px) { .rcp { top: auto; bottom: 108px; left: 8px; right: 8px; width: auto; height: 52%; } }
        .nav button, .bar button, .insp button, .lib button, .ents button, .rcp button, .menu button, .rooms button, .lookp header button, .rcards header button {
          display: inline-flex; align-items: center; justify-content: center; gap: .4em; }
        .menu button { justify-content: flex-start; }
        :is(.bar, .insp, .lib, .ents, .rcp, .menu, .rooms, .lookp, .rcards) button ha-icon { --mdc-icon-size: 16px; flex: none; }
        .nav button ha-icon { --mdc-icon-size: 18px; } .nav .edbtn ha-icon { --mdc-icon-size: 15px; }
        .ents .erow .ok { display: inline-flex; align-items: center; gap: 2px; } .ents .erow .ok ha-icon { --mdc-icon-size: 14px; }
        .insp h4 .tw ha-icon { --mdc-icon-size: 16px; transition: transform .15s; } .insp.min h4 .tw ha-icon { transform: rotate(-90deg); }
        .empty { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(360px, calc(100% - 32px)); box-sizing: border-box; z-index: 2;
          display: grid; gap: 6px; padding: 16px 18px; border-radius: 14px; text-align: center; pointer-events: none; color: #f2ebe0;
          background: rgba(20,18,16,.78); border: 1px solid rgba(255,255,255,.1); backdrop-filter: blur(6px); font: 13px/1.45 var(--ha-font-family-body, system-ui); }
        .empty b { font-size: 15px; } .empty span { opacity: .8; } .empty ha-icon { --mdc-icon-size: 14px; margin: 0 2px 0 4px; }
        .hide { display: none !important; }
      </style>
      <ha-card><div class="wrap"><div class="ov"></div><div class="ed"></div>
        <div class="rooms"></div><div class="rcards hide"><header><span class="ttl"></span><button data-m title="Hide controls">${ic("chevron-up")}</button></header><div class="rcbody"></div></div>
        <div class="nav">
          <button data-v="left" title="Rotate view left">${ic("rotate-left")}</button><button data-v="right" title="Rotate view right">${ic("rotate-right")}</button>
          <button data-v="top" title="Top-down / angled">${ic("floor-plan")}</button><button data-v="out" title="Zoom out">${ic("minus")}</button><button data-v="in" title="Zoom in">${ic("plus")}</button>
          <button data-v="home" title="Whole home">${ic("home-outline")}</button><button class="edbtn" style="display:none" title="Edit the map">${ic("pencil-outline")}Edit</button>
        </div></div></ha-card>`;
    const wrap = (this._wrap = root.querySelector(".wrap"));
    this._ov = root.querySelector(".ov");
    this._ed = root.querySelector(".ed");
    this._edBtn = root.querySelector(".edbtn");
    this._edBtn.addEventListener("click", () => this._enterEdit?.());

    const renderer = (this._renderer = new T.WebGLRenderer({ antialias: true, alpha: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.max_pixel_ratio || 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = cfg.shadows !== false;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    wrap.prepend(renderer.domElement);

    this._scene = new T.Scene();
    const cam = (this._cam = new T.OrthographicCamera(-1, 1, 1, -1, -2000, 4000));
    this._home = { pos: new T.Vector3(330, 360, 330), target: new T.Vector3(-10, 5, -10), zoom: 1 };
    cam.position.copy(this._home.pos); cam.lookAt(this._home.target);
    this._homeSph = new T.Spherical().setFromVector3(this._home.pos.clone().sub(this._home.target));
    const controls = (this._controls = new OrbitControls(cam, renderer.domElement));
    controls.target.copy(this._home.target);
    controls.enableDamping = true; controls.dampingFactor = 0.14;
    controls.minPolarAngle = 0.02; controls.maxPolarAngle = 1.2;
    controls.minZoom = 0.6; controls.maxZoom = 8;
    controls.screenSpacePanning = false;          // pan glides along the floor, not the screen
    controls.zoomToCursor = true;                 // wheel / pinch zooms toward the pointer
    controls.rotateSpeed = 0.7; controls.panSpeed = 1.1; controls.zoomSpeed = 1.2;
    // map-style: drag pans, right-drag (or Ctrl/Shift-drag) rotates; touch: one finger pans, two pinch + twist
    controls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE };
    controls.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE };
    // three r160's OrbitControls reports a change on every update() for an orthographic camera (it always flags the zoom),
    // which kept the render loop spinning at full frame rate forever. Only a real camera move counts (_camMoved).
    controls.addEventListener("change", () => {
      this._clampPan();
      if (!this._camMoved()) return;
      this._camMv = true; this._syncNav();
      const f = this._focus, t = controls.target;
      if (f && !this._fly) {   // panning well away from the framed room ends the see-through view
        const [x1, x2, y1, y2] = f.room.rect, x = t.x + CX, y = t.z + CY, M = 40;
        if (x < x1 - M || x > x2 + M || y < y1 - M || y > y2 + M) this._setFocus(null);
      }
      this._requestRender();
    });
    controls.addEventListener("start", () => { this._fly = null; this._moved = true; this._setActiveRoom(null); });
    const nav = root.querySelector(".nav");
    nav.addEventListener("click", (ev) => {
      const a = ev.target.closest("button")?.dataset.v; if (!a) return;
      if (a !== "home") this._moved = true;
      if (a === "home") this._focusRoom(null);
      else if (a === "left" || a === "right") this._orbitBy(a === "left" ? -Math.PI / 2 : Math.PI / 2);
      else if (a === "top") this._toggleTop();
      else if (a === "in" || a === "out") this._flyTo({ zoom: cam.zoom * (a === "in" ? 1.4 : 1 / 1.4) }, 250);
    });
    this._buildRoomBar();
    root.querySelector(".rcards header").addEventListener("click", () => {   // open/collapse the controls, then re-frame the view for the new space
      this._rcMin = !this._rcMin; this._showRoomCards(this._rcRoom);
      this._fitRoom = this._rcRoom === "home" ? null : this._rooms().find((r) => r.name === this._rcRoom) || null;
      this._moved = false; this._setActiveRoom(this._fitRoom ? this._fitRoom.name : "");
      requestAnimationFrame(() => { if (this._renderer) { this._applyOffset(); this._frame(this._fitRoom, 450); this._requestRender(); } });
    });
    this._showRoomCards("home");
    this._setActiveRoom("");   // the whole-home view is where it starts
    this._idleKick = () => this._armIdle();   // any touch, click, wheel or key restarts the idle countdown
    for (const t of ["pointerdown", "wheel", "keydown"]) wrap.addEventListener(t, this._idleKick, { capture: true, passive: true });
    renderer.domElement.addEventListener("dblclick", (ev) => { if (!this._edit) { const r = this._roomAt(ev); if (r) this._focusRoom(r); } });
    renderer.domElement.addEventListener("contextmenu", (ev) => ev.preventDefault());
    this._texListener = () => this._renderer && this._requestRender();
    document.addEventListener("ha-3dhome-tex", this._texListener);
    this._visListener = () => { if (!document.hidden && this._renderer) this._requestRender(); };
    document.addEventListener("visibilitychange", this._visListener);
    this._rebuild();
    this._bindPicking();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(wrap);
    this._ro.observe(root.querySelector(".rcards"));   // the room controls resizing moves the safe area (see _safeArea)
    this._resize();
    this._ready = true;
    this._update();
    if (this._hass?.user?.is_admin && this._enterEdit) this._edBtn.style.display = "";
    this._edReady = () => { if (this._edBtn && this._hass?.user?.is_admin && !this._edit) this._edBtn.style.display = ""; };
    window.addEventListener("ha-3dhome-editor-ready", this._edReady);
  }

  _resize() {
    const w = this._wrap.clientWidth, h = this._wrap.clientHeight;
    if (!w || !h) return;
    this._renderer.setSize(w, h, false);
    this._composer?.setPixelRatio(this._renderer.getPixelRatio()); this._composer?.setSize(w, h);
    const span = this._config.view_size || 375, a = w / h;
    const c = this._cam;
    if (a >= 1.6) { c.top = span / 1.6; c.bottom = -span / 1.6; c.left = -c.top * a; c.right = c.top * a; }
    else { c.left = -span; c.right = span; c.top = span / a; c.bottom = -span / a; }
    this._applyOffset();
    if (this._moved || this._edit) { /* the view is the user's own: leave it */ }
    else if (this._fitRoom || this._fly) this._frame(this._fitRoom || null, 350);   // the safe area changed (room cards loaded, resize): re-frame
    else {   // nobody has moved the view yet: the whole home, as big as fits in the safe area
      const v = this._homeView(), oc = this._controls;
      oc.target.copy(v.target); c.position.setFromSpherical(this._homeSph).add(v.target); c.lookAt(v.target);
      c.zoom = v.zoom; c.updateProjectionMatrix();
    }
    this._requestRender();
  }
  /* The part of the card the controls leave clear, in px of the wrap: above the room bar and nav, and below the room cards
   * on a phone (they span the top) or beside them on a wide screen, whichever is bigger. Collapsed cards leave the full width. */
  _safeArea() {
    const wr = this._wrap.getBoundingClientRect(), w = this._wrap.clientWidth, h = this._wrap.clientHeight, M = 8;
    const rel = (el) => { const r = el && !el.classList.contains("hide") ? el.getBoundingClientRect() : null; return r?.width && r?.height ? r : null; };
    // the room bar and the nav buttons along the bottom: the view stops above the higher of them
    const bars = [".rooms", ".nav"].map((q) => rel(this.shadowRoot?.querySelector(q))).filter(Boolean);
    const bottom = bars.length ? Math.max(h * 0.6, Math.min(...bars.map((r) => r.top - wr.top)) - M) : h;
    const full = { x: 0, y: 0, w, h: bottom };
    const box = this.shadowRoot?.querySelector(".rcards");
    if (!box || box.classList.contains("min") || this._edit) return full;
    const r = rel(box);
    if (!r) return full;
    const top = r.bottom - wr.top + M, below = bottom - top, left = r.left - wr.left - M;
    if (below * w >= left * bottom) return below > h * 0.25 ? { x: 0, y: top, w, h: below } : full;
    return left > w * 0.3 ? { x: 0, y: 0, w: left, h: bottom } : full;
  }
  /* Centre the view in the safe area: a camera view offset shifts the whole picture, so everything that centres on the orbit
   * target (Home, room buttons, zoom) lands in the middle of the clear part. _requestRender eases it in when the area changes. */
  _applyOffset() {
    const w = this._wrap.clientWidth, h = this._wrap.clientHeight, s = this._safeArea();
    this._voT = [w / 2 - (s.x + s.w / 2), h / 2 - (s.y + s.h / 2)];
    if (!this._vo) this._vo = [...this._voT];
    this._setOffset();
  }
  _setOffset() {
    const cam = this._cam, w = this._wrap.clientWidth, h = this._wrap.clientHeight, [x, y] = this._vo;
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) cam.clearViewOffset(); else cam.setViewOffset(w, h, x, y, w, h);
  }
  _stepOffset() {   // → true while still easing
    const a = this._vo, b = this._voT;
    if (!a || !b || (a[0] === b[0] && a[1] === b[1])) return false;
    for (const i of [0, 1]) a[i] = Math.abs(b[i] - a[i]) < 0.5 ? b[i] : a[i] + (b[i] - a[i]) * 0.2;
    this._setOffset();
    return true;
  }
  /* the home view: the whole house (its floors, walls' height and lights) as large as fits in the safe area, from the home angle.
   * The camera is orthographic, so the box's centre projects to the centre of its outline and can be the orbit target. */
  _homeView() {
    const T = this.T, cfg = this._cfg(), sc = cfg.scene || {}, w = this._wrap.clientWidth || 1, h = this._wrap.clientHeight || 1, s = this._safeArea();
    const pts = [...(sc.floors || []).flatMap((f) => f.pts || []), ...(cfg.lights || []).filter((L) => L.x != null).map((L) => [L.x, L.y])];
    if (!pts.length) return { target: this._home.target.clone(), zoom: this._home.zoom };
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), H = sc.wall_height ?? 46;
    const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const target = new T.Vector3((x1 + x2) / 2 - CX, H / 2, (y1 + y2) / 2 - CY);
    const probe = this._cam.clone(); probe.clearViewOffset(); probe.zoom = 1; probe.updateProjectionMatrix();
    probe.position.setFromSpherical(this._homeSph).add(target); probe.lookAt(target); probe.updateMatrixWorld(true);
    let ex = 0, ey = 0;
    for (const x of [x1, x2]) for (const y of [y1, y2]) for (const z of [0, H]) {
      const v = new T.Vector3(x - CX, z, y - CY).project(probe); ex = Math.max(ex, Math.abs(v.x)); ey = Math.max(ey, Math.abs(v.y));
    }
    const c = this._controls, zoom = 0.96 * Math.min((s.w / w) / (ex || 1), (s.h / h) / (ey || 1));
    return { target, zoom: Math.min(c.maxZoom, Math.max(c.minZoom, zoom)) };
  }

  _requestRender() {
    if (this._raf || !this._renderer || document.hidden) return;   // hidden tab: render once it's visible again
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      if (!this._renderer) return;
      this._camMv = false; this._controls.update();   // sets _camMv (via "change") only if the camera really moved
      const moving = this._camMv | this._stepOffset();
      for (const hp of this._helpers || []) hp.update();
      this._scaleHandles();
      this._updateFade();
      if (this._usePP) this._composer.render(); else this._renderer.render(this._scene, this._cam);
      this._placeOverlays();
      if (moving) this._requestRender();
    });
  }

  /* ---------- camera ---------- */
  /* → true when the camera moved, zoomed or retargeted since the last call (same tolerances as OrbitControls) */
  _camMoved() {
    const T = this.T, c = this._cam, t = this._controls.target, k = (this._camK ||= { p: new T.Vector3(), q: new T.Quaternion(), t: new T.Vector3(), z: null });
    const moved = k.z !== c.zoom || k.p.distanceToSquared(c.position) > 1e-6 || 8 * (1 - k.q.dot(c.quaternion)) > 1e-6 || k.t.distanceToSquared(t) > 1e-6;
    if (moved) { k.p.copy(c.position); k.q.copy(c.quaternion); k.t.copy(t); k.z = c.zoom; }
    return moved;
  }
  _clampPan() {
    const t = this._controls.target, b = this._config.pan_bounds || [-340, 340, -240, 240];
    const nx = Math.min(b[1], Math.max(b[0], t.x)), nz = Math.min(b[3], Math.max(b[2], t.z));
    if (nx !== t.x || nz !== t.z) { this._cam.position.x += nx - t.x; this._cam.position.z += nz - t.z; t.x = nx; t.z = nz; }
  }
  _sph() { return new this.T.Spherical().setFromVector3(this._cam.position.clone().sub(this._controls.target)); }
  /* smooth camera move: any of target (Vector3), zoom, theta (azimuth), phi (tilt) */
  _flyTo({ target, zoom, theta, phi }, ms = 650) {
    const T = this.T, c = this._controls, cam = this._cam, s0 = this._sph();
    const t0 = c.target.clone(), t1 = target ? target.clone() : t0.clone(), z0 = cam.zoom;
    const z1 = Math.min(c.maxZoom, Math.max(c.minZoom, zoom ?? z0));
    let th1 = theta ?? s0.theta;
    while (th1 - s0.theta > Math.PI) th1 -= 2 * Math.PI;
    while (th1 - s0.theta < -Math.PI) th1 += 2 * Math.PI;
    const ph1 = Math.min(c.maxPolarAngle, Math.max(c.minPolarAngle, phi ?? s0.phi));
    const fly = (this._fly = {}), start = performance.now(), damp = c.enableDamping;
    c.enableDamping = false;
    const step = (now) => {
      if (this._fly !== fly || !this._renderer) { c.enableDamping = damp; return; }
      const k = Math.min(1, (now - start) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      c.target.lerpVectors(t0, t1, e);
      cam.position.setFromSpherical(new T.Spherical(s0.radius, s0.phi + (ph1 - s0.phi) * e, s0.theta + (th1 - s0.theta) * e)).add(c.target);
      cam.zoom = z0 * Math.pow(z1 / z0, e); cam.updateProjectionMatrix(); cam.lookAt(c.target);
      if (k < 1) requestAnimationFrame(step); else { this._fly = null; c.enableDamping = damp; }
      this._syncNav(); this._requestRender();
    };
    requestAnimationFrame(step);
  }
  _orbitBy(d) { this._flyTo({ theta: this._sph().theta + d }, 450); }
  _toggleTop() {
    const s = this._sph();
    const q = Math.PI / 2;
    if (s.phi > 0.3) { this._lastPhi = s.phi; this._lastTheta = s.theta; this._flyTo({ phi: 0.02, theta: Math.round(s.theta / q) * q }, 550); }
    else this._flyTo({ phi: this._lastPhi || this._homeSph.phi, theta: this._lastTheta ?? s.theta + q / 2 }, 550);
  }
  _syncNav() { this.shadowRoot?.querySelector('.nav [data-v="top"]')?.classList.toggle("on", this._sph().phi < 0.3); }
  _rooms() {
    const floors = this._cfg().scene?.floors || [];
    const title = roomTitle;
    const bbox = (pts) => [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
    const ptsOf = (names) => floors.filter((f) => names.includes(f.name)).flatMap((f) => f.pts);
    if (Array.isArray(this._config.room_menu))
      return this._config.room_menu.map((r) => { const pts = ptsOf(r.floors || [r.name]);
        return { name: r.name, label: r.label || title(r.name), rect: r.rect || (pts.length ? bbox(pts) : null), floors: r.floors || [r.name] }; }).filter((r) => r.rect);
    const skip = new Set(this._config.room_menu_exclude || ["rug", "shower_tub"]);
    const order = ["living", "kitchen", "dining", "bedroom", "office", "bath", "hallway", "balcony", "laundry", "closet"];
    const rank = (n) => { const i = order.indexOf(n); return i < 0 ? 99 : i; };
    return floors.filter((f) => f.name && !skip.has(f.name) && f.menu !== false && f.pts?.length >= 3)
      .map((f) => { const names = f.name === "bath" ? ["bath", "shower_tub"] : [f.name]; return { name: f.name, label: title(f.name), rect: bbox(ptsOf(names)), floors: names }; })
      .sort((a, b) => rank(a.name) - rank(b.name));
  }
  _buildRoomBar() {
    const bar = this.shadowRoot.querySelector(".rooms"); if (!bar) return;
    if (this._config.room_menu === false) { bar.style.display = "none"; return; }
    const rooms = this._rooms();
    bar.innerHTML = `<button data-r="">${ic("home-outline")}Home</button>` + rooms.map((r) => `<button data-r="${esc(r.name)}">${esc(r.label)}</button>`).join("");
    bar.onclick = (ev) => { const b = ev.target.closest("button"); if (!b) return; this._focusRoom(rooms.find((r) => r.name === b.dataset.r) || null); };
  }
  _setActiveRoom(name) { this.shadowRoot?.querySelectorAll(".rooms button").forEach((b) => b.classList.toggle("on", name !== null && b.dataset.r === (name || ""))); }
  _focusRoom(room) {
    const T = this.T;
    this._showRoomCards(room ? room.name : "home");
    this._setFocus(room);
    this._fitRoom = room; this._applyOffset();
    this._frame(room, 700);
    this._setActiveRoom(room ? room.name : "");
    this._moved = false;   // until a hand moves the view, a change in the room controls' size re-frames it (see _resize)
  }
  /* fly to frame a room (or the whole home, room null) inside the safe area, keeping the tilt */
  _frame(room, ms) {
    const T = this.T;
    if (!room) { const v = this._homeView(); this._flyTo({ target: v.target, zoom: v.zoom, theta: this._homeSph.theta, phi: this._homeSph.phi }, ms); return; }
    const [x1, x2, y1, y2] = room.rect, H = this._cfg().scene?.wall_height ?? 46, s = this._sph();
    const target = new T.Vector3((x1 + x2) / 2 - CX, 5, (y1 + y2) / 2 - CY);
    const phi = s.phi < 0.3 ? s.phi : Math.min(Math.max(s.phi, 0.7), 1.0);
    const probe = this._cam.clone(); probe.clearViewOffset(); probe.zoom = 1; probe.updateProjectionMatrix();
    probe.position.setFromSpherical(new T.Spherical(s.radius, phi, s.theta)).add(target); probe.lookAt(target); probe.updateMatrixWorld(true);
    let ex = 0, ey = 0;
    for (const x of [x1, x2]) for (const y of [y1, y2]) for (const z of [0, H]) {
      const v = new T.Vector3(x - CX, z, y - CY).project(probe); ex = Math.max(ex, Math.abs(v.x)); ey = Math.max(ey, Math.abs(v.y));
    }
    const sa = this._safeArea(), fw = sa.w / (this._wrap.clientWidth || 1), fh = sa.h / (this._wrap.clientHeight || 1);
    const zoom = Math.min(0.82 * fw / (ex || 1), 0.72 * fh / (ey || 1));   // fit the room inside the part the controls leave clear
    this._flyTo({ target, zoom, phi }, ms);
  }
  /* Room controls: `room_cards: { home: [card, …], <room name>: [card, …] }` holds ordinary Lovelace card configs, shown top right
   * for the room in view (`home` = the whole-home view). HA's own card helpers build them, so any card a dashboard can show works here.
   * Elements are cached per room and rebuilt only when that room's config changes. */
  _showRoomCards(key) {
    this._rcRoom = key;
    const box = this.shadowRoot?.querySelector(".rcards"); if (!box) return;
    const list = this._config.room_cards?.[key];
    if (!Array.isArray(list) || !list.length) { box.classList.add("hide"); return; }
    const label = key === "home" ? "Home" : this._rooms().find((r) => r.name === key)?.label || roomTitle(key);
    box.querySelector(".ttl").textContent = label;
    const mb = box.querySelector("[data-m]"); mb.innerHTML = ic(this._rcMin ? "chevron-down" : "chevron-up"); mb.title = this._rcMin ? "Show controls" : "Hide controls";
    box.classList.toggle("min", !!this._rcMin); box.classList.remove("hide");
    const body = box.querySelector(".rcbody"), sig = JSON.stringify(list), gen = this._gen;
    const c = (this._rcCache ||= new Map()).get(key);
    if (c?.sig === sig) { if (body.firstChild !== c.els[0] || body.children.length !== c.els.length) body.replaceChildren(...c.els); this._rcHass(); return; }
    body.replaceChildren();
    this._makeCards(list).then((els) => {
      if (gen !== this._gen) return;
      this._rcCache?.set(key, { sig, els });
      if (this._rcRoom === key && this.shadowRoot?.contains(body)) { body.replaceChildren(...els); this._rcHass(); }
    });
  }
  /* build Lovelace card elements; a card whose element isn't defined yet asks to be rebuilt (ll-rebuild) */
  async _makeCards(list) {
    const helpers = await window.loadCardHelpers?.().catch(() => null);
    const make = (conf) => {
      let el;
      try {
        if (helpers) el = helpers.createCardElement(conf);
        else { const t = String(conf.type || ""); el = document.createElement(t.startsWith("custom:") ? t.slice(7) : `hui-${t}-card`); el.setConfig?.(conf); }   // no card helpers (outside HA)
      }
      catch (e) { el = document.createElement("div"); el.textContent = "Card error: " + (e.message || e); }
      if (helpers) el.addEventListener("ll-rebuild", (ev) => { ev.stopPropagation(); const n = make(conf); el.replaceWith(n); n.hass = this._hass; }, { once: true });
      el.hass = this._hass;
      return el;
    };
    return (list || []).filter((c) => c && typeof c === "object").map(make);
  }
  _rcHass() {
    if (!this._hass || !this.shadowRoot) return;
    for (const b of this.shadowRoot.querySelectorAll(".rcards:not(.hide):not(.min) .rcbody, .rcp .rcprev")) for (const el of b.children) el.hass = this._hass;
  }
  /* `idle_view: {room, after}`: after `after` seconds without a touch, fly back to that room ("" or missing = whole home) */
  _armIdle() {
    clearTimeout(this._backT); this._backT = null;
    const s = +this._config?.idle_view?.after;
    if (!(s > 0) || !this._renderer) return;
    this._backT = setTimeout(() => {
      this._backT = null;
      if (!this._renderer) return;
      if (this._edit) return this._armIdle();   // never yank the view away mid-edit
      const name = this._config.idle_view?.room || "";
      this._focusRoom((name && this._rooms().find((r) => r.name === name)) || null);
    }, s * 1000);
  }
  _roomAt(ev) {
    const T = this.T, el = this._renderer.domElement, r = el.getBoundingClientRect(), ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this._cam);
    const hit = ray.intersectObjects(this._floorMeshes || [], false).find((h) => h.object.userData.room && h.object.userData.room !== "rug");
    if (!hit) return null;
    const n = hit.object.userData.room;
    return this._rooms().find((rm) => rm.floors.includes(n)) || null;
  }
  /* See-through room view: while a room is framed, walls and furniture of other rooms that stand between the camera and
   * it fade out. Rays run from a grid of points inside the room towards the camera (orthographic, so they are parallel)
   * and are tested against bounding boxes, per mesh for walls and openings, per item for everything else.
   * Faded meshes get a see-through copy of their material (cached in _fadeMats), still cast shadows, and are restored
   * before the world is disposed. `room_fade: false` turns it off; a number 0–1 sets how much of them stays visible. */
  _setFocus(room) {
    const polys = room ? this._roomPolys(room) : null;
    this._focus = room && polys.length ? { room, polys } : null;
    this._fadeSig = null;
    if (!this._focus) this._clearFade();
    this._requestRender();
  }
  _roomPolys(room) {
    const floors = (this._cfg().scene?.floors || []).filter((f) => room.floors.includes(f.name) && f.pts?.length >= 3).map((f) => f.pts);
    if (floors.length) return floors;
    const [x1, x2, y1, y2] = room.rect || [];
    return room.rect ? [[[x1, y1], [x2, y1], [x2, y2], [x1, y2]]] : [];
  }
  _fadeAmount() { const v = this._config.room_fade; return v === false || this._edit ? null : Math.max(0, Math.min(1, typeof v === "number" ? v : 0.15)); }
  _updateFade() {
    const f = this._focus, a = this._fadeAmount();
    if (!f || a == null || !this._world) { if (this._faded?.size) this._clearFade(); return; }
    const T = this.T, dir = this._cam.position.clone().sub(this._controls.target).normalize();
    const sig = `${dir.x.toFixed(3)},${dir.y.toFixed(3)},${dir.z.toFixed(3)}|${this._fadeGen || 0}`;
    if (sig === this._fadeSig) return;
    this._fadeSig = sig;
    const sc = this._cfg().scene || {}, H = sc.wall_height ?? 46, inset = (sc.wall_thickness ?? 4) + 1;
    const pts = f.polys.flat(), x1 = Math.min(...pts.map((p) => p[0])), x2 = Math.max(...pts.map((p) => p[0]));
    const y1 = Math.min(...pts.map((p) => p[1])), y2 = Math.max(...pts.map((p) => p[1]));
    const inRoom = (x, y) => f.polys.some((pl) => inPoly(x, y, pl));
    // sample points inside the room, kept off its own walls, on the floor and at half height
    const N = 7, samples = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = x1 + inset + ((x2 - x1 - 2 * inset) * i) / N, y = y1 + inset + ((y2 - y1 - 2 * inset) * j) / N;
      if (x2 - x1 > 2 * inset && y2 - y1 > 2 * inset && inRoom(x, y)) for (const z of [2, H * 0.55]) samples.push(new T.Vector3(x - CX, z, y - CY));
    }
    if (!samples.length) samples.push(new T.Vector3((x1 + x2) / 2 - CX, 2, (y1 + y2) / 2 - CY));
    // what can block: walls and openings piece by piece, furniture, models and fixtures as whole items
    const box = new T.Box3(), c = new T.Vector3(), ray = new T.Ray(), hit = new T.Vector3(), want = new Set(), seen = new Set();
    const blocks = (b) => samples.some((s) => { ray.set(s, dir); return ray.intersectBox(b, hit) && !b.containsPoint(s); });
    const piece = (m) => { if (m.isMesh && m.material?.visible !== false && blocks(box.setFromObject(m))) want.add(m); };
    this._world.traverse((m) => { if (m.userData.wall) piece(m); });   // legacy walls have no item key
    for (const [key, g] of this._items) {
      if (seen.has(g) || !"nbov".includes(key[0])) continue;
      seen.add(g);
      if (key[0] === "n") { g.traverse(piece); continue; }
      if (box.setFromObject(g).isEmpty()) continue;
      box.getCenter(c);
      if (inRoom(c.x + CX, c.z + CY) || !blocks(box)) continue;
      g.traverse((m) => { if (m.isMesh) want.add(m); });
    }
    for (const m of this._faded || []) if (!want.has(m)) this._unfadeMesh(m);
    this._faded = want;
    for (const m of want) this._fadeMesh(m, a);
  }
  _fadeMesh(m, a) {
    if (m.userData.fadeOrig) return;
    const orig = m.material, one = (mt) => {
      if (!mt || mt.visible === false || mt.colorWrite === false) return mt;
      const ck = mt.uuid + "|" + a;
      let fm = (this._fadeMats ||= new Map()).get(ck);
      if (!fm) { fm = mt.clone(); fm.transparent = true; fm.opacity = (mt.opacity ?? 1) * a; fm.depthWrite = false; this._fadeMats.set(ck, fm); }
      return fm;
    };
    m.userData.fadeOrig = orig;
    m.material = Array.isArray(orig) ? orig.map(one) : one(orig);
  }
  _unfadeMesh(m) { if (m.userData.fadeOrig) { m.material = m.userData.fadeOrig; delete m.userData.fadeOrig; } }
  _clearFade(free) {   // `free` also drops the see-through materials (world rebuild); otherwise they stay for the next room
    for (const m of this._faded || []) this._unfadeMesh(m);
    this._faded = null; this._fadeSig = null;
    if (free) { for (const fm of this._fadeMats?.values() || []) fm.dispose(); this._fadeMats = null; }   // clones share their originals' textures
    this._requestRender();
  }
  /* plan-axis step that best matches a screen direction (sx right, sy up) */
  _screenDir(sx, sy) {
    const T = this.T, right = new T.Vector3().setFromMatrixColumn(this._cam.matrixWorld, 0);
    const fwd = this._controls.target.clone().sub(this._cam.position);
    right.y = 0; fwd.y = 0; right.normalize(); fwd.normalize();
    const v = right.multiplyScalar(sx).add(fwd.multiplyScalar(sy));
    return Math.abs(v.x) >= Math.abs(v.z) ? [Math.sign(v.x), 0] : [0, Math.sign(v.z)];
  }

  /* ---------- world (re)build ---------- */
  _rebuild() {
    const T = this.T;
    if (this._world) this._disposeWorld();
    this._world = new T.Group(); this._scene.add(this._world);
    this._items = new Map(); this._fixtures = []; this._screens = []; this._floorMeshes = []; this._bulbs = null; this._niche = null; this._cur = null; this._xf = null;
    const sc = this._cfg().scene || {};
    this._buildScene(sc);
    this._armIdle();
    this._stage = this._stageSpot = null; this._lkSig = null; this._bgKey = undefined;   // _applyLook (from _update) re-applies the look to the fresh lights
    this._buildRoof(sc);
    this._buildLights();
    this._buildTargets();
    this._buildOverlays();
    if (this._edit) this._applyPlanVis();
    if (this._renderer) this._renderer.shadowMap.needsUpdate = true;
    this._loadModels();
    if (this._focus) this._focus.polys = this._roomPolys(this._focus.room);   // room outlines may have changed
    this._fadeGen = (this._fadeGen || 0) + 1;
    this._showEmpty();
    if (this._ready) this._update();
  }
  /* a new dashboard (Settings → Dashboards → Add → 3D Home) starts with nothing in it: say how to begin */
  _showEmpty() {
    const cfg = this._cfg(), sc = cfg.scene || {};
    const empty = !this._edit && ![sc.wall_segs, sc.walls, sc.front_walls, sc.floors, sc.boxes, sc.objects, cfg.lights].some((a) => a?.length);
    let el = this._wrap?.querySelector(".empty");
    if (!empty) return el?.remove();
    if (!el) { el = document.createElement("div"); el.className = "empty"; this._wrap?.append(el); }
    el.innerHTML = `<b>Your 3D home is empty</b><span>${this._hass?.user?.is_admin
      ? `Press ${ic("pencil-outline")}Edit, then Floor plan, to draw your walls and rooms. Save puts them in this dashboard.`
      : "Ask an administrator to draw the floor plan with the Edit button."}</span>`;
  }

  /* free GPU memory of the current world: geometries, per-item materials + their textures, light shadow maps.
   * Cached materials (this._mats), the shared glow texture, blueprint textures and Sweet Home 3D prototype meshes are kept. */
  _disposeWorld() {
    this._clearFade(true);
    this._scene?.remove(this._world);
    this._disposeTree(this._world);
    this._wallG = null; this._jointMeshes = null; this._roomHG = null; this._vertMeshes = this._midMeshes = null; this._strHG = null; this._sptMeshes = this._smidMeshes = null;
  }
  _disposeTree(root) {
    const keep = new Set(Object.values(this._mats || {})), keepTex = new Set([...(this._bpTex?.values() || []), ...Object.values(this._surfTexs || {})]);
    root.traverse((o) => {
      if (o.isLight) o.shadow?.dispose?.();
      if (o.userData.shared) return;
      o.geometry?.dispose?.();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        if (keep.has(m)) continue;
        if (m.map && m.map !== this._glowTex && !keepTex.has(m.map)) m.map.dispose();
        m.dispose();
      }
    });
    root.clear();
  }

  /* The house has no visible roof, so the sun would light every room from above. An invisible roof over the rooms, plus
   * walls raised to roof height wherever they are lower (cut-away front walls), lets sunlight in only through windows and
   * doors. Their material writes neither colour nor depth, so they only show up in shadow maps, and they can't be picked.
   * The slab sits just above the tallest wall so ceiling lamps still light the room below. */
  _buildRoof(sc) {
    if (this._plan || sc.roof === false) return;
    const T = this.T, WT = sc.wall_thickness ?? 4, G = new T.Group();
    let segs = sc.wall_segs || [], opens = sc.openings || [];
    if (sc.walls || sc.front_walls) { const lw = legacyWalls(sc); segs = [...segs, ...lw.segs]; opens = [...opens, ...lw.opens]; }
    const H = Math.max(sc.wall_height ?? 46, ...segs.filter((w) => !w.low).map((w) => w.h ?? 0)) + 0.5, TOP = H + 1.5;   // over the tallest wall
    const mat = (this._mats.__roof ||= new T.MeshBasicMaterial({ side: T.DoubleSide, colorWrite: false, depthWrite: false }));
    const add = (geo, x = 0, y = 0, z = 0, ry = 0) => {
      const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry;
      m.castShadow = true; m.receiveShadow = false; m.raycast = () => {}; m.userData.roof = true; G.add(m);
    };
    for (const f of sc.floors || []) {
      if (!(f.pts?.length >= 3) || f.roof === false || f.name === "rug" || (f.roof !== true && OUTDOOR.test(f.name || ""))) continue;
      const geo = new T.ExtrudeGeometry(new T.Shape(f.pts.map(([x, y]) => new T.Vector2(x - CX, y - CY))), { depth: 1.5, bevelEnabled: false });
      geo.rotateX(Math.PI / 2); add(geo, 0, TOP);   // a 1.5-thick slab just above the walls
    }
    // every wall, raised to the top of the roof: fills the cut-away walls, and covers wall tops so they aren't sunlit
    const ext = wallExtensions(segs, WT);
    segs.forEach((w, i) => {
      const full = { ...w, h: TOP }; delete full.low;
      const [ux, uy] = segDir(w), t = w.t ?? WT, ry = -Math.atan2(uy, ux);
      for (const [p0, p1, z0, z1] of wallPieces(full, ext[i], opens, TOP, WT)) {
        const sm = (p0 + p1) / 2;
        add(new T.BoxGeometry(p1 - p0, z1 - z0, t), w.a[0] + ux * sm - CX, z0 + (z1 - z0) / 2, w.a[1] + uy * sm - CY, ry);
      }
    });
    if (G.children.length) this._world.add(G);
  }

  /* ---------- door leaves ----------
   * Built inside the opening's item group (so `rot` applies), in plan coordinates. Each moving part is a pivot group
   * whose `mv` says how it opens: a turn about its hinge, or a slide along x / up. `t` runs 0 (shut) → 1 (open). */
  _buildDoorLeaf(o) {
    const T = this.T, [, def] = DOOR_STYLES[o.style], col = o.color || def, th = 1.4, gap = 0.3;
    const x1 = o.x - o.w / 2, x2 = o.x + o.w / 2, z0 = o.z || 0, hh = o.h - gap, y = o.y, d = o.d ?? 6;
    const right = o.hinge === "right", side = o.flip ? -1 : 1, parent = this._cur, parts = [];
    const glassMat = this._mat("#a9cfe6", { transparent: true, opacity: 0.3, depthWrite: false });
    const pivot = (px, py, mv) => {
      const outer = new T.Group(), inner = new T.Group();
      outer.position.set(px - CX, 0, py - CY); inner.position.set(-(px - CX), 0, -(py - CY));
      outer.add(inner); parent.add(outer); this._cur = inner; parts.push({ node: outer, mv, x0: outer.position.x, y0: 0 });
    };
    const slab = (a, b, yc, t = th) => this._box(a, b, yc - t / 2, yc + t / 2, z0, hh, col);
    const framed = (a, b, yc) => {   // glass pane in a thin frame
      const f = 1.6;
      for (const [p, q, zz, h] of [[a, a + f, z0, hh], [b - f, b, z0, hh], [a, b, z0, f], [a, b, z0 + hh - f, f]]) this._box(p, q, yc - th / 2, yc + th / 2, zz, h, col);
      this._box(a + f, b - f, yc - 0.3, yc + 0.3, z0 + f, hh - 2 * f, glassMat).castShadow = false;
    };
    if (o.style === "panel" || o.style === "glass") {   // swings towards +y (−y when flipped)
      pivot(right ? x2 : x1, y, { rot: (right ? 1 : -1) * side * (Math.PI / 2) });
      (o.style === "glass" ? framed : slab)(x1 + gap, x2 - gap, y);
    } else if (o.style === "double") {
      const m = o.x;
      pivot(x1, y, { rot: -side * (Math.PI / 2) }); slab(x1 + gap, m - gap / 2, y);
      pivot(x2, y, { rot: side * (Math.PI / 2) }); slab(m + gap / 2, x2 - gap, y);
    } else if (o.style === "sliding") {
      const m = o.x, ov = 1;
      this._cur = parent; framed(right ? x1 + gap : m - ov, right ? m + ov : x2 - gap, y - side * 0.9);   // fixed pane
      pivot(o.x, y, { x: (right ? -1 : 1) * (o.w / 2 - gap) }); framed(right ? m - ov : x1 + gap, right ? x2 - gap : m + ov, y + side * 0.9);
    } else if (o.style === "barn") {
      const yf = y + side * (d / 2 + 0.9);   // hangs on the wall face
      const yr = yf - side * 1.2;
      this._cur = parent; this._box(right ? x1 - 1 : x1 - o.w - 1, right ? x2 + o.w + 1 : x2 + 1, yr - 0.4, yr + 0.4, z0 + hh, 1.2, "#2a2a2a");   // rail
      pivot(o.x, y, { x: (right ? 1 : -1) * o.w }); slab(x1 - 1, x2 + 1, yf, 1.6);
    } else if (o.style === "garage") {
      pivot(o.x, y, { y: hh * 0.92 });
      slab(x1 + gap, x2 - gap, y, 1.2);
      for (let k = 1; k < 4; k++) this._box(x1 + gap, x2 - gap, y - 0.8, y + 0.8, z0 + (hh * k) / 4 - 0.25, 0.5, this._mat("#b9b3aa"));   // panel seams
    }
    this._cur = parent;
    this._doorLeaves.push({ o, parts, t: 0 });
  }
  _doorTarget(o) { return o.entity ? (OPEN_STATES.has(this._hass?.states[o.entity]?.state) ? 1 : 0) : o.open ? 1 : 0; }
  _poseDoor(dl) {
    const e = dl.t < 0.5 ? 2 * dl.t * dl.t : 1 - Math.pow(-2 * dl.t + 2, 2) / 2;
    for (const p of dl.parts) {
      if (p.mv.rot) p.node.rotation.y = p.mv.rot * e;
      if (p.mv.x) p.node.position.x = p.x0 + p.mv.x * e;
      if (p.mv.y) p.node.position.y = p.mv.y * e;
    }
  }
  /* animate every door towards its sensor's state */
  _setDoors() {
    const leaves = this._doorLeaves;
    if (!leaves?.length) return;
    let moving = false;
    for (const dl of leaves) if (dl.target !== this._doorTarget(dl.o)) { dl.target = this._doorTarget(dl.o); moving = true; }
    if (!moving || this._doorAnim) return;
    const anim = (this._doorAnim = {}); let last = performance.now();
    const step = (now) => {
      if (this._doorAnim !== anim || this._doorLeaves !== leaves || !this._renderer) return;
      const k = Math.min(1, Math.max(0, now - last) / 700); last = Math.max(last, now); let busy = false;   // rAF time can be earlier than performance.now()
      for (const dl of leaves) {
        if (dl.t === dl.target) continue;
        dl.t = dl.t < dl.target ? Math.min(dl.target, dl.t + k) : Math.max(dl.target, dl.t - k);
        this._poseDoor(dl); busy ||= dl.t !== dl.target;
      }
      this._requestRender();
      if (busy) requestAnimationFrame(step); else { this._doorAnim = null; this._renderer.shadowMap.needsUpdate = true; this._requestRender(); }
    };
    requestAnimationFrame(step);
  }

  /* ---------- geometry ---------- */
  _mat(color, opts = {}) {
    const key = color + JSON.stringify(opts);
    this._mats ||= {};
    return (this._mats[key] ||= new this.T.MeshLambertMaterial({ color, ...opts }));
  }
  /* a wall / floor material: the colour, optionally with a SURFACES texture. Geometry needs plan-unit UVs (see _planUV). */
  _surfMat(color, tex, opts = {}) {
    if (!SURFACES[tex]) return this._mat(color, opts);
    const key = color + "~" + tex + JSON.stringify(opts);
    this._mats ||= {};
    if (this._mats[key]) return this._mats[key];
    const map = this._surfTex(tex), m = (this._mats[key] = new this.T.MeshLambertMaterial({ color, map, ...opts }));
    m.color.multiplyScalar(1 / map.image.mean);
    return m;
  }
  _surfTex(name) {
    const T = this.T, cm = this._modelScale()[0];
    let t = (this._surfTexs ||= {})[name];
    if (!t) {
      t = this._surfTexs[name] = new T.CanvasTexture(paintSurface(name));
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.anisotropy = Math.min(8, this._renderer?.capabilities.getMaxAnisotropy() || 1);
    }
    t.repeat.set(cm / SURFACES[name][1], cm / SURFACES[name][1]);   // UVs are in plan units
    return t;
  }
  /* box UVs in plan units, projected along each face's normal, so textures keep their real size and line up across pieces.
   * (ox, oy, oz) is the box centre in the frame the texture should be continuous in; heights are stretched back to true scale. */
  _planUV(geo, ox = 0, oy = 0, oz = 0) {
    const [mx, mz] = this._modelScale(), vs = mz / mx, P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i) + ox, y = (P.getY(i) + oy) * vs, z = P.getZ(i) + oz;
      if (Math.abs(N.getY(i)) > 0.5) U.setXY(i, x, z);
      else if (Math.abs(N.getX(i)) > 0.5) U.setXY(i, z, y);
      else U.setXY(i, x, y);
    }
    U.needsUpdate = true;
    return geo;
  }
  _add(mesh, cast = true) { mesh.castShadow = cast && !this._noCast; mesh.receiveShadow = true; (this._cur || this._world).add(mesh); return mesh; }
  /* start a keyed, pivot-rotatable item group */
  /* An item's groups: outer (centre + turn about the vertical, `rot`) → tilt (`rx` / `rz`, about the middle of the item's
   * own bounding box, set up in _endItem) → size (fixed-shape `size`) → inner (the meshes, in plan coordinates).
   * Together that is the rotation Ry·Rx·Rz, Unity's order: turn, then tilt. */
  _begin(key, center, rot = 0, parent, size, az = 0, tilt) {
    const T = this.T, outer = new T.Group(), inner = new T.Group();
    outer.position.set(center[0] - CX, 0, center[1] - CY); outer.rotation.y = (-rot * Math.PI) / 180;
    inner.position.set(-(center[0] - CX), 0, -(center[1] - CY));
    let top = outer;
    if (tilt) { const tg = new T.Group(); tg.userData.tilt = tilt; outer.add(tg); top = tg; }
    if (size) {   // `size` multiplier of a fixed-shape object, about the height `az` it stands on or hangs from
      const sg = new T.Group(); sg.position.y = az; sg.scale.set(size[0], size[2], size[1]); inner.position.y = -az;
      sg.add(inner); top.add(sg);
    } else top.add(inner);
    outer.userData.key = key; outer.userData.inner = inner; (parent || this._world).add(outer); this._items.set(key, outer);
    this._outer = outer;
    this._cur = inner;
    this._xf = rot ? (x, y) => rotPt(x, y, center[0], center[1], rot) : null;
    return outer;
  }
  _endItem() {
    const o = this._outer, tg = o?.children[0];
    if (tg?.userData.tilt) {   // the tilt pivot: middle of the untilted item, in the outer group's frame (o.userData.tc)
      const T = this.T, ry = o.rotation.y; o.rotation.y = 0; o.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(tg); o.rotation.y = ry;
      const tc = box.isEmpty() ? new T.Vector3() : box.getCenter(new T.Vector3()).sub(o.position).sub(o.parent?.position || new T.Vector3());
      o.userData.tc = tc;
      const [rx, rz] = tg.userData.tilt;
      if (rx || rz) {
        for (const c of tg.children) c.position.sub(tc);
        tg.position.copy(tc); tg.rotation.set((rx * Math.PI) / 180, 0, (rz * Math.PI) / 180);
      }
      o.updateMatrixWorld(true);
    }
    this._cur = null; this._xf = null; this._outer = null;
  }
  _box(x1, x2, y1, y2, z, h, color, opts) {
    const T = this.T;
    const m = new T.Mesh(new T.BoxGeometry(Math.max(x2 - x1, 0.3), Math.max(h, 0.3), Math.max(y2 - y1, 0.3)), typeof color === "string" ? this._mat(color, opts) : color);
    m.position.set((x1 + x2) / 2 - CX, z + h / 2, (y1 + y2) / 2 - CY);
    return this._add(m);
  }
  _cyl(x, y, z, r, h, color, seg = 16, r2) {
    const T = this.T;
    const m = new T.Mesh(new T.CylinderGeometry(r2 ?? r, r, h, seg), typeof color === "string" ? this._mat(color) : color);
    m.position.set(x - CX, z + h / 2, y - CY);
    return this._add(m);
  }
  _sphere(x, y, z, r, color) {
    const T = this.T;
    const m = new T.Mesh(new T.SphereGeometry(r, 12, 10), typeof color === "string" ? this._mat(color) : color);
    m.position.set(x - CX, z, y - CY);
    return this._add(m);
  }
  /* stage look: a soft, offset "drop shadow" under the house, baked from the floor outlines into a blurred texture */
  _buildStageShadow(sc) {
    const T = this.T, pts = (sc.floors || []).flatMap((f) => f.pts || []);
    if (!pts.length) return;
    const M = 60, [x1, x2, y1, y2] = [Math.min(...pts.map((p) => p[0])) - M, Math.max(...pts.map((p) => p[0])) + M, Math.min(...pts.map((p) => p[1])) - M, Math.max(...pts.map((p) => p[1])) + M];
    const k = 1, c = document.createElement("canvas"); c.width = Math.ceil((x2 - x1) * k); c.height = Math.ceil((y2 - y1) * k);
    const g = c.getContext("2d");
    for (const [blur, a] of [[22, 0.6], [6, 0.5]]) {   // a wide soft penumbra plus a tighter contact shadow
      g.filter = `blur(${blur}px)`; g.fillStyle = `rgba(0,0,0,${a})`;
      for (const f of sc.floors) { if (!(f.pts?.length >= 3)) continue; g.beginPath(); f.pts.forEach(([x, y], i) => g[i ? "lineTo" : "moveTo"]((x - x1) * k, (y - y1) * k)); g.closePath(); g.fill(); }
    }
    const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
    const m = new T.Mesh(new T.PlaneGeometry(x2 - x1, y2 - y1), new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = -1; m.raycast = () => {};   // never picked
    m.position.set((x1 + x2) / 2 - CX + 10, -6, (y1 + y2) / 2 - CY + 14);   // offset toward the viewer, below the floor slab
    this._world.add(m); this._stage = m;
    /* the backdrop's spotlight lies on the ground under the house, so it pans, zooms and turns with it. It only brightens
     * (alpha falls to 0 at its rim), so it blends into the flat card background with no seam. */
    const cs = document.createElement("canvas"); cs.width = cs.height = 256;
    const gs = cs.getContext("2d"), rg = gs.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [at, al] of [[0, 1], [0.55, 0.47], [1, 0]]) rg.addColorStop(at, `rgba(54,49,42,${al})`);
    gs.fillStyle = rg; gs.fillRect(0, 0, 256, 256);
    const st = new T.CanvasTexture(cs); st.colorSpace = T.SRGBColorSpace;
    const sp = new T.Mesh(new T.PlaneGeometry((x2 - x1) * 2.4, (y2 - y1) * 2.6), new T.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, toneMapped: false }));
    sp.rotation.x = -Math.PI / 2; sp.renderOrder = -2; sp.raycast = () => {};
    sp.position.set((x1 + x2) / 2 - CX, -7, (y1 + y2) / 2 - CY);
    this._world.add(sp); this._stageSpot = sp;
  }
  _emissive(color) { return new this.T.MeshStandardMaterial({ color, emissive: new this.T.Color(color), emissiveIntensity: 0.05, roughness: 0.4 }); }
  _fixture(x, y, mesh) {
    mesh.castShadow = false;
    const [wx, wy] = this._xf ? this._xf(x, y) : [x, y];
    this._fixtures.push({ x: wx, y: wy, mesh });
  }

  _buildScene(sc) {
    const T = this.T, H = sc.wall_height ?? 46, LIN = sc.lintel ?? 8, WT = sc.wall_thickness ?? 4, LOW = sc.low ?? 8;
    const wallCol = (sc.wall_colors || ["#e9dcc8"])[0], wallMat = this._surfMat(wallCol, sc.wall_texture);
    const pal = sc.palette || {};
    const col = (c) => (typeof c === "string" ? (pal[c] || ["#888"])[0] : c[0]);
    // walls
    const wall = (axis, at, a, b, h, z) => {
      const m = axis === "y" ? this._box(at - WT / 2, at + WT / 2, a, b, z, h, wallMat) : this._box(a, b, at - WT / 2, at + WT / 2, z, h, wallMat);
      this._planUV(m.geometry, m.position.x, m.position.y, m.position.z);
      m.userData.wall = true;
    };
    for (const w of sc.walls || []) {
      const h = w.h ?? H;
      for (const [a, b] of w.spans || []) wall(w.axis, w.at, a, b, h, 0);
      for (const [a, b] of w.doors || []) wall(w.axis, w.at, a, b, LIN, h - LIN);
    }
    for (const w of sc.front_walls || []) for (const [a, b] of w.spans) wall(w.axis, w.at, a, b, w.h ?? LOW, 0);
    // free wall segments, openings, blueprint underlay (the editable floor plan)
    this._buildPlanLayer(sc);
    // boxes
    (sc.boxes || []).forEach((e, i) => {
      const [x1, x2, y1, y2, h, c, z = 0] = bArr(e);
      this._begin("b:" + i, itemCenter("b", e), Array.isArray(e) ? 0 : e.rot || 0, null, null, 0, Array.isArray(e) ? [0, 0] : [e.rx || 0, e.rz || 0]);
      this._box(x1, x2, y1, y2, z, h, col(c));
      this._endItem();
    });
    // objects
    (sc.objects || []).forEach((o, i) => {
      this._begin("o:" + i, itemCenter("o", o), o.rot || 0, null, SIZED.has(o.type) && o.size ? sizeOf(o) : null, sizeAnchor(o), [o.rx || 0, o.rz || 0]);
      this._buildObject(o, H, LIN);
      this._endItem();
    });
    // overlays (fixtures, glass, railings) never block light
    this._noCast = true;
    (sc.overlays || []).forEach((o, i) => {
      const c = itemCenter("v", o);
      if (c) this._begin("v:" + i, c, o.rot || 0, null, SIZED.has(o.type) && o.size ? sizeOf(o) : null, sizeAnchor(o), [o.rx || 0, o.rz || 0]);
      this._buildOverlay(o, H, LOW);
      this._endItem();
    });
    this._noCast = false;
  }
  _buildObject(o, H, LIN) {
    if (o.type === "doorpanel") this._box(o.at - 0.6, o.at + 2.4, o.span[0], o.span[1], 0, H - LIN, o.fill || "#3a2a1e");
    else if (o.type === "shelf") {
      const [x1, x2, y1, y2, h] = o.box; const c = (o.colors || ["#2c2622"])[0];
      this._box(x1, x2, y2 - 1.5, y2, 0, h, c); this._box(x1, x1 + 1.5, y1, y2, 0, h, c); this._box(x2 - 1.5, x2, y1, y2, 0, h, c);
      for (const z of [0, ...(o.shelves || []), h - 1]) this._box(x1, x2, y1, y2, z, 1, c);
    } else if (o.type === "table") {
      this._cyl(o.x, o.y, o.z - 2, o.r, 2, "#b39672", 32); this._cyl(o.x, o.y, 0, 1.6, o.z - 2, "#6e5a40");
      this._cyl(o.x, o.y, 0, 7, 1, "#6e5a40"); this._sphere(o.x, o.y, o.z + 3, 2.6, "#5f8a55");
    } else if (o.type === "floorlamp") {
      this._cyl(o.x, o.y, 0, 4, 1, "#2a2a2a"); this._cyl(o.x, o.y, 0, 0.6, o.z, "#2a2a2a");
      this._fixture(o.x, o.y, this._cyl(o.x, o.y, o.z - 3, 5.5, 8, this._emissive("#fbf3e2"), 20, 4.5));
    } else if (o.type === "tablelamp") {
      this._cyl(o.x, o.y, o.z, 2, 6, "#cfcfcf");
      this._fixture(o.x, o.y, this._cyl(o.x, o.y, o.z + 6, 4.5, 6, this._emissive("#fbf3e2"), 20, 3.6));
    } else if (o.type === "plant") {
      const z = o.z || 0; this._cyl(o.x, o.y, z, 3, 5, "#d9cbb0", 12, 3.6);
      for (const [dx, dy, dz, r] of [[-2, 0, 9, 3.5], [2, 1, 11, 3.5], [0, -1, 14, 4]]) this._sphere(o.x + dx, o.y + dy, z + dz, r, "#4f7a45");
    } else if (o.type === "plantwall") {
      const { x1, x2, z1, z2, y } = o;
      this._box(x1 - 2, x2 + 2, y - 1, y + 3, z1 - 1.5, 1.5, "#f4f2ee");
      this._niche = this._box(x1, x2, y - 1.2, y - 0.2, z1, z2 - z1, this._emissive("#f7f6f1"));
      const sx = (x) => x1 + (x - 246) * (x2 - x1) / 54, sz = (z) => z1 + (z - 13) * (z2 - z1) / 28;
      for (const [a, b, z] of [[248, 270, 21], [280, 299, 21], [248, 262, 29], [276, 299, 29], [248, 262, 36], [284, 298, 36]])
        this._box(sx(a), sx(b), y - 0.2, y + 3.5, sz(z) - 0.8, 0.8, "#a5835c");
      for (const [x, z, r] of [[252, 13, 3], [262, 13, 2.2], [270, 13, 2.5], [286, 13, 2.2], [293, 13, 2.3], [254, 21, 2.2], [266, 21, 1.8], [284, 21, 2.5], [292, 21, 1.9], [252, 29, 1.9], [258, 29, 1.7], [282, 29, 1.6], [290, 29, 2]])
        this._sphere(sx(x), y + 1.8, sz(z) + r, r, "#4f8a46");
      this._fixture((x1 + x2) / 2, y, this._sphere((x1 + x2) / 2, y + 1, z2 - 1.5, 1.6, this._emissive("#fffbe8")));
    } else if (o.type === "screen") {
      // 16:9 screen showing the entity's artwork / snapshot (drawn into a canvas texture in _drawScreen)
      const T = this.T, w = o.w || 32, h = (w * 9) / 16, z = o.z ?? 20, par = this._cur || this._world;
      this._box(o.x - w / 2 - 0.8, o.x + w / 2 + 0.8, o.y - 1, o.y, z - 0.8, h + 1.6, "#121212");
      if (o.stand) { this._box(o.x - 1, o.x + 1, o.y - 1.6, o.y - 0.6, 0, z, "#1b1b1b"); this._box(o.x - w / 4, o.x + w / 4, o.y - 4, o.y + 2, 0, 0.8, "#1b1b1b"); }
      const c = document.createElement("canvas"); c.width = 512; c.height = 288;
      const tex = new T.CanvasTexture(c); tex.colorSpace = T.SRGBColorSpace;
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
      m.position.set(o.x - CX, z + h / 2, o.y - CY + 0.12); par.add(m);
      const light = new T.PointLight(0xffffff, 0, w * 2.4, 1.4); light.position.set(o.x - CX, z + h / 2, o.y - CY + 8); par.add(light);
      this._screens.push({ o, mesh: m, tex, canvas: c, light, sig: null });
    } else if (o.type === "model") {
      // placeholder until the model loads
      const ph = this._box(o.x - o.w / 2, o.x + o.w / 2, o.y - o.d / 2, o.y + o.d / 2, o.z || 0, o.h,
        this._mat("#d8cdb9", { transparent: true, opacity: 0.35, depthWrite: false }));
      ph.castShadow = false; ph.userData.placeholder = true;
    }
  }
  _buildOverlay(o, H, LOW) {
    const T = this.T;
    if (o.type === "sink") { const [x1, x2, y1, y2] = o.rect; this._box(x1, x2, y1, y2, o.z - 1.2, 1.4, "#8d9296");
      if (o.faucet) this._cyl(o.faucet[0], o.faucet[1], o.z, 0.6, 6, "#d8dadc"); }
    else if (o.type === "burners") for (const [x, y] of o.pts) { const m = new T.Mesh(new T.TorusGeometry(3.2, 0.5, 6, 20), this._mat("#6b6f73")); m.rotation.x = Math.PI / 2; m.position.set(x - CX, o.z + 0.3, y - CY); this._add(m, false); }
    else if (o.type === "line") {
      const [ax, ay, az] = o.a, [bx, by, bz] = o.b, len = Math.hypot(bx - ax, by - ay, bz - az);
      const m = new T.Mesh(new T.CylinderGeometry((o.w || 0.6) / 2, (o.w || 0.6) / 2, len, 6), this._mat(o.stroke || "#777"));
      m.position.set((ax + bx) / 2 - CX, (az + bz) / 2, (ay + by) / 2 - CY);
      m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(bx - ax, bz - az, by - ay).normalize()); this._add(m, false);
    }
    else if (o.type === "pendant") { this._cyl(o.x, o.y, o.z + 6, 0.25, (o.top ?? 62) - o.z - 6, "#3a3a3a", 6);
      this._fixture(o.x, o.y, this._cyl(o.x, o.y, o.z, 2.8, 6, this._emissive("#fff1cf"), 16)); }
    else if (o.type === "track") {
      const [ax, ay] = o.a, [bx, by] = o.b; this._box(Math.min(ax, bx) - 0.8, Math.max(ax, bx) + 0.8, Math.min(ay, by) - 0.8, Math.max(ay, by) + 0.8, o.z, 1.2, "#2a2a2a");
      for (const t of o.heads || [0.15, 0.5, 0.85]) { const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        this._cyl(x, y, o.z - 3, 0.3, 3, "#2a2a2a", 6); this._fixture(x, y, this._cyl(x, y, o.z - 6, 1.8, 3.5, this._emissive("#fff4d6"), 12, 1.2)); }
    } else if (o.type === "fan") {
      const z = o.z ?? 44, r = o.r ?? 22;
      this._cyl(o.x, o.y, z + 1, 0.6, (o.ceiling ?? z + 8) - z - 1, "#2a1f17", 6);
      this._cyl(o.x, o.y, z, 4, 2.5, "#3b2d22", 16);
      for (let k = 0; k < 5; k++) {
        const a = k * 2 * Math.PI / 5 + 0.3;
        const m = new T.Mesh(new T.BoxGeometry(r - 4, 0.5, 5), this._mat("#5a4636"));
        m.position.set(o.x - CX + Math.cos(a) * (r / 2 + 2), z + 1.5, o.y - CY + Math.sin(a) * (r / 2 + 2)); m.rotation.y = -a; this._add(m);
      }
      this._fixture(o.x, o.y, this._sphere(o.x, o.y, z - 0.5, 3.6, this._emissive("#fff3d0")));
    } else if (o.type === "glasswall") {
      const Hh = o.h ?? H, glass = this._mat("#a9cfe6", { transparent: true, opacity: 0.18, depthWrite: false });
      const g = this._box(o.x - 0.3, o.x + 0.3, o.y1, o.y2, 0, Hh, glass); g.castShadow = false;
      for (const y of o.posts) this._box(o.x - 0.8, o.x + 0.8, y - 0.8, y + 0.8, 0, Hh, "#3b3f43");
      this._box(o.x - 0.8, o.x + 0.8, o.y1, o.y2, Hh - 1.2, 1.2, "#3b3f43"); this._box(o.x - 0.8, o.x + 0.8, o.y1, o.y2, 0, 1, "#3b3f43");
    } else if (o.type === "cornerglass") {
      const g = this._box(o.x1, o.x2, o.y - 0.3, o.y + 0.3, 0, LOW + 2, this._mat("#a9cfe6", { transparent: true, opacity: 0.3, depthWrite: false })); g.castShadow = false;
    } else if (o.type === "railing") {
      for (let y = o.y1 + 5; y <= o.y2; y += 12) this._cyl(o.x, y, 0, 0.4, o.h, "#d9cdb8", 6);
      for (let x = o.x_end + 6; x < o.x; x += 12) this._cyl(x, o.y2, 0, 0.4, o.h, "#d9cdb8", 6);
      this._box(o.x - 0.8, o.x + 0.8, o.y1, o.y2, o.h, 1, "#d9cdb8"); this._box(o.x_end, o.x, o.y2 - 0.8, o.y2 + 0.8, o.h, 1, "#d9cdb8");
    } else if (o.type === "bulbs") {
      this._bulbs = o.pts.map(([x, y]) => this._sphere(x, y, o.z, 1, this._emissive("#fff1c4")));
    }
  }

  /* ---------- Sweet Home 3D models ---------- */
  async _mod(url) { return (this._mods ||= {})[url] ||= import(url); }
  async _jszip() { return (await this._mod(this._config.jszip_url || JSZIP_URL)).default; }
  _modelScale() { const s = this._cfg().scene?.model_scale; return Array.isArray(s) ? s : [2.1, 4]; } // cm per plan unit [xy, z]
  _openLib(file) {
    if (!LIBCACHE.has(file)) {
      const p = (async () => {
        const res = await fetch(LIB_DIR + encodeURIComponent(file), { cache: "no-store" });
        if (!res.ok) throw new Error(`${file} not downloaded (${res.status})`);
        const JSZip = await this._jszip();
        const outer = await JSZip.loadAsync(await res.arrayBuffer());
        const sh3fs = [];
        for (const name of Object.keys(outer.files)) {
          if (outer.files[name].dir || !/\.sh3f$/i.test(name)) continue;
          sh3fs.push({ name: name.split("/").pop(), zip: await JSZip.loadAsync(await outer.file(name).async("arraybuffer")) });
        }
        if (!sh3fs.length && outer.file(/PluginFurnitureCatalog\.properties$/).length) sh3fs.push({ name: "", zip: outer });
        const lic = LIBS.find((l) => l.file === file)?.lic || "";
        const items = [];
        for (const s of sh3fs) {
          const cands = s.zip.file(/PluginFurnitureCatalog\.properties$/).sort((a, b) => a.name.length - b.name.length);
          if (!cands.length) continue;
          const bytes = await cands[0].async("uint8array");
          const props = parseProps(new TextDecoder("iso-8859-1").decode(bytes));
          for (const k of Object.keys(props)) {
            const m = k.match(/^name#(\d+)$/); if (!m) continue;
            const g = (f) => props[f + "#" + m[1]];
            const model = g("model"); if (!model || !/\.(obj|zip)$/i.test(model)) continue;
            items.push({ name: props[k], cat: g("category") || "Misc", icon: g("icon"), model, w: +g("width") || 50, d: +g("depth") || 50,
              h: +g("height") || 50, elev: +g("elevation") || 0, mr: g("modelRotation") || null, creator: g("creator") || "", sh3f: s.name, lib: file, lic });
          }
        }
        if (!items.length) throw new Error(`No OBJ furniture found in ${file}`);
        items.sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
        return { sh3fs, items };
      })();
      p.catch(() => LIBCACHE.delete(file));
      LIBCACHE.set(file, p);
    }
    return LIBCACHE.get(file);
  }
  async _extractModel(o) {
    const lib = await this._openLib(o.lib);
    const s = lib.sh3fs.find((x) => x.name === (o.sh3f || "")) || lib.sh3fs[0];
    let zip = s.zip, path = o.model.replace(/^\/+/, "");
    if (/\.zip$/i.test(path)) {
      const JSZip = await this._jszip();
      const f = zipFind(zip, path); if (!f) throw new Error("model zip missing: " + path);
      zip = await JSZip.loadAsync(await f.async("arraybuffer"));
      path = Object.keys(zip.files).find((n) => /\.obj$/i.test(n));
      if (!path) throw new Error("no OBJ inside " + o.model);
    }
    const of = zipFind(zip, path); if (!of) throw new Error("model missing: " + path);
    const obj = await of.async("string"), dir = dirOf(of.name);
    const out = { obj, mtl: null, tex: {} };
    const mtlName = (obj.match(/^\s*mtllib\s+(.+?)\s*$/m) || [])[1];
    if (mtlName) {
      const mf = zipFind(zip, dir + mtlName) || zipFind(zip, mtlName);
      if (mf) {
        out.mtl = await mf.async("string");
        const texDir = dirOf(mf.name);
        for (const mm of out.mtl.matchAll(/^\s*(?:map_\w+|bump|disp|refl)\s+(.+?)\s*$/gim)) {
          const tn = mm[1].split(/\s+/).pop().replace(/\\/g, "/");
          const tf = zipFind(zip, texDir + tn) || zipFind(zip, tn);
          if (tf) out.tex[tn.split("/").pop().toLowerCase()] = await tf.async("blob");
        }
      }
    }
    return out;
  }
  _modelProto(o) {
    const key = `${o.lib}|${o.sh3f || ""}|${o.model}`;
    if (!MODELCACHE.has(key)) {
      const p = (async () => {
        const T = this.T;
        let files = await IDB.get(key);
        if (!files) { files = await this._extractModel(o); IDB.put(key, files); }
        const [{ OBJLoader }, { MTLLoader }] = await Promise.all([this._mod(OBJ_URL), this._mod(MTL_URL)]);
        const urls = {};
        for (const [n, b] of Object.entries(files.tex || {})) urls[n] = URL.createObjectURL(b);
        const mgr = new T.LoadingManager();
        mgr.setURLModifier((u) => urls[decodeURIComponent(u.split(/[\\/]/).pop()).toLowerCase()] || u);
        mgr.onLoad = () => document.dispatchEvent(new Event("ha-3dhome-tex"));
        const loader = new OBJLoader(mgr);
        if (files.mtl) { const mats = new MTLLoader(mgr).parse(files.mtl, ""); mats.preload(); loader.setMaterials(mats); }
        const obj = loader.parse(files.obj);
        if (o.mr) {
          const v = String(o.mr).trim().split(/\s+/).map(Number);
          if (v.length === 9 && v.every((n) => !isNaN(n))) obj.applyMatrix4(new T.Matrix4().set(v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, 0, 0, 0, 1));
        }
        obj.traverse((m) => {
          if (!m.isMesh) return;
          m.castShadow = true; m.receiveShadow = true; m.userData.shared = true;
          for (const mt of Array.isArray(m.material) ? m.material : [m.material]) { mt.side = T.DoubleSide; if (mt.shininess != null) mt.shininess = Math.min(mt.shininess, 30); }
        });
        obj.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(obj), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
        return { node: obj, size, center, min: box.min.clone() };
      })();
      p.catch((e) => { console.warn("ha-3dhome-card model", key, e); MODELCACHE.delete(key); });
      MODELCACHE.set(key, p);
    }
    return MODELCACHE.get(key);
  }
  _loadModels() {
    const objs = this._cfg().scene?.objects || [];
    objs.forEach((o, i) => {
      if (o.type !== "model") return;
      const key = "o:" + i, world = this._world;
      this._modelProto(o).then((proto) => {
        const outer = this._items.get(key);
        if (world !== this._world || !outer) return;
        const inner = outer.userData.inner, T = this.T;
        const ph = inner.children.find((c) => c.userData.placeholder);
        if (ph) { inner.remove(ph); ph.geometry.dispose(); }
        const inst = proto.node.clone();
        inst.position.set(-proto.center.x, -proto.min.y, -proto.center.z);
        const holder = new T.Group(); holder.add(inst);
        const sz = proto.size;
        holder.scale.set(o.w / (sz.x || 1), o.h / (sz.y || 1), o.d / (sz.z || 1));
        if (o.mirror) holder.scale.x *= -1;
        holder.position.set(o.x - CX, o.z || 0, o.y - CY);
        inner.add(holder);
        this._fadeGen = (this._fadeGen || 0) + 1;   // its real size can change what blocks the framed room
        this._renderer.shadowMap.needsUpdate = true;
        this._requestRender();
      }).catch((e) => {
        const outer = this._items.get(key);
        const ph = outer?.userData.inner?.children.find((c) => c.userData.placeholder);
        if (ph) ph.material = this._mat("#c2483d", { transparent: true, opacity: 0.45, depthWrite: false });
        if (world === this._world) (this._modelErr ||= {})[key] = String(e.message || e);
        this._requestRender();
      });
    });
  }

  /* ---------- lights ---------- */
  _glowTexture() {
    if (this._glowTex) return this._glowTex;
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return (this._glowTex = new this.T.CanvasTexture(c));
  }
  _buildCompass(north) {   // editing only: a flat north arrow beside the house
    const T = this.T, G = new T.Group(), noPick = () => {};
    const tri = (pts, color) => {
      const geo = new T.ShapeGeometry(new T.Shape(pts.map(([x, y]) => new T.Vector2(x, y)))); geo.rotateX(Math.PI / 2);
      const m = new T.Mesh(geo, new T.MeshBasicMaterial({ color, side: T.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
      m.raycast = noPick; G.add(m);
    };
    tri([[0, -18], [-6, 0], [6, 0]], "#e5484d"); tri([[0, 18], [-6, 0], [6, 0]], "#f2efe8");
    const ring = new T.Mesh(new T.RingGeometry(19, 21, 40), new T.MeshBasicMaterial({ color: "#f2efe8", side: T.DoubleSide, transparent: true, opacity: 0.6, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.raycast = noPick; G.add(ring);
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"); g.fillStyle = "#e5484d"; g.font = "bold 48px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("N", 32, 34);
    const lab = new T.Mesh(new T.PlaneGeometry(11, 11), new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }));
    lab.rotation.x = -Math.PI / 2; lab.position.z = -28; lab.raycast = noPick; G.add(lab);
    G.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 2; });
    G.position.set(622 - CX, 1, 250 - CY); G.rotation.y = (-north * Math.PI) / 180;
    this._world.add(G);
  }
  /* Where the sun is: editor preview hour, then sun.sun's azimuth/elevation, then computed from HA's home location. */
  _sunPos() {
    const h = this._hass, cfg = this._cfg(), lat = h?.config?.latitude, lon = h?.config?.longitude;
    if (this._sunPreview != null && lat != null && lon != null) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setMinutes(this._sunPreview * 60);
      return solarPosition(d, lat, lon);
    }
    const a = h?.states[cfg.sun_entity || "sun.sun"]?.attributes;
    if (a && isFinite(a.azimuth) && isFinite(a.elevation)) return { azimuth: Number(a.azimuth), elevation: Number(a.elevation) };
    if (lat != null && lon != null) return solarPosition(new Date(), lat, lon);
    return null;
  }
  _placeSun(az, el, north) {
    const [x, y, z] = sunVector(az, el, north), D = 650;
    this._sun.target.position.set(0, 0, 0);
    this._sun.position.set(x * D, y * D, z * D);
    const key = `${Math.round(az * 2)}:${Math.round(el * 2)}:${north}`;
    if (key !== this._sunKey) { this._sunKey = key; if (this._renderer) this._renderer.shadowMap.needsUpdate = true; }
  }
  /* per-light tuning that needs no rebuild: reach (`r`), falloff (`decay`), beam width (`angle`, degrees) and edge (`soft`)
   * for spot lights, and the glow sprite size (`halo`). Brightness and saturation are applied in _update(). */
  _tuneLight(rec) {
    const L = rec.L, l = rec.light, r = L.r ?? 40;
    if (rec.kind === "string") l.distance = Math.max(140, stringLen(L.points || []) * 0.9) * (r / 40);
    else if (rec.kind === "niche") l.distance = 90 * (r / 40);
    else l.distance = r * (l.isSpotLight ? 3.2 : 2.6);
    l.decay = L.decay ?? (rec.kind === "glow" ? 1.1 : 1.2);
    if (l.isSpotLight) { l.angle = L.angle != null ? Math.max(5, Math.min(85, L.angle)) * Math.PI / 180 : rec.down ? 0.9 : 0.75; l.penumbra = L.soft ?? 0.8; }
    rec.sprite?.scale.setScalar((L.halo ?? 9) * 2.2);
  }
  _buildLights() {
    const T = this.T, cfg = this._cfg(), W = this._world;
    this._amb = new T.AmbientLight(0xffffff, 0.6); W.add(this._amb);
    this._hemi = new T.HemisphereLight(0xdfe8ff, 0x3a2f25, 0.4); W.add(this._hemi);
    const sun = (this._sun = new T.DirectionalLight(0xfff1dc, 1.2));
    sun.position.set(-260, 420, -160); sun.castShadow = true;   // moved by _placeSun() from the sun's real position
    sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -380, right: 380, top: 380, bottom: -380, near: 10, far: 1400 });
    sun.shadow.bias = -0.0008; W.add(sun); W.add(sun.target);
    this._sunKey = null;
    if (this._edit) this._buildCompass(cfg.scene?.north || 0);
    // cool fill from the front-right, used by the gradient-lighting look (see _applyLook)
    this._fill = new T.DirectionalLight(0xb9c8ff, 0); this._fill.position.set(300, 260, 360); this._fill.visible = false; W.add(this._fill);
    this._buildSkyLights(cfg);

    // group co-located bulbs into one physical light per fixture
    const groups = new Map();
    (cfg.lights || []).forEach((L, i) => {
      if (L.kind === "string" || L.fixture === "string" || L.kind === "niche") { groups.set("e" + i, { kind: L.fixture === "string" ? "string" : L.kind, members: [L], keys: ["l:" + i], L }); return; }
      const key = `${Math.round(L.x)}:${Math.round(L.y)}:${Math.round(L.z ?? 40)}`;
      if (!groups.has(key)) groups.set(key, { kind: "glow", members: [], keys: [], L });
      groups.get(key).members.push(L); groups.get(key).keys.push("l:" + i);
    });
    let shadowBudget = cfg.max_shadow_lights ?? 8;
    const ranked = [...groups.values()].sort((a, b) => (b.L.r ?? 40) - (a.L.r ?? 40));
    this._lightGroups = ranked.map((g) => {
      const L = g.L, rec = { ...g, fixtures: [] };
      const grp = new T.Group(); grp.userData.key = g.keys[0]; W.add(grp);
      for (const k of g.keys) this._items.set(k, grp);
      rec.group = grp;
      if (g.kind === "string") {
        const pts = L.points || [], [mx, my] = pts.length ? mean(pts) : [CX, CY];
        rec.light = new T.PointLight(0xffd59a, 0, 140, 1.2); rec.light.position.set(mx - CX, (L.z ?? 17) + 4, my - CY);
        rec.bulbs = L.fixture === "string" ? this._buildFixture(L, grp) : this._bulbs || [];
      } else if (g.kind === "niche") {
        const [x1, x2, z1, z2, Y] = L.rect;
        rec.light = new T.PointLight(0xe2ffec, 0, 90, 1.2); rec.light.position.set((x1 + x2) / 2 - CX, (z1 + z2) / 2, Y + 10 - CY);
        rec.niche = this._niche;
      } else {
        const aimed = L.gx != null && Math.hypot(L.gx - L.x, L.gy - L.y) > 12, down = !aimed && L.fixture === "can";   // can lights shine straight down
        const r = L.r ?? 40, z = L.z ?? 40;
        if (aimed || down) {
          rec.light = new T.SpotLight(0xffffff, 0, r * 3.2, down ? 0.9 : 0.75, 0.8, 1.1); rec.down = down;
          rec.light.target.position.set((down ? L.x : L.gx) - CX, down ? 0 : L.gz ?? 0, (down ? L.y : L.gy) - CY); grp.add(rec.light.target);
        } else rec.light = new T.PointLight(0xffffff, 0, r * 2.6, 1.1);
        rec.light.position.set(L.x - CX, z - 2, L.y - CY);
        rec.fixtures = [...this._buildFixture(L, grp), ...this._fixtures.filter((f) => Math.hypot(f.x - L.x, f.y - L.y) < 6).map((f) => f.mesh)];
        const sp = new T.Sprite(new T.SpriteMaterial({ map: this._glowTexture(), color: 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }));
        sp.position.set(L.x - CX, z - 1, L.y - CY); grp.add(sp); rec.sprite = sp;
      }
      this._tuneLight(rec);
      if (shadowBudget > 0 && g.kind === "glow" && cfg.shadows !== false && L.shadow !== false) {
        rec.light.castShadow = true; shadowBudget--;
        rec.light.shadow.mapSize.set(cfg.shadow_map_size || 512, cfg.shadow_map_size || 512);
        rec.light.shadow.bias = -0.002; rec.light.shadow.camera.near = 1;
        rec.light.shadow.blurSamples = 8;   // only used by the soft (VSM) shadows of the gradient-lighting look
      }
      grp.add(rec.light);
      return rec;
    });
  }

  /* a light's own fixture model (`L.fixture`), built into the light's group so it moves with it. Returns the meshes that
   * glow (emissive) when the light is on. Fixtures never cast shadows, or they would shadow their own light. */
  _buildFixture(L, grp) {
    const T = this.T, f = L.fixture; if (!FIXTURES[f] || f === "none") return [];
    const fix = new T.Group(); fix.userData.fixture = true; grp.add(fix);
    const cur = this._cur, nc = this._noCast; this._cur = fix; this._noCast = true;
    const H = this._cfg().scene?.wall_height ?? 46, x = L.x, y = L.y, z = L.z ?? 40, lit = [], glow = (c = "#fff1cf") => this._emissive(c);
    const metal = L.trim || "#2a2a2a", s = L.size > 0 ? L.size : 1;   // `size` scales the fixture about the bulb; cords still reach the ceiling
    if (f === "can") {
      this._cyl(x, y, z - 0.4 * s, 2.8 * s, 0.4 * s, "#e4e0d8", 20);
      lit.push(this._cyl(x, y, z - 0.5 * s, 2 * s, 0.2 * s, glow(), 20));
    } else if (f === "ceiling") {
      this._cyl(x, y, z - 0.6 * s, 5.2 * s, 0.6 * s, "#e8e4dc", 24);
      lit.push(this._cyl(x, y, z - 2.6 * s, 4.8 * s, 2 * s, glow(), 24, 3.6 * s));
    } else if (f === "pendant") {
      if (H - z > 4 * s) this._cyl(x, y, z + 3 * s, 0.25, H - z - 3 * s, "#3a3a3a", 6);
      this._cyl(x, y, z - 1 * s, 4.2 * s, 4 * s, L.shade || metal, 20, 1.2 * s);
      lit.push(this._cyl(x, y, z - 1.1 * s, 3.8 * s, 0.2 * s, glow(), 20));
    } else if (f === "bulb") {
      if (H - z > 3 * s) this._cyl(x, y, z + 1.4 * s, 0.2, H - z - 1.4 * s, "#3a3a3a", 6);
      this._cyl(x, y, z + 0.6 * s, 0.6 * s, 1 * s, "#8a7a5a", 8);
      lit.push(this._sphere(x, y, z, 1.4 * s, glow("#fff1c4")));
    } else if (f === "floorlamp") {
      this._cyl(x, y, 0, 4 * s, 1 * s, metal, 18); this._cyl(x, y, 0, 0.6 * s, Math.max(1, z - 3 * s), metal, 8);
      lit.push(this._cyl(x, y, z - 3 * s, 5.5 * s, 8 * s, glow("#fbf3e2"), 20, 4.5 * s));
    } else if (f === "tablelamp") {
      this._cyl(x, y, z - 9 * s, 2 * s, 6 * s, L.shade || "#cfcfcf", 14, 1.4 * s);
      lit.push(this._cyl(x, y, z - 3 * s, 4.5 * s, 6 * s, glow("#fbf3e2"), 20, 3.6 * s));
    } else if (f === "string") {
      const pts = L.points || [], mat = glow("#fff1c4"), cord = this._mat("#2b2b2b");
      const seg = (a, b) => {   // a cord piece between two [x, y, z] points
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); if (len < 0.01) return;
        const m = new T.Mesh(new T.CylinderGeometry(0.18, 0.18, len, 5), cord);
        m.position.set((a[0] + b[0]) / 2 - CX, (a[2] + b[2]) / 2, (a[1] + b[1]) / 2 - CY);
        m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(b[0] - a[0], b[2] - a[2], b[1] - a[1]).normalize()); this._add(m, false);
      };
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], sag = spanSag(L, Math.hypot(b[0] - a[0], b[1] - a[1]));
        let prev = [a[0], a[1], z];
        for (let k = 1; k <= 12; k++) { const t = k / 12, p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z - sag * 4 * t * (1 - t)]; seg(prev, p); prev = p; }
      }
      for (const [bx, by, drop] of stringBulbs(L)) {
        this._cyl(bx, by, z - drop - 1 * s, 0.35 * s, 1 * s, "#2b2b2b", 6);
        lit.push(this._sphere(bx, by, z - drop - 1.8 * s, 0.95 * s, mat));
      }
    }
    this._cur = cur; this._noCast = nc;
    return lit;
  }
  /* rebuild one light's model in place (dragging a string's ends), keeping its live colour */
  _refreshFixture(key) {
    const rec = this._lightGroups?.find((g) => g.keys.includes(key)); if (!rec) return;
    for (const c of [...rec.group.children]) if (c.userData.fixture) { rec.group.remove(c); this._disposeTree(c); }
    const L = (rec.L = rec.members[0] = this._get(key));
    if (rec.kind === "string") {
      rec.bulbs = this._buildFixture(L, rec.group);
      const [mx, my] = mean(L.points); rec.light.position.set(mx - CX, (L.z ?? 17) + 4, my - CY); this._tuneLight(rec);
    } else rec.fixtures = this._buildFixture(L, rec.group);
    this._update();
  }

  /* Daylight through windows: the roof blocks the sun except through openings, but a bright sky still lights a room.
   * Each window, glass door or glass wall between a roofed room and the outside gets a soft, shadowless spot light
   * aimed into the room, scaled by daylight in _update (`window_light` multiplies it; `daylight: false` on an opening skips it). */
  _buildSkyLights(cfg) {
    const T = this.T, sc = cfg.scene || {};
    this._skyLights = [];
    if (this._plan || cfg.window_light === 0) return;
    const rooms = (sc.floors || []).filter((f) => f.pts?.length >= 3 && f.name !== "rug" && f.roof !== false && (f.roof === true || !OUTDOOR.test(f.name || "")));
    const indoor = (x, y) => rooms.some((f) => inPoly(x, y, f.pts));
    const H = sc.wall_height ?? 46, aps = [];
    for (const o of sc.openings || []) {
      if (o.daylight === false || !(o.kind === "window" || o.daylight || (o.kind === "door" && /glass|sliding/.test(o.style || "")))) continue;
      const [ax, ay] = rotPt(1, 0, 0, 0, o.rot || 0);
      aps.push({ x: o.x, y: o.y, ax, ay, w: o.w, z: o.z || 0, h: o.h ?? H });
    }
    for (const v of sc.overlays || []) {
      if (v.type === "glasswall") aps.push({ x: v.x, y: (v.y1 + v.y2) / 2, ax: 0, ay: 1, w: Math.abs(v.y2 - v.y1), z: 0, h: H });
      else if (v.type === "cornerglass") aps.push({ x: (v.x1 + v.x2) / 2, y: v.y, ax: 1, ay: 0, w: Math.abs(v.x2 - v.x1), z: 0, h: H });
    }
    aps.sort((a, b) => b.w - a.w);
    for (const a of aps.slice(0, cfg.max_window_lights ?? 10)) {
      let [nx, ny] = [-a.ay, a.ax];   // pick the normal that points from outside into a room
      const p = 10, inA = indoor(a.x + nx * p, a.y + ny * p), inB = indoor(a.x - nx * p, a.y - ny * p);
      if (inA === inB) continue;   // interior partition, or nowhere near a room
      if (!inA) { nx = -nx; ny = -ny; }
      const reach = Math.min(90, Math.max(30, a.w * 0.8)), top = Math.min(a.z + a.h, H) - 4;
      const L = new T.SpotLight(0xe4ecff, 0, reach * 2.4, Math.min(1.3, Math.atan((a.w / 2 + 20) / reach) + 0.35), 1, 1);
      L.position.set(a.x + nx * 3 - CX, Math.max(a.z + 6, top), a.y + ny * 3 - CY);
      L.target.position.set(a.x + nx * reach - CX, 0, a.y + ny * reach - CY);
      this._world.add(L, L.target);
      this._skyLights.push({ light: L, w: a.w });
    }
  }

  /* ---------- picking ---------- */
  _keyGroup(key) {
    if (!this._items.has(key)) { const g = new this.T.Group(); g.userData.key = key; this._world.add(g); this._items.set(key, g); }
    return this._items.get(key);
  }
  _buildTargets() {
    const T = this.T, cfg = this._cfg(), editing = !!this._edit;
    this._targets = [];
    const addTarget = (key, x, y, z, r, entity, action) => {
      const m = new T.Mesh(new T.SphereGeometry(Math.max(r, 3) * 0.9, 8, 6), new T.MeshBasicMaterial({ visible: false }));
      m.position.set(x - CX, z, y - CY); m.userData = { entity, action }; this._keyGroup(key).add(m); this._targets.push(m);
    };
    /* string lights: a tap anywhere along the cord toggles them, so the target is a tube that follows each sagging span */
    const stringTarget = (key, L) => {
      const pts = L.points, z = L.z ?? (L.fixture === "string" ? 40 : 20), r = Math.max(3, (L.hit ?? 10) * 0.6), mat = new T.MeshBasicMaterial({ visible: false });
      const up = new T.Vector3(0, 1, 0);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], sag = spanSag(L, Math.hypot(b[0] - a[0], b[1] - a[1])) + 2;   // bulbs hang ~2 below the cord
        const at = (t) => new T.Vector3(a[0] + (b[0] - a[0]) * t - CX, z - sag * 4 * t * (1 - t), a[1] + (b[1] - a[1]) * t - CY);
        for (let k = 0; k < 6; k++) {
          const p = at(k / 6), q = at((k + 1) / 6), len = p.distanceTo(q); if (len < 0.01) continue;
          const m = new T.Mesh(new T.CapsuleGeometry(r, len, 2, 6), mat);
          m.position.copy(p).add(q).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(up, q.clone().sub(p).normalize());
          m.userData = { entity: L.entity, action: L.tap || "toggle" }; this._keyGroup(key).add(m); this._targets.push(m);
        }
      }
    };
    const marker = (key, p, color) => {
      const m = new T.Mesh(new T.SphereGeometry(2.4, 12, 8), new T.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
      m.renderOrder = 10; m.position.set(p[0] - CX, p[2], p[1] - CY); m.userData.key = key; this._keyGroup(key).add(m);
    };
    (cfg.lights || []).forEach((L, i) => {
      if (editing) { marker("l:" + i, itemCenter("l", L), 0xffd166); return; }
      if (L.hit === 0) return;
      if (L.points?.length >= 2) { stringTarget("l:" + i, L); if (L.hx == null) return; }
      const [x, y, z] = L.hx != null ? [L.hx, L.hy, L.hz ?? 0] : [L.x ?? L.points[0][0], L.y ?? L.points[0][1], L.z ?? 20];
      addTarget("l:" + i, x, y, z, L.hit ?? 10, L.entity, L.tap || "toggle");
    });
    (cfg.hotspots || []).forEach((H, i) => {
      if (editing) marker("h:" + i, [H.x, H.y, H.z ?? 10], 0x5aa9ff);
      else addTarget("h:" + i, H.x, H.y, H.z ?? 10, H.hit ?? 12, H.entity, H.tap || "more-info");
    });
    if (!editing) for (const sc of this._screens || []) { sc.mesh.userData = { entity: sc.o.entity, action: sc.o.tap || "more-info" }; this._targets.push(sc.mesh); }
    if (editing) {
      (cfg.chips || []).forEach((c, i) => marker("c:" + i, [c.x, c.y, c.z ?? 50], 0x6fd39a));
      (cfg.doors || []).forEach((d, i) => marker("d:" + i, [d.x, d.y, d.z ?? 22], 0xef6b5b));
    }
  }
  _bindPicking() {
    const T = this.T, el = this._renderer.domElement;
    const ray = new T.Raycaster(), v = new T.Vector2();
    let down = null, timer = null;
    const setRay = (ev) => {
      const r = el.getBoundingClientRect();
      v.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, this._cam);
    };
    const pick = (ev) => { setRay(ev); return ray.intersectObjects(this._targets, false)[0]?.object.userData; };
    /* the editable item under the pointer. Furniture mode ignores walls/openings/blueprint; plan mode ignores everything else. */
    /* every editable item under the pointer, nearest first. Furniture mode ignores walls/openings/blueprint/rooms;
     * plan mode ignores everything else. Clicking the same spot again steps through this list (plan mode). */
    const pickKeys = (ev) => {
      setRay(ev);
      const out = [];
      for (const hit of ray.intersectObject(this._world, true)) {
        const o = hit.object;
        if (o.isSprite || o.userData.joint || o.userData.vert || o.userData.mid) continue;
        if (o.userData.wall && !this._plan) continue;
        let key = null;
        for (let p = o; p && p !== this._world; p = p.parent) if (p.userData.key) { key = p.userData.key; break; }
        if (key) {
          const isPlan = PLAN.has(key[0]);
          if (this._plan ? !isPlan || o.userData.locked : isPlan) continue;
          if (!out.includes(key)) out.push(key);
          if (!this._plan) break;
        } else if (o.userData.floor) break;
      }
      return this._plan ? [...out.filter((k) => k[0] === "n"), ...out.filter((k) => k[0] !== "n")] : out;   // doors and windows sit inside walls: offer them first
    };
    const pickKey = (ev) => pickKeys(ev)[0] || null;
    /* handles: a selected string light's points and span midpoints; in plan mode the selected room's corners, then its
     * edge midpoints, then wall joints */
    const pickHandle = (ev) => {
      setRay(ev);
      for (const [arr, type] of [[this._sptMeshes, "spt"], [this._smidMeshes, "smid"], [this._vertMeshes, "vert"], [this._midMeshes, "mid"], [this._jointMeshes, "joint"]]) {
        if (!arr?.length) continue;
        const h = ray.intersectObjects(arr, false)[0];
        if (h) return { type, d: h.object.userData[type] };
      }
      return null;
    };
    /* click without dragging: in plan mode a repeat click on the same spot selects the next thing underneath */
    const clickPick = (ev, extra = []) => {
      const keys = [...pickKeys(ev)]; for (const k of extra) if (!keys.includes(k)) keys.push(k);
      const add = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      if (!this._plan || add) return this._clickSelect(keys[0] || null, add, ev.altKey);
      const i = keys.indexOf(this._edit.primary);
      this._clickSelect(keys.length ? keys[(i + 1) % keys.length] : null, false, true);
      if (keys.length > 1 && i < 0 && !this._cycleHinted) { this._cycleHinted = true; this._toast("Several things here — click again to pick the next one underneath"); }
    };
    const floorPoint = (ev, y) => { setRay(ev); return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -y), new T.Vector3()); };
    const planPt = (ev) => { const p = floorPoint(ev, 0); return p ? [p.x + CX, p.z + CY] : null; };
    const ptrs = new Set();
    const camSnap = () => ({ pos: this._cam.position.clone(), target: this._controls.target.clone(), zoom: this._cam.zoom });
    const camRestore = (c) => {
      const oc = this._controls, damp = oc.enableDamping;
      oc.enableDamping = false; oc.update();                       // flush any pan/orbit that already started
      this._cam.position.copy(c.pos); oc.target.copy(c.target); this._cam.zoom = c.zoom; this._cam.updateProjectionMatrix();
      oc.update(); oc.enableDamping = damp;
    };
    const cancelDrag = () => {   // a second finger arrived: put things back and hand over to the camera
      if (down?.dragging && this._drag) { this._pivot.position.copy(down.piv0); this._pivot.quaternion.copy(this._drag.quat); this._dragPreview(); this._drag = null; }
      if (down?.jdrag) { this._work = JSON.parse(down.snap0); if (down.spt) this._commit(); else this._rebuildPlan(); this._hideTip(); }
      if (down) { down.key = null; down.handle = null; down.vert = down.spt = null; down.dragging = down.jdrag = false; down.cancelled = true; }
      this._controls.enabled = true;
    };
    el.addEventListener("pointerdown", (ev) => {
      ptrs.add(ev.pointerId);
      if (this._edit) {
        if (ptrs.size > 1) { cancelDrag(); return; }
        down = { x: ev.clientX, y: ev.clientY, edit: true, touch: ev.pointerType !== "mouse", cam: camSnap() }; this._tcUsed = false;
        if (this._plan && this._tool !== "select") { down.tool = true; return; }   // drawing / placing: acts on click
        // a string light's handles win over the move gizmo (its arrows often point straight at them)
        if (this._sptMeshes?.length && ev.button === 0 && !(ev.shiftKey || ev.ctrlKey || ev.metaKey)) {
          const h = pickHandle(ev);
          if (h?.type === "spt" || h?.type === "smid") { down.handle = h; ev.stopImmediatePropagation(); return; }
        }
        // press on furniture / a marker can drag it — with a mouse anything, on touch only what's already selected
        if (ev.button === 0 && !(ev.shiftKey || ev.ctrlKey || ev.metaKey) && !this._tc?.axis) {
          if (this._plan || this._sptMeshes?.length) {
            const h = pickHandle(ev);
            if (h && (h.type !== "joint" || !down.touch || h.d.m.some(([i]) => this._edit.sel.has("w:" + i)))) { down.handle = h; return; }
          }
          const keys = pickKeys(ev), key = keys.find((k) => this._edit.sel.has(k)) || keys[0];
          // rooms cover most of the plan, so they only drag once selected (otherwise a drag pans)
          if (key && ((!down.touch && key[0] !== "r") || this._edit.sel.has(key))) down.key = key;
        }
        return;
      }
      down = { x: ev.clientX, y: ev.clientY, hit: pick(ev), held: false };
      if (down.hit) timer = setTimeout(() => { if (down) { down.held = true; this._moreInfo(down.hit.entity); } }, 500);
    }, { capture: true });   // capture: runs before the camera controls, so a 2nd finger re-enables them in time
    el.addEventListener("pointermove", (ev) => {
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > (down.touch ? 8 : 5)) { clearTimeout(timer); down.hit = null; down.moved = true; }
      // drag a handle: a wall joint (every wall end at that corner follows), a room corner, or a room edge midpoint (adds a corner)
      if (down?.handle && down.moved && this._edit && ptrs.size === 1) {
        const h = down.handle;
        if (!down.jdrag) {
          this._controls.enabled = false; camRestore(down.cam);
          down.jdrag = true; down.snap0 = JSON.stringify(this._work);
          for (const hp of this._helpers || []) hp.visible = false;
          if (h.type === "joint") down.m = h.d.m.map((x) => [...x]);
          else if (h.type === "spt" || h.type === "smid") {   // string light: move a point, or bend a span by adding one
            const L = this._get(h.d.key);
            if (h.type === "smid") { const a = L.points[h.d.k], b = L.points[h.d.k + 1]; L.points.splice(h.d.k + 1, 0, [R1((a[0] + b[0]) / 2), R1((a[1] + b[1]) / 2)]); }
            down.spt = { key: h.d.key, k: h.type === "smid" ? h.d.k + 1 : h.d.k };
          } else {
            const f = this._get(h.d.key);
            if (h.type === "mid") { const a = f.pts[h.d.k], b = f.pts[(h.d.k + 1) % f.pts.length]; f.pts.splice(h.d.k + 1, 0, [R1((a[0] + b[0]) / 2), R1((a[1] + b[1]) / 2)]); }
            down.vert = { key: h.d.key, k: h.type === "mid" ? h.d.k + 1 : h.d.k };
          }
        }
        if (down.spt) {
          const L = this._get(down.spt.key), q = floorPoint(ev, L.z ?? 17); if (!q) return;
          let pt = [q.x + CX, q.z + CY];
          if (this._edit.snap) pt = pt.map((v) => Math.round(v));
          L.points[down.spt.k] = pt.map(R1);
          this._refreshFixture(down.spt.key); this._buildStringHandles();
          this._showTip(ev, `${this._fmtLen(stringLen(L.points))} · ${stringCount(L)} bulbs`);
          this._requestRender();
          return;
        }
        const p = planPt(ev); if (!p) return;
        if (down.vert) {
          const f = this._get(down.vert.key), n = f.pts.length, k = down.vert.k, prev = f.pts[(k - 1 + n) % n];
          const s = this._snapPoint(p, { from: prev, room: down.vert });
          f.pts[k] = [R1(s.p[0]), R1(s.p[1])];
          this._vsel = down.vert;
          this._rebuildPlan(); this._showMarker(s.p, s.kind);
          this._showTip(ev, this._fmtArea(polyArea(f.pts)));
          return;
        }
        const segs = this._work.scene.wall_segs, [i0, e0] = down.m[0], other = segs[i0][e0 === "a" ? "b" : "a"];
        const s = this._snapPoint(p, { from: down.m.length === 1 ? other : null, exclude: down.m });
        for (const [i, e] of down.m) segs[i][e] = [R1(s.p[0]), R1(s.p[1])];
        this._rebuildPlan(); this._showMarker(s.p, s.kind);
        this._showTip(ev, down.m.map(([i]) => this._fmtLen(segDir(segs[i])[2])).join(" · "));
        return;
      }
      if (down?.key && down.moved && this._edit && ptrs.size === 1) {
        if (this._tcDragging) { down.key = null; return; }
        if (!down.dragging) {
          this._controls.enabled = false; camRestore(down.cam);
          if (!this._edit.sel.has(down.key)) this._clickSelect(down.key, false, ev.altKey);
          down.prevMode = this._edit.mode; down.rot = down.prevMode === "rotate";   // scale mode drags move things too
          down.piv0 = this._pivot.position.clone();
          down.p0 = floorPoint(ev, down.piv0.y);
          if (!down.p0) { down.key = null; this._controls.enabled = true; return; }
          this._dragStart(down.rot ? "rotate" : "translate"); down.dragging = true; el.style.cursor = "grabbing";
        }
        const p = floorPoint(ev, down.piv0.y); if (!p) return;
        if (down.rot) {   // rotate mode: turn the selection around its centre as the pointer circles it
          const a0 = Math.atan2(down.p0.z - down.piv0.z, down.p0.x - down.piv0.x), a1 = Math.atan2(p.z - down.piv0.z, p.x - down.piv0.x);
          let dr = -(a1 - a0); if (this._edit.snap) dr = Math.round(dr / (Math.PI / 12)) * (Math.PI / 12);
          this._pivot.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), dr).multiply(this._drag.quat);
        } else {
          let dx = p.x - down.p0.x, dz = p.z - down.p0.z;
          if (this._edit.snap) { dx = Math.round(dx / 2) * 2; dz = Math.round(dz / 2) * 2; }
          this._pivot.position.set(down.piv0.x + dx, down.piv0.y, down.piv0.z + dz);
        }
        this._dragPreview();
        return;
      }
      if (this._plan && this._tool !== "select" && (!down || !down.moved) && ev.pointerType === "mouse") { this._toolHover(ev, planPt(ev)); return; }
      if (!down && ev.pointerType === "mouse") {
        if (this._edit) {
          if ((this._plan || this._sptMeshes?.length) && pickHandle(ev)) { el.style.cursor = "move"; return; }
          const k = pickKey(ev); el.style.cursor = k ? (this._edit.sel.has(k) ? "move" : "pointer") : "grab";
        } else el.style.cursor = pick(ev) ? "pointer" : "grab";
      }
    });
    const up = (ev) => {
      ptrs.delete(ev.pointerId);
      clearTimeout(timer);
      if (down?.edit) {
        if (ptrs.size) return;                       // wait until the last finger lifts
        if (down.jdrag) { this._edit.undo.push(down.snap0); this._edit.redo = []; this._hideTip(); this._hidePreview(); this._commit(); }
        else if (down.dragging) this._dragEnd();
        else if (!down.moved && !down.cancelled && !this._tcUsed && !this._tcDragging && ev.type === "pointerup") {
          if (down.tool) { const p = planPt(ev); if (p) this._toolClick(p, pickKey(ev), ev); }
          else if (down.handle?.type === "vert") { this._vsel = down.handle.d; this._buildRoomHandles(); this._renderInspector(); this._requestRender(); }
          else if (down.handle?.type === "joint") clickPick(ev, down.handle.d.m.map(([i]) => "w:" + i));
          else clickPick(ev);
        }
        if (!this._tcDragging) this._controls.enabled = true;
      } else if (down && down.hit && !down.held && ev.type === "pointerup") {
        if (down.hit.action === "toggle") this._hass.callService("homeassistant", "toggle", { entity_id: down.hit.entity });
        else this._moreInfo(down.hit.entity);
      }
      down = null;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", () => { if (this._plan && !down) this._hidePreview(true); });
  }
  _moreInfo(entityId) { this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } })); }
  _bindTap(node, entity) {
    if (!entity) return;
    node.addEventListener("click", () => this._moreInfo(entity));
  }
  /* badge taps: toggle lights/switches, run scripts/scenes/buttons, otherwise more-info; hold = more-info */
  _bindEntityTap(node, entity, tap) {
    let t = null, held = false;
    node.addEventListener("pointerdown", () => { held = false; t = setTimeout(() => { held = true; this._moreInfo(entity); }, 500); });
    node.addEventListener("pointerleave", () => clearTimeout(t));
    node.addEventListener("pointerup", () => { clearTimeout(t); if (!held && !this._edit) this._entityAction(entity, tap); });
  }
  _entityAction(entity, tap) {
    const d = entity.split(".")[0], h = this._hass;
    const a = tap || (TOGGLE_DOMAINS.has(d) ? "toggle" : ["script", "scene"].includes(d) ? "run" : ["button", "input_button"].includes(d) ? "press" : "more-info");
    if (a === "toggle") h.callService("homeassistant", "toggle", { entity_id: entity });
    else if (a === "run") h.callService(d, "turn_on", { entity_id: entity });
    else if (a === "press") h.callService(d, "press", { entity_id: entity });
    else this._moreInfo(entity);
  }

  /* ---------- screens ---------- */
  _drawScreen(sc, st, boost) {
    const a = st?.attributes || {}, on = !!st && !SCREEN_OFF.has(st.state);
    const pic = on ? a.entity_picture_local || a.entity_picture || "" : "";
    const title = on ? a.media_title || a.app_name || a.source || a.friendly_name || "" : "";
    const sub = on ? a.media_artist || a.media_series_title || a.media_album_name || (a.media_title && a.app_name) || "" : "";
    const sig = [st?.state, pic, title, sub].join("|");
    const setLight = () => { sc.light.intensity = on && sc.rgb ? 20 * boost * ((sc.o.w || 32) / 32) * (st.state === "playing" ? 1 : 0.5) : 0; if (sc.rgb) sc.light.color.setRGB(...sc.rgb); };
    if (sc.sig === sig) return setLight();
    sc.sig = sig;
    const g = sc.canvas.getContext("2d"), W = 512, H = 288;
    const fit = (txt, max) => { let t = String(txt); if (g.measureText(t).width <= max) return t; while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1); return t + "…"; };
    const paint = (img) => {
      if (sc.sig !== sig || !this._renderer) return;
      g.save(); g.fillStyle = "#050506"; g.fillRect(0, 0, W, H);
      if (!on) {
        const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, "rgba(255,255,255,.07)"); gr.addColorStop(0.45, "rgba(255,255,255,0)");
        g.fillStyle = gr; g.fillRect(0, 0, W, H); sc.rgb = null;
      } else {
        let textX = 32, textW = W - 64, textY = H - 64;
        if (img) {
          const ar = img.width / img.height, cover = Math.max(W / img.width, H / img.height);
          g.filter = "blur(16px)"; g.drawImage(img, (W - img.width * cover) / 2, (H - img.height * cover) / 2, img.width * cover, img.height * cover); g.filter = "none";
          g.fillStyle = "rgba(0,0,0,.5)"; g.fillRect(0, 0, W, H);
          if (ar > 1.3) {   // video / app thumbnail: fill the screen, caption on a gradient
            const s2 = Math.min(W / img.width, H / img.height); g.drawImage(img, (W - img.width * s2) / 2, (H - img.height * s2) / 2, img.width * s2, img.height * s2);
            const gr = g.createLinearGradient(0, H * 0.55, 0, H); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.8)"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
          } else {           // album art: square cover on the left, text beside it
            const S = H - 56, sw = S * Math.min(ar, 1.2);
            g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = 18; g.drawImage(img, 28, 28, sw, S); g.shadowBlur = 0;
            textX = 28 + sw + 26; textW = W - textX - 24; textY = H / 2 - 4;
          }
          try { const t = document.createElement("canvas"); t.width = t.height = 6; const tg = t.getContext("2d"); tg.drawImage(img, 0, 0, 6, 6);
            const d = tg.getImageData(0, 0, 6, 6).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
            const n = d.length / 4, mx = Math.max(r, gg, b) / n || 1; sc.rgb = [r / n / mx, gg / n / mx, b / n / mx]; } catch (e) { sc.rgb = [1, 1, 1]; }
        } else {
          const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, "#23324a"); gr.addColorStop(1, "#3a2340"); g.fillStyle = gr; g.fillRect(0, 0, W, H);
          textY = H / 2 + 6; sc.rgb = [0.6, 0.7, 1];
        }
        g.fillStyle = "#fff"; g.font = "600 30px system-ui, sans-serif"; g.fillText(fit(title, textW), textX, textY);
        g.fillStyle = "rgba(255,255,255,.72)"; g.font = "400 21px system-ui, sans-serif"; if (sub) g.fillText(fit(sub, textW), textX, textY + 32);
        g.fillStyle = "rgba(255,255,255,.85)"; g.font = "600 18px system-ui, sans-serif";
        g.fillText(st.state === "playing" ? "▶" : st.state === "paused" ? "❚❚" : "", W - 40, 38);
      }
      g.restore(); sc.tex.needsUpdate = true; setLight(); this._requestRender();
    };
    if (pic) { const img = new Image(); img.crossOrigin = "anonymous"; img.onload = () => paint(img); img.onerror = () => paint(null); img.src = pic; }
    else paint(null);
  }

  /* ---------- html overlays ---------- */
  _buildOverlays() {
    const cfg = this._cfg(), ov = this._ov;
    ov.innerHTML = "";
    this._anchors = [];
    this._chips = (cfg.chips || []).map((cc) => {
      const d = document.createElement("div"); d.className = "chip"; ov.append(d);
      if (cc.size > 0 && cc.size !== 1) d.style.fontSize = `max(${9 * cc.size}px, ${1.1 * cc.size}cqw)`;
      if (cc.entity) this._bindEntityTap(d, cc.entity, cc.tap);
      else this._bindTap(d, cc.tap_entity || cc.temperature || cc.climate || cc.humidity);
      this._anchors.push({ node: d, p: [cc.x, cc.y, cc.z ?? 50] });
      return { cfg: cc, node: d };
    });
    this._doors = (cfg.doors || []).map((dc) => {
      const d = document.createElement("div"); d.className = "door"; d.title = dc.name || dc.entity; d.innerHTML = "<ha-icon></ha-icon>"; ov.append(d);
      if (dc.size > 0 && dc.size !== 1) d.style.width = d.style.height = `max(${14 * dc.size}px, ${1.8 * dc.size}cqw)`;
      this._bindTap(d, dc.entity);
      this._anchors.push({ node: d, p: [dc.x, dc.y, dc.z ?? 22] });
      return { cfg: dc, node: d };
    });
    this._weather = null;
    if (cfg.weather) {
      const w = document.createElement("div"); w.className = "weather";
      w.innerHTML = `<ha-icon></ha-icon><div class="t"></div><div class="s"></div>`; ov.append(w);
      this._bindTap(w, cfg.weather); this._weather = w;
    }
  }
  _placeOverlays() {
    const T = this.T, v = new T.Vector3();
    for (const a of [...(this._anchors || []), ...(this._roomLabels || [])]) {
      v.set(a.p[0] - CX, a.p[2], a.p[1] - CY).project(this._cam);
      a.node.style.left = ((v.x + 1) / 2) * 100 + "%"; a.node.style.top = ((1 - v.y) / 2) * 100 + "%";
    }
  }
  _fmt(entity, digits = 0) {
    const st = this._hass.states[entity];
    if (!st || ["unknown", "unavailable"].includes(st.state)) return "–";
    const n = Number(st.state); return isNaN(n) ? st.state : n.toFixed(digits);
  }

  /* ---------- looks ----------
   * light = sky/ground gradient lighting with a cool fill and soft shadows, ao = ambient occlusion,
   * stage = soft drop shadow under the house + spotlit backdrop, bloom = glow around lit lamps (night only).
   * Each is a 0..1 strength (lookOf). The post-processing passes (ao, bloom) load on first use. */
  _applyLook(day) {   // day: daylight 0 (night) .. 1, from _update
    const T = this.T, L = lookOf(this._cfg()), r = this._renderer, t = L.light, mix = (a, b) => a + (b - a) * t, night = day < 0.5;
    const A = Math.max(0, Math.min(1, +(this._cfg().ambient ?? AMBIENT) || 0));   // daytime room fill: the even light everywhere
    this._amb.intensity = mix(0.22 + 0.53 * day * A, 0.08 + 0.17 * day * A);
    this._hemi.intensity = mix(0.16 + 0.39 * day * A, 0.35 + 0.9 * day * A);
    this._hemi.color.lerpColors(new T.Color(0xdfe8ff), new T.Color(0xd6e4ff), t);
    this._hemi.groundColor.lerpColors(new T.Color(0x3a2f25), new T.Color(0x5a4636), t);
    this._sun.intensity *= mix(1, 1.3);   // _update set the sun from its elevation
    this._fill.intensity = (0.06 + 0.29 * day) * t;
    r.toneMappingExposure = mix(1, 1.05);
    if (!this._stage && L.stage && !this._plan) this._buildStageShadow(this._cfg().scene || {});
    for (const m of [this._stage, this._stageSpot]) if (m) { m.visible = L.stage > 0; m.material.opacity = L.stage; }
    const sig = JSON.stringify(L) + night;
    if (sig !== this._lkSig) {   // things that need a shadow re-render or a shader recompile: only when the look changes
      this._lkSig = sig;
      this._fill.visible = t > 0;
      const type = t > 0 ? T.VSMShadowMap : T.PCFSoftShadowMap;
      if (r.shadowMap.type !== type) r.shadowMap.type = type;
      Object.assign(this._sun.shadow, { radius: 1 + 8 * t, blurSamples: 16, bias: mix(-0.0008, -0.0004), normalBias: 0.6 * t });
      for (const g of this._lightGroups) if (g.light.castShadow) g.light.shadow.radius = 1 + 3 * t;
      r.shadowMap.needsUpdate = true;
      const s = L.stage, hex = (a, b) => "#" + new T.Color(a).lerp(new T.Color(b), s).getHexString();
      const card = this.shadowRoot.querySelector("ha-card");
      if (card) card.style.background = s ? hex(0x1b1a18, 0x141311) : "";   // the spotlight itself is _stageSpot, in the scene
    }
    if ((L.ao || L.bloom) && !this._composer) this._loadPost();
    const bloom = night && L.bloom > 0;   // by day the lamps are dim and bloom only washes out white surfaces
    if (this._aoPass) { this._aoPass.enabled = L.ao > 0; this._aoPass.blendIntensity = L.ao; }
    if (this._bloomPass) { this._bloomPass.enabled = bloom; this._bloomPass.strength = 0.9 * L.bloom; }
    this._usePP = !!this._composer && !this._plan && (L.ao > 0 || bloom);   // floor plan editing stays plain and quick
    // the bloom pass writes opaque alpha, so the card background has to be painted into the scene
    const bgKey = this._usePP && bloom ? L.stage + "|" + r.toneMappingExposure : null;   // _sceneBg reads computed styles: only when it changes
    if (bgKey !== this._bgKey) { this._bgKey = bgKey; this._scene.background = bgKey ? this._sceneBg(L.stage) : null; }
  }
  /* the card background as a scene background colour. The output pass tone-maps it, so undo ACES first (per channel; fine for greys). */
  _sceneBg(s) {
    const T = this.T, k = this._renderer.toneMappingExposure / 0.6;
    const aces = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
    const untone = (c) => { for (const ch of ["r", "g", "b"]) { let lo = 0, hi = 1; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (aces(m * k) < c[ch]) lo = m; else hi = m; } c[ch] = lo; } return c; };
    const bg = new T.Color(((s) => s.getPropertyValue("--ha-3dhome-bg").trim() || s.getPropertyValue("--iso-bg").trim())(getComputedStyle(this)) || "#1b1a18");
    return untone(s ? bg.lerp(new T.Color(0x141311), s) : bg);   // the stage spotlight is a mesh (_stageSpot), so this stays flat
  }
  async _loadPost() {
    const gen = this._gen, cfg = this._config;
    if (this._ppLoading === gen) return;
    this._ppLoading = gen;
    try {
      const [{ EffectComposer }, { RenderPass }, { OutputPass }, { GTAOPass }, { UnrealBloomPass }] =
        await Promise.all(["EffectComposer", "RenderPass", "OutputPass", "GTAOPass", "UnrealBloomPass"].map((f) => import((cfg.jsm_url || JSM) + "postprocessing/" + f + ".js/+esm")));
      if (gen !== this._gen || !this._renderer) return;
      const T = this.T, comp = (this._composer = new EffectComposer(this._renderer));
      comp.addPass(new RenderPass(this._scene, this._cam));
      const ao = (this._aoPass = new GTAOPass(this._scene, this._cam, 256, 256));
      ao.updateGtaoMaterial({ radius: 20, distanceExponent: 1.3, thickness: 8, scale: 1.8, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      // sprites (glows), glass and invisible hit targets must not occlude anything
      const hide = ao.overrideVisibility.bind(ao);
      ao.overrideVisibility = () => { hide(); this._scene.traverse((o) => { const m = o.material;
        if (o.isSprite || (m && !Array.isArray(m) && (!m.visible || m.transparent || !m.depthWrite))) o.visible = false; }); };
      comp.addPass(ao);
      comp.addPass((this._bloomPass = new UnrealBloomPass(new T.Vector2(256, 256), 0.45, 0.55, 0.72)));
      comp.addPass(new OutputPass());
      this._resize(); this._update(); this._requestRender();
    } catch (e) { console.warn("ha-3dhome-card: effects unavailable", e); }
    finally { if (this._ppLoading === gen) this._ppLoading = null; }
  }

  /* ---------- live update ---------- */
  _update() {
    const T = this.T, h = this._hass, cfg = this._cfg();
    if (!h || !this._lightGroups) return;
    const sun = h.states[cfg.sun_entity || "sun.sun"], pos = this._sunPos(), north = Number(cfg.scene?.north) || 0;
    // daylight 0..1: from the sun's elevation (civil twilight is −6°), or sun.sun's state when there is no position
    let el = pos ? pos.elevation : (sun && sun.state === "below_horizon" ? -10 : 45);
    if (cfg.night_mode === "never" || this._plan) el = Math.max(el, this._plan ? 55 : 30);   // plan editing is always lit
    if (cfg.night_mode === "always" && !this._plan) el = -18;
    const day = smooth(-6, 4, el);
    if (this._plan) this._placeSun(0, 89, 0);   // (nearly) overhead: full-height walls would otherwise throw long shadows across the plan
    else if (pos) this._placeSun(pos.azimuth, Math.max(el, 7), north);   // keep a little height so dawn shadows stay on the map
    else this._sun.position.set(-260, 420, -160);
    this._sun.intensity = 1.3 * smooth(-1, 8, el);
    const warm = smooth(2, 30, el);   // orange at sunrise/sunset, white-ish by mid-morning
    this._sun.color.setRGB(1, 0.62 + 0.325 * warm, 0.38 + 0.483 * warm);
    this._applyLook(day);   // ambient + hemisphere (and the optional looks)
    for (const s of this._skyLights || []) s.light.intensity = 160 * Math.sqrt(s.w / 60) * day * (cfg.window_light ?? 1);
    const boost = 1 - 0.45 * day;

    for (const g of this._lightGroups) {
      let sum = 0, rgb = [0, 0, 0], anyOn = false;
      for (const L of g.members) {
        const st = h.states[L.entity];
        if (!st || st.state !== "on") continue;
        anyOn = true;
        const bri = (st.attributes.brightness ?? 255) / 255, c = L.color || stateRgb(st);
        sum += bri; rgb = rgb.map((v, i) => v + c[i] * bri);
      }
      const n = g.members.length;
      const color = (this._tmpCol ||= new T.Color());
      if (anyOn && sum > 0) color.setRGB(rgb[0] / sum / 255, rgb[1] / sum / 255, rgb[2] / sum / 255); else color.setRGB(1, 0.8, 0.55);
      const avg = Math.min(1, sum / n), level = anyOn ? (0.06 + 0.94 * avg) * Math.sqrt(n) : 0;   // follows the bulbs' real brightness; per-light settings set the top end
      const L = g.L, strength = (cfg.light_strength ?? 1) * (L.intensity ?? 1);
      if (L.saturation != null && L.saturation !== 1) { const c = {}; color.getHSL(c); color.setHSL(c.h, Math.min(1, c.s * Math.max(0, L.saturation)), c.l); }
      g.light.color.copy(color);
      if (g.kind === "string") {
        g.light.intensity = level * 48 * boost * strength;
        for (const b of g.bulbs) { b.material.emissive.copy(color); b.material.emissiveIntensity = anyOn ? 2.2 : 0.05; }
      } else if (g.kind === "niche") {
        g.light.intensity = level * 60 * boost * strength;
        if (g.niche) { g.niche.material.emissive.copy(color); g.niche.material.emissiveIntensity = anyOn ? 0.7 : 0.02; }
      } else {
        const r = L.r ?? 40;
        g.light.intensity = level * (g.light.isSpotLight ? 175 : 115) * boost * strength * (r / 60);
        for (const f of g.fixtures) { f.material.emissive.copy(color); f.material.emissiveIntensity = anyOn ? 0.5 + 1.1 * avg : 0.04; }
        g.sprite.material.color.copy(color); g.sprite.material.opacity = anyOn ? 0.3 + 0.65 * avg : 0;
      }
    }

    for (const sc of this._screens || []) this._drawScreen(sc, h.states[sc.o.entity], boost);
    for (const { cfg: cc, node } of this._chips) {
      const parts = [];
      if (cc.entity) {
        const st = h.states[cc.entity];
        const txt = !st ? "–" : h.formatEntityState ? h.formatEntityState(st)
          : `${st.state}${st.attributes.unit_of_measurement ? " " + st.attributes.unit_of_measurement : ""}`;
        const name = cc.label ?? (cc.show_name ? st?.attributes.friendly_name || cc.entity : "");
        const html = `<ha-icon icon="${esc(cc.icon || entIcon(st, cc.entity))}"></ha-icon>${name ? `<span>${esc(name)}</span>` : ""}`
          + (cc.show_state === false ? "" : `<span class="item">${esc(txt)}</span>`);
        node.classList.toggle("act", !!st && ACTIVE.has(st.state));
        if (node._html !== html) { node.innerHTML = html; node._html = html; node.style.display = ""; }
        continue;
      }
      if (cc.icon) parts.push(`<ha-icon icon="${esc(cc.icon)}"></ha-icon>`);
      if (cc.label) parts.push(`<span>${esc(cc.label)}</span>`);
      if (cc.climate) {
        const st = h.states[cc.climate];
        if (st) {
          const cur = st.attributes.current_temperature;
          parts.push(`<span class="item"><ha-icon icon="mdi:thermostat"></ha-icon>${cur != null ? Math.round(cur) + "°" : "–"}</span>`);
          const lo = st.attributes.target_temp_low, hi = st.attributes.target_temp_high, tt = st.attributes.temperature;
          const tgt = tt != null ? `${Math.round(tt)}°` : (lo != null && hi != null ? `${Math.round(lo)}–${Math.round(hi)}°` : "");
          if (tgt) parts.push(`<span class="item" style="opacity:.75">${tgt}</span>`);
        }
      }
      const tv = cc.temperature && this._fmt(cc.temperature, cc.temp_digits ?? 0);
      if (tv && tv !== "–") parts.push(`<span class="item"><ha-icon icon="mdi:thermometer"></ha-icon>${tv}°</span>`);
      const hv = cc.humidity && this._fmt(cc.humidity, 0);
      if (hv && hv !== "–") parts.push(`<span class="item"><ha-icon icon="mdi:water-percent"></ha-icon>${hv}%</span>`);
      if (cc.media && h.states[cc.media]?.state === "playing") parts.push(`<span class="item occ"><ha-icon icon="mdi:television-play"></ha-icon></span>`);
      if (cc.occupancy && h.states[cc.occupancy]?.state === "on") parts.push(`<span class="item occ"><ha-icon icon="mdi:account"></ha-icon></span>`);
      const html = parts.join("");
      if (node._html !== html) { node.innerHTML = html; node._html = html; node.style.display = html ? "" : "none"; }
    }
    for (const { cfg: dc, node } of this._doors) {
      const open = h.states[dc.entity]?.state === "on", icon = open ? (dc.icon_open || "mdi:door-open") : (dc.icon_closed || "mdi:door-closed");
      if (node._icon === icon) continue;
      node._icon = icon; node.className = "door " + (open ? "open" : "closed");
      node.querySelector("ha-icon").setAttribute("icon", icon);
    }
    this._setDoors();   // 3D doors follow their sensors
    if (this._weather) {
      const st = h.states[cfg.weather];
      if (st) {
        const a = st.attributes, w = this._weather;
        const outside = cfg.outdoor_temperature ? this._fmt(cfg.outdoor_temperature, 0) : Math.round(a.temperature);
        const wind = a.wind_speed != null ? ` · ${Math.round(a.wind_speed)} ${a.wind_speed_unit || ""}` : "";
        const icon = WEATHER_ICON3[st.state] || "mdi:weather-partly-cloudy", t = `${outside}${a.temperature_unit || "°"}`, sub = `${a.humidity ?? "–"}% humidity${wind}`;
        if (w._sig !== icon + t + sub) {
          w._sig = icon + t + sub;
          w.querySelector("ha-icon").setAttribute("icon", icon); w.querySelector(".t").textContent = t; w.querySelector(".s").textContent = sub;
        }
      }
    }
    this._requestRender();
  }

  /* =====================================================================
   * Floor plan: wall segments + joints, openings (negative boxes), blueprint underlay
   * ===================================================================== */
  _buildPlanLayer(sc) {
    const T = this.T, plan = !!this._plan, edit = !!this._edit;
    const H = sc.wall_height ?? 46, WT = sc.wall_thickness ?? 4, wallCol = (sc.wall_colors || ["#e9dcc8"])[0];
    const segs = sc.wall_segs || [], opens = sc.openings || [];
    const G = (this._wallG = new T.Group()); this._world.add(G);
    this._mats ||= {}; this._doorLeaves = []; this._doorAnim = null;
    // room floors (r:i) — polygons; the room menu frames each room by its outline
    this._floorMeshes = [];
    (sc.floors || []).forEach((f, i) => {
      if (!(f.pts?.length >= 3)) return;
      this._begin("r:" + i, mean(f.pts), 0, G);
      const geo = new T.ShapeGeometry(new T.Shape(f.pts.map(([x, y]) => new T.Vector2(x - CX, y - CY)))); geo.rotateX(Math.PI / 2);
      const m = new T.Mesh(geo, this._surfMat(f.fill || "#b3a58f", f.texture, { side: T.DoubleSide }));   // ShapeGeometry UVs are already plan units
      m.position.y = f.name === "rug" ? 0.4 : 0.01 * i;
      m.receiveShadow = true; m.userData.floor = true; m.userData.room = f.name;
      this._cur.add(m); this._floorMeshes.push(m);
      this._endItem();
    });
    this._buildRoomLabels(sc);
    const invis = (this._mats.__invis ||= new T.MeshBasicMaterial({ visible: false }));
    const ext = wallExtensions(segs, WT);
    segs.forEach((s, i) => {
      const [ux, uy, L] = segDir(s), t = s.t ?? WT, h = s.h ?? H, ry = -Math.atan2(uy, ux);
      this._begin("w:" + i, [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], 0, G);
      const mat = this._surfMat(s.color || wallCol, s.texture ?? sc.wall_texture);
      for (const [p0, p1, z0, z1] of wallPieces(s, ext[i], opens, H, WT)) {
        if (z1 - z0 < 0.05) continue;
        const sm = (p0 + p1) / 2, m = new T.Mesh(this._planUV(new T.BoxGeometry(p1 - p0, z1 - z0, t), sm, (z0 + z1) / 2), mat);
        m.position.set(s.a[0] + ux * sm - CX, z0 + (z1 - z0) / 2, s.a[1] + uy * sm - CY); m.rotation.y = ry;
        m.userData.wall = true; this._add(m);
      }
      if (plan) {   // fatter invisible slab so thin walls are easy to click
        const m = new T.Mesh(new T.BoxGeometry(L + Math.min(t, 2), h, Math.max(t + 4, 12 * this._upp())), invis);
        m.position.set((s.a[0] + s.b[0]) / 2 - CX, h / 2, (s.a[1] + s.b[1]) / 2 - CY); m.rotation.y = ry; m.castShadow = false; this._cur.add(m);
      }
      this._endItem();
    });
    const tint = { door: "#f08c3a", window: "#4ea3ff" };
    opens.forEach((o, i) => {
      this._begin("n:" + i, [o.x, o.y], o.rot || 0, G);
      const d = o.d ?? 6;
      if (plan) {   // drawn over the wall so doors and windows still show from above
        const m = this._box(o.x - o.w / 2, o.x + o.w / 2, o.y - d / 2, o.y + d / 2, o.z || 0, o.h, tint[o.kind] || "#e5484d", { transparent: true, opacity: 0.55, depthWrite: false, depthTest: false });
        m.castShadow = false; m.renderOrder = 12;
      }
      else if (o.kind === "window") this._box(o.x - o.w / 2, o.x + o.w / 2, o.y - 0.3, o.y + 0.3, o.z || 0, o.h, "#a9cfe6", { transparent: true, opacity: 0.22, depthWrite: false }).castShadow = false;
      else if (o.kind === "door" && DOOR_STYLES[o.style]?.[1]) this._buildDoorLeaf(o);
      this._endItem();
    });
    (sc.blueprints || []).forEach((bp, i) => {
      if (!bp.src || !(plan || bp.show)) return;
      this._begin("p:" + i, [bp.x, bp.y], bp.rot || 0, G);
      const m = new T.Mesh(new T.PlaneGeometry(bp.w, bp.h), new T.MeshBasicMaterial({ map: this._bpTexture(bp.src), transparent: true,
        opacity: bp.opacity ?? 0.6, depthWrite: false, toneMapped: false }));
      m.rotation.x = -Math.PI / 2; m.position.set(bp.x - CX, plan ? 0.7 : 0.45, bp.y - CY); m.renderOrder = 1;
      if (bp.locked) m.userData.locked = true;
      this._add(m, false); m.receiveShadow = false;
      this._endItem();
    });
    for (const dl of this._doorLeaves) { dl.t = dl.target = this._doorTarget(dl.o); this._poseDoor(dl); }   // start at the sensor's state
    this._jointMeshes = [];
    if (plan) {
      const geo = new T.SphereGeometry(1, 14, 10);
      this._joints = planJoints(segs);
      for (const j of this._joints) {
        const m = new T.Mesh(geo, this._jointMat(false));
        m.position.set(j.p[0] - CX, (segs[j.m[0][0]].h ?? H) + 0.6, j.p[1] - CY); m.renderOrder = 13; m.userData.joint = j;
        G.add(m); this._jointMeshes.push(m);
      }
      if (edit) this._paintJoints?.();
    }
    this._buildRoomHandles?.();
  }
  _bpTexture(src) {
    this._bpTex ||= new Map();
    if (!this._bpTex.has(src)) {
      const tex = new this.T.TextureLoader().load(src, () => this._requestRender(), undefined, () => this._edit && this._toast("Couldn't load the blueprint image"));
      tex.colorSpace = this.T.SRGBColorSpace; this._bpTex.set(src, tex);
    }
    return this._bpTex.get(src);
  }
  /* world units per screen pixel (for pixel-sized handles and snapping radii) */
  _upp() { const c = this._cam; return (c.right - c.left) / c.zoom / (this._renderer.domElement.clientWidth || 1); }
  _scaleHandles() {
    const u = this._upp();
    for (const m of this._sptMeshes || []) m.scale.setScalar(4.5 * u);   // string-light points (furniture mode too)
    for (const m of this._smidMeshes || []) m.scale.setScalar(3 * u);
    if (!this._plan) return;
    for (const m of this._jointMeshes || []) m.scale.setScalar(5 * u);
    for (const m of this._vertMeshes || []) m.scale.setScalar(5 * u);
    for (const m of this._midMeshes || []) m.scale.setScalar(3.2 * u);
    if (this._prevDot) this._prevDot.scale.setScalar(4 * u);
  }
  _buildRoomLabels(sc) {
    let box = this._wrap?.querySelector(".rlabels");
    if (!box && this._wrap) { box = document.createElement("div"); box.className = "rlabels"; this._wrap.append(box); }
    this._roomLabels = [];
    if (!box) return;
    box.innerHTML = "";
    if (!this._plan) return;
    (sc.floors || []).forEach((f) => {
      if (!(f.pts?.length >= 3) || f.name === "rug") return;
      const node = document.createElement("div"); node.className = "rlabel";
      node.innerHTML = `${esc(roomTitle(f.name || "room"))}<small>${esc(this._fmtArea(polyArea(f.pts)))}</small>`;
      box.append(node); this._roomLabels.push({ node, p: [...mean(f.pts), 1] });
    });
  }
  _fmtArea(a) {
    const cm2 = a * this._modelScale()[0] ** 2;
    return this._imperial() ? `${Math.round(cm2 / 929.03)} ft²` : `${(cm2 / 10000).toFixed(1)} m²`;
  }

  /* ----- units: the plan stores model units; people see cm or feet/inches ----- */
  _imperial() {
    const u = this._cfg()?.scene?.units;
    return u ? u === "imperial" : this._hass?.config?.unit_system?.length === "mi";
  }
  _fmtLen(units, vertical) {
    const cm = units * this._modelScale()[vertical ? 1 : 0];
    if (this._imperial()) { const inch = Math.round(cm / 2.54), ft = Math.floor(inch / 12); return ft ? `${ft}′ ${inch - ft * 12}″` : `${inch}″`; }
    return cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${Math.round(cm)} cm`;
  }
}

if (!customElements.get("ha-3dhome-card")) {
  /* helpers shared with the editor module (src/ha-3dhome-editor.js). Published before define() so the editor, which
   * awaits whenDefined(), always finds them — and only by the core that actually owns the element. */
  window.__ha3dhome = { VERSION3D, ACTIVE, ic, inPoly, CX, CY, DOOR_CLASSES, KINDS, LIBS, LIB_DIR, PLAN, R1, ROOM_FILLS, ROTATABLE, SF, STRATEGY_TYPES: ["custom:" + STRATEGY_NAME, "custom:" + OLD_NAMES.strategy], CARD_TYPES: ["custom:ha-3dhome-card", "custom:" + OLD_NAMES.card], STRUCT_TYPES, SURFACES, DOOR_STYLES, FIXTURES, TC_URL, bArr, entIcon, esc, itemCenter, itemBase, itemZ, scaleItem, SIZED, jclone, legacyWalls, lookOf, AMBIENT, mapPts, mean, stringCount, stringLen, solarPosition, stableJSON, strategyCard: (c) => Home3DStrategy.cardConfig(c), sunVector, polyArea, roomTitle, rotPt, segDir, shiftItem, zipFind };
  customElements.define("ha-3dhome-card", Home3DCard);
  if (!customElements.get(OLD_NAMES.card)) customElements.define(OLD_NAMES.card, class extends Home3DCard {});
  /* HACS registers only this file as a resource, so load the editor from next to it. The query string is kept, so an
   * editor that is also registered as its own resource (same folder, same ?v=) resolves to the same module. Skipped when
   * the core isn't a .js file (inlined into a test page). */
  const here = new URL(import.meta.url);
  if (here.pathname.endsWith(".js")) import(new URL("ha-3dhome-editor.js", here).href + here.search).catch(() => {});
}

/* ---------- dashboard strategy: `strategy: { type: custom:ha-3dhome, scene, lights, ... }` ----------
 * Generates a full-screen dashboard around the 3D map. Options besides the card config:
 *   title / path / icon  – the generated view (defaults "Home", "3d", mdi:floor-plan)
 *   extra_views          – ordinary Lovelace views appended after the map
 */
class Home3DStrategy extends HTMLElement {
  static async generate(config) {
    const { title, path, icon, extra_views } = config || {};
    return {
      title: title || "Home Map",
      views: [
        { title: title || "Home", path: path || "3d", icon: icon || "mdi:floor-plan", type: "panel",
          cards: [Home3DStrategy.cardConfig(config)] },
        ...(Array.isArray(extra_views) ? extra_views : []),
      ],
    };
  }
  static cardConfig(config) { const { type, title, path, icon, extra_views, ...card } = config || {}; return { fill: true, ...card, type: "custom:ha-3dhome-card" }; }
  static async generateDashboard(info) { return Home3DStrategy.generate(info?.config?.strategy || info?.config || {}); } // older HA
}
for (const name of [STRATEGY_NAME, OLD_NAMES.strategy]) for (const tag of ["ll-strategy-dashboard-" + name, "ll-strategy-" + name])
  if (!customElements.get(tag)) customElements.define(tag, class extends Home3DStrategy {});
// HA 2026.5+ lists registered dashboard strategies under Settings → Dashboards → Add dashboard → Community dashboards
window.customStrategies = window.customStrategies || [];
if (!window.customStrategies.some((s) => s.type === STRATEGY_NAME && s.strategyType === "dashboard"))
  window.customStrategies.push({ type: STRATEGY_NAME, strategyType: "dashboard", name: "3D Home",
    description: "A live 3D map of your home, with an editor built in", documentationURL: "https://github.com/tbell19/ha-3dhome" });
window.customCards = window.customCards || [];
if (!window.customCards.find((c) => c.type === "ha-3dhome-card"))
  window.customCards.push({ type: "ha-3dhome-card", name: "3D Home", description: `Live 3D floor plan with editor (${VERSION3D})` });
