/* <ha-3dhome-splat>: the home as a 3D scan (a Gaussian splat) with live entities pinned into it. The panel shows it
 * instead of the floor plan map when the config has `splat` (or nothing yet: then it offers to make a scan).
 *
 * Scene graph: scene → level (the scan's alignment: SplatConfig.align, so the floor is level at height 0) → the splat
 * (DropInViewer), the pins' glows and the levelling markers. Pins are kept in the scan's own coordinates, inside
 * `level`, so levelling again never moves them off the things they mark.
 *
 * Rendering is on demand like the map's: nothing draws unless _requestRender() is called, and it keeps drawing for a
 * moment after (the renderer sorts the splats for the new view on a worker and needs a frame once that is done).
 *
 * The element talks to the panel the way <ha-3dhome-map> does: setConfig(), hass, layoutStore (Save), homePage, `_edit`
 * (set while editing) and the "ha-3dhome-editing" event. It also takes `entryId`, for the integration's file and scan
 * endpoints (api.ts).
 */
import type { CardConfig, Hass, HomePage, LayoutStore, SplatConfig, SplatPin, V3 } from "../types";
import type { DropInViewer } from "@mkkellogg/gaussian-splats-3d";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadOrbitControls, loadSplatRenderer, loadThree } from "../core/libs";
import {
  fromLevel,
  levelFromFloor,
  mm,
  pinGlow,
  pinTap,
  robustExtent,
  scanLighting,
  spinLevel,
  splatFormat,
  toLevel,
  viewOf,
  NO_ALIGN,
  type Extent,
} from "../core/splat";
import { stateRgb } from "../core/entities";
import { jclone, stableJSON } from "../core/util";
import { IntegrationApi, type ScanJob } from "./api";
import { canFilm, type PhotoTaker } from "./capture";
import { pickFile } from "./files";
import { splatStyles } from "./styles";
import { patchSplatMaterial, setLighting } from "./lighting";
import { renderUi } from "./ui";

type Three = typeof import("three");

/** what the editor holds while editing */
export interface SplatEdit {
  work: SplatConfig;
  sel: number; // the selected pin, -1 for none
  tool: null | "place" | "level";
  placeEntity: string; // the entity the next tap places
  levelPts: V3[]; // floor points tapped so far (scan coordinates)
  undo: string[];
  dirty: boolean;
  saving: boolean;
}

/** a splat that's loading, or why it couldn't */
interface LoadState {
  src: string;
  pct: number;
  phase: "download" | "process" | "done" | "failed";
  error?: string;
}

/** how many splat centres are read to find the scan's extent */
const SAMPLE = 4000;
/** how long a detached view keeps its scene, in case the page comes back (ms) */
const PARK = 30000;
/** a press longer than this opens the entity's details (ms) */
const HOLD = 500;

export class SplatView extends HTMLElement {
  layoutStore: LayoutStore | null = null;
  homePage: HomePage | null = null;
  /** the integration's config entry, for its file and scan endpoints */
  entryId = "";
  _edit: SplatEdit | null = null;
  _hass: Hass | null = null;
  _config: CardConfig = {};
  _api: IntegrationApi | null = null;

  /* the scene (null until _init, and again after teardown) */
  _three: Three | null = null;
  _renderer: import("three").WebGLRenderer | null = null;
  _scene: import("three").Scene | null = null;
  _camera: import("three").PerspectiveCamera | null = null;
  _controls: OrbitControls | null = null;
  _level: import("three").Group | null = null; // the scan's alignment
  _drop: DropInViewer | null = null; // the splat renderer
  _glows: import("three").Sprite[] = []; // a glow per light pin (same index as the pins), or null
  _glowTex: import("three").Texture | null = null;
  _marks: import("three").Mesh[] = []; // levelling markers
  _ro: ResizeObserver | null = null;
  _raf = 0;
  _until = 0; // keep drawing until then (ms)
  _gen = 0; // bumped by every splat load and teardown, so a late load knows it's stale
  _inited: Promise<void> | null = null;
  _parked = 0; // the teardown timer while detached
  _hassRaf = 0;
  _lit = false; // the splat material has the live lighting (lighting.ts)
  _unfollow: Promise<() => Promise<void>> | null = null;

