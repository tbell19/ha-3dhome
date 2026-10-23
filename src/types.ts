/* Types for the card config (docs/CONFIG.md is the reference) and the parts of Home Assistant the card talks to.
 *
 * Items are deliberately loose: one interface per list, with every field any of its `type`s can have, because the
 * card and the editor treat items generically (move, rotate, resize).
 * Comments say which `type` a field belongs to.
 */

/** A point on the floor plan, in plan units. */
export type Pt = [number, number];
/** A point with a height. */
export type Pt3 = [number, number, number];
/** A colour: a CSS colour, or a palette key. Boxes may also give [top, left, right]. */
export type Colour = string;

/* ---------- Home Assistant ---------- */

export interface HassEntity {
  entity_id?: string; // missing in test fixtures: code iterates Object.entries(states)
  state: string;
  attributes: Record<string, any>;
  last_changed?: string;
  last_updated?: string;
}

export interface HassConnection {
  subscribeEvents(cb: (ev: unknown) => void, type: string): Promise<() => void>;
  /** a websocket subscription; Home Assistant renews it after a reconnect */
  subscribeMessage<T>(cb: (msg: T) => void, msg: Record<string, unknown>): Promise<() => Promise<void>>;
  ping?(): Promise<unknown>;
  reconnect?(force?: boolean): void;
  connected?: boolean;
}

export interface Hass {
  states: Record<string, HassEntity>;
  user?: { is_admin?: boolean; name?: string };
  config?: { latitude?: number; longitude?: number; unit_system?: { length?: string }; [k: string]: any };
  services?: Record<string, Record<string, unknown>>;
  connected?: boolean;
  connection: HassConnection;
  themes?: { darkMode?: boolean };
  locale?: { language?: string };
  language?: string;
  /** the signed-in user's frontend settings (frontend/set_user_data, key "core"), kept current by Home Assistant */
  userData?: { default_panel?: string; [k: string]: unknown };
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
  callWS<T = any>(msg: Record<string, unknown>): Promise<T>;
  fetchWithAuth?(url: string, init?: RequestInit): Promise<Response>;
  formatEntityState?(st: HassEntity): string;
}

/** A Lovelace card config: only `type` is known. */
export interface LovelaceCardConfig {
  type: string;
  /* the fields this module reads; any card may carry more */
  entity?: string;
  entities?: (string | { entity?: string })[];
  cards?: LovelaceCardConfig[];
  name?: string;
  title?: string;
  card_id?: string;
  [k: string]: unknown;
}

/* ---------- the scene ---------- */

/** `[x1, x2, y1, y2, height, colour, z]`. */
export type BoxArray = [number, number, number, number, number, Colour | Colour[], number?];
export interface BoxObject {
  b: BoxArray;
  rot?: number;
  rx?: number;
  rz?: number;
  group?: string;
}
export type BoxEntry = BoxArray | BoxObject;

export interface Floor {
  name: string;
  pts: Pt[];
  fill?: Colour;
  texture?: string;
  menu?: boolean;
  roof?: boolean;
}

export interface WallSeg {
  a: Pt;
  b: Pt;
  t?: number;
  h?: number;
  low?: boolean;
  color?: Colour;
  texture?: string;
  note?: string;
}

export interface Opening {
  kind: "door" | "window" | "cut";
  x: number;
  y: number;
  w: number;
  d?: number;
  h: number;
  z?: number;
  rot?: number;
  style?: string;
  color?: Colour;
  hinge?: "left" | "right";
  flip?: boolean;
  entity?: string;
  open?: boolean;
  daylight?: boolean; // false: no daylight through it; true: daylight through a door that isn't glass
}

export interface Blueprint {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot?: number;
  opacity?: number;
  locked?: boolean;
  show?: boolean;
}

/** An entry of `scene.objects` or `scene.overlays`. */
export interface SceneItem {
  type: string;
  x?: number;
  y?: number;
  z?: number;
  rot?: number;
  rx?: number;
  rz?: number;
  group?: string;
  size?: number | Pt3;
  // shelf
  box?: [number, number, number, number, number];
  shelves?: number[];
  colors?: Colour[];
  // table (radius), fan (radius, ceiling)
  r?: number;
  ceiling?: number;
  // model
  name?: string;
  lib?: string;
  sh3f?: string;
  model?: string;
  mr?: number[];
  w?: number;
  d?: number;
  h?: number;
  cm?: Pt3;
  mirror?: boolean;
  creator?: string;
  lic?: string;
  icon?: string;
  // screen
  entity?: string;
  stand?: boolean;
  tap?: string;
  // pendant
  top?: number;
  // track, line
  // sink, burners
  rect?: number[];
  faucet?: Pt;
  pts?: Pt[];
  [k: string]: unknown;
}

