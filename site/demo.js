/* Standalone demo: the real card on a fictional home ("Juniper House", examples/sample-home.json) with a fake `hass`.
 * Nothing here talks to Home Assistant. Tapping toggles the pretend entities, the editor works, and Save keeps the
 * layout in this browser (localStorage) until Reset.
 *
 * Served by GitHub Pages (.github/workflows/pages.yml) or locally with `npm run demo`. Both put the built card in ./card/
 * and the sample layout at ./sample-home.json.
 */
const KEY = "ha-3dhome-demo-layout";
const store = {
  get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
};

/* ---- stand-ins for the bits of the Home Assistant frontend the card uses ---- */
customElements.define("ha-card", class extends HTMLElement { connectedCallback() { this.style.display = "block"; } });
// <ha-icon icon="mdi:name">: the Material Design Icons SVG from Iconify, painted in currentColor
customElements.define("ha-icon", class extends HTMLElement {
  static get observedAttributes() { return ["icon"]; }
  connectedCallback() { this._paint(); }
  attributeChangedCallback() { this._paint(); }
  set icon(v) { this.setAttribute("icon", v); }
  _paint() {
    const name = (this.getAttribute("icon") || "").replace(/^mdi:/, "");
    const url = name ? `url("https://api.iconify.design/mdi/${encodeURIComponent(name)}.svg")` : "none";
    Object.assign(this.style, { display: "inline-block", width: "var(--mdc-icon-size, 24px)", height: "var(--mdc-icon-size, 24px)",
      background: "currentColor", verticalAlign: "middle", mask: `${url} center / contain no-repeat`, webkitMask: `${url} center / contain no-repeat` });
  }
});

/* ---- pretend entities ---- */
const light = (name, rgb, brightness = 220, on = true) => ({ state: on ? "on" : "off",
  attributes: { friendly_name: name, brightness: on ? brightness : undefined, rgb_color: rgb, supported_color_modes: ["rgb"] } });
const sensor = (name, state, unit, device_class) => ({ state: String(state), attributes: { friendly_name: name, unit_of_measurement: unit, device_class } });
const binary = (name, on, device_class) => ({ state: on ? "on" : "off", attributes: { friendly_name: name, device_class } });
const STATES = {
  "sun.sun": { state: "below_horizon", attributes: { friendly_name: "Sun", elevation: -12, azimuth: 290 } },
  "weather.home": { state: "partlycloudy", attributes: { friendly_name: "Home", temperature: 64, temperature_unit: "°F", humidity: 52, wind_speed: 7, wind_speed_unit: "mph" } },
  "sensor.outside_temperature": sensor("Outside temperature", 64, "°F", "temperature"),
  "light.dining_pendant": light("Dining pendant", [255, 196, 140]),
  "light.kitchen_downlights": light("Kitchen downlights", [255, 214, 170], 170),
  "light.lounge_lamp": light("Lounge lamp", [255, 180, 110], 200),
  "light.lounge_ceiling": light("Lounge ceiling", [255, 220, 180], 180, false),
  "light.hall": light("Hall", [255, 214, 170], 110),
  "light.foyer": light("Foyer", [255, 200, 150], 150, false),
  "light.main_bedroom": light("Main bedroom", [255, 210, 170], 160, false),
  "light.reading_lamp": light("Reading lamp", [255, 170, 100], 140),
  "light.ensuite": light("Ensuite", [240, 240, 255], 255, false),
  "light.study_fan": light("Study fan", [200, 215, 255], 210, false),
  "light.study_fan_a": light("Study fan A", [200, 215, 255], 210, false),
  "light.study_fan_b": light("Study fan B", [200, 215, 255], 210, false),
  "light.porch": light("Porch", [255, 190, 120], 200),
  "light.deck_spots": light("Deck spots", [255, 225, 190], 230),
  "sensor.lounge_temperature": sensor("Lounge temperature", 71.4, "°F", "temperature"),
  "sensor.lounge_humidity": sensor("Lounge humidity", 44, "%", "humidity"),
  "binary_sensor.lounge_occupancy": binary("Lounge occupancy", true, "occupancy"),
  "sensor.main_bedroom_temperature": sensor("Main bedroom temperature", 68.9, "°F", "temperature"),
  "binary_sensor.main_bedroom_occupancy": binary("Main bedroom occupancy", false, "occupancy"),
  "binary_sensor.front_door": binary("Front door", false, "door"),
  "binary_sensor.deck_door": binary("Deck door", true, "door"),
  "climate.heat_pump": { state: "heat_cool", attributes: { friendly_name: "Heat pump", current_temperature: 70, target_temp_low: 68, target_temp_high: 74, hvac_action: "idle" } },
  "media_player.lounge_tv": { state: "playing", attributes: { friendly_name: "Lounge TV", device_class: "tv",
    media_title: "Nature at Night", media_series_title: "S1 · E4", entity_picture: "./art.svg" } },
  "media_player.kitchen_radio": { state: "paused", attributes: { friendly_name: "Kitchen radio", media_title: "Morning Jazz" } },
};