  /* what's shown */
  _load: LoadState | null = null;
  _sample: V3[] = []; // splat centres in scan coordinates, for the extent
  _job: ScanJob | null = null;
  _scanning = false; // the photo-taking screen is open
  _scanVideo: File | null = null; // read photos from this video instead of the camera
  _taker: PhotoTaker | null = null; // the photo taker while scanning (tests look at it)
  _adding = false; // the "Add a device" chooser is open
  _uploadPct: number | null = null; // a splat file uploading, 0–1
  _menu = false;
  _toastMsg = "";
  _toastTimer = 0;
  _wrap: HTMLElement | null = null;
  _pinsEl: HTMLElement | null = null;
  _uiEl: HTMLElement | null = null;
  _press: { i: number; x: number; y: number; t: number; timer: number; held: boolean; moved: boolean } | null = null;
  _down: { x: number; y: number; t: number } | null = null;

  /* ----- what the panel uses ----- */

  setConfig(config: CardConfig) {
    if (stableJSON(config) === stableJSON(this._config)) return;
    this._config = config;
    if (this._renderer) this._apply();
    else this._ui();
  }

  set hass(hass: Hass) {
    const first = !this._hass;
    this._hass = hass;
    if (!this._api && this.entryId) this._api = new IntegrationApi(() => this._hass!, this.entryId);
    if (first || !this._renderer) this._start();
    else if (!this._hassRaf)
      this._hassRaf = requestAnimationFrame(() => {
        this._hassRaf = 0;
        this._updateStates();
      });
  }

  get hass(): Hass {
    return this._hass!;
  }

  connectedCallback() {
    clearTimeout(this._parked);
    this._start();
  }

  disconnectedCallback() {
    clearTimeout(this._parked);
    this._parked = window.setTimeout(() => {
      if (!this.isConnected && !this._edit?.dirty) this._teardown();
    }, PARK);
  }

  /* ----- lifecycle ----- */

  _cfg(): SplatConfig | null {
    return this._edit?.work ?? this._config.splat ?? null;
  }

  _isAdmin() {
    return !!this._hass?.user?.is_admin;
  }

  _start() {
    if (!this._hass || !this.isConnected) return;
    if (!this.shadowRoot) this._dom();
    if (!this._inited)
      this._inited = this._init().catch((e) => console.error("3D Home: couldn't start the 3D scan view", e));
    this._follow();
  }

