/* Types for the card config (docs/CONFIG.md is the reference) and the parts of Home Assistant the card talks to.
 *
 * Items are deliberately loose: one interface per list, with every field any of its `type`s can have, because the
 * card and the editor treat items generically (move, rotate, resize) and the dashboard may hold older shapes.
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
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
  callWS<T = any>(msg: Record<string, unknown>): Promise<T>;
  fetchWithAuth?(url: string, init?: RequestInit): Promise<Response>;
  formatEntityState?(st: HassEntity): string;
}

/** A Lovelace card config: only `type` is known. */
export interface LovelaceCardConfig {
  type: string;
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

/** The pre-v4.7 axis-aligned walls: `{axis, at, spans, doors}`. */
export interface LegacyWall {
  axis: "x" | "y";
  at: number;
  spans?: Pt[];
  doors?: Pt[];
  h?: number;
  note?: string;
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
  // doorpanel
  axis?: "x" | "y";
  at?: number;
  span?: Pt;
  fill?: Colour;
  // shelf
  box?: [number, number, number, number, number];
  shelves?: number[];
  colors?: Colour[];
  // table (radius), fan (radius, ceiling)
  r?: number;
  ceiling?: number;
  // plantwall
  x1?: number;
  x2?: number;
  z1?: number;
  z2?: number;
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
  a?: number[];
  b?: number[];
  heads?: number[];
  stroke?: Colour;
  // sink, burners, bulbs
  rect?: number[];
  faucet?: Pt;
  pts?: Pt[];
  // glasswall, cornerglass, railing
  y1?: number;
  y2?: number;
  posts?: number[];
  handle?: number;
  x_end?: number;
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
  walls?: LegacyWall[];
  front_walls?: LegacyWall[];
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
  kind?: "string" | "niche";
  points?: Pt[];
  count?: number;
  spacing?: number;
  sag?: number;
  rect?: number[];
  size?: number | Pt3;
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

export interface Chip {
  entity?: string;
  x: number;
  y: number;
  z?: number;
  label?: string;
  show_name?: boolean;
  show_state?: boolean;
  icon?: string;
  tap?: string;
  size?: number;
  [k: string]: unknown;
}

export interface DoorConfig {
  entity: string;
  x: number;
  y: number;
  z?: number;
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
  type?: string;
  scene?: Scene;
  lights?: LightConfig[];
  hotspots?: Hotspot[];
  chips?: Chip[];
  doors?: DoorConfig[];
  weather?: string;
  outdoor_temperature?: string;
  sun_entity?: string;
  night_mode?: "always" | "never";
  fill?: boolean;
  aspect_ratio?: string;
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
  idle_view?: { room?: string; after?: number };
  max_pixel_ratio?: number;
  dashboard?: string;
  card_id?: string;
  three_url?: string;
  orbit_url?: string;
  jszip_url?: string;
  jsm_url?: string;
  rooms?: unknown;
  [k: string]: unknown;
}

/** The strategy config: the card config plus options for the generated dashboard. */
export interface StrategyConfig extends CardConfig {
  title?: string;
  path?: string;
  icon?: string;
  extra_views?: Record<string, unknown>[];
}