const GROUPS = { "light.study_fan": ["light.study_fan_a", "light.study_fan_b"] };   // light groups, as Home Assistant would have them
const TOGGLE = { on: "off", off: "on", open: "closed", closed: "open", playing: "paused", paused: "playing" };
let card, cfg, states = structuredClone(STATES);

function hass() {
  return {
    states, user: { is_admin: true, name: "Demo" }, language: "en",
    config: { unit_system: { length: "mi", temperature: "°F" }, latitude: 40, longitude: -100, time_zone: "UTC" },
    services: { homeassistant: { toggle: {} }, light: { turn_on: {}, turn_off: {}, toggle: {} } },
    callService: async (domain, service, data) => {
      for (const id of [].concat(data?.entity_id || [])) {
        const st = states[id]; if (!st) continue;
        let next = service === "turn_on" ? "on" : service === "turn_off" ? "off" : TOGGLE[st.state] || st.state;
        if (id.startsWith("binary_sensor.")) next = st.state === "on" ? "off" : "on";
        for (const m of GROUPS[id] || []) setState(m, next);
        setState(id, next, id.startsWith("light.") && next === "on" ? { brightness: data?.brightness ?? st.attributes.brightness ?? 220 } : {});
      }
    },
    callWS: async (m) => {
      if (m.type === "lovelace/config") return { strategy: structuredClone(cfg) };
      if (m.type === "lovelace/config/save") { cfg = m.config.strategy || m.config; store.set(cfg); toast("Saved in this browser. Reset puts the sample home back."); return null; }
      return null;
    },
    connection: { subscribeEvents: async () => () => {} },
  };
}
function setState(id, state, attrs = {}) {
  states = { ...states, [id]: { ...states[id], state, attributes: { ...states[id].attributes, ...attrs }, last_changed: new Date().toISOString() } };
  if (card) card.hass = hass();
  if (dialog.open && dialog.dataset.id === id) openInfo(id);
}

/* ---- more-info: a small dialog in place of Home Assistant's ---- */
const dialog = document.getElementById("info");
function openInfo(id) {
  const st = states[id]; if (!st) return;
  dialog.dataset.id = id;
  const a = st.attributes, canToggle = /^(light|switch|binary_sensor|media_player)\./.test(id);
  dialog.querySelector("h2").textContent = a.friendly_name || id;
  dialog.querySelector(".id").textContent = id;
  dialog.querySelector(".state").textContent = st.state + (a.unit_of_measurement ? " " + a.unit_of_measurement : "");
  const tg = dialog.querySelector(".toggle"); tg.hidden = !canToggle;
  tg.textContent = id.startsWith("binary_sensor.") ? (st.state === "on" ? "Close it" : "Open it") : st.state === "on" || st.state === "playing" ? "Turn off" : "Turn on";
  const br = dialog.querySelector(".bri"); br.hidden = !id.startsWith("light.") || st.state !== "on";
  br.querySelector("input").value = a.brightness ?? 255;
  if (!dialog.open) dialog.showModal();
}
dialog.querySelector(".toggle").onclick = () => hass().callService("homeassistant", "toggle", { entity_id: dialog.dataset.id });
dialog.querySelector(".bri input").oninput = (e) => setState(dialog.dataset.id, "on", { brightness: +e.target.value });
dialog.querySelector(".close").onclick = () => dialog.close();
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
window.addEventListener("hass-more-info", (e) => e.detail?.entityId && openInfo(e.detail.entityId));

/* ---- toolbar ---- */
let toastTimer;
function toast(t) { const el = document.getElementById("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 3500); }
function setDay(day) {
  states = { ...states, "sun.sun": { state: day ? "above_horizon" : "below_horizon", attributes: { ...states["sun.sun"].attributes, elevation: day ? 38 : -12, azimuth: day ? 200 : 290 } } };
  document.getElementById("day").setAttribute("aria-pressed", day);
  document.getElementById("night").setAttribute("aria-pressed", !day);
  if (card) card.hass = hass();
}
document.getElementById("day").onclick = () => setDay(true);
document.getElementById("night").onclick = () => setDay(false);
document.getElementById("reset").onclick = async () => { store.clear(); states = structuredClone(STATES); await mount(await sample()); toast("Back to the sample home"); };

/* ---- mount the card the way the dashboard strategy does ---- */
async function sample() { return (await (await fetch("./sample-home.json")).json()).strategy; }
async function mount(c) {
  cfg = c;
  const gen = await customElements.get("ll-strategy-dashboard-ha-3dhome").generate(cfg);
  card?.remove();
  card = document.createElement("ha-3dhome-card");
  card.setConfig({ ...gen.views[0].cards[0], dashboard: "demo" });
  document.getElementById("host").append(card);
  card.hass = hass();
}

await import("./card/ha-3dhome.js");
await mount(store.get() || (await sample()));
setDay(false);