  _dom() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${splatStyles}</style><div class="wrap"><div class="pins"></div><div class="ui"></div></div>`;
    this._wrap = root.querySelector(".wrap");
    this._pinsEl = root.querySelector(".pins");
    this._uiEl = root.querySelector(".ui");
    this._ui();
  }

  async _init() {
    const gen = this._gen;
    const [THREE, { OrbitControls }] = await Promise.all([loadThree(), loadOrbitControls()]);
    if (gen !== this._gen || !this.isConnected) {
      this._inited = null;
      return;
    }
    this._three = THREE;
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); // splats are heavy on fill rate
    renderer.setClearColor(0x1b1a18, 1);
    renderer.domElement.className = "gl";
    this._wrap!.prepend(renderer.domElement);
    this._renderer = renderer;
    renderer.domElement.addEventListener("webglcontextrestored", () => this._requestRender(500));

    this._scene = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(60, 1, 0.03, 400);
    this._camera.position.set(4, 3, 5);
    this._level = new THREE.Group();
    this._scene.add(this._level);
    const controls = new OrbitControls(this._camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.screenSpacePanning = true;
    controls.maxDistance = 120;
    controls.addEventListener("change", () => this._requestRender(700));
    this._controls = controls;

    this._bindPointer(renderer.domElement);
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this._wrap!);
    this._resize();
    this._apply();
  }

  /** show what the config says: load the splat if it changed, place the pins, level the scan */
  _apply() {
    const cfg = this._cfg();
    if (!this._renderer) return;
    if (!cfg?.src) {
      this._dropSplat();
      this._load = null;
    } else if (this._load?.src !== cfg.src || this._load.phase === "failed") this._loadSplat(cfg.src, cfg.format);
    this._placeLevel();
    this._buildGlows();
    this._ui();
    this._requestRender(300);
  }

  _dropSplat() {
    const drop = this._drop;
    this._drop = null;
    this._sample = [];
    if (drop) {
      drop.parent?.remove(drop);
      drop.dispose().catch(() => {});
    }
  }

  async _loadSplat(src: string, format?: SplatConfig["format"]) {
    const gen = ++this._gen;
    this._dropSplat();
    const load: LoadState = (this._load = { src, pct: 0, phase: "download" });
    this._ui();
    try {
      const GS = await loadSplatRenderer();
      const url = await this._api!.splatUrl(src);
      if (gen !== this._gen) return;
      const kind = format || splatFormat(src) || "ply";
      const fmt = {
        ply: GS.SceneFormat.Ply,
        splat: GS.SceneFormat.Splat,
        ksplat: GS.SceneFormat.KSplat,
        spz: GS.SceneFormat.Spz,
      }[kind];
      const drop = new GS.DropInViewer({
        sharedMemoryForWorkers: false, // Home Assistant's pages aren't cross-origin isolated
        gpuAcceleratedSort: false,
        sphericalHarmonicsDegree: 0,
        dynamicScene: false,
        logLevel: GS.LogLevel.None,
        sceneRevealMode: GS.SceneRevealMode.Instant,
      });
      this._drop = drop;
      this._level!.add(drop);
      await drop.addSplatScene(url, {
        format: fmt,
        showLoadingUI: false,
        progressiveLoad: false,
        splatAlphaRemovalThreshold: 5,
        onProgress: (pct, _label, status) => {
          if (gen !== this._gen) return;
          load.pct = Math.round(pct || 0);
          load.phase = status === 0 ? "download" : "process";
          this._ui();
        },
      });
      if (gen !== this._gen) return;
      load.phase = "done";
      this._lit = !!drop.splatMesh && patchSplatMaterial(drop.splatMesh.material as import("three").ShaderMaterial);
      this._readSample();
      this._updateStates();
      if (!this._cfg()?.view) this._frameAll();
      else this._goView();
      this._requestRender(1500);
    } catch (e) {
      if (gen !== this._gen) return;
      load.phase = "failed";
      load.error = e instanceof Error ? e.message : String(e);
      console.error("3D Home: couldn't load the 3D scan", e);
    }
    this._ui();
  }

  /** read a spread of splat centres (scan coordinates), for the extent */
  _readSample() {
    const mesh = this._drop?.splatMesh;
    const THREE = this._three!;
    if (!mesh) return;
    const n = mesh.getSplatCount();
    const step = Math.max(1, Math.floor(n / SAMPLE));
    const v = new THREE.Vector3();
    const out: V3[] = [];
    for (let i = 0; i < n; i += step) {
      mesh.getSplatCenter(i, v, false);
      out.push([v.x, v.y, v.z]);
    }
    this._sample = out;
  }

  /** the scan's extent in levelled coordinates */
  _extent(): Extent | null {
    const align = this._cfg()?.align;
    return robustExtent(this._sample.map((p) => toLevel(align, p)));
  }

  _placeLevel() {
    const a = this._cfg()?.align ?? NO_ALIGN;
    this._level!.quaternion.set(...a.q);
    this._level!.position.set(...a.t);
    this._level!.updateMatrixWorld(true);
  }

  /** the camera on the config's start view */
  _goView() {
    const v = this._cfg()?.view;
    if (!v) return this._frameAll();
    this._camera!.position.set(...v.position);
    this._controls!.target.set(...v.target);
    this._controls!.update();
    this._requestRender(800);
  }

  /** the camera on the whole scan */
  _frameAll() {
    const e = this._extent();
    if (!e) return;
    const v = viewOf(e, !!this._cfg()?.align);
    this._camera!.position.set(...v.position);
    this._controls!.target.set(...v.target);
    this._controls!.update();
    this._requestRender(800);
  }

  _resize() {
    const r = this._renderer;
    if (!r || !this._wrap) return;
    const w = Math.max(1, this._wrap.clientWidth);
    const h = Math.max(1, this._wrap.clientHeight);
    r.setSize(w, h, false);
    this._camera!.aspect = w / h;
    this._camera!.updateProjectionMatrix();
    this._requestRender(300);
  }

  /** draw now and keep drawing for `ms` */
  _requestRender(ms = 0) {
    this._until = Math.max(this._until, performance.now() + ms);
    if (!this._raf && this._renderer) this._raf = requestAnimationFrame(this._frame);
  }

  _frame = () => {
    this._raf = 0;
    const r = this._renderer;
    if (!r) return;
    const moving = this._controls!.update();
    r.render(this._scene!, this._camera!);
    this._placePins();
    if (moving || performance.now() < this._until) this._raf = requestAnimationFrame(this._frame);
  };

  _teardown() {
    this._gen++;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._ro?.disconnect();
    this._ro = null;
    this._dropSplat();
    this._clearGlows();
    this._clearMarks();
    this._glowTex?.dispose();
    this._glowTex = null;
    this._controls?.dispose();
    this._controls = null;
    if (this._renderer) {
      this._renderer.domElement.remove();
      this._renderer.dispose();
      this._renderer.forceContextLoss();
    }
    this._renderer = null;
    this._scene = null;
    this._camera = null;
    this._level = null;
    this._load = null;
    this._inited = null;
    this._unfollow?.then((u) => u()).catch(() => {});
    this._unfollow = null;
  }

  /* ----- the scan job (photos being turned into a splat by the integration) ----- */

  _follow() {
    if (this._unfollow || !this._api || !this._isAdmin()) return;
    this._unfollow = this._api.follow((job) => {
      this._job = job;
      this._ui();
    });
    this._unfollow.catch(() => (this._unfollow = null)); // an integration without scans: nothing to follow
  }

  /* ----- pins ----- */

  /** a pin's place in world coordinates */
  _pinWorld(pin: SplatPin) {
    const THREE = this._three!;
    return this._level!.localToWorld(new THREE.Vector3(...pin.p));
  }

  /** move the pins' chips to where their points are on screen */
  _placePins() {
    const pins = this._cfg()?.pins ?? [];
    const els = this._pinsEl?.querySelectorAll<HTMLElement>(".pin");
    if (!els?.length || !this._camera) return;
    const w = this._wrap!.clientWidth;
    const h = this._wrap!.clientHeight;
    const cam = this._camera;
    els.forEach((el) => {
      const pin = pins[+el.dataset.i!];
      if (!pin) return;
      const v = this._pinWorld(pin).project(cam);
      const behind = v.z > 1 || v.z < -1;
      el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      el.classList.toggle("off-screen", behind);
    });
  }

  /** a soft round glow, shared by every light's sprite */
  _glowTexture() {
    if (this._glowTex) return this._glowTex;
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.25, "rgba(255,255,255,.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    this._glowTex = new this._three!.CanvasTexture(c);
    return this._glowTex;
  }

  _clearGlows() {
    for (const s of this._glows) {
      if (!s) continue;
      s.parent?.remove(s);
      s.material.dispose();
    }
    this._glows = [];
  }

  /** a glow sprite for each light pin; states colour them in _updateStates() */
  _buildGlows() {
    const THREE = this._three!;
    this._clearGlows();
    const pins = this._cfg()?.pins ?? [];
    this._glows = pins.map((pin) => {
      const r = pinGlow(pin);
      if (!r) return null as unknown as import("three").Sprite;
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this._glowTexture(),
          blending: THREE.AdditiveBlending,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0,
        }),
      );
      s.position.set(...pin.p);
      s.scale.setScalar(r * 2);
      s.renderOrder = 10;
      this._level!.add(s);
      return s;
    });
    this._updateStates();
  }

  /** entity states: the glows' colour and brightness, and the chips (redrawn by the UI) */
  _updateStates() {
    const pins = this._cfg()?.pins ?? [];
    const states = this._hass?.states ?? {};
    const mat = this._drop?.splatMesh?.material as import("three").ShaderMaterial | undefined;
    if (this._lit && mat) {
      const night = this._cfg()?.night ?? 0.25;
      const sun = states[this._config.sun_entity || "sun.sun"];
      setLighting(mat, scanLighting(pins, states, sun, stateRgb, night));
    }
    pins.forEach((pin, i) => {
      const s = this._glows[i];
      if (!s) return;
      const st = states[pin.entity];
      const on = st?.state === "on";
      const [r, g, b] = stateRgb(st);
      s.material.color.setRGB(r / 255, g / 255, b / 255);
      s.material.opacity = on ? 0.25 + 0.6 * ((st.attributes.brightness ?? 255) / 255) : 0;
      s.visible = on;
    });
    this._ui();
    this._requestRender(100);
  }

  /* ----- pointer: taps on pins, taps on the scan for the editing tools ----- */

  _bindPointer(canvas: HTMLCanvasElement) {
    canvas.addEventListener("pointerdown", (e) => {
      this._down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    canvas.addEventListener("pointerup", (e) => {
      const d = this._down;
      this._down = null;
      if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return;
      const r = canvas.getBoundingClientRect();
      this._canvasTap(e.clientX - r.left, e.clientY - r.top);
    });
  }

  /** the point of the scan under (x, y) on the canvas, in scan coordinates, or null */
  _pick(x: number, y: number): V3 | null {
    const drop = this._drop;
    const mesh = drop?.splatMesh;
    if (!drop || !mesh || this._load?.phase !== "done") return null;
    const w = this._wrap!.clientWidth;
    const h = this._wrap!.clientHeight;
    const rc = drop.viewer.raycaster;
    rc.setFromCameraAndScreenPosition(this._camera!, { x, y }, { x: w, y: h });
    const hits = rc.intersectSplatMesh(mesh, []) ?? [];
    if (!hits.length) return null;
    const p = this._level!.worldToLocal(hits[0].origin.clone());
    return [p.x, p.y, p.z];
  }

  _canvasTap(x: number, y: number) {
    const ed = this._edit;
    if (!ed) return;
    if (ed.tool === "place") {
      const p = this._pick(x, y);
      if (!p) return this._toast("Tap on the scan itself, where the device is.");
      const entity = ed.placeEntity;
      this._mutate((w) => {
        (w.pins ??= []).push({ entity, p: mm(p) });
        return w.pins.length - 1;
      });
      ed.tool = null;
      ed.placeEntity = "";
      this._ui();
    } else if (ed.tool === "level") {
      const p = this._pick(x, y);
      if (!p) return this._toast("Tap on the floor of the scan.");
      ed.levelPts.push(p);
      this._showMarks();
      if (ed.levelPts.length === 3) this._finishLevel();
      this._ui();
    } else if (ed.sel >= 0) {
      ed.sel = -1;
      this._ui();
    }
  }

  /** a press on a pin's chip: tap = its action, hold = its details; while editing, select it and drag it */
  _pinDown(e: PointerEvent, i: number) {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that's already gone */
    }
    const press: NonNullable<SplatView["_press"]> = {
      i,
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
      timer: 0,
      held: false,
      moved: false,
    };
    this._press = press;
    if (this._edit) {
      this._edit.sel = i;
      this._edit.undo.push(JSON.stringify(this._edit.work));
      this._controls!.enabled = false;
      this._ui();
      return;
    }
    press.timer = window.setTimeout(() => {
      press.held = true;
      this._moreInfo(this._cfg()!.pins![i].entity);
    }, HOLD);
  }

  _pinMove(e: PointerEvent) {
    const press = this._press;
    if (!press) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
      press.moved = true;
      clearTimeout(press.timer);
    }
    if (!this._edit || !press.moved) return;
    const r = this._wrap!.getBoundingClientRect();
    const p = this._pick(e.clientX - r.left, e.clientY - r.top);
    const pin = this._edit.work.pins?.[press.i];
    if (!p || !pin) return;
    pin.p = mm(p);
    this._glows[press.i]?.position.set(...pin.p);
    this._requestRender(100);
  }

  _pinUp() {
    const press = this._press;
    this._press = null;
    if (!press) return;
    clearTimeout(press.timer);
    if (this._edit) {
      this._controls!.enabled = true;
      if (press.moved) this._edit.dirty = true;
      else this._edit.undo.pop(); // a tap that only selected
      this._ui();
      return;
    }
    if (press.held || press.moved) return;
    const pin = this._cfg()?.pins?.[press.i];
    if (!pin) return;
    const tap = pinTap(pin);
    if (tap === "toggle") this._hass?.callService("homeassistant", "toggle", { entity_id: pin.entity });
    else if (tap === "more-info") this._moreInfo(pin.entity);
  }

  _moreInfo(entityId: string) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } }));
  }

  /* ----- editing ----- */

  _enterEdit() {
    if (this._edit || !this._isAdmin()) return;
    const work: SplatConfig = jclone(this._config.splat ?? { src: "" });
    work.pins ??= [];
    this._edit = { work, sel: -1, tool: null, placeEntity: "", levelPts: [], undo: [], dirty: false, saving: false };
    this._menu = false;
    this.dispatchEvent(new CustomEvent("ha-3dhome-editing", { detail: { editing: true } }));
    this._ui();
  }

  /** leave the editor; unsaved changes are dropped */
  _exitEdit() {
    if (!this._edit) return;
    this._edit = null;
    this._clearMarks();
    this._apply();
    this._goView();
    this.dispatchEvent(new CustomEvent("ha-3dhome-editing", { detail: { editing: false } }));
  }

  /** change the work copy (undoable); `fn` may return the pin to select */
  _mutate(fn: (w: SplatConfig) => number | void) {
    const ed = this._edit!;
    ed.undo.push(JSON.stringify(ed.work));
    if (ed.undo.length > 60) ed.undo.shift();
    const sel = fn(ed.work);
    if (typeof sel === "number") ed.sel = sel;
    if (ed.sel >= (ed.work.pins?.length ?? 0)) ed.sel = -1;
    ed.dirty = true;
    this._apply();
  }

  _undo() {
    const ed = this._edit;
    const last = ed?.undo.pop();
    if (!ed || !last) return;
    ed.work = JSON.parse(last);
    ed.sel = -1;
    ed.dirty = true;
    this._apply();
  }

  /** start placing an entity: the next tap on the scan puts it there */
  _startPlace(entity: string) {
    const ed = this._edit!;
    this._adding = false;
    ed.tool = "place";
    ed.placeEntity = entity;
    this._ui();
  }

  _startLevel() {
    const ed = this._edit!;
    ed.tool = ed.tool === "level" ? null : "level";
    ed.levelPts = [];
    this._clearMarks();
    this._ui();
  }

  _finishLevel() {
    const ed = this._edit!;
    const THREE = this._three!;
    const [a, b, c] = ed.levelPts;
    // "up" in scan coordinates: the screen's up while the points were tapped
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this._camera!.quaternion);
    up.applyQuaternion(this._level!.getWorldQuaternion(new THREE.Quaternion()).invert());
    const align = levelFromFloor(a, b, c, [up.x, up.y, up.z]);
    ed.tool = null;
    ed.levelPts = [];
    this._clearMarks();
    if (!align) return this._toast("Those points are in a line. Tap three spots spread over the floor.");
    this._mutate((w) => {
      w.align = { q: align.q.map((v) => Math.round(v * 1e6) / 1e6) as typeof align.q, t: mm(align.t) };
      delete w.view;
    });
    this._frameAll();
    this._toast("Levelled. Turn it with ↺ ↻ if you like, then save.");
  }

  /** turn the levelled scan about the vertical */
  _spin(deg: number) {
    this._mutate((w) => {
      const a = spinLevel(w.align ?? NO_ALIGN, (deg * Math.PI) / 180);
      w.align = { q: a.q.map((v) => Math.round(v * 1e6) / 1e6) as typeof a.q, t: mm(a.t) };
      delete w.view;
    });
    this._frameAll();
  }

  /** the view now becomes the one the page opens on */
  _setStartView() {
    const c = this._camera!.position;
    const t = this._controls!.target;
    this._mutate((w) => {
      w.view = { position: mm([c.x, c.y, c.z]), target: mm([t.x, t.y, t.z]) };
    });
    this._toast("The page will open on this view.");
  }

  _showMarks() {
    const THREE = this._three!;
    this._clearMarks();
    for (const p of this._edit?.levelPts ?? []) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xf2c76b, depthTest: false }),
      );
      m.renderOrder = 20;
      m.position.set(...p);
      this._level!.add(m);
      this._marks.push(m);
    }
    this._requestRender(100);
  }

  _clearMarks() {
    for (const m of this._marks) {
      m.parent?.remove(m);
      m.geometry.dispose();
      (m.material as import("three").Material).dispose();
    }
    this._marks = [];
  }

  async _save() {
    const ed = this._edit;
    if (!ed || ed.saving || !this.layoutStore) return;
    ed.saving = true;
    this._ui();
    try {
      const splat = ed.work.src ? ed.work : undefined;
      const next = await this.layoutStore.save({ splat }, this._config);
      this._config = next;
      this._edit = null;
      this._clearMarks();
      this._apply();
      this.dispatchEvent(new CustomEvent("ha-3dhome-editing", { detail: { editing: false } }));
      this._toast(this.layoutStore.savedMessage);
    } catch (e) {
      ed.saving = false;
      this._toast(e instanceof Error ? e.message : (e as { message?: string })?.message || "Couldn't save.");
      this._ui();
    }
  }

  /** a new splat file was uploaded: show it (and save straight away when not editing) */
  async _useUploaded(src: string) {
    if (this._edit) {
      this._mutate((w) => {
        w.src = src;
        delete w.align;
        delete w.view;
        delete w.format;
      });
      this._toast("Scan replaced. Level it and check where the pins are, then save.");
      return;
    }
    const pins = this._config.splat?.pins ?? [];
    const next = await this.layoutStore!.save({ splat: { src, pins } }, this._config);
    this._config = next;
    this._apply();
  }

  /** upload a splat file and show it */
  async _upload(file: File) {
    this._uploadPct = 0;
    this._ui();
    try {
      const src = await this._api!.uploadSplat(file, (f) => {
        this._uploadPct = f;
        this._ui();
      });
      this._uploadPct = null;
      await this._useUploaded(src);
    } catch (e) {
      this._uploadPct = null;
      this._toast((e as { message?: string })?.message || "The upload failed.");
    }
  }

  _toggleAdding() {
    const ed = this._edit;
    if (ed?.tool === "place") ed.tool = null;
    else this._adding = !this._adding;
    this._ui();
  }

  /** open the photo-taking screen, on the camera or reading `video` */
  _openScan(video: File | null) {
    if (this._edit?.dirty && !confirm("Taking new photos drops your unsaved changes. Go on?")) return;
    if (!video && !canFilm()) {
      // browsers only share the camera with https pages: on http, the phone's own camera app films the video instead
      pickFile("video/*", (f) => this._openScan(f), "environment");
      return;
    }
    if (this._edit) this._exitEdit();
    this._scanVideo = video;
    this._scanning = true;
    this._ui();
  }

  _closeScan() {
    this._scanning = false;
    this._scanVideo = null;
    this._taker = null;
    this._ui();
    this._requestRender(300);
  }

  /** the scan view gives way to a drawn floor plan: the panel swaps in <ha-3dhome-map> */
  _usePlan() {
    this.dispatchEvent(new CustomEvent("ha-3dhome-mode", { bubbles: true, composed: true, detail: { mode: "plan" } }));
  }

  _toast(msg: string) {
    this._toastMsg = msg;
    clearTimeout(this._toastTimer);
    this._toastTimer = window.setTimeout(() => {
      this._toastMsg = "";
      this._ui();
    }, 3500);
    this._ui();
  }

  /** redraw the UI (Preact) */
  _ui() {
    if (this._uiEl) renderUi(this);
    this._placePins();
  }

  /** levelled → scan coordinates, for the UI */
  _toScan(p: V3) {
    return fromLevel(this._cfg()?.align, p);
  }
}