export interface Scene {
  wall_height?: number;
  lintel?: number;
  wall_thickness?: number;
  low?: number;
  wall_colors?: Colour[];
  wall_texture?: string;
  model_scale?: [number, number];
  palette?: Record<string, Colour[]>;
  floors?: Floor[];
  wall_segs?: WallSeg[];
  openings?: Opening[];
  blueprints?: Blueprint[];
  north?: number;
  roof?: boolean;
  units?: "imperial" | "metric";
  boxes?: BoxEntry[];
  objects?: SceneItem[];
  overlays?: SceneItem[];
  [k: string]: unknown;
}

/* ---------- entities on the map ---------- */

export interface LightConfig {
  entity?: string;
  name?: string;
  x?: number;
  y?: number;
  z?: number;
  gx?: number;
  gy?: number;
  gz?: number;
  hx?: number;
  hy?: number;
  hz?: number;
  r?: number;
  halo?: number;
  hit?: number;
  tap?: string;
  color?: number[];
  intensity?: number;
  saturation?: number;
  decay?: number;
  angle?: number;
  soft?: number;
  shadow?: boolean;
  fixture?: string;
  trim?: Colour;
  shade?: Colour;
  points?: Pt[];
  count?: number;
  spacing?: number;
  sag?: number;
  size?: number; // scales the fixture model
  [k: string]: unknown;
}

export interface Hotspot {
  entity: string;
  x: number;
  y: number;
  z?: number;
  hit?: number;
  tap?: string;
  name?: string;
  [k: string]: unknown;
}

/** A chip: an HTML pill on the map. Either a badge for one `entity`, or a composite of the other fields. */
export interface Chip {
  x: number;
  y: number;
  z?: number;
  size?: number;
  // badge
  entity?: string;
  show_name?: boolean;
  show_state?: boolean;
  tap?: string;
  // composite (and badge)
  label?: string;
  icon?: string;
  temperature?: string;
  temp_digits?: number;
  humidity?: string;
  climate?: string;
  occupancy?: string;
  media?: string;
  tap_entity?: string;
  [k: string]: unknown;
}

/** A door or window sensor dot: red when open, green when shut. */
export interface DoorConfig {
  entity: string;
  name?: string;
  x: number;
  y: number;
  z?: number;
  size?: number;
  icon_open?: string;
  icon_closed?: string;
  [k: string]: unknown;
}

export interface RoomMenuEntry {
  name: string;
  label?: string;
  floors?: string[];
  rect?: [number, number, number, number];
}

/** Any item the editor can select, whatever list it lives in. */
export type AnyItem =
  | BoxEntry
  | SceneItem
  | LightConfig
  | Hotspot
  | Chip
  | DoorConfig
  | WallSeg
  | Opening
  | Blueprint
  | Floor;

export type Looks = { light: number; ao: number; stage: number; bloom: number };

export interface CardConfig {
  scene?: Scene;
  lights?: LightConfig[];
  hotspots?: Hotspot[];
  chips?: Chip[];
  doors?: DoorConfig[];
  weather?: string;
  outdoor_temperature?: string;
  sun_entity?: string;
  night_mode?: "always" | "never";
  view_size?: number;
  pan_bounds?: [number, number, number, number];
  room_menu?: false | RoomMenuEntry[];
  room_cards?: Record<string, LovelaceCardConfig[]>;
  room_fade?: number | false;
  room_menu_exclude?: string[];
  shadows?: boolean;
  max_shadow_lights?: number;
  shadow_map_size?: number;
  light_strength?: number;
  window_light?: number;
  max_window_lights?: number;
  ambient?: number;
  look?: false | Partial<Record<keyof Looks, number | boolean>>;
  ao_pause?: boolean;
  idle_view?: { room?: string; after?: number };
  max_pixel_ratio?: number;
  [k: string]: unknown;
}

/** One wall end: the wall's index in scene.wall_segs and which end. */
export type WallEnd = [number, "a" | "b"];

/** The parts of the config that the editor changes and Save writes back (LAYOUT_KEYS lists them at runtime). */
export type LayoutKey =
  | "scene"
  | "lights"
  | "hotspots"
  | "chips"
  | "doors"
  | "look"
  | "ao_pause"
  | "ambient"
  | "idle_view"
  | "room_cards";

/** A saved layout: what the editor changes, without the card's own options. */
export type Layout = Pick<CardConfig, LayoutKey>;

/** Where Save writes the layout: the panel hands its map a store that saves through the integration (map.layoutStore). */
export interface LayoutStore {
  /** what the toast says once saved, e.g. "Saved" */
  readonly savedMessage: string;
  /** write the layout; resolves to the card config it now corresponds to, which the card takes as its own */
  save(layout: Layout, config: CardConfig): Promise<CardConfig>;
}

/** Whether Home Assistant opens on the map's page for the signed-in user. The panel hands it to its map
 * (map.homePage), which shows it in its ⋮ menu. */
export interface HomePage {
  /** true when this page is the user's default page */
  isHome(hass: Hass): boolean;
  /** make this page the user's default page, or go back to the one Home Assistant picks */
  setHome(hass: Hass, on: boolean): Promise<void>;
}
