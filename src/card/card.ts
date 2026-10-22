/* <ha-3dhome-map>: the 3D map the panel shows. This file holds its lifecycle (config, hass, connection state,
 * attach/detach, teardown) and world rebuilds. The rest of the card is split by topic into the parts
 * below (startup.ts, camera.ts, …), whose methods are copied onto this class. The editor is a separate object.
 */
import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import type { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import type { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import type {
  CardConfig,
  HomePage,
  LayoutStore,
  Chip,
  DoorConfig,
  Hass,
  HassEntity,
  LightConfig,
  Opening,
  Pt,
  SceneItem,
} from "../types";
import type { Joint } from "../core/plan-geometry";
import { ic, esc, stableJSON } from "../core/util";
import { watchedEntities } from "../core/entities";
import { LAYOUT_KEYS } from "../core/constants";
import { editorAvailable } from "./editor-loader";
import { StartupPart } from "./startup";
import { CameraPart } from "./camera";
import { RoomsPart } from "./rooms";
import { ScenePart } from "./scene";
import { ModelsPart } from "./models";
import { LightsPart } from "./lights";
import { PickingPart } from "./picking";
import { LivePart } from "./live";
import { PlanPart } from "./plan";
import { BatchPart } from "./batch";
import { BakePart } from "./ao-bake";
import type { BakedAOUniforms } from "./ao-bake";
import type { CardEditor } from "../editor-contract";

/** A room the camera can frame: from the room menu, or one per floor. */
export interface Room {
  name: string;
  label: string;
  rect: number[] | null; // [x1, x2, y1, y2] in plan units
  floors: string[];
}

/** Editor state while editing (null otherwise). */
export interface EditState {
  sel: Set<string>; // selected item keys
  undo: string[]; // JSON snapshots of the config being edited
  redo: string[];
  dirty: boolean;
  mode: "translate" | "rotate" | "scale";
  space: "world" | "local";
  lock: boolean;
  snap: boolean;
  showFurn: boolean;
  [k: string]: any;
}

/** A door's moving parts, built by _buildDoorLeaf and animated by _setDoors. `t` runs 0 (shut) → 1 (open). */
export interface DoorLeaf {
  o: Opening;
  parts: { node: THREE.Group; mv: { rot?: number; x?: number; y?: number }; x0: number; y0: number }[];
  t: number;
  target?: number;
}

/** A mesh whose material type varies (fixtures glow through MeshStandardMaterial, most else is Lambert). */
export type AnyMesh = THREE.Mesh<THREE.BufferGeometry, any>;

/** A TV or camera screen: a canvas texture showing the entity's artwork, plus a light that tints the room. */
export interface Screen {
  o: SceneItem;
  mesh: THREE.Mesh;
  tex: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  light: THREE.PointLight;
  sig: string | null; // what is painted, so unchanged states skip the repaint
  rgb?: number[] | null; // the artwork's average colour, for the light
}

/** An overlay element, remembering what it last showed so unchanged states skip the DOM. */
export type OverlayNode = HTMLElement & { _html?: string; _icon?: string; _sig?: string };

/** An HTML element pinned to a point in the scene (chips, door dots, room labels). */
export interface Anchor {
  node: HTMLElement;
  p: number[]; // [x, y, z] in plan units
}

/** A light as built: one per fixture (bulbs at the same spot share it), with what _update() needs to drive it. */
export interface LightGroup {
  kind: "glow" | "string";
  members: LightConfig[]; // the config entries of its bulbs
  keys: string[]; // their item keys ("l:3")
  L: LightConfig; // the first one, whose settings it uses
  group: THREE.Group;
  light: THREE.PointLight | THREE.SpotLight;
  fixtures: AnyMesh[]; // meshes that glow when it is on
  bulbs?: AnyMesh[]; // string lights
  sprite?: THREE.Sprite; // the halo
  down?: boolean; // a can light, aimed straight down
  [k: string]: any; // live state kept by _update()
}

/* a connection blip shorter than this (HA suspending a hidden tab, a Wi-Fi hand-over) doesn't show the offline pill */
const CONN_GRACE = 2500;
/* how long a lost WebGL context may stay lost on a visible page before the card rebuilds itself from scratch */
const CTX_GRACE = 3000;
/* two configs that differ at most in their layout (what the editor changes) need no new renderer */
const sameOptions = (a: CardConfig, b: CardConfig) => {
  const options = (c: CardConfig) => stableJSON({ ...c, ...Object.fromEntries(LAYOUT_KEYS.map((k) => [k, null])) });
  return options(a) === options(b);
};

/* The card's methods live in its parts (one file per topic) and are copied onto the prototype below. The editor is a
 * separate object (src/editor/editor.ts), created when Edit is first pressed, that the card talks to through CardEditor
 * (src/editor-contract.ts). */
export interface Home3DCard
  extends StartupPart,
    CameraPart,
    RoomsPart,
    ScenePart,
    ModelsPart,
    LightsPart,
    PickingPart,
    LivePart,
    PlanPart,
    BatchPart,
    BakePart {}

export class Home3DCard extends HTMLElement {
  /* `declare` adds types only: no field is created, so nothing changes at runtime. */

  // config and Home Assistant
  declare _config: CardConfig; // the config as the panel gave it (the integration's stored config)
  declare _cfgJSON: string; // its stableJSON, to spot identical configs
  declare _hass: Hass;
  declare _hassRaf: number | null; // the frame that applies the latest hass
  declare _watch: string[]; // entities the config mentions (watchedEntities)
  declare _seen: {
    config: unknown;
    locale: unknown;
    user: unknown;
    at: number;
    states: Map<string, HassEntity>;
  } | null;
  declare _seenCfg: CardConfig | null;
  declare _layoutStore: LayoutStore | null; // where Save writes (see layoutStore)
  declare _homePage: HomePage | null; // whether HA opens on this page (see homePage)

  // lifecycle
  declare _ready: boolean;
  declare _loading: boolean;
  declare _gen: number; // bumped by every teardown, so stale async work can tell
  declare _kickT: ReturnType<typeof setTimeout> | null;
  declare _idleT: ReturnType<typeof setTimeout>;
  declare _backT: ReturnType<typeof setTimeout> | null;
  declare _ro: ResizeObserver | null;
  declare _keys: ((ev: KeyboardEvent) => void) | null;
  declare _texListener: (() => void) | null;
  declare _visListener: (() => void) | null;
  declare _netListener: ((ev: Event) => void) | null;
  declare _edReady: (() => void) | null;
  declare _idleKick: () => void;

  // connection and WebGL context
  declare _offSince: number; // when the connection dropped (0 = connected)
  declare _offT: ReturnType<typeof setTimeout> | null;
  declare _probeT: ReturnType<typeof setTimeout> | null;
  declare _ctxT: ReturnType<typeof setTimeout> | null;
  declare _ctxLost: number; // when the WebGL context was lost (0 = fine)
  declare _shownAt: number;
  declare _hiddenAt: number;
  declare _camKeep: { pos: number[]; zoom: number; target: number[] } | null; // camera to restore after a rebuild

  // DOM
  declare _wrap: HTMLElement;
  declare _ov: HTMLElement; // overlay layer for chips and labels
  declare _editorLayer: HTMLElement; // editor UI layer
  declare _edBtn: HTMLElement | null;
  declare _moreBtn: HTMLElement | null; // ⋮ on the nav: the map's less used settings
  declare _moreMenu: HTMLElement | null; // its menu (Open Home Assistant here)
  declare _conn: HTMLElement | null; // the "Reconnecting" pill
  declare _toastT: ReturnType<typeof setTimeout>;

  // Three.js
  declare T: typeof THREE; // the Three.js module, loaded in _init (src/core/libs.ts)
  declare _renderer: THREE.WebGLRenderer;
  declare _scene: THREE.Scene;
  declare _cam: THREE.OrthographicCamera;
  declare _controls: OrbitControls;
  declare _tc: TransformControls | null; // the editor's transform gizmo
  declare _composer: EffectComposer | null;
  declare _aoPass: GTAOPass | null;
  declare _bloomPass: UnrealBloomPass | null;
  declare _usePP: boolean; // render through the composer
  declare _ppLoading: number | null;
  declare _raf: number | null;
  declare _aoLevel: number; // the ambient occlusion strength the look asks for (0..1)
  declare _drawK: { p: THREE.Vector3; q: THREE.Quaternion; z: number } | null; // the camera as last drawn (_seenMove)
  declare _movedAt: number; // performance.now() of the last frame the view moved in
  declare _aoU: BakedAOUniforms | null; // the baked corner shading, shared by every patched material (ao-bake.ts)
  declare _aoRT: THREE.WebGLRenderTarget | null; // its map
  declare _aoBaked: THREE.Group | null; // the world it was baked for
  declare _batchBox: THREE.Group | null; // the merged static meshes (batch.ts)
  declare _batched: THREE.Mesh[] | null; // the meshes they replace, hidden while they show
  declare _batchOn: boolean; // the merged meshes are showing
  declare _batchT: ReturnType<typeof setTimeout> | null; // the merge waits for the world to settle
  declare _settleT: ReturnType<typeof setTimeout> | null; // redraws with ambient occlusion once the view is still
  declare _helpers: (THREE.Object3D & { update(): void; dispose?(): void })[]; // gizmo helpers that follow the camera

  // camera
  declare _home: { pos: THREE.Vector3; target: THREE.Vector3; zoom: number };
  declare _homeSph: THREE.Spherical;
  declare _camK: { p: THREE.Vector3; q: THREE.Quaternion; t: THREE.Vector3; z: number | null } | null;
  declare _camMv: boolean;
  declare _moved: boolean; // the user moved the view, so resizes leave it alone
  declare _fly: Record<string, any> | null; // a camera flight in progress
  declare _lastPhi: number;
  declare _lastTheta: number;
  declare _vo: number[]; // view offset (safe area), eased towards _voT
  declare _voT: number[];

  // the world: everything built from the config, thrown away by _rebuild()
  declare _world: THREE.Group | null;
  declare _items: Map<string, THREE.Group>; // item key → its pivot group
  declare _cur: THREE.Object3D | null; // the group being built into
  declare _outer: THREE.Group | null;
  declare _xf: ((x: number, y: number) => Pt) | null; // plan transform of the item being built
  declare _noCast: boolean;
  declare _mats: Record<string, THREE.Material> | null; // cached materials
  declare _surfTexs: Record<string, THREE.Texture> | null;
  declare _bpTex: Map<string, THREE.Texture> | null; // blueprint textures by src
  declare _glowTex: THREE.Texture | null;
  declare _tmpCol: THREE.Color;
  declare _fixtures: { x: number; y: number; mesh: AnyMesh }[]; // glowing parts of objects and overlays, for lights to claim
  declare _screens: Screen[];
  declare _floorMeshes: THREE.Mesh[];
  declare _doorLeaves: DoorLeaf[];
  declare _doorAnim: object | null; // the running door animation
  declare _stage: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null; // the drop shadow under the house
  declare _stageSpot: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null; // the spotlit backdrop under the house
  declare _targets: THREE.Object3D[]; // tap targets
  declare _modelErr: Record<string, string>;

  // lights and looks
  declare _amb: THREE.AmbientLight;
  declare _hemi: THREE.HemisphereLight;
  declare _fill: THREE.DirectionalLight;
  declare _sun: THREE.DirectionalLight;
  declare _sunKey: string | null;
  declare _sunPreview: number | null; // the editor's time-of-day preview (hours)
  declare _lightGroups: LightGroup[];
  declare _skyLights: { light: THREE.SpotLight; w: number }[]; // daylight through windows
  declare _lkSig: string | null; // the look last applied
  declare _bgKey: string | undefined;

  // overlays: chips, doors, weather, labels
  declare _chips: { cfg: Chip; node: OverlayNode }[];
  declare _doors: { cfg: DoorConfig; node: OverlayNode }[];
  declare _weather: OverlayNode | null;
  declare _anchors: Anchor[];
  declare _roomLabels: Anchor[];

  // rooms
  declare _focus: { room: Room; polys: Pt[][] } | null; // the framed room and its floor outlines
  declare _fitRoom: Room | null;
  declare _rcRoom: string; // the room whose controls show
  declare _rcMin: boolean;
  declare _rcCache: Map<string, { sig: string; els: HTMLElement[] }> | null; // built room cards, by room
  declare _faded: Set<THREE.Mesh> | null; // meshes made see-through
  declare _fadeSig: string | null;
  declare _fadeGen: number;
  declare _fadeMats: Map<string, THREE.Material> | null;

  // floor plan layer
  declare _plan: boolean; // floor plan mode
  declare _wallG: THREE.Group | null;
  declare _joints: Joint[];
  declare _jointMeshes: THREE.Mesh[] | null;
  declare _midMeshes: THREE.Mesh[] | null;
  declare _roomHG: THREE.Group | null;
  declare _vertMeshes: THREE.Mesh[] | null;
  declare _strHG: THREE.Group | null;
  declare _sptMeshes: THREE.Mesh[] | null;
  declare _smidMeshes: THREE.Mesh[] | null;

  // editing (set by the editor)
  declare _editor: CardEditor | null; // created when Edit is first pressed, dropped by _teardown
  declare _edit: EditState | null;
  declare _work: CardConfig | null; // the config being edited
  declare _drag: Record<string, any> | null;
  declare _tool: string;
  declare _vsel: any;
  declare _pivot: THREE.Object3D;
  declare _tcDragging: boolean;
  declare _tcUsed: boolean;
  declare _cycleHinted: boolean;
  setConfig(config: CardConfig): void {
    // An identical config changes nothing. One that differs only in its layout (a save here or on another device) is
    // rebuilt in the running scene; anything else gets a full teardown first, so no WebGL context is left behind.
    const json = stableJSON(config || {});
    if (json === this._cfgJSON && (this._ready || this._loading)) return;
    const layoutOnly = this._ready && !this._edit && sameOptions(this._config, config || {});
    this._cfgJSON = json;
    this._config = config || {};
    if (layoutOnly) return this._applyLayout(); // a new layout (saved here or on another device): keep the renderer
    this._teardown();
    this._kick();
  }

  /* the config's layout changed but none of the card's options: rebuild the world in the running scene */
  _applyLayout() {
    this._rebuild();
    this._buildRoomBar();
    this._showRoomCards(this._rcRoom || "home");
    this._requestRender();
  }

  /* start up a tick later, once hass and the config have both arrived */
  _kick() {
    if (this._kickT) return;
    this._kickT = setTimeout(() => {
      this._kickT = null;
      if (!this.isConnected || !this._hass || !this._config || this._ready || this._loading) return;
      this._loading = true;
      this._init().catch((e) => this._fail(e));
    }, 0);
  }

  /* release everything the card holds: GPU resources, the WebGL context, listeners, timers */
  _teardown() {
    this._gen = (this._gen || 0) + 1; // invalidates in-flight async work (_init, model loads)
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    clearTimeout(this._settleT);
    this._settleT = null;
    clearTimeout(this._batchT);
    this._batchT = null;
    this._aoRT?.dispose();
    this._aoRT = null;
    this._aoU = null;
    this._fly = null;
    this._focus = null;
    clearTimeout(this._backT);
    this._backT = null;
    if (this._keys) window.removeEventListener("keydown", this._keys);
    if (this._texListener) document.removeEventListener("ha-3dhome-tex", this._texListener);
    if (this._visListener) document.removeEventListener("visibilitychange", this._visListener);
    if (this._netListener)
      for (const t of ["online", "offline", "pageshow"]) window.removeEventListener(t, this._netListener);
    this._netListener = null;
    clearTimeout(this._offT);
    clearTimeout(this._probeT);
    clearTimeout(this._ctxT);
    this._offT = this._probeT = this._ctxT = null;
    this._offSince = 0;
    this._ctxLost = 0;
    this._conn = null;
    if (this._edReady) window.removeEventListener("ha-3dhome-editor-ready", this._edReady);
    this._ro?.disconnect();
    this._ro = null;
    for (const hp of this._helpers || []) {
      this._scene?.remove(hp);
      hp.dispose?.();
    }
    this._helpers = [];
    this._editor?.disposePreview();
    this._editor = null; // its scene objects are gone; Edit makes a new one
    this._plan = false;
    if (this._world) this._disposeWorld();
    for (const t of this._bpTex?.values() || []) t.dispose();
    this._bpTex = null;
    this._world = null;
    try {
      this._tc?.detach();
      this._tc?.dispose();
    } catch {
      /* ignore */
    }
    this._tc = null;
    this._controls?.dispose();
    this._controls = null;
    for (const m of Object.values(this._mats || {})) m.dispose();
    this._mats = null;
    this._glowTex?.dispose();
    this._glowTex = null;
    for (const ps of this._composer?.passes || []) ps.dispose?.();
    this._composer?.dispose();
    this._composer = this._aoPass = this._bloomPass = null;
    this._usePP = false;
    this._lkSig = null;
    this._bgKey = undefined;
    for (const t of Object.values(this._surfTexs || {})) t.dispose();
    this._surfTexs = null;
    if (this._renderer) {
      this._renderer.renderLists?.dispose();
      this._renderer.dispose();
      this._renderer.forceContextLoss(); // give the context back to the browser now, not at GC time
      this._renderer.domElement.remove();
      this._renderer = null;
    }
    this._rcCache = null;
    this._camK = null;
    this._seen = null;
    this._seenCfg = null;
    if (this._hassRaf) cancelAnimationFrame(this._hassRaf);
    this._hassRaf = null;
    this._scene = null;
    this._edit = null;
    this._work = null;
    this._ready = false;
    this._loading = false;
    if (this.shadowRoot) this.shadowRoot.innerHTML = "";
  }

  /** Where Save writes: the panel's store, which saves through the integration. */
  set layoutStore(store: LayoutStore | null) {
    this._layoutStore = store;
  }

  /** Whether Home Assistant opens on this page: the panel's, offered in the ⋮ menu. */
  set homePage(home: HomePage | null) {
    this._homePage = home;
    this._showHome();
  }

  /** the ⋮ button and its menu item: shown when the panel says where the page is, ticked while it's the user's
   * default page */
  _showHome() {
    const btn = this._moreBtn;
    const item = this._moreMenu?.querySelector<HTMLElement>(".homeitem");
    if (!btn || !item) return;
    const on = !!this._hass && !!this._homePage?.isHome(this._hass);
    btn.classList.toggle("hide", !this._homePage);
    item.innerHTML = `${ic(on ? "checkbox-marked" : "checkbox-blank-outline")}Open Home Assistant here`;
  }

  /** open or close the ⋮ menu (it closes on any press outside it) */
  _toggleMore(open = this._moreMenu?.classList.contains("hide")) {
    this._moreMenu?.classList.toggle("hide", !open);
    this._moreBtn?.classList.toggle("on", !!open);
  }

  async _toggleHome() {
    const home = this._homePage;
    const hass = this._hass;
    this._toggleMore(false);
    if (!home || !hass) return;
    const on = !home.isHome(hass);
    try {
      await home.setHome(hass, on);
      this._toast(on ? "Home Assistant now opens on this page" : "Home Assistant opens on its usual page again");
    } catch (e) {
      console.error("3D Home: couldn't change the default page", e);
      this._toast("Couldn't change the page Home Assistant opens on");
    }
  }

  set hass(hass: Hass) {
    this._hass = hass;
    if (!this._loading && !this._ready) this._kick();
    // HA hands over a new hass for every state change anywhere in the house, often dozens in a burst. Apply them once
    // per frame (none while the tab is hidden), and redo the scene only when an entity the map shows has changed.
    if (this._ready && !this._hassRaf)
      this._hassRaf = requestAnimationFrame(() => {
        this._hassRaf = null;
        this._applyHass();
      });
  }

  _applyHass() {
    const h = this._hass;
    if (!this._ready || !h) return;
    this._connState(h);
    if (this._edit || this._hassChanged(h)) this._update();
    this._rcHass();
    this._showHome();
    if (this._edBtn) this._edBtn.style.display = h.user?.is_admin && !this._edit && editorAvailable() ? "" : "none"; // the editor itself loads on the first press
  }

  /* → true when anything _update() reads differs from the last applied hass: a watched entity's state object (HA keeps
   * the object of an unchanged entity), the locale or location, or a minute has passed (the sun moves) */
  _hassChanged(h: Hass) {
    const seen = this._seen;
    const now = Date.now();
    let changed =
      !seen ||
      this._seenCfg !== this._cfg() ||
      seen.config !== h.config ||
      seen.locale !== h.locale ||
      seen.user !== h.user ||
      now - seen.at > 60000;
    if (!changed)
      for (const id of this._watch || [])
        if (seen.states.get(id) !== h.states[id]) {
          changed = true;
          break;
        }
    if (!changed) return false;
    const cfg = this._cfg();
    if (this._seenCfg !== cfg) {
      this._watch = watchedEntities(cfg);
      this._seenCfg = cfg;
    }
    this._seen = {
      config: h.config,
      locale: h.locale,
      user: h.user,
      at: now,
      states: new Map(this._watch.map((id) => [id, h.states[id]])),
    };
    return true;
  }

  /* The websocket to HA drops on a restart, a network loss or a sleeping tablet, and HA flips hass.connected while it
   * reconnects. Past a short grace period the map greys out under a "Reconnecting" pill (its states may be stale); once
   * it's back, every entity is re-applied (they may have changed meanwhile) and the scene redrawn. */
  _connState(h = this._hass) {
    if (!this._ready) return;
    const up = !!h && h.connected !== false && navigator.onLine !== false;
    if (up) {
      clearTimeout(this._offT);
      this._offT = null;
      if (this._offSince) {
        this._offSince = 0;
        this._seen = null;
        this._showOffline(false);
      } // _seen = null: the next _hassChanged redoes everything
    } else if (!this._offSince) {
      this._offSince = Date.now();
      this._offT = setTimeout(() => {
        this._offT = null;
        if (this._offSince) this._showOffline(true);
      }, CONN_GRACE);
    }
  }

  _showOffline(on: boolean) {
    this._wrap?.classList.toggle("offline", on);
    this._conn?.classList.toggle("hide", !on);
  }

  /* a tap that would call a service while HA is away: show the pill now instead of a call that goes nowhere */
  _offlineTap() {
    if (!this._offSince) return false;
    clearTimeout(this._offT);
    this._offT = null;
    this._showOffline(true);
    this._conn?.animate?.([{ transform: "translateX(-50%) scale(1.08)" }, { transform: "translateX(-50%)" }], 300);
    return true;
  }

  /* After a long sleep or a network change the websocket can be dead without HA noticing yet (it still says connected).
   * Ping it, and if no answer comes back, have HA reconnect now rather than whenever the socket finally times out. */
  _probeConn() {
    const h = this._hass;
    const c = h?.connection;
    if (!c?.ping || h.connected === false || this._probeT) return;
    this._probeT = setTimeout(() => {
      this._probeT = null;
      if (this._renderer && this._hass?.connection === c) c.reconnect?.(true);
    }, 8000);
    c.ping().then(
      () => {
        clearTimeout(this._probeT);
        this._probeT = null;
      },
      () => {},
    );
  }

  /* Phones and tablets often throw away the WebGL context of a page in the background. Three.js restores its state when
   * the browser gives the context back, but nothing redraws by itself (rendering is on demand), and some browsers never
   * give it back: then rebuild the card once the page is visible again. */
  _ctxCheck() {
    clearTimeout(this._ctxT);
    this._ctxT = null;
    if (!this._ctxLost || !this._renderer) return;
    if (document.hidden) return; // visibilitychange calls again
    const left = CTX_GRACE - (Date.now() - Math.max(this._ctxLost, this._shownAt || 0));
    if (left > 0) {
      this._ctxT = setTimeout(() => this._ctxCheck(), left);
      return;
    }
    if (this._edit?.dirty) return; // never throw away unsaved edits; the canvas comes back with the context
    console.warn("ha-3dhome: the WebGL context was lost and not restored; rebuilding the map");
    const cam = this._cam &&
      this._controls && {
        pos: this._cam.position.toArray(),
        zoom: this._cam.zoom,
        target: this._controls.target.toArray(),
      };
    this._teardown();
    this._camKeep = cam;
    this._kick();
  }

  disconnectedCallback() {
    this._ro?.disconnect();
    // Leaving the page detaches the map. The panel keeps it for when you come back, but if that takes more than 30 s
    // the GPU memory is given back (unless there are unsaved edits) and the map starts again on return.
    clearTimeout(this._idleT);
    this._idleT = setTimeout(() => {
      if (!this.isConnected && !this._edit?.dirty) this._teardown();
    }, 30000);
  }

  connectedCallback() {
    clearTimeout(this._idleT);
    if (this._ro && this._wrap) this._ro.observe(this._wrap);
    else this._kick();
  }

  _cfg() {
    return this._work || this._config;
  }

  /** a short message at the bottom of the map (the editor's feedback, mostly) */
  _toast(msg: string, ms = 2600) {
    if (!this._editorLayer) return;
    let t = this._editorLayer.querySelector<HTMLElement>(".toast");
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      this._editorLayer.append(t);
    }
    t.textContent = msg;
    t.style.opacity = "1";
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (t.style.opacity = "0"), ms);
  }

  _fail(e: any) {
    console.error("ha-3dhome", e);
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `<ha-card><div style="padding:16px">3D map failed to load: ${esc((e && e.message) || e)}</div></ha-card>`;
  }

  /* ---------- world (re)build ---------- */
  _rebuild() {
    const T = this.T;
    if (this._world) this._disposeWorld();
    this._world = new T.Group();
    this._scene.add(this._world);
    this._items = new Map();
    this._fixtures = [];
    this._screens = [];
    this._floorMeshes = [];
    this._cur = null;
    this._xf = null;
    const sc = this._cfg().scene || {};
    this._buildScene(sc);
    this._armIdle();
    this._stage = this._stageSpot = null;
    this._lkSig = null;
    this._bgKey = undefined; // _applyLook (from _update) re-applies the look to the fresh lights
    this._buildRoof(sc);
    this._buildLights();
    this._buildTargets();
    this._buildOverlays();
    if (this._edit) this._editor.applyPlanVis();
    if (this._renderer) this._renderer.shadowMap.needsUpdate = true;
    this._loadModels();
    if (this._focus) this._focus.polys = this._roomPolys(this._focus.room); // room outlines may have changed
    this._fadeGen = (this._fadeGen || 0) + 1;
    this._showEmpty();
    if (this._ready) this._update();
    this._scheduleBatch();
  }

  /* a new panel or dashboard starts with nothing in it: say how to begin */
  _showEmpty() {
    const cfg = this._cfg();
    const sc = cfg.scene || {};
    const empty = !this._edit && ![sc.wall_segs, sc.floors, sc.boxes, sc.objects, cfg.lights].some((a) => a?.length);
    let el = this._wrap?.querySelector<HTMLElement>(".empty");
    if (!empty) return el?.remove();
    if (!el) {
      el = document.createElement("div");
      el.className = "empty";
      this._wrap?.append(el);
    }
    el.innerHTML = `<b>Your 3D home is empty</b><span>${
      this._hass?.user?.is_admin
        ? `Press ${ic("pencil-outline")}Edit, then Floor plan, to draw your walls and rooms. Save keeps them here.`
        : "Ask an administrator to draw the floor plan with the Edit button."
    }</span>`;
  }

  /* free GPU memory of the current world: geometries, per-item materials + their textures, light shadow maps.
   * Cached materials (this._mats), the shared glow texture, blueprint textures and Sweet Home 3D prototype meshes are kept. */
  _disposeWorld() {
    this._unbatch();
    this._dropBakedAO();
    this._clearFade(true);
    this._scene?.remove(this._world);
    this._disposeTree(this._world);
    this._wallG = null;
    this._jointMeshes = null;
    this._roomHG = null;
    this._vertMeshes = this._midMeshes = null;
    this._strHG = null;
    this._sptMeshes = this._smidMeshes = null;
  }

  _disposeTree(root: THREE.Object3D) {
    const keep = new Set(Object.values(this._mats || {}));
    const keepTex = new Set([...(this._bpTex?.values() || []), ...Object.values(this._surfTexs || {})]);
    root.traverse((o: any) => {
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
}

for (const part of [
  StartupPart,
  CameraPart,
  RoomsPart,
  ScenePart,
  ModelsPart,
  LightsPart,
  PickingPart,
  LivePart,
  PlanPart,
  BatchPart,
  BakePart,
])
  for (const k of Object.getOwnPropertyNames(part.prototype))
    if (k !== "constructor")
      Object.defineProperty(Home3DCard.prototype, k, Object.getOwnPropertyDescriptor(part.prototype, k)!);
