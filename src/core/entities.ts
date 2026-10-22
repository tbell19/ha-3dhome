/* Home Assistant entities: icons, colours, which states count as "on", and which entities a config mentions.
 */
import type { CardConfig, HassEntity } from "../types";

export const WEATHER_ICON3: Record<string, string> = {
  "clear-night": "mdi:weather-night",
  cloudy: "mdi:weather-cloudy",
  fog: "mdi:weather-fog",
  hail: "mdi:weather-hail",
  lightning: "mdi:weather-lightning",
  "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy",
  pouring: "mdi:weather-pouring",
  rainy: "mdi:weather-rainy",
  snowy: "mdi:weather-snowy",
  "snowy-rainy": "mdi:weather-snowy-rainy",
  sunny: "mdi:weather-sunny",
  windy: "mdi:weather-windy",
  "windy-variant": "mdi:weather-windy-variant",
  exceptional: "mdi:alert-circle-outline",
};
/** colour temperature in kelvin → [r, g, b] */
export function k2rgb(k: number): number[] {
  const t = k / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    b = 255;
  }
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return [c(r), c(g), c(b)];
}
/** a light's colour from its state: rgb_color, else its colour temperature, else warm white */
export const stateRgb = (st: HassEntity | undefined): number[] => {
  const a: Record<string, any> = (st && st.attributes) || {};
  if (Array.isArray(a.rgb_color)) return a.rgb_color;
  if (a.color_temp_kelvin) return k2rgb(a.color_temp_kelvin);
  return [255, 205, 140];
};
export const DOMAIN_ICON: Record<string, string> = {
  light: "mdi:lightbulb",
  switch: "mdi:toggle-switch",
  fan: "mdi:fan",
  sensor: "mdi:eye",
  binary_sensor: "mdi:radiobox-marked",
  climate: "mdi:thermostat",
  media_player: "mdi:speaker",
  cover: "mdi:window-shutter",
  lock: "mdi:lock",
  camera: "mdi:cctv",
  vacuum: "mdi:robot-vacuum",
  person: "mdi:account",
  device_tracker: "mdi:map-marker",
  input_boolean: "mdi:toggle-switch-outline",
  script: "mdi:script-text",
  scene: "mdi:palette",
  button: "mdi:gesture-tap-button",
  input_button: "mdi:gesture-tap-button",
  automation: "mdi:robot",
  weather: "mdi:weather-partly-cloudy",
  humidifier: "mdi:air-humidifier",
  water_heater: "mdi:water-boiler",
  alarm_control_panel: "mdi:shield-home",
  select: "mdi:format-list-bulleted",
  input_select: "mdi:format-list-bulleted",
  number: "mdi:ray-vertex",
  input_number: "mdi:ray-vertex",
  remote: "mdi:remote",
  siren: "mdi:bullhorn",
  valve: "mdi:valve",
  update: "mdi:package-up",
  event: "mdi:gesture-double-tap",
  todo: "mdi:clipboard-list",
  calendar: "mdi:calendar",
  zone: "mdi:map-marker-radius",
};
export const CLASS_ICON: Record<string, string> = {
  temperature: "mdi:thermometer",
  humidity: "mdi:water-percent",
  illuminance: "mdi:brightness-5",
  power: "mdi:flash",
  energy: "mdi:lightning-bolt",
  battery: "mdi:battery",
  motion: "mdi:motion-sensor",
  occupancy: "mdi:account",
  presence: "mdi:account",
  door: "mdi:door",
  window: "mdi:window-closed-variant",
  garage_door: "mdi:garage",
  opening: "mdi:square-outline",
  moisture: "mdi:water-alert",
  smoke: "mdi:smoke-detector",
  co2: "mdi:molecule-co2",
  pm25: "mdi:blur",
  carbon_dioxide: "mdi:molecule-co2",
  tv: "mdi:television",
  speaker: "mdi:speaker",
};
/** the icon HA would show for an entity: its own, else by device class, else by domain */
export const entIcon = (st: HassEntity | undefined, id?: string) =>
  st?.attributes?.icon ||
  CLASS_ICON[st?.attributes?.device_class] ||
  DOMAIN_ICON[(id || st?.entity_id || "").split(".")[0]] ||
  "mdi:shape-outline";
export const ACTIVE = new Set([
  "on",
  "open",
  "opening",
  "playing",
  "home",
  "unlocked",
  "heat",
  "cool",
  "heat_cool",
  "cleaning",
  "triggered",
]);
export const TOGGLE_DOMAINS = new Set(["light", "switch", "fan", "input_boolean"]);
export const DOOR_CLASSES = new Set(["door", "window", "garage_door", "opening"]);
export const SCREEN_OFF = new Set(["off", "standby", "unavailable", "unknown"]);
/* every entity id the card config mentions (room_cards excluded: those cards follow hass themselves), plus the sun */
export const ENTITY_ID = /^[a-z_]+\.[a-z0-9_]+$/;
export const watchedEntities = (cfg: CardConfig) => {
  const out = new Set([cfg.sun_entity || "sun.sun"]);
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (ENTITY_ID.test(v)) out.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "room_cards") walk(x);
  };
  walk(cfg);
  return [...out];
};
