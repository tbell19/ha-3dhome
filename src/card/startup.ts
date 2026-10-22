/* Card startup: loads Three.js, builds the renderer, camera, controls and DOM, and wires up input.
 */
import type * as THREE from "three";
import type { OrbitControls as OrbitControlsType } from "three/examples/jsm/controls/OrbitControls.js";
import type { Home3DCard } from "./card";
import { THREE_URL, ORBIT_URL, CX, CY } from "../core/constants";
import { cardStyles, CARD_HTML } from "./styles";
import { editorAvailable, loadEditor } from "./editor-loader";

export class StartupPart {
  /** first start (and restart after a lost context): load Three.js, build the DOM, renderer, camera and listeners, then
   * the world */
  async _init(this: Home3DCard) {
    const cfg = this._config,
      gen = this._gen;
    const T: typeof THREE = (this.T = await import(cfg.three_url || THREE_URL));
    const { OrbitControls } = await import(cfg.orbit_url || ORBIT_URL);
    if (gen !== this._gen || !this.isConnected) {
      this._loading = false;
      return;
    } // torn down / detached meanwhile
    const root = this.shadowRoot || this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${cardStyles}</style>${CARD_HTML}`;
    const wrap = (this._wrap = root.querySelector<HTMLElement>(".wrap"));
    this._ov = root.querySelector<HTMLElement>(".ov");
    this._ed = root.querySelector<HTMLElement>(".ed");
    this._edBtn = root.querySelector<HTMLElement>(".edbtn");
    this._conn = root.querySelector<HTMLElement>(".conn");
    this._edBtn.addEventListener("click", () => this._openEditor());

    this._createRenderer(T, wrap);
    const { cam, controls } = this._createCamera(T, OrbitControls);
    this._bindNav(root);
    this._bindPageListeners();
    this._rebuild();
    this._bindPicking();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(wrap);
    this._ro.observe(root.querySelector<HTMLElement>(".rcards")); // the room controls resizing moves the safe area (see _safeArea)
    if (this._camKeep) {
      // rebuilt after a lost context: keep the view the user had
      const k = this._camKeep;
      this._camKeep = null;
      this._fitRoom = null;
      this._fly = null;
      this._moved = true;
      cam.position.fromArray(k.pos);
      controls.target.fromArray(k.target);
      cam.zoom = k.zoom;
      cam.updateProjectionMatrix();
    }
    this._resize();
    this._ready = true;
    this._connState();
    this._update();
    if (this._hass?.user?.is_admin && editorAvailable()) this._edBtn.style.display = "";
    // an editor registered as its own resource may arrive later
    this._edReady = () => {
      if (this._edBtn && this._hass?.user?.is_admin && !this._edit) this._edBtn.style.display = "";
    };
    window.addEventListener("ha-3dhome-editor-ready", this._edReady);
  }

  /** Edit pressed: fetch the editor the first time, then enter edit mode */
  async _openEditor(this: Home3DCard) {
    if (!this._editor) {
      const btn = this._edBtn,
        gen = this._gen;
      btn.style.opacity = ".5";
      try {
        const mod = await loadEditor();
        if (gen !== this._gen) return; // torn down meanwhile
        this._editor = mod.create(this);
      } catch (e) {
        console.warn("3D Home: the editor didn't load", e);
        btn.title = "The editor didn't load. Check the connection and try again.";
        return;
      } finally {
        btn.style.opacity = "";
      }
    }
    if (!this._edit) await this._editor.enter();
  }

  /** the WebGL renderer, its canvas first in .wrap, with context loss handling (phones drop background contexts) */
  _createRenderer(this: Home3DCard, T: typeof THREE, wrap: HTMLElement) {
    const cfg = this._config;
    const renderer = (this._renderer = new T.WebGLRenderer({ antialias: true, alpha: true }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.max_pixel_ratio || 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = cfg.shadows !== false;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    wrap.prepend(renderer.domElement);
    const canvas = renderer.domElement; // three.js keeps the context restorable (it preventDefault()s the loss)
    canvas.addEventListener("webglcontextlost", () => {
      if (this._renderer?.domElement === canvas) {
        this._ctxLost = Date.now();
        this._ctxCheck();
      }
    });
    canvas.addEventListener("webglcontextrestored", () => {
      if (this._renderer?.domElement !== canvas) return;
      this._ctxLost = 0;
      clearTimeout(this._ctxT);
      this._ctxT = null;
      this._renderer.shadowMap.needsUpdate = true;
      this._requestRender();
    });
    return renderer;
  }

  /** the scene, the orthographic camera at its home view, and map-style OrbitControls */
  _createCamera(this: Home3DCard, T: typeof THREE, OrbitControls: typeof OrbitControlsType) {
    const renderer = this._renderer;
    this._scene = new T.Scene();
    const cam = (this._cam = new T.OrthographicCamera(-1, 1, 1, -1, -2000, 4000));
    this._home = { pos: new T.Vector3(330, 360, 330), target: new T.Vector3(-10, 5, -10), zoom: 1 };
    cam.position.copy(this._home.pos);
    cam.lookAt(this._home.target);
    this._homeSph = new T.Spherical().setFromVector3(this._home.pos.clone().sub(this._home.target));
    const controls = (this._controls = new OrbitControls(cam, renderer.domElement));
    controls.target.copy(this._home.target);
    controls.enableDamping = true;
    controls.dampingFactor = 0.14;
    controls.minPolarAngle = 0.02;
    controls.maxPolarAngle = 1.2;
    controls.minZoom = 0.6;
    controls.maxZoom = 8;
    controls.screenSpacePanning = false; // pan glides along the floor, not the screen
    controls.zoomToCursor = true; // wheel / pinch zooms toward the pointer
    controls.rotateSpeed = 0.7;
    controls.panSpeed = 1.1;
    controls.zoomSpeed = 1.2;
    // map-style: drag pans, right-drag (or Ctrl/Shift-drag) rotates; touch: one finger pans, two pinch + twist
    controls.mouseButtons = { LEFT: T.MOUSE.PAN, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.ROTATE };
    controls.touches = { ONE: T.TOUCH.PAN, TWO: T.TOUCH.DOLLY_ROTATE };
    // three r160's OrbitControls reports a change on every update() for an orthographic camera (it always flags the zoom),
    // which kept the render loop spinning at full frame rate forever. Only a real camera move counts (_camMoved).
    controls.addEventListener("change", () => {
      this._clampPan();
      if (!this._camMoved()) return;
      this._camMv = true;
      this._syncNav();
      const f = this._focus,
        t = controls.target;
      if (f && !this._fly) {
        // panning well away from the framed room ends the see-through view
        const [x1, x2, y1, y2] = f.room.rect,
          x = t.x + CX,
          y = t.z + CY,
          M = 40;
        if (x < x1 - M || x > x2 + M || y < y1 - M || y > y2 + M) this._setFocus(null);
      }
      this._requestRender();
    });
    controls.addEventListener("start", () => {
      this._fly = null;
      this._moved = true;
      this._setActiveRoom(null);
    });
    return { cam, controls };
  }

  /** the view buttons, the room bar, the room controls header, the idle countdown and double-click to frame a room */
  _bindNav(this: Home3DCard, root: ShadowRoot) {
    const wrap = this._wrap,
      cam = this._cam,
      renderer = this._renderer;
    const nav = root.querySelector<HTMLElement>(".nav");
    nav.addEventListener("click", (ev) => {
      const a = (ev.target as HTMLElement).closest<HTMLElement>("button")?.dataset.v;
      if (!a) return;
      if (a !== "home") this._moved = true;
      if (a === "home") this._focusRoom(null);
      else if (a === "left" || a === "right") this._orbitBy(a === "left" ? -Math.PI / 2 : Math.PI / 2);
      else if (a === "top") this._toggleTop();
      else if (a === "in" || a === "out") this._flyTo({ zoom: cam.zoom * (a === "in" ? 1.4 : 1 / 1.4) }, 250);
    });
    this._buildRoomBar();
    root.querySelector<HTMLElement>(".rcards header").addEventListener("click", () => {
      // open/collapse the controls, then re-frame the view for the new space
      this._rcMin = !this._rcMin;
      this._showRoomCards(this._rcRoom);
      this._fitRoom = this._rcRoom === "home" ? null : this._rooms().find((r) => r.name === this._rcRoom) || null;
      this._moved = false;
      this._setActiveRoom(this._fitRoom ? this._fitRoom.name : "");
      requestAnimationFrame(() => {
        if (this._renderer) {
          this._applyOffset();
          this._frame(this._fitRoom, 450);
          this._requestRender();
        }
      });
    });
    this._showRoomCards("home");
    this._setActiveRoom(""); // the whole-home view is where it starts
    this._idleKick = () => this._armIdle(); // any touch, click, wheel or key restarts the idle countdown
    for (const t of ["pointerdown", "wheel", "keydown"])
      wrap.addEventListener(t, this._idleKick, { capture: true, passive: true });
    renderer.domElement.addEventListener("dblclick", (ev) => {
      if (!this._edit) {
        const r = this._roomAt(ev);
        if (r) this._focusRoom(r);
      }
    });
    renderer.domElement.addEventListener("contextmenu", (ev) => ev.preventDefault());
  }

  /** document and window listeners (removed again in _teardown): model textures arriving, the page hiding and
   * showing, and the browser's network state */
  _bindPageListeners(this: Home3DCard) {
    this._texListener = () => this._renderer && this._requestRender();
    document.addEventListener("ha-3dhome-tex", this._texListener);
    this._visListener = () => {
      if (document.hidden) {
        this._hiddenAt = Date.now();
        return;
      }
      if (!this._renderer) return;
      this._shownAt = Date.now();
      this._requestRender();
      this._ctxCheck();
      if (this._shownAt - (this._hiddenAt || this._shownAt) > 60000) this._probeConn(); // back from a long sleep
    };
    document.addEventListener("visibilitychange", this._visListener);
    // the browser's own network state: going offline counts even before the socket notices, and coming online or
    // a page restored from the back/forward cache checks the socket still works
    this._netListener = (ev) => {
      if (!this._renderer) return;
      this._connState();
      if (ev.type !== "offline") {
        this._requestRender();
        this._probeConn();
      }
    };
    for (const t of ["online", "offline", "pageshow"]) window.addEventListener(t, this._netListener);
  }
}
