/* <ha-3dhome-card>: the custom element. This file holds its lifecycle (config, hass, connection state,
 * attach/detach, teardown) and world rebuilds. The rest of the card is split by topic into the mixins it extends.
 */
import { ic, esc, stableJSON } from "../core/util.js";
import { watchedEntities } from "../core/entities.js";
import { StartupMixin } from "./startup.js";
import { CameraMixin } from "./camera.js";
import { RoomsMixin } from "./rooms.js";
import { SceneMixin } from "./scene.js";
import { ModelsMixin } from "./models.js";
import { LightsMixin } from "./lights.js";
import { PickingMixin } from "./picking.js";
import { LiveMixin } from "./live.js";
import { PlanMixin } from "./plan.js";

/* Cards that HA detached but haven't torn down yet, by dashboard + card_id. HA rebuilds a strategy dashboard's cards
 * whenever its config changes (every editor save), and the new element adopts the parked one instead of starting a
 * second WebGL scene from scratch: same camera, no reload, no flash. */
const PARKED = new Map();
/* a connection blip shorter than this (HA suspending a hidden tab, a Wi-Fi hand-over) doesn't show the offline pill */
const CONN_GRACE = 2500;
/* how long a lost WebGL context may stay lost on a visible page before the card rebuilds itself from scratch */
const CTX_GRACE = 3000;
const cardIdent = (cfg) =>
  `${cfg.dashboard || decodeURIComponent(location.pathname.split("/")[1] || "lovelace")}|${cfg.card_id || ""}`;

export class Home3DCard extends PlanMixin(
  LiveMixin(PickingMixin(LightsMixin(ModelsMixin(SceneMixin(RoomsMixin(CameraMixin(StartupMixin(HTMLElement)))))))),
) {
  setConfig(config) {
    if (this._inner) return this._inner.setConfig(config); // a shell around an adopted card
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
        PARKED.delete(this._ident);
        clearTimeout(old._idleT);
        this._inner = old;
        const root = this.shadowRoot || this.attachShadow({ mode: "open" });
        root.innerHTML = "<style>:host { display: block; }</style>";
        root.append(old);
        old.hass = this._hass;
        old.setConfig(this._config); // usually identical, so nothing is rebuilt
        return;
      }
      this._loading = true;
      this._init().catch((e) => this._fail(e));
    }, 0);
  }

  /* release everything the card holds: GPU resources, the WebGL context, listeners, timers */
  _teardown() {
    this._gen = (this._gen || 0) + 1; // invalidates in-flight async work (_init, model loads)
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
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
    this._disposePreview?.();
    this._plan = false;
    if (this._world) this._disposeWorld();
    for (const t of this._bpTex?.values() || []) t.dispose();
    this._bpTex = null;
    this._world = null;
    try {
      this._tc?.detach();
      this._tc?.dispose();
    } catch (e) {
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

  getCardSize() {
    return 12;
  }

  getGridOptions() {
    return { columns: "full", rows: "auto" };
  }

  set hass(hass) {
    if (this._inner) {
      this._inner.hass = hass;
      return;
    }
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
    if (this._edBtn) this._edBtn.style.display = h.user?.is_admin && !this._edit && this._enterEdit ? "" : "none"; // Edit shows once the editor module has loaded
  }

  /* → true when anything _update() reads differs from the last applied hass: a watched entity's state object (HA keeps
   * the object of an unchanged entity), the locale or location, or a minute has passed (the sun moves) */
  _hassChanged(h) {
    const seen = this._seen,
      now = Date.now();
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

  _showOffline(on) {
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
    const h = this._hass,
      c = h?.connection;
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
    if (this._inner) return; // the adopted card parks itself
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
    if (this._inner) {
      if (!this._inner.isConnected && this.shadowRoot) this.shadowRoot.append(this._inner);
      return;
    }
    clearTimeout(this._idleT);
    if (PARKED.get(this._ident) === this) PARKED.delete(this._ident);
    if (this._ro && this._wrap) this._ro.observe(this._wrap);
    else this._kick();
  }

  _cfg() {
    return this._work || this._config;
  }

  _fail(e) {
    console.error("ha-3dhome-card", e);
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
    this._bulbs = null;
    this._niche = null;
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
    if (this._edit) this._applyPlanVis();
    if (this._renderer) this._renderer.shadowMap.needsUpdate = true;
    this._loadModels();
    if (this._focus) this._focus.polys = this._roomPolys(this._focus.room); // room outlines may have changed
    this._fadeGen = (this._fadeGen || 0) + 1;
    this._showEmpty();
    if (this._ready) this._update();
  }

  /* a new dashboard (Settings → Dashboards → Add → 3D Home) starts with nothing in it: say how to begin */
  _showEmpty() {
    const cfg = this._cfg(),
      sc = cfg.scene || {};
    const empty =
      !this._edit &&
      ![sc.wall_segs, sc.walls, sc.front_walls, sc.floors, sc.boxes, sc.objects, cfg.lights].some((a) => a?.length);
    let el = this._wrap?.querySelector(".empty");
    if (!empty) return el?.remove();
    if (!el) {
      el = document.createElement("div");
      el.className = "empty";
      this._wrap?.append(el);
    }
    el.innerHTML = `<b>Your 3D home is empty</b><span>${
      this._hass?.user?.is_admin
        ? `Press ${ic("pencil-outline")}Edit, then Floor plan, to draw your walls and rooms. Save puts them in this dashboard.`
        : "Ask an administrator to draw the floor plan with the Edit button."
    }</span>`;
  }

  /* free GPU memory of the current world: geometries, per-item materials + their textures, light shadow maps.
   * Cached materials (this._mats), the shared glow texture, blueprint textures and Sweet Home 3D prototype meshes are kept. */
  _disposeWorld() {
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

  _disposeTree(root) {
    const keep = new Set(Object.values(this._mats || {})),
      keepTex = new Set([...(this._bpTex?.values() || []), ...Object.values(this._surfTexs || {})]);
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
}
