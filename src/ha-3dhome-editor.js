/* ha-3dhome-card — editor module (v-matched to the core module).
 *
 * The card core (src/ha-3dhome.js) renders the map and handles viewing. This module adds everything behind
 * the Edit button: furniture/entity editing, the floor-plan editor, the model library and saving. The core loads it from
 * its own folder, so viewers who never edit don't pay for it up front.
 *
 * It waits for the core to define <ha-3dhome-card>, takes the shared helpers the core publishes on
 * window.__ha3dhome, and copies the methods of Home3DEditor onto the card's prototype.
 */
const EDITOR_VERSION = "5.0.0";
await customElements.whenDefined("ha-3dhome-card");
const H = window.__ha3dhome;
if (!H || H.VERSION3D !== EDITOR_VERSION) throw new Error(`3D Home editor ${EDITOR_VERSION} doesn't match the card core ${H?.VERSION3D || "(missing)"} — refresh, or update both resources`);
const { inPoly, ACTIVE, CX, CY, DOOR_CLASSES, KINDS, LIBS, LIB_DIR, PLAN, R1, ROOM_FILLS, ROTATABLE, SF, STRATEGY_TYPES, CARD_TYPES, STRUCT_TYPES, SURFACES, DOOR_STYLES, FIXTURES, TC_URL, bArr, entIcon, esc, ic, itemCenter, itemBase, itemZ, scaleItem, jclone, legacyWalls, lookOf, AMBIENT, mapPts, mean, stringCount, stringLen, polyArea, roomTitle, rotPt, segDir, shiftItem, zipFind } = H;

const YAML_URL = "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm";
const SAVED = ["scene", "lights", "hotspots", "chips", "doors", "look", "ambient", "idle_view", "room_cards"];   // what Save writes back (a missing one is removed)
const IDLE_AFTER = [[0, "Never"], [30, "After 30 seconds"], [60, "After 1 minute"], [120, "After 2 minutes"], [300, "After 5 minutes"], [600, "After 10 minutes"], [900, "After 15 minutes"], [1800, "After 30 minutes"], [3600, "After 1 hour"]];
const hm = (hours) => { const m = Math.round(hours * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

class Home3DEditor {

  /* =====================================================================
   * Editor
   * ===================================================================== */
  _list(k, create) {
    const w = this._work;
    if ("bovwnpr".includes(k)) {
      w.scene ||= {}; const n = { b: "boxes", o: "objects", v: "overlays", w: "wall_segs", n: "openings", p: "blueprints", r: "floors" }[k];
      if (create) w.scene[n] ||= [];
      return w.scene[n] || [];
    }
    const n = { l: "lights", h: "hotspots", c: "chips", d: "doors" }[k];
    if (create) w[n] ||= [];
    return w[n] || [];
  }
  _get(key) { const [k, i] = key.split(":"); return this._list(k)[+i]; }
  _setBoxObj(key) { const [k, i] = key.split(":"); const l = this._list(k); if (k === "b" && Array.isArray(l[+i])) l[+i] = { b: l[+i] }; return l[+i]; }
  _allKeys() { const out = []; for (const k of "bovlhcdwnpr") this._list(k).forEach((_, i) => out.push(k + ":" + i)); return out; }
  _label(key) {
    const [k] = key.split(":"), it = this._get(key);
    if (!it) return key;
    if (k === "b") return "Box" + (it.group ? ` · ${it.group}` : "");
    if (k === "o" || k === "v") return (it.type === "model" ? it.name || "Model" : it.type) + (it.group ? ` · ${it.group}` : "");
    if (k === "w") return `Wall · ${this._fmtLen(segDir(it)[2])}`;
    if (k === "n") return { door: "Door", window: "Window" }[it.kind] || "Cut-out";
    if (k === "p") return "Blueprint";
    if (k === "r") return `Room · ${roomTitle(it.name || "unnamed")}`;
    const ent = it.entity ? this._hass?.states[it.entity]?.attributes?.friendly_name || it.entity : "";
    return `${KINDS[k][0].toUpperCase() + KINDS[k].slice(1)}${ent ? " · " + ent : it.label ? " · " + it.label : ""}`;
  }

  async _enterEdit() {
    if (this._edit) return;
    const { TransformControls } = await this._mod(TC_URL);
    this._work = jclone({ scene: this._config.scene || {}, lights: this._config.lights || [], hotspots: this._config.hotspots || [],
      chips: this._config.chips || [], doors: this._config.doors || [], room_cards: this._config.room_cards });
    this._work = { ...this._config, ...this._work };
    this._migrateWalls();
    this._edit = { sel: new Set(), undo: [], redo: [], dirty: false, mode: "translate", space: "world", lock: false, snap: true, showFurn: false };
    this._plan = false; this._tool = "select";
    this._coarse = matchMedia("(pointer: coarse)").matches;   // touch-first device: no gizmo, drag selected items directly
    this._inspMin = this._coarse && this._wrap.clientWidth < 640;  // phones: inspector starts folded to its title bar
    this._wrap.classList.add("editing");
    this._edBtn.style.display = "none";
    const T = this.T;
    this._pivot = new T.Object3D(); this._scene.add(this._pivot);
    const tc = (this._tc = new TransformControls(this._cam, this._renderer.domElement));
    tc.setSize(0.9);
    tc.addEventListener("change", () => this._requestRender());
    tc.addEventListener("dragging-changed", (e) => { this._controls.enabled = !e.value; this._tcDragging = e.value; if (e.value) this._tcUsed = true; });
    tc.addEventListener("mouseDown", () => this._dragStart(this._edit.mode));
    tc.addEventListener("objectChange", () => this._dragPreview());
    tc.addEventListener("mouseUp", () => this._dragEnd());
    this._scene.add(tc);
    this._applySnap();
    this._keys = (ev) => this._onKey(ev);
    window.addEventListener("keydown", this._keys);
    this._renderEditorUI();
    this._rebuild();
    this._select([]);
  }
  _exitEdit(discard) {
    if (!this._edit) return;
    if (discard && this._edit.dirty && !confirm("Discard your unsaved layout changes?")) return;
    window.removeEventListener("keydown", this._keys);
    this._tc.detach(); this._scene.remove(this._tc); this._tc.dispose(); this._tc = null;
    this._scene.remove(this._pivot);
    for (const hp of this._helpers || []) { this._scene.remove(hp); hp.dispose?.(); }
    this._helpers = [];
    this._disposePreview();
    if (this._plan && this._planTopped && this._sph().phi < 0.3) this._toggleTop();
    this._plan = false; this._planTopped = false; this._tool = "select"; this._sunPreview = null;
    this._edit = null; this._work = null; this._controls.enabled = true;
    this._wrap.classList.remove("editing", "plan", "tool");
    this._ed.innerHTML = "";
    this._edBtn.style.display = this._hass?.user?.is_admin ? "" : "none";
    this._rebuild();
    this._buildRoomBar();
    this._showRoomCards(this._rcRoom || "home");
  }
  _applySnap() {
    const s = this._edit.snap;
    this._tc.setTranslationSnap(s ? 2 : null);
    this._tc.setRotationSnap(s ? Math.PI / 12 : null);
    this._tc.setScaleSnap(s ? 0.05 : null);
  }
  _toast(msg, ms = 2600) {
    let t = this._ed.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; this._ed.append(t); }
    t.textContent = msg; t.style.opacity = 1; clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (t.style.opacity = 0), ms);
  }
  /* The toolbar: a top row (mode switch, undo/redo, Cancel, Save) and a row of tools for what is selected. Item tools
   * (`.selo`) show only with a selection and scene tools (`.idle`) only without one; the rest sit in the Draw and More
   * menus. On a phone the rows stack and only `.ico` buttons drop their label. */
  _renderEditorUI() {
    const ed = this._ed, plan = !!this._plan;
    const b = (a, icon, label, title, cls = "") => `<button data-a="${a}"${cls ? ` class="${cls}"` : ""}${title ? ` title="${title}"` : ""}>${ic(icon)}<span class="lbl">${label}</span></button>`;
    const menu = (m, icon, label, title, cls = "") => `<button data-m="${m}"${cls ? ` class="${cls}"` : ""} title="${title}">${ic(icon)}<span class="lbl">${label}</span>${ic("menu-down")}</button>`;
    const modes = `<span class="seg modes">${b("m-furn", "sofa-outline", "Furniture", "Edit furniture and devices")}${b("m-plan", "floor-plan", "Floor plan", "Edit walls, doors, windows and the blueprint")}</span>`;
    const acts = `<span class="acts">${b("undo", "undo", "Undo", "Undo (Ctrl+Z)", "ico")}${b("redo", "redo", "Redo", "Redo (Ctrl+Shift+Z)", "ico")}
      <button data-a="cancel">Cancel</button><button data-a="save" class="primary">Save</button></span>`;
    const tools = plan
      ? b("t-select", "cursor-default-outline", "Select", "Select and move (V)") + b("rotate", "rotate-right", "Rotate", "Rotate (R)", "selo")
        + menu("draw", "pencil-ruler", "Draw", "Draw walls, doors, windows and rooms") + b("bp", "image-outline", "Blueprint", "Blueprint image to trace over", "idle")
        + b("del", "delete-outline", "Delete", "Delete (Del)", "selo ico") + menu("more", "dots-horizontal", "More", "More options")
      : b("add", "plus", "Add", "Add entities, boxes or models", "idle")
        + b("look", "palette-outline", "Look", "Lighting, effects and idle view", "idle") + b("controls", "tune-variant", "Controls", "Cards shown for each room", "idle")
        + b("translate", "cursor-move", "Move", "Move (W)", "selo") + b("rotate", "rotate-right", "Rotate", "Rotate (E)", "selo") + b("scale", "resize", "Scale", "Scale (R)", "selo")
        + b("del", "delete-outline", "Delete", "Delete (Del)", "selo ico") + menu("more", "dots-horizontal", "More", "More options", "selo");
    const pops = plan
      ? `<div class="menu pop hide" data-pop="draw">${b("t-wall", "wall", "Walls", "Draw walls (W)")}${b("t-door", "door", "Door", "Add a door to a wall (D)")}${b("t-window", "window-closed-variant", "Window", "Add a window to a wall")}${b("t-room", "vector-polygon", "Room", "Draw a room outline")}</div>
        <div class="menu pop hide" data-pop="more">${b("furnvis", "eye-outline", "Show furniture", "Show furniture while editing the plan")}${b("snap", "magnet", "Snap to corners and angles", "Snap to grid, corners and 15° angles")}</div>`
      : `<div class="menu pop hide" data-pop="more">${b("dup", "content-copy", "Duplicate", "Duplicate (Ctrl+D)")}${b("group", "group", "Group", "Group the selected items")}${b("ungroup", "ungroup", "Ungroup", "Ungroup")}
        ${b("space", "earth", "Global axes", "Gizmo axes: the world's, or the selected item's own (X)")}${b("snap", "magnet", "Snap to grid", "Snap to grid / 15° / 5%")}</div>`;
    ed.innerHTML = `<div class="tb">
      <div class="bar"><div class="top">${modes}${acts}</div><div class="tools">${tools}</div></div>${pops}</div>
      <div class="insp"></div>`;
    ed.querySelector(".tb").addEventListener("click", (ev) => {
      const mb = ev.target.closest("[data-m]"); if (mb) return this._togglePop(mb.dataset.m, mb);
      const bt = ev.target.closest("[data-a]"); if (!bt) return;
      const a = bt.dataset.a;
      this._togglePop(null);
      if (a === "m-furn" || a === "m-plan") this._setPlanMode(a === "m-plan");
      else if (a === "translate" || a === "rotate" || a === "scale" || a === "t-select") {
        this._setMode(a === "t-select" ? "translate" : a);
        if (this._plan && this._tool !== "select") this._setTool("select"); else this._syncBar();
      }
      else if (a === "space") { this._edit.space = this._edit.space === "local" ? "world" : "local"; this._placePivot(); this._syncBar(); }
      else if (a === "t-wall" || a === "t-door" || a === "t-window" || a === "t-room") { const t = a.slice(2); this._setTool(this._tool === t ? "select" : t); }
      else if (a === "bp") { const n = this._list("p").length; if (n) { this._setTool("select"); this._select(["p:0"]); } else this._pickBlueprintFile(); }
      else if (a === "furnvis") { this._edit.showFurn = !this._edit.showFurn; this._applyPlanVis(); this._syncBar(); this._requestRender(); }
      else if (a === "snap") { this._edit.snap = !this._edit.snap; this._applySnap(); this._syncBar(); }
      else if (a === "add") this._toggleEntityPanel();
      else if (a === "models") this._openLibrary();
      else if (a === "look") { this._select([]); this._toggleLookPanel(); }
      else if (a === "controls") { this._select([]); this._toggleRoomCardsPanel(); }
      else if (a === "dup") this._duplicate();
      else if (a === "del") this._delete();
      else if (a === "group") this._group(true);
      else if (a === "ungroup") this._group(false);
      else if (a === "undo") this._undo(false);
      else if (a === "redo") this._undo(true);
      else if (a === "cancel") this._exitEdit(true);
      else if (a === "save") this._save();
    });
    if (!this._wrap._popWired) {   // a press anywhere outside an open menu closes it
      this._wrap._popWired = true;
      this._wrap.addEventListener("pointerdown", (ev) => { if (!ev.composedPath().some((n) => n.classList?.contains("pop") || n.dataset?.m)) this._togglePop?.(null); }, { capture: true });
    }
    this._syncBar();
  }
  /* Opens the Draw or More menu under its button (or closes it when it's already open); null closes any open menu. */
  _togglePop(name, btn) {
    const ed = this._ed; if (!ed) return;
    for (const p of ed.querySelectorAll(".pop")) {
      const open = p.dataset.pop === name && p.classList.contains("hide");
      p.classList.toggle("hide", !open);
      ed.querySelector(`[data-m="${p.dataset.pop}"]`)?.classList.toggle("open", open);
      if (!open || !btn) continue;
      const wr = this._wrap.getBoundingClientRect(), br = btn.getBoundingClientRect(), bar = ed.querySelector(".bar").getBoundingClientRect();
      p.style.top = bar.bottom - wr.top + 6 + "px";
      p.style.left = Math.max(8, Math.min(br.left - wr.left, wr.width - p.offsetWidth - 8)) + "px";
    }
  }
  _syncBar() {
    const ed = this._ed, bar = ed?.querySelector(".bar"); if (!bar) return;
    const e = this._edit, q = (a) => ed.querySelector(`.tb [data-a="${a}"]`), on = (a, v) => q(a)?.classList.toggle("on", !!v), dis = (a, v) => { const b = q(a); if (b) b.disabled = !!v; };
    const sel = !this._plan || this._tool === "select", n = e.sel.size;
    on("m-furn", !this._plan); on("m-plan", this._plan);
    on("translate", e.mode === "translate"); on("t-select", sel && e.mode !== "rotate"); on("rotate", sel && e.mode === "rotate"); on("scale", e.mode === "scale");
    on("space", e.space === "local"); const sp = q("space"); if (sp) sp.innerHTML = e.space === "local" ? `${ic("compass-outline")}<span class="lbl">Own axes</span>` : `${ic("earth")}<span class="lbl">Global axes</span>`;
    const tools = { wall: ["wall", "Walls"], door: ["door", "Door"], window: ["window-closed-variant", "Window"], room: ["vector-polygon", "Room"] };
    for (const t in tools) on("t-" + t, this._tool === t);
    const dm = ed.querySelector('[data-m="draw"]');
    if (dm) { const [icon, label] = tools[this._tool] || ["pencil-ruler", "Draw"]; dm.classList.toggle("on", !!tools[this._tool]); dm.innerHTML = `${ic(icon)}<span class="lbl">${label}</span>${ic("menu-down")}`; }
    for (const b of bar.querySelectorAll(".selo")) b.classList.toggle("hide", !n);
    for (const b of bar.querySelectorAll(".idle")) b.classList.toggle("hide", !!n);
    on("furnvis", e.showFurn); on("snap", e.snap); this._syncLookPanel(); this._syncRoomCardsPanel(); on("controls", ed.querySelector(".rcp")); on("bp", e.primary?.[0] === "p" && n);
    dis("dup", !n); dis("ungroup", !n); dis("group", n < 2);
    dis("undo", !e.undo.length); dis("redo", !e.redo.length);
    q("save").textContent = e.dirty ? "Save •" : "Save";
    this._wrap.classList.toggle("tool", !!this._plan && this._tool !== "select");
  }
  _onKey(ev) {
    const t = ev.composedPath()[0];
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!this.isConnected) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const sel = [...this._edit.sel];
    if (this._plan && !mod) {
      if ((ev.key === "Delete" || ev.key === "Backspace") && this._vsel && this._tool === "select") { ev.preventDefault(); this._planField(this._vsel.key, "delcorner"); return; }
      if ((ev.key === "Escape" || ev.key === "Enter") && this._tool !== "select") {
        if (this._tool === "wall" && this._draw?.start && ev.key === "Enter") { this._setTool("wall"); return; }
        if (this._tool === "room" && ev.key === "Enter" && this._draw?.pts?.length >= 3) { this._finishRoom(); return; }
        this._setTool("select"); return;
      }
      const tk = { w: "wall", d: "door", v: "select" }[ev.key.toLowerCase()];
      if (tk) { this._setTool(tk); return; }
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (arrows[ev.key] && sel.length) {
      ev.preventDefault();
      const [dx, dy] = this._screenDir(...arrows[ev.key]), step = ev.shiftKey ? 10 : 1;
      this._mutate(() => { this._applyMove(sel, dx * step, dy * step); return sel; });
      return;
    }
    // [ and ] turn the selection 15° (Shift: 90°); Q / E do the same on the floor plan, where E isn't the rotate tool
    const turn = { "[": -1, "{": -1, "]": 1, "}": 1, ...(this._plan ? { q: -1, Q: -1, e: 1, E: 1 } : {}) }[ev.key];
    if (turn && !mod && sel.length) {
      this._mutate(() => { this._applyRotate(sel, (ev.shiftKey ? 90 : 15) * turn, this._pivotC); return sel; });
      return;
    }
    // Unity / Godot gizmo keys in furniture mode: W move, E rotate, R scale, X local / global axes
    const gk = !this._plan && !mod && { w: "translate", e: "rotate", r: "scale" }[ev.key.toLowerCase()];
    if (gk) { this._setMode(gk); this._syncBar(); return; }
    if (!this._plan && !mod && ev.key.toLowerCase() === "x") { this._ed.querySelector('[data-a="space"]')?.click(); return; }
    if (ev.key === "Delete" || ev.key === "Backspace") { if (this._edit.sel.size) { ev.preventDefault(); this._delete(); } }
    else if (mod && ev.key.toLowerCase() === "z") { ev.preventDefault(); this._undo(ev.shiftKey); }
    else if (mod && ev.key.toLowerCase() === "d") { ev.preventDefault(); this._duplicate(); }
    else if (ev.key === "Escape") this._select([]);
    else if (ev.key === "r" && !mod) this._ed.querySelector('[data-a="rotate"]')?.click();
    else if ((ev.key === "g" || ev.key === "t") && !mod) this._ed.querySelector('[data-a="translate"]')?.click();
  }

  /* ----- selection ----- */
  _expand(key, alone) {
    const set = new Set([key]);
    if (alone) return set;
    const it = this._get(key), grp = it && !Array.isArray(it) && it.group;
    if (grp) for (const k of this._allKeys()) { const o = this._get(k); if (o && !Array.isArray(o) && o.group === grp) set.add(k); }
    for (const k of [...set]) for (const a of this._attached(k)) set.add(a);
    return set;
  }
  /* lights / hotspots that ride along with a fixture (pendant, fan, track, lamps, plant wall, string bulbs) */
  _attached(key) {
    const [k] = key.split(":"); if (k !== "o" && k !== "v") return [];
    const it = this._get(key); let test = null;
    const near = (cx, cy, rad) => (x, y) => Math.hypot(x - cx, y - cy) < rad;
    const rot = it.rot || 0, c = itemCenter(k, it);
    const w = (x, y) => (rot ? rotPt(x, y, c[0], c[1], rot) : [x, y]);
    switch (it.type) {
      case "pendant": case "floorlamp": case "tablelamp": { const [x, y] = w(it.x, it.y); test = near(x, y, 8); break; }
      case "fan": { const [x, y] = w(it.x, it.y); test = near(x, y, (it.r ?? 22) / 2 + 4); break; }
      case "track": {
        const a = w(...it.a), b = w(...it.b);
        test = (x, y) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) < 8; };
        break;
      }
      case "plantwall": test = (x, y) => x > it.x1 - 4 && x < it.x2 + 4 && Math.abs(y - it.y) < 12; break;
      case "bulbs": case "railing": {
        const out = []; this._list("l").forEach((L, i) => L.kind === "string" && out.push("l:" + i)); return out;
      }
      default: return [];
    }
    const out = [];
    this._list("l").forEach((L, i) => { const p = itemCenter("l", L); if (L.kind !== "string" && test(p[0], p[1])) out.push("l:" + i); });
    this._list("h").forEach((H, i) => { if (test(H.x, H.y)) out.push("h:" + i); });
    return out;
  }
  _clickSelect(key, additive, alone) {
    if (!key) { if (!additive) this._select([]); return; }
    const set = this._expand(key, alone);
    if (additive) {
      const cur = new Set(this._edit.sel), has = cur.has(key);
      for (const k of set) has ? cur.delete(k) : cur.add(k);
      this._select([...cur]);
    } else this._select([...set], key);
  }
  _select(keys, primary) {
    const T = this.T, e = this._edit;
    e.sel = new Set(keys.filter((k) => this._get(k)));
    e.primary = primary && e.sel.has(primary) ? primary : [...e.sel][0];
    for (const hp of this._helpers || []) { this._scene.remove(hp); hp.dispose?.(); }
    this._helpers = [];
    const groups = new Set([...e.sel].map((k) => this._items.get(k)).filter(Boolean));
    for (const g of groups) { const hp = new T.BoxHelper(g, 0xf2c76b); hp.material.depthTest = false; hp.renderOrder = 11; this._scene.add(hp); this._helpers.push(hp); }
    this._placePivot();
    if (this._vsel && !e.sel.has(this._vsel.key)) this._vsel = null;
    this._paintJoints(); this._buildRoomHandles(); this._buildStringHandles();
    if (e.sel.size) { this._ed.querySelector(".lookp") && this._toggleLookPanel(); this._ed.querySelector(".rcp") && this._toggleRoomCardsPanel(); }
    this._renderInspector(); this._syncBar(); this._requestRender();
  }
  _groupsOfSel() { return [...new Set([...this._edit.sel].map((k) => this._items.get(k)).filter(Boolean))]; }

  _setMode(m) {
    const e = this._edit; if (this._plan && m === "scale") m = "translate";
    e.mode = m; this._tc.setMode(m);
    // the floor plan only moves and turns flat; furniture gets all three axes
    this._tc.showX = this._tc.showZ = !this._plan || m === "translate"; this._tc.showY = !this._plan || m === "rotate";
    this._placePivot();
  }
  /* rotation of a furniture item as a quaternion: turn (`rot`, clockwise from above) then tilt (`rx`, `rz`), i.e. Ry·Rx·Rz */
  _itemQuat(k, it) {
    const T = this.T, r = Math.PI / 180;
    if (!ROTATABLE.has(k)) return new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -(this._itemAngle(k, it) || 0) * r);
    return new T.Quaternion().setFromEuler(new T.Euler((it.rx || 0) * r, -(Array.isArray(it) ? 0 : it.rot || 0) * r, (it.rz || 0) * r, "YXZ"));
  }
  /* the point a lone item turns and tilts about (the middle of its bounding box), in Three.js coordinates */
  _tiltPivot(key) {
    const T = this.T, g = this._items.get(key), tc = g?.userData.tc; if (!tc) return null;
    return tc.clone().applyAxisAngle(new T.Vector3(0, 1, 0), g.rotation.y).add(g.position);
  }
  /* where the gizmo sits and which way it faces. One item: its own middle, and its own axes in Local (and always for
   * Scale, which works along the item's axes). Several: the middle of their bounding box, world axes. */
  _placePivot() {
    const e = this._edit, T = this.T, keys = [...e.sel], pv = this._pivot; if (!pv) return;
    pv.scale.set(1, 1, 1); pv.quaternion.identity();
    if (!keys.length) { this._tc?.detach(); return; }
    const one = keys.length === 1, k = keys[0][0], it = this._get(keys[0]);
    if (this._plan) {
      const cs = keys.map((kk) => itemCenter(kk[0], this._get(kk))).filter(Boolean);
      const [cx, cy] = mean(cs), cz = cs.reduce((s, c) => s + (c[2] || 0), 0) / cs.length;
      this._pivotC = [cx, cy]; pv.position.set(cx - CX, cz, cy - CY);
    } else {
      let G = one && ROTATABLE.has(k) ? this._tiltPivot(keys[0]) : null;
      if (G && one && !it.rx && !it.rz) { const c = itemCenter(k, it); G.x = c[0] - CX; G.z = c[1] - CY; }   // untilted: turn about its own centre
      if (!G) {
        const box = new T.Box3();
        for (const key of keys) {
          const g = this._items.get(key);
          if (ROTATABLE.has(key[0]) && g) { g.updateMatrixWorld(true); box.expandByObject(g); }
          else { const c = itemCenter(key[0], this._get(key)); if (c) box.expandByPoint(new T.Vector3(c[0] - CX, c[2] ?? 0, c[1] - CY)); }
        }
        G = box.isEmpty() ? new T.Vector3() : box.getCenter(new T.Vector3());
      }
      pv.position.copy(G);
      this._pivotC = one ? (itemCenter(k, it) || [G.x + CX, G.z + CY]).slice(0, 2) : [G.x + CX, G.z + CY];
      if (one && (e.space === "local" || e.mode === "scale")) pv.quaternion.copy(this._itemQuat(k, it));
    }
    this._tc?.setSpace(e.space === "local" ? "local" : "world");
    if (this._coarse || this._plan) this._tc?.detach(); else this._tc?.attach(pv);   // plan mode is all direct dragging; the gizmo would sit on top of what you click next
  }

  /* ----- drag (TransformControls gizmo, or dragging the item itself) ----- */
  _dragStart(kind) {
    const p = this._pivot;
    this._drag = { kind, snap: JSON.stringify(this._work), pos: p.position.clone(), quat: p.quaternion.clone(), rot: p.rotation.y,
      groups: this._groupsOfSel().map((g) => ({ g, pos: g.position.clone(), quat: g.quaternion.clone(), scale: g.scale.clone() })) };
  }
  _dragDelta() {
    const d = this._drag, p = this._pivot;
    return { move: p.position.clone().sub(d.pos), dq: p.quaternion.clone().multiply(d.quat.clone().invert()), s: p.scale.clone() };
  }
  /* one factor for scaling several items together: whichever axis was pulled furthest */
  _uniform(s) { return [s.x, s.y, s.z].reduce((a, b) => (Math.abs(Math.log(b || 1)) > Math.abs(Math.log(a || 1)) ? b : a), 1); }
  _dragPreview() {
    const d = this._drag; if (!d) return;
    const { move, dq, s } = this._dragDelta(), f = this._edit.sel.size > 1 || !ROTATABLE.has(this._edit.primary?.[0]) ? this._uniform(s) : 0;
    for (const { g, pos, quat, scale } of d.groups) {
      if (d.kind === "translate") g.position.copy(pos).add(move);
      else if (d.kind === "rotate") { g.position.copy(pos).sub(d.pos).applyQuaternion(dq).add(d.pos); g.quaternion.copy(dq).multiply(quat); }
      else if (f) { g.position.copy(pos).sub(d.pos).multiplyScalar(f).add(d.pos); g.scale.copy(scale).multiplyScalar(f); }
      else g.scale.set(scale.x * s.x, scale.y * s.y, scale.z * s.z);
    }
    this._requestRender();
  }
  _dragEnd() {
    const d = this._drag; if (!d) return;
    const { move, dq, s } = this._dragDelta(), keys = [...this._edit.sel];
    this._drag = null;
    const moved = d.kind === "translate" ? move.length() > 0.01 : d.kind === "rotate" ? Math.abs(dq.w) < 0.9999999 : [s.x, s.y, s.z].some((v) => Math.abs(v - 1) > 1e-3);
    if (!moved) { this._placePivot(); return; }
    this._edit.undo.push(d.snap); this._edit.redo = [];
    if (d.kind === "translate") this._applyMove(keys, move.x, move.z, move.y);
    else if (d.kind === "rotate") this._applyRotQ(keys, dq, d.pos);
    else if (keys.length > 1 || !ROTATABLE.has(keys[0][0])) { const f = this._uniform(s); this._scaleSel(keys, f, f, f); }
    else this._scaleSel(keys, s.x, s.z, s.y);   // the gizmo's own axes: x across, z front to back, y up
    if (this._edit.snap && d.kind === "translate") for (const k of this._edit.sel) if (k[0] === "n") this._fitOpening(this._get(k));
    this._commit();
  }
  /* turn the selection by the quaternion dq about G (Three.js coordinates). A turn about the vertical alone goes through
   * _applyRotate, as before; a tilt also moves each item so it swings round G as one rigid group. */
  _applyRotQ(keys, dq, G) {
    const T = this.T, r = Math.PI / 180, up = new T.Vector3(0, 1, 0), e = new T.Euler().setFromQuaternion(dq, "YXZ");
    if (Math.abs(e.x) < 1e-5 && Math.abs(e.z) < 1e-5) return this._applyRotate(keys, -e.y / r, [G.x + CX, G.z + CY]);
    const ang = (v, half) => { v = R1((((v / r) % 360) + 360) % 360); if (v >= 359.95) v = 0; return half && v > 180 ? R1(v - 360) : v; };
    for (const key of keys) {
      const k = key[0]; let it = this._get(key); if (!it) continue;
      const c = itemCenter(k, it); if (!c) continue;
      if (ROTATABLE.has(k)) {
        it = this._setBoxObj(key);
        const tc = this._items.get(key)?.userData.tc || new T.Vector3(), O = new T.Vector3(c[0] - CX, 0, c[1] - CY);
        const P = tc.clone().applyAxisAngle(up, -(it.rot || 0) * r).add(O), P2 = P.clone().sub(G).applyQuaternion(dq).add(G);
        const q = this._itemQuat(k, it).premultiply(dq), eu = new T.Euler().setFromQuaternion(q, "YXZ");
        const O2 = P2.clone().sub(tc.clone().applyAxisAngle(up, eu.y));
        shiftItem(k, it, O2.x - O.x, O2.z - O.z, P2.y - P.y);
        it.rot = ang(-eu.y); it.rx = ang(eu.x, true); it.rz = ang(eu.z, true);
        for (const f of ["rot", "rx", "rz"]) if (!it[f]) delete it[f];
      } else {   // a light, badge, hotspot or door: its point swings round G, and a string or a beam turns with the group
        const P = new T.Vector3(c[0] - CX, c[2] ?? 0, c[1] - CY), P2 = P.clone().sub(G).applyQuaternion(dq).add(G), yaw = -e.y / r;
        mapPts(it, (x, y) => { const [a, b] = rotPt(x, y, c[0], c[1], yaw); return [a + P2.x - P.x, b + P2.z - P.z]; });
        if (PLAN.has(k)) continue;
        if (it.rect) { it.rect[2] = R1(it.rect[2] + P2.y - P.y); it.rect[3] = R1(it.rect[3] + P2.y - P.y); }
        else it.z = R1(Math.max(0, P2.y));
      }
    }
  }
  _applyMove(keys, dx, dy, dz = 0) {
    for (const key of keys) {
      const k = key[0], it = this._get(key); if (!it) continue;
      if (ROTATABLE.has(k)) { shiftItem(k, it, dx, dy, dz); continue; }
      mapPts(it, (x, y) => [x + dx, y + dy]);
      if (dz && it.rect) { it.rect[2] = R1(it.rect[2] + dz); it.rect[3] = R1(it.rect[3] + dz); }
      else if (dz) it.z = R1(Math.max(0, itemCenter(k, it)[2] + dz));
    }
  }
  _applyRotate(keys, deg, pivot) {
    const [px, py] = pivot;
    for (const key of keys) {
      const k = key[0]; let it = this._get(key); if (!it) continue;
      if (ROTATABLE.has(k)) {
        const c = itemCenter(k, it); if (!c) continue;
        const [nx, ny] = rotPt(c[0], c[1], px, py, deg);
        shiftItem(k, it, nx - c[0], ny - c[1]);
        it = this._setBoxObj(key);
        it.rot = R1((((it.rot || 0) + deg) % 360 + 360) % 360);
        if (!it.rot) delete it.rot;
      } else mapPts(it, (x, y) => rotPt(x, y, px, py, deg));
    }
  }
  _mutate(fn) {
    this._edit.undo.push(JSON.stringify(this._work)); this._edit.redo = [];
    const keys = fn();
    this._commit(keys);
  }
  _commit(keys) {
    this._edit.dirty = true;
    const sel = keys || [...this._edit.sel], primary = this._edit.primary;
    this._rebuild();
    this._select(sel, primary);
  }
  _undo(redo) {
    const e = this._edit, from = redo ? e.redo : e.undo, to = redo ? e.undo : e.redo;
    if (!from.length) return;
    to.push(JSON.stringify(this._work));
    this._work = JSON.parse(from.pop());
    e.dirty = true;
    this._rebuild(); this._select([...e.sel], e.primary);
  }

  /* ----- commands ----- */
  _target() { const t = this._controls.target; return [R1(t.x + CX), R1(t.z + CY)]; }
  _push(k, item) { const l = this._list(k, true); l.push(item); return k + ":" + (l.length - 1); }
  _duplicate() {
    if (!this._edit.sel.size) return;
    this._mutate(() => {
      const rename = {}, out = [];
      for (const key of this._edit.sel) {
        const k = key[0], it = jclone(this._get(key));
        if (!Array.isArray(it) && it.group) it.group = rename[it.group] ||= it.group.replace(/_\d+$/, "") + "_" + Math.random().toString(36).slice(2, 6);
        if (ROTATABLE.has(k)) shiftItem(k, it, 12, 12); else mapPts(it, (x, y) => [x + 12, y + 12]);
        out.push(this._push(k, it));
      }
      this._toast(`Duplicated ${out.length} item${out.length > 1 ? "s" : ""}`);
      return out;
    });
  }
  _delete() {
    if (!this._edit.sel.size) return;
    this._mutate(() => {
      const by = {};
      for (const key of this._edit.sel) { const [k, i] = key.split(":"); (by[k] ||= []).push(+i); }
      for (const [k, idx] of Object.entries(by)) { const l = this._list(k); idx.sort((a, b) => b - a).forEach((i) => l.splice(i, 1)); }
      return [];
    });
  }
  _group(on) {
    const keys = [...this._edit.sel]; if (!keys.length) return;
    this._mutate(() => {
      const name = "g_" + Math.random().toString(36).slice(2, 7);
      for (const key of keys) { const it = this._setBoxObj(key); if (on) it.group = name; else delete it.group; }
      this._toast(on ? `Grouped ${keys.length} items — click selects the whole group (Alt-click picks one piece)` : "Ungrouped");
      return keys;
    });
  }
  /* ----- add panel: any HA entity, drag onto the map ----- */
  _placedEntities() {
    const w = this._work, out = new Set();
    for (const n of ["lights", "hotspots", "chips", "doors"]) for (const it of w[n] || []) [it.entity, it.climate, it.temperature, it.humidity].forEach((e) => e && out.add(e));
    for (const o of w.scene?.objects || []) if (o.entity) out.add(o.entity);
    return out;
  }
  /* Look panel: a strength slider per render look (light, ao, stage, bloom), applied live while dragging. One undo step per drag. */
  _toggleLookPanel() {
    const old = this._ed.querySelector(".lookp");
    this._ed.querySelector('[data-a="look"]')?.classList.toggle("on", !old);
    if (old) return old.remove();
    if (this._ed.querySelector(".rcp")) this._toggleRoomCardsPanel();
    const rows = [["ambient", "Room fill", "Even daylight on every surface"], ["light", "Soft lighting", "Gradient sky light, soft shadows"], ["ao", "Corner shading", "Darkens corners and creases"],
      ["stage", "Drop shadow", "Lifts the home off the background"], ["bloom", "Lamp glow", "Glow around lit lamps, at night"]];
    const p = document.createElement("div"); p.className = "lookp";
    p.innerHTML = `<header><span class="ttl">Look</span><button data-x title="Close">${ic("close")}</button></header>
      ${rows.map(([k, n, d]) => `<label><span class="n">${n}</span><output data-o="${k}"></output><input type="range" min="0" max="100" step="5" data-k="${k}"><span class="d">${d}</span></label>`).join("")}
      <div class="idle"><span class="n">When left alone</span><span class="d">Go back to a view after nobody has touched the map for a while</span>
        <select data-i="after" aria-label="Idle time">${IDLE_AFTER.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
        <select data-i="room" aria-label="View to return to"><option value="">Whole home</option>${this._rooms().map((r) => `<option value="${esc(r.name)}">${esc(r.label)}</option>`).join("")}</select></div>`;
    this._ed.append(p);
    p.querySelector("[data-x]").addEventListener("click", () => this._toggleLookPanel());
    p.addEventListener("input", (ev) => {
      const k = ev.target.dataset.k; if (!k) return;
      if (!this._lookDrag) { this._edit.undo.push(JSON.stringify(this._work)); this._edit.redo = []; this._edit.dirty = true; this._lookDrag = true; }
      const look = this._work.look === false ? { light: 0, ao: 0, stage: 0, bloom: 0 } : { ...(this._work.look || {}) }, v = +ev.target.value / 100;
      if (k === "ambient") { if (v === AMBIENT) delete this._work.ambient; else this._work.ambient = v; }   // top-level, default AMBIENT
      else { if (v === lookOf({})[k]) delete look[k]; else look[k] = v;   // stored only when it differs from the default
        if (Object.keys(look).length) this._work.look = look; else delete this._work.look; }
      p.querySelector(`[data-o="${k}"]`).textContent = v ? Math.round(v * 100) + "%" : "Off";
      this._update(); this._requestRender();
    });
    p.addEventListener("change", (ev) => {
      this._lookDrag = false;
      if (!ev.target.dataset.i) return;
      this._edit.undo.push(JSON.stringify(this._work)); this._edit.redo = []; this._edit.dirty = true;
      const after = +p.querySelector('[data-i="after"]').value, room = p.querySelector('[data-i="room"]').value;
      if (after > 0) this._work.idle_view = room ? { room, after } : { after }; else delete this._work.idle_view;
      this._syncLookPanel();
    });
    this._syncLookPanel();
  }
  _syncLookPanel() {
    const p = this._ed?.querySelector(".lookp"); if (!p || this._lookDrag) return;
    const L = { ...lookOf(this._work), ambient: this._work.ambient ?? AMBIENT };
    const iv = this._work.idle_view, after = p.querySelector('[data-i="after"]'), room = p.querySelector('[data-i="room"]');
    if (after) { const a = +iv?.after > 0 ? String(+iv.after) : "0";
      if (![...after.options].some((o) => o.value === a)) after.add(new Option(`${a} seconds`, a));   // a hand-set value
      after.value = a; room.value = iv?.room || ""; room.disabled = a === "0"; }
    for (const i of p.querySelectorAll("input[data-k]")) { const v = L[i.dataset.k]; i.value = Math.round(v * 100); p.querySelector(`[data-o="${i.dataset.k}"]`).textContent = v ? Math.round(v * 100) + "%" : "Off"; }
  }
  /* Controls panel: the Lovelace cards each room shows top right (`room_cards`). Tiles for entities, the room's own devices in one go,
   * or any card as YAML (pasted from another dashboard's card code editor). One undo step per change; no 3D rebuild. */
  _toggleRoomCardsPanel() {
    const old = this._ed.querySelector(".rcp");
    if (old) { old.remove(); this._syncBar(); return; }
    if (this._ed.querySelector(".ents")) this._toggleEntityPanel();
    if (this._ed.querySelector(".lookp")) this._toggleLookPanel();
    const p = document.createElement("div"); p.className = "rcp";
    p.innerHTML = `<header><span class="ttl">Room controls</span><button data-x title="Close">${ic("close")}</button></header>
      <div class="rcb"><select data-room></select>
        <div class="hint">These cards show in the top right corner while this room is in view. Any Home Assistant card works.</div>
        <div class="rcl"></div>
        <div class="rcadd"><input data-ent list="rc-ents" placeholder="Entity, e.g. light.lamp"><button data-add>${ic("plus")}Tile</button></div>
        <datalist id="rc-ents"></datalist>
        <div class="rcadd"><button data-auto>${ic("plus")}This room's devices</button><button data-code>${ic("code-braces")}Code</button></div>
        <div class="rccode hide"><textarea spellcheck="false"></textarea>
          <div class="hint">YAML or JSON: one card, or a list of cards. You can paste a card's code from another dashboard (edit the card, then Show code editor).</div>
          <div class="rcadd"><button data-apply class="primary">Apply</button><button data-codex>Close</button></div></div>
        <div class="hint">Preview</div><div class="rcprev"></div></div>`;
    this._ed.append(p);
    const room = p.querySelector("[data-room]"), ta = p.querySelector("textarea"), code = p.querySelector(".rccode");
    room.innerHTML = [["home", "Whole home"], ...this._rooms().map((r) => [r.name, r.label])].map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
    room.value = this._rooms().some((r) => r.name === this._rcRoom) ? this._rcRoom : "home";
    p.querySelector("datalist").innerHTML = Object.entries(this._hass?.states || {}).map(([id, st]) => `<option value="${esc(id)}">${esc(st.attributes?.friendly_name || "")}</option>`).join("");
    room.addEventListener("change", () => { this._rcRoom = room.value; code.classList.add("hide"); this._syncRoomCardsPanel(true); this._focusRoom(this._rooms().find((r) => r.name === room.value) || null); });
    const cur = () => this._work.room_cards?.[room.value] || [];
    p.querySelector("[data-x]").addEventListener("click", () => this._toggleRoomCardsPanel());
    p.querySelector(".rcl").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-i]"); if (!b) return;
      const i = +b.dataset.i, l = [...cur()];
      if (b.dataset.op === "del") l.splice(i, 1);
      else { const j = i + (b.dataset.op === "up" ? -1 : 1); if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; }
      this._rcSet(room.value, l);
    });
    const ent = p.querySelector("[data-ent]"), addTile = () => {
      const e = ent.value.trim(); if (!e) return;
      if (!this._hass?.states[e]) return this._toast("No entity called " + e);
      this._rcSet(room.value, [...cur(), { type: "tile", entity: e }]); ent.value = "";
    };
    p.querySelector("[data-add]").addEventListener("click", addTile);
    ent.addEventListener("keydown", (ev) => { if (ev.key === "Enter") addTile(); });
    p.querySelector("[data-auto]").addEventListener("click", () => {
      const have = new Set(cur().map((c) => c.entity).filter(Boolean)), add = this._roomEntities(room.value).filter((e) => !have.has(e));
      if (!add.length) return this._toast(room.value === "home" ? "Pick a room first" : "No more devices placed in this room");
      this._rcSet(room.value, [...cur(), ...add.map((entity) => ({ type: "tile", entity }))]);
      this._toast(`Added ${add.length} ${add.length === 1 ? "tile" : "tiles"}`);
    });
    const yaml = () => this._mod(YAML_URL).then((m) => m.default || m).catch(() => null);
    p.querySelector("[data-code]").addEventListener("click", async () => {
      if (!code.classList.contains("hide")) return code.classList.add("hide");
      const l = cur(), Y = await yaml();
      ta.value = l.length ? (Y ? Y.dump(l, { lineWidth: -1 }) : JSON.stringify(l, null, 2)) : "";
      code.classList.remove("hide"); ta.focus();
    });
    p.querySelector("[data-codex]").addEventListener("click", () => code.classList.add("hide"));
    p.querySelector("[data-apply]").addEventListener("click", async () => {
      const txt = ta.value.trim(); let v;
      try { if (!txt) v = []; else if (/^[[{]/.test(txt)) v = JSON.parse(txt); else { const Y = await yaml(); if (!Y) throw new Error("couldn't load the YAML reader, use JSON"); v = Y.load(txt); } }
      catch (e) { return this._toast("That code doesn't read right: " + (e.reason || e.message || e), 5000); }
      if (v && !Array.isArray(v) && Array.isArray(v.cards) && !v.type) v = v.cards;   // a pasted view or stack body
      const l = Array.isArray(v) ? v : v ? [v] : [];
      if (l.some((c) => !c || typeof c !== "object" || !c.type)) return this._toast("Every card needs a type, like type: tile", 5000);
      this._rcSet(room.value, l); code.classList.add("hide");
    });
    this._syncRoomCardsPanel(true);
  }
  _rcSet(key, list) {
    const e = this._edit; e.undo.push(JSON.stringify(this._work)); e.redo = []; e.dirty = true;
    const rc = { ...(this._work.room_cards || {}) };
    if (list.length) rc[key] = list; else delete rc[key];
    if (Object.keys(rc).length) this._work.room_cards = rc; else delete this._work.room_cards;
    this._syncBar();
  }
  /* entities of the lights, hotspots, chips, doors and objects placed inside a room's outline */
  _roomEntities(key) {
    const room = this._rooms().find((r) => r.name === key); if (!room) return [];
    const w = this._work, polys = (w.scene?.floors || []).filter((f) => room.floors.includes(f.name) && f.pts?.length >= 3).map((f) => f.pts);
    const inside = (x, y) => polys.length ? polys.some((pts) => inPoly(x, y, pts)) : x >= room.rect[0] && x <= room.rect[1] && y >= room.rect[2] && y <= room.rect[3];
    const out = [];
    const add = (k, it) => { if (!it?.entity || out.includes(it.entity)) return; const [x, y] = itemCenter(k, it); if (inside(x, y)) out.push(it.entity); };
    for (const [k, n] of [["l", "lights"], ["h", "hotspots"], ["c", "chips"], ["d", "doors"]]) for (const it of w[n] || []) add(k, it);
    for (const o of w.scene?.objects || []) add("o", o);
    return out;
  }
  _syncRoomCardsPanel(force) {
    const p = this._ed?.querySelector(".rcp"); if (!p) return;
    const key = p.querySelector("[data-room]").value, list = this._work.room_cards?.[key] || [], sig = key + JSON.stringify(list);
    if (!force && p._sig === sig) return;
    p._sig = sig;
    const st = this._hass?.states || {};
    const name = (c) => { const e = c.entity || (typeof c.entities?.[0] === "string" ? c.entities[0] : c.entities?.[0]?.entity);
      const what = c.name || c.title || (e && (st[e]?.attributes?.friendly_name || e)) || "";
      return { t: String(c.type).replace(/^custom:/, "").replace(/-/g, " "), what: (c.entities?.length > 1 ? `${what} +${c.entities.length - 1}` : what) || (c.cards ? `${c.cards.length} cards` : "") }; };
    p.querySelector(".rcl").innerHTML = list.map((c, i) => { const n = name(c); return `<div class="rcrow"><div style="min-width:0"><div class="n">${esc(n.what || n.t)}</div><div class="id">${esc(n.t)}</div></div>
      <span><button data-i="${i}" data-op="up" title="Move up"${i ? "" : " disabled"}>${ic("arrow-up")}</button><button data-i="${i}" data-op="down" title="Move down"${i < list.length - 1 ? "" : " disabled"}>${ic("arrow-down")}</button><button data-i="${i}" data-op="del" title="Remove">${ic("close")}</button></span></div>`; }).join("")
      || `<div class="hint">No controls for this room yet.</div>`;
    const prev = p.querySelector(".rcprev"), gen = this._gen;
    prev.replaceChildren();
    this._makeCards(list).then((els) => { if (gen === this._gen && p._sig === sig && p.isConnected) prev.replaceChildren(...els); });
  }
  _toggleEntityPanel(force) {
    const old = this._ed.querySelector(".ents");
    if (old && force !== true) { old.remove(); this._ed.querySelector('[data-a="add"]')?.classList.remove("on"); return; }
    if (old) return;
    if (this._ed.querySelector(".rcp")) this._toggleRoomCardsPanel();
    this._ed.querySelector('[data-a="add"]')?.classList.add("on");
    const p = document.createElement("div"); p.className = "ents";
    const doms = [["", "All"], ["light", "Lights"], ["switch", "Switches"], ["sensor", "Sensors"], ["binary_sensor", "Binary"], ["climate", "Climate"],
      ["media_player", "Media"], ["cover", "Covers"], ["fan", "Fans"], ["lock", "Locks"], ["camera", "Cameras"], ["*", "Other"]];
    p.innerHTML = `<header><span class="ttl">Add to map</span><button data-x title="Close">${ic("close")}</button></header>
      <div class="quick"><button data-q="box">${ic("cube-outline")}Box</button><button data-q="label">${ic("label-outline")}Label</button><button data-q="model" title="Browse 3D model libraries">${ic("sofa-outline")}Model</button></div>
      <input type="search" placeholder="Search entities…"><div class="doms">${doms.map(([d, l]) => `<button data-d="${d}"${d === "" ? ' class="on"' : ""}>${l}</button>`).join("")}</div>
      <div class="hint">${this._coarse ? "Tap an entity to add it in the middle of the view, then drag it into place." : "Drag an entity onto the floor plan (or click to drop it in the middle of the view)."}</div><div class="list"></div>`;
    this._ed.append(p);
    let dom = "";
    const q = p.querySelector("input"), list = p.querySelector(".list");
    const main = new Set(doms.map((d) => d[0]).filter((d) => d && d !== "*"));
    const render = () => {
      const s = q.value.trim().toLowerCase(), placed = this._placedEntities(), states = this._hass?.states || {};
      const rows = Object.entries(states).map(([id, st]) => ({ id, st, name: String(st.attributes?.friendly_name || id) })).filter(({ id, name }) => {
        const d = id.split(".")[0];
        if (dom === "*" ? main.has(d) : dom && d !== dom) return false;
        return !s || id.toLowerCase().includes(s) || name.toLowerCase().includes(s);
      }).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 250);
      list.innerHTML = rows.map(({ id, st, name }) => `<div class="erow${ACTIVE.has(st.state) ? " act" : ""}" data-e="${esc(id)}"><ha-icon icon="${esc(entIcon(st, id))}"></ha-icon>
        <div style="min-width:0"><div class="n">${esc(name)}</div><div class="id">${esc(id)} · ${esc(st.state)}</div></div>
        <span class="ok">${placed.has(id) ? `${ic("check")}On map` : ""}</span></div>`).join("") || `<div class="hint">No matching entities.</div>`;
    };
    q.addEventListener("input", render);
    p.querySelector(".doms").addEventListener("click", (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      dom = b.dataset.d; p.querySelectorAll(".doms button").forEach((x) => x.classList.toggle("on", x === b)); render();
    });
    p.querySelector("[data-x]").addEventListener("click", () => this._toggleEntityPanel());
    p.querySelector(".quick").addEventListener("click", (ev) => {
      const k = ev.target.closest("button")?.dataset.q; if (!k) return;
      if (k === "model") return this._openLibrary();
      const [x, y] = this._target();
      this._mutate(() => [k === "box" ? this._push("b", { b: [x - 10, x + 10, y - 10, y + 10, 10, "cream", 0] }) : this._push("c", { label: "Label", x, y, z: 50 })]);
    });
    // Mouse and pen drag an entity onto the map. A finger scrolls the list instead, and a tap adds the entity mid-view.
    let touched = false;
    list.addEventListener("pointerdown", (ev) => {
      const row = ev.target.closest(".erow"); touched = ev.pointerType === "touch"; if (!row || ev.button > 0 || touched) return;
      ev.preventDefault();
      this._dragEntity(row.dataset.e, ev, row);
    });
    list.addEventListener("click", (ev) => {
      const row = ev.target.closest(".erow"); if (!row || !touched) return;
      const [x, y] = this._target(); this._placeEntity(row.dataset.e, x, y);
      this._toggleEntityPanel();   // out of the way, so the new item can be dragged into place
    });
    render();
    this._entsRender = render;
  }
  /* pointer-driven drag from the panel onto the canvas (works with mouse and touch) */
  _dragEntity(id, ev0, row) {
    const st = this._hass?.states[id], wrapR = () => this._wrap.getBoundingClientRect(), canvas = this._renderer.domElement;
    let ghost = null;
    const over = (ev) => {
      const r = canvas.getBoundingClientRect(), panel = this._ed.querySelector(".ents")?.getBoundingClientRect();
      const inCanvas = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      const inPanel = panel && ev.clientX >= panel.left && ev.clientX <= panel.right && ev.clientY >= panel.top && ev.clientY <= panel.bottom;
      return inCanvas && !inPanel;
    };
    const move = (ev) => {
      if (!ghost && Math.hypot(ev.clientX - ev0.clientX, ev.clientY - ev0.clientY) < 6) return;
      if (!ghost) { ghost = document.createElement("div"); ghost.className = "ghost"; ghost.textContent = st?.attributes.friendly_name || id; this._ed.append(ghost); }
      const w = wrapR(); ghost.style.left = ev.clientX - w.left + "px"; ghost.style.top = ev.clientY - w.top + "px";
      ghost.classList.toggle("off", !over(ev));
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      const dragged = !!ghost; ghost?.remove();
      if (ev.type === "pointercancel") return;
      if (!dragged) { const [x, y] = this._target(); return this._placeEntity(id, x, y); }
      if (!over(ev)) return;
      const T = this.T, r = canvas.getBoundingClientRect(), ray = new T.Raycaster();
      ray.setFromCamera(new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this._cam);
      const p = ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), new T.Vector3());
      if (p) this._placeEntity(id, R1(p.x + CX), R1(p.z + CY));
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  }
  /* pick a sensible representation for an entity: light glow, door marker, climate chip, or a live badge */
  _entityItem(id, x, y, as) {
    const st = this._hass?.states[id], d = id.split(".")[0], dc = st?.attributes?.device_class;
    as ||= d === "light" ? "light" : d === "binary_sensor" && DOOR_CLASSES.has(dc) ? "door" : d === "media_player" && dc === "tv" ? "screen" : "badge";
    if (as === "screen") return ["o", { type: "screen", entity: id, x, y, z: 20, w: 32 }];
    if (as === "light") return ["l", { entity: id, x, y, z: 40, r: 40, hit: 10 }];
    if (as === "door") return ["d", { entity: id, x, y }];
    if (as === "hotspot") return ["h", { entity: id, x, y, z: 10, hit: 12 }];
    if (d === "climate") return ["c", { climate: id, x, y, z: 40 }];
    return ["c", { entity: id, x, y, z: 30 }];
  }
  _placeEntity(id, x, y) {
    const [k, item] = this._entityItem(id, x, y);
    this._mutate(() => [this._push(k, item)]);
    this._toast(`Added ${this._hass?.states[id]?.attributes.friendly_name || id}. Drag it into place.`);
    this._entsRender?.();
  }
  _convertEntity(key, as) {
    const it = this._get(key), id = it.entity || it.climate; if (!id) return;
    const c = itemCenter(key[0], it);
    this._mutate(() => {
      const [k, i] = key.split(":"); this._list(k).splice(+i, 1);
      const [nk, item] = this._entityItem(id, R1(c[0]), R1(c[1]), as);
      if (as === "badge" && id.startsWith("climate.")) { delete item.climate; item.entity = id; }
      return [this._push(nk, item)];
    });
  }

  /* ----- inspector ----- */
  _renderInspector() {
    const box = this._ed.querySelector(".insp"); if (!box) return;
    if (this._plan) return this._renderPlanInspector(box);
    const e = this._edit, n = e.sel.size;
    if (!n) {
      box.innerHTML = `<h4>Edit layout<span class="tw">${ic("chevron-down")}</span></h4><div class="sub">Tap something to select it, then drag it to move.
        <details class="tips"><summary>Tips</summary>On touch, one finger only moves things that are already selected — otherwise it pans; two fingers zoom and rotate.
        With a mouse, drag anything to move it; drag empty floor to pan, right-drag to orbit. W / E / R pick the move, rotate and scale gizmo (X switches its axes between the world and the item). Arrow keys nudge, [ / ] turn 15°. Shift-click multi-selects, Alt-click picks one piece of a group.
        Markers: <span style="color:#ffd166">●</span> light <span style="color:#5aa9ff">●</span> hotspot <span style="color:#6fd39a">●</span> chip <span style="color:#ef6b5b">●</span> door.</details></div>
        ${this._sunHTML(true)}`;
      this._bindSun(box);
      this._bindInspToggle(box);
      return;
    }
    const key = e.primary, k = key[0], it = this._get(key);
    const f = (lab, name, val, type = "number", step = 1) => `<label>${lab}<input data-f="${name}" type="${type}" step="${step}" value="${esc(val ?? "")}"></label>`;
    let fields = "";
    const xf = this._transformHTML(key, k, it, n);
    if (!ROTATABLE.has(k) && n === 1) {
      if (k === "h") fields += f(`Tap radius (${this._imperial() ? "in" : "cm"})`, "hit", this._toReal(it.hit ?? 12));
      else if (k !== "l" || FIXTURES[it.fixture] && it.fixture !== "none") fields += f("Size %", "size", Math.round((it.size ?? 1) * 100), "number", 5);
    }
    const ang = this._itemAngle(k, it);
    let extra = "";
    if (k === "l") extra += this._lightTuneHTML(key, it);
    if (k === "l" && it.kind !== "niche") {
      const fx = FIXTURES[it.fixture] ? it.fixture : "none";
      extra += `<label style="margin-bottom:8px">Fixture<select data-fx>${Object.entries(FIXTURES)
        .map(([v, l]) => `<option value="${v}"${v === fx ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
      if (it.points?.length && fx === "string") {
        const U = this._imperial() ? "in" : "cm", len = stringLen(it.points);
        extra += `<div class="grid">${f(`Length (${U})`, "len", this._toReal(len))}${f("Bulbs (0 = auto)", "count", it.count || 0)}${f("Sag", "sag", R1(it.sag ?? Math.min(8, (len / Math.max(1, it.points.length - 1)) * 0.05)), "number", 0.5)}</div>
          <div class="sub" style="margin:4px 0 8px">${stringCount(it)} bulbs${it.count ? "" : ", about one every " + this._fmtLen(it.spacing || 14)}. Drag the yellow dots to stretch it, or a white dot to bend it.</div>
          ${it.points.length > 2 ? `<div class="row" style="margin:0 0 8px"><button data-b="straighten">Straighten</button></div>` : ""}`;
      }
    }
    if (k === "b") {
      const b = bArr(it), pal = this._work.scene?.palette || {};
      const cur = typeof b[5] === "string" ? (pal[b[5]] || ["#888888"])[0] : b[5][0];
      extra += `<div class="grid"><label>Colour<input data-f="color" type="color" value="${esc(cur)}"></label></div>`;
    }
    if ("lhdc".includes(k) && (k !== "c" || it.entity != null || !it.label)) {
      extra += `<label style="margin-bottom:8px">Entity<input data-f="entity" list="ents" value="${esc(it.entity || "")}" placeholder="light.kitchen"></label>
        <datalist id="ents">${Object.keys(this._hass?.states || {}).filter((id) => k !== "l" || /^(light|switch)\./.test(id)).sort().map((id) => `<option value="${id}">`).join("")}</datalist>`;
    }
    const eid = (!ROTATABLE.has(k) || it.type === "screen") && (it.entity || it.climate);
    if (eid) {
      const cur = it.type === "screen" ? "screen" : k === "l" ? "light" : k === "d" ? "door" : k === "h" ? "hotspot" : "badge";
      const opts = [["badge", "Badge (icon + live state)"], ["light", "Light glow"], ["door", "Door / window marker"], ["hotspot", "Invisible tap spot"]];
      if (/^(media_player|camera)\./.test(eid)) opts.unshift(["screen", "Screen (16:9 with media preview)"]);
      extra += `<label style="margin-bottom:8px">Show as<select data-as>${opts
        .map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
    }
    if (ang != null || n > 1) extra += `<div class="row" style="margin:0 0 8px"><button data-b="rotl" title="Turn left">${ic("rotate-left")}90°</button><button data-b="rotr" title="Turn right">${ic("rotate-right")}90°</button>${ROTATABLE.has(k) || n > 1 ? '<button data-b="level">Level</button>' : ""}</div>`;
    if (it.type === "screen") extra += `<div class="row" style="margin:0 0 8px"><button data-b="stand">${it.stand ? "Remove stand" : "Add stand"}</button></div>`;
    if (it.type === "model") {
      extra += `<div class="row"><button data-b="mirror">${ic("flip-horizontal")}Mirror</button><button data-b="resetsize">Reset size</button></div>`;
      if (this._modelErr?.[key]) extra += `<div class="credit" style="color:#ef8b7b">Couldn't load: ${esc(this._modelErr[key])}</div>`;
      extra += `<div class="credit">${esc(it.name || "")} — ${esc(it.creator || "unknown author")} · ${esc(it.lic || "")} · Sweet Home 3D library</div>`;
    }
    box.innerHTML = `<h4>${esc(this._label(key))}<span class="tw">${ic("chevron-down")}</span></h4><div class="sub">${n > 1 ? `${n} items selected. Position, rotation and size change them all together; other fields edit the highlighted one.` : KINDS[k]}</div>
      ${xf}${fields ? `<div class="grid">${fields}</div>` : ""}${extra}
      <details style="margin-top:8px"><summary style="cursor:pointer;opacity:.8">Advanced (JSON)</summary>
        <textarea data-json>${esc(JSON.stringify(it, null, 1))}</textarea><div class="row"><button data-b="json">Apply JSON</button></div></details>`;
    box.querySelectorAll("input[data-f]").forEach((inp) => inp.addEventListener("change", () => this._field(key, inp.dataset.f, inp.value)));
    box.querySelectorAll("button[data-b]").forEach((b) => b.addEventListener("click", () => this._field(key, b.dataset.b)));
    box.querySelector("[data-lock]")?.addEventListener("click", () => { this._edit.lock = !this._edit.lock; this._renderInspector(); });
    box.querySelector("select[data-as]")?.addEventListener("change", (ev) => this._convertEntity(key, ev.target.value));
    box.querySelector("select[data-fx]")?.addEventListener("change", (ev) => this._setFixture(key, ev.target.value));
    if (k === "l") this._bindLightTune(box, key);
    this._bindInspToggle(box);
  }
  /* ----- per-light tuning: what this light looks like at the bulb's full brightness and colour. The live state from
   * Home Assistant still scales it; these set the top end (see _update / _tuneLight in the core). ----- */
  _lightTuneRows(it) {
    const aimed = it.gx != null && Math.hypot(it.gx - it.x, it.gy - it.y) > 12, spot = aimed || (!aimed && it.fixture === "can" && !it.points), glow = !it.points && it.kind !== "niche";
    const pct = (v) => Math.round(v * 100) + "%";
    return [
      ["intensity", "Brightness", 0, 4, 0.05, 1, pct, "At the bulb's full brightness"],
      ["saturation", "Colour", 0, 2, 0.05, 1, pct, "How strongly the bulb's colour shows"],
      ["r", "Reach", 5, 200, 1, 40, (v) => this._fmtLen(v * (spot ? 3.2 : 2.6)), "How far the light travels"],
      ["decay", "Falloff", 0, 3, 0.1, glow ? 1.1 : 1.2, (v) => v.toFixed(1), "Low lights evenly to the edge, high fades fast"],
      ...(spot ? [["angle", "Beam width", 10, 85, 1, aimed ? 43 : 52, (v) => Math.round(v) + "°", ""], ["soft", "Beam edge", 0, 1, 0.05, 0.8, (v) => (v < 0.15 ? "Sharp" : pct(v) + " soft"), ""]] : []),
      ...(glow ? [["halo", "Glow size", 0, 30, 1, 9, (v) => String(v), "The halo drawn around the bulb"]] : []),
    ];
  }
  _lightTuneHTML(key, it) {
    const rows = this._lightTuneRows(it), set = rows.some(([n]) => it[n] != null);
    return `<details class="ltune"${this._ltuneOpen ? " open" : ""}><summary>Light settings</summary>
      ${rows.map(([n, lab, min, max, step, d, fmt, desc]) => `<label><span class="n">${lab}</span><output data-lo="${n}">${esc(fmt(it[n] ?? d))}</output>
        <input type="range" data-lt="${n}" min="${min}" max="${max}" step="${step}" value="${it[n] ?? d}">${desc ? `<span class="d">${desc}</span>` : ""}</label>`).join("")}
      ${set ? `<div class="row"><button data-lreset>Reset light settings</button></div>` : ""}</details>`;
  }
  _bindLightTune(box, key) {
    const det = box.querySelector(".ltune"); if (!det) return;
    det.addEventListener("toggle", () => { this._ltuneOpen = det.open; });
    const rows = Object.fromEntries(this._lightTuneRows(this._get(key)).map((r) => [r[0], r]));
    // co-located bulbs (a two-bulb fan) render as one light, so a setting applies to all of them
    const members = () => { const rec = this._lightGroups?.find((g) => g.keys.includes(key)); return rec ? [rec, rec.keys.map((kk) => this._get(kk))] : [null, [this._get(key)]]; };
    det.addEventListener("input", (ev) => {
      const n = ev.target.dataset.lt; if (!n) return;
      if (!this._ltDrag) { this._edit.undo.push(JSON.stringify(this._work)); this._edit.redo = []; this._edit.dirty = true; this._ltDrag = true; }
      const v = +ev.target.value, [, , , , , d, fmt] = rows[n], [rec, its] = members();
      for (const it of its) if (v === d) delete it[n]; else it[n] = v;
      det.querySelector(`[data-lo="${n}"]`).textContent = fmt(v);
      if (rec) { rec.L = this._get(rec.keys[0]); this._tuneLight(rec); }
      this._update(); this._requestRender();
    });
    det.addEventListener("change", () => { if (this._ltDrag) { this._ltDrag = false; this._commit(); } });
    det.querySelector("[data-lreset]")?.addEventListener("click", () => this._mutate(() => {
      for (const it of members()[1]) for (const n of Object.keys(rows)) delete it[n];
      return [...this._edit.sel];
    }));
  }
  /* ----- north + sun preview (no selection) ----- */
  _sunHTML(preview) {
    const north = Number(this._work.scene?.north) || 0, c = this._hass?.config || {}, hr = this._sunPreview;
    const where = c.latitude != null && c.longitude != null;
    return `<div class="sun" style="margin-top:8px"><div class="grid" style="grid-template-columns:1fr 1fr"><label>North °<input data-sun="north" type="number" step="5" value="${north}"></label>
      <div class="row" style="align-items:end"><button data-sun="nl" title="Turn north left">${ic("rotate-left")}15°</button><button data-sun="nr" title="Turn north right">${ic("rotate-right")}15°</button></div></div>
      <div class="sub">How far north is turned clockwise from the top of the floor plan. The red arrow points north; the sun follows Home Assistant's sun position.</div>
      ${preview && where ? `<label style="margin-top:6px">Preview the sun at <b data-sun="t">${hr == null ? "now" : hm(hr)}</b><input data-sun="hour" type="range" min="0" max="24" step="0.25" value="${hr ?? new Date().getHours() + new Date().getMinutes() / 60}"></label>
        ${hr == null ? "" : '<div class="row"><button data-sun="live">Back to now</button></div>'}` : ""}</div>`;
  }
  _bindSun(box) {
    const setNorth = (v) => {
      if (!isFinite(v)) return;
      v = R1(((v % 360) + 360) % 360);
      this._mutate(() => { this._work.scene ||= {}; if (v) this._work.scene.north = v; else delete this._work.scene.north; return [...this._edit.sel]; });
    };
    box.querySelector('[data-sun="north"]')?.addEventListener("change", (ev) => setNorth(Number(ev.target.value)));
    box.querySelector('[data-sun="nl"]')?.addEventListener("click", () => setNorth((Number(this._work.scene?.north) || 0) - 15));
    box.querySelector('[data-sun="nr"]')?.addEventListener("click", () => setNorth((Number(this._work.scene?.north) || 0) + 15));
    const hour = box.querySelector('[data-sun="hour"]');
    hour?.addEventListener("input", () => {
      this._sunPreview = Number(hour.value); const v = this._sunPreview;
      box.querySelector('[data-sun="t"]').textContent = hm(v);
      this._update(); this._requestRender();
    });
    hour?.addEventListener("change", () => { if (!box.querySelector('[data-sun="live"]')) this._renderInspector(); });
    box.querySelector('[data-sun="live"]')?.addEventListener("click", () => { this._sunPreview = null; this._update(); this._requestRender(); this._renderInspector(); });
  }
  _bindInspToggle(box) {
    box.classList.toggle("min", !!this._inspMin);
    box.querySelector("h4").onclick = () => { this._inspMin = !this._inspMin; box.classList.toggle("min", this._inspMin); };
  }
  _field(key, name, raw) {
    const k = key[0], num = Number(raw);
    if (name === "level") {   // take out any tilt, keep the turn
      const sel = [...this._edit.sel];
      return this._mutate(() => { for (const kk of sel) { const o = this._get(kk); if (o && !Array.isArray(o) && (o.rx || o.rz)) { delete o.rx; delete o.rz; } } return sel; });
    }
    if (name === "rotl" || name === "rotr") {
      const sel = [...this._edit.sel];
      return this._mutate(() => { this._applyRotate(sel, name === "rotl" ? -90 : 90, this._pivotC); return sel; });
    }
    if (name === "json") {
      let v; try { v = JSON.parse(this._ed.querySelector("textarea[data-json]").value); } catch (e) { return this._toast("Invalid JSON: " + e.message); }
      return this._mutate(() => { const [kk, i] = key.split(":"); this._list(kk)[+i] = v; return [...this._edit.sel]; });
    }
    if (!["entity", "color", "mirror", "resetsize", "stand", "straighten"].includes(name) && (isNaN(num) || raw === "")) return;
    if (["px", "py", "pz", "rx", "ry", "rz", "sx", "sy", "sz", "wx", "wy", "wz", "size", "hit"].includes(name)) return this._transformField(name, num);
    this._mutate(() => {
      const it = this._get(key);
      if (name === "len" && it.points?.length > 1) {   // stretch (or shrink) the last span; bulbs follow
        const P = it.points, a = P[P.length - 2], b = P[P.length - 1], span = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const ns = Math.max(1, span + this._fromReal(num) - stringLen(P));
        P[P.length - 1] = [R1(a[0] + ((b[0] - a[0]) / span) * ns), R1(a[1] + ((b[1] - a[1]) / span) * ns)];
      }
      else if (name === "count") { if (num > 0) it.count = Math.min(200, Math.round(num)); else delete it.count; }
      else if (name === "sag") it.sag = Math.max(0, num);
      else if (name === "straighten" && it.points?.length > 2) it.points = [it.points[0], it.points.at(-1)];
      else if (name === "entity") it.entity = raw.trim();
      else if (name === "color") { const b = bArr(it); const T = this.T, col = new T.Color(raw);
        b[5] = [raw, "#" + col.clone().multiplyScalar(0.78).getHexString(), "#" + col.clone().multiplyScalar(0.88).getHexString()]; }
      else if (name === "mirror") it.mirror = !it.mirror || undefined;
      else if (name === "stand") it.stand = !it.stand || undefined;
      else if (name === "resetsize") { const [sxy, sz] = this._modelScale(); it.w = R1(it.cm[0] / sxy); it.d = R1(it.cm[1] / sxy); it.h = R1(it.cm[2] / sz); }
      return [...this._edit.sel];
    });
  }
  /* ----- transform fields: position, rotation and size of the selection. Inputs are in cm or inches (model_scale, the
   * same scale Set scale fits the blueprint to); the plan stores plan units. ----- */
  _selPos() {
    const keys = [...this._edit.sel];
    if (keys.length === 1) { const k = keys[0][0], it = this._get(keys[0]), c = itemCenter(k, it) || [CX, CY]; return [c[0], c[1], itemZ(k, it)]; }
    return [...this._pivotC, Math.min(...keys.map((key) => itemBase(key[0], this._get(key))))];
  }
  /* which way an item faces: `rot` for furniture, the run of a string light, or an aimed light's beam; null if it has no direction */
  _itemAngle(k, it) {
    if (ROTATABLE.has(k)) return Array.isArray(it) ? 0 : it.rot || 0;
    const p = it.points?.length > 1 ? [it.points[0], it.points.at(-1)] : it.gx != null && Math.hypot(it.gx - it.x, it.gy - it.y) > 12 ? [[it.x, it.y], [it.gx, it.gy]] : null;
    return p ? R1((((Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]) * 180) / Math.PI) % 360 + 360) % 360) : null;
  }
  /* [width, depth, height] of one item along its own axes, in plan units (0 where that axis can't change) */
  _dims(key) {
    const k = key[0], it = this._get(key);
    if (k === "b") { const b = bArr(it); return [b[1] - b[0], b[3] - b[2], b[4]]; }
    if (it.type === "model") return [it.w, it.d, it.h];
    if (it.type === "screen") { const w = it.w || 32; return [w, 0, (w * 9) / 16]; }
    if (it.type === "table") return [it.r * 2, 0, it.z];
    const g = this._items.get(key); if (!g) return null;
    const r = g.rotation.y, tg = g.children[0]?.userData.tilt ? g.children[0] : null, tr = tg?.rotation.clone();   // measured untilted
    g.rotation.y = 0; tg?.rotation.set(0, 0, 0); g.updateMatrixWorld(true);
    const box = new this.T.Box3().setFromObject(g); g.rotation.y = r; if (tg) tg.rotation.copy(tr); g.updateMatrixWorld(true);
    if (box.isEmpty()) return null;
    const s = box.getSize(new this.T.Vector3()); return [s.x, s.z, s.y];
  }
  /* the selection's overall size, lined up with the plan */
  _selDims() {
    const T = this.T, box = new T.Box3();
    for (const key of this._edit.sel) {
      const k = key[0], g = this._items.get(key);
      if (ROTATABLE.has(k) && g) { g.updateMatrixWorld(true); box.expandByObject(g); }
      else { const c = itemCenter(k, this._get(key)); if (c) box.expandByPoint(new T.Vector3(c[0] - CX, c[2] ?? 0, c[1] - CY)); }
    }
    if (box.isEmpty()) return null;
    const s = box.getSize(new T.Vector3()); return [s.x, s.z, s.y];
  }
  /* The Transform rows, laid out like Unity / Godot: X across, Y up, Z front to back (the gizmo's red, green and blue).
   * Position and Size are in cm or inches; Rotation in degrees (Y turns, X and Z tilt); Scale in % (applied, then back to 100). */
  _transformHTML(key, k, it, n) {
    const U = this._imperial() ? "in" : "cm", pos = this._selPos(), rotatable = ROTATABLE.has(k);
    const inp = (ax, name, val, step = 1, off) => `<label class="ax-${ax}"><i>${ax.toUpperCase()}</i><input data-f="${name}" type="number" step="${step}" value="${esc(val ?? "")}"${off ? " disabled" : ""}></label>`;
    const row = (lab, cells) => `<div class="xf"><b>${lab}</b>${cells}</div>`;
    let h = row(`Position <span style="opacity:.6;font-weight:400">${U}</span>`, inp("x", "px", this._toReal(pos[0])) + inp("y", "py", pos[2] == null ? "" : this._toReal(pos[2], true), 1, pos[2] == null) + inp("z", "pz", this._toReal(pos[1])));
    const ang = this._itemAngle(k, it);
    if (rotatable || n > 1 || ang != null) {
      const tilt = rotatable && !Array.isArray(it);
      h += row("Rotation °", inp("x", "rx", tilt ? it.rx || 0 : 0, 15, !tilt) + inp("y", "ry", ang ?? 0, 15) + inp("z", "rz", tilt ? it.rz || 0 : 0, 15, !tilt));
    }
    if (rotatable || n > 1) {
      const lock = `<button data-lock title="Keep proportions">${ic(this._edit.lock || n > 1 ? "link-variant" : "link-variant-off")}</button>`;
      h += row(`Scale % ${n > 1 ? "" : lock}`, inp("x", "sx", 100, 5) + inp("y", "sy", 100, 5) + inp("z", "sz", 100, 5));
      const d = n > 1 ? this._selDims() : this._dims(key);
      if (d) h += row(`Size <span style="opacity:.6;font-weight:400">${U}</span>`, inp("x", "wx", d[0] > 0 ? this._toReal(d[0]) : "", 0.5, !(d[0] > 0)) + inp("y", "wy", d[2] > 0 ? this._toReal(d[2], true) : "", 0.5, !(d[2] > 0)) + inp("z", "wz", d[1] > 0 ? this._toReal(d[1]) : "", 0.5, !(d[1] > 0)));
    }
    return h;
  }
  _transformField(name, v) {
    const T = this.T, sel = [...this._edit.sel], key = this._edit.primary, k = key[0], it = this._get(key), pos = this._selPos();
    this._mutate(() => {
      if (name[0] === "p") {   // position: x across, y up (elevation), z front to back
        const i = { px: 0, pz: 1, py: 2 }[name], d = this._fromReal(v, i === 2) - (pos[i] ?? 0);
        if (Math.abs(d) > 0.01) this._applyMove(sel, i === 0 ? d : 0, i === 1 ? d : 0, i === 2 ? d : 0);
      } else if (name[0] === "r") {   // rotation: set the highlighted item's angle; the rest of the selection turns with it
        const r = Math.PI / 180, q0 = this._itemQuat(k, it), e = new T.Euler().setFromQuaternion(q0, "YXZ");
        if (name === "rx") e.x = v * r; else if (name === "rz") e.z = v * r; else e.y = -v * r;
        if (!ROTATABLE.has(k) || Array.isArray(it)) { e.x = 0; e.z = 0; }
        const dq = new T.Quaternion().setFromEuler(e).multiply(q0.invert());
        if (Math.abs(dq.w) < 0.9999999) this._applyRotQ(sel, dq, this._pivot.position.clone());
      } else if (name === "size") { const s = Math.max(5, v) / 100; if (s === 1) delete it.size; else it.size = s; }
      else if (name === "hit") it.hit = Math.max(1, R1(this._fromReal(v)));
      else {   // scale % or size: x across, y up, z front to back → scaleItem's (sx, sy = depth, sz = height)
        const i = { x: 0, z: 1, y: 2 }[name[1]], uni = sel.length > 1 || this._edit.lock || !ROTATABLE.has(k);
        let r = v / 100;
        if (name[0] === "w") { const cur = (sel.length > 1 ? this._selDims() : this._dims(key))?.[i]; if (!(cur > 0)) return sel; r = this._fromReal(v, i === 2) / cur; }
        if (r > 0 && Math.abs(r - 1) > 1e-4) this._scaleSel(sel, ...(uni ? [r, r, r] : [1, 1, 1].map((x, j) => (j === i ? r : x))));
      }
      return sel;
    });
  }
  /* resize the selection about its centre. One item stretches along its own axes; several scale evenly together, so the
   * gaps between them grow too and anything stacked (a lamp on a table) stays on top. */
  _scaleSel(keys, sx, sy, sz) {
    const [px, py] = this._pivotC, multi = keys.length > 1;
    const z0 = multi ? Math.min(...keys.map((key) => itemBase(key[0], this._get(key)))) : undefined;
    for (const key of keys) {
      const k = key[0], it = this._get(key); if (!it) continue;
      if (ROTATABLE.has(k)) { const c = itemCenter(k, it); if (c && multi) shiftItem(k, it, (c[0] - px) * (sx - 1), (c[1] - py) * (sy - 1)); }
      else mapPts(it, (x, y) => [px + (x - px) * sx, py + (y - py) * sy]);
      scaleItem(k, it, sx, sy, sz, z0);
    }
  }
  /* pick a fixture model for a light. String lights run along `points`; everything else sits at x/y. Heights move to a
   * sensible spot for the new fixture (ceiling, table, floor lamp), which the Height field can then fine-tune. */
  _setFixture(key, fx) {
    this._mutate(() => {
      const L = this._get(key), H = this._work.scene?.wall_height ?? 46, c = itemCenter("l", L);
      if (fx === "string" && !L.points?.length) {
        L.points = [[R1(c[0] - 30), R1(c[1])], [R1(c[0] + 30), R1(c[1])]];
        for (const f of ["x", "y", "gx", "gy", "gz"]) delete L[f];
      } else if (fx !== "string" && L.points?.length && L.kind !== "niche") {
        [L.x, L.y] = mean(L.points).map(R1); delete L.points; delete L.count; delete L.sag; delete L.spacing;
        if (L.kind === "string") delete L.kind;
      }
      if (fx === "string") L.kind = "string";
      if (fx === "none") delete L.fixture; else L.fixture = fx;
      const z = { can: H - 0.5, ceiling: H - 0.5, pendant: R1(H * 0.7), bulb: R1(H * 0.72), floorlamp: 36, tablelamp: 25, string: R1(H * 0.8) }[fx];
      if (z != null) L.z = z;
      return [key];
    });
  }
  _jointMat(sel) {
    const k = sel ? "__jointSel" : "__joint";
    return (this._mats[k] ||= new this.T.MeshBasicMaterial({ color: sel ? 0xf2c76b : 0xffffff, depthTest: false, transparent: true }));
  }
  _paintJoints() {
    if (!this._jointMeshes?.length || !this._edit) return;
    for (const m of this._jointMeshes) m.material = this._jointMat(m.userData.joint.m.some(([i]) => this._edit.sel.has("w:" + i)));
  }
  /* rebuild only the plan layer (walls, openings, blueprint, joints) — used while dragging a corner */
  _rebuildPlan() {
    if (!this._wallG) return this._rebuild();
    this._world.remove(this._wallG); this._disposeTree(this._wallG); this._roomHG = null;
    for (const k of [...this._items.keys()]) if (PLAN.has(k[0])) this._items.delete(k);
    this._buildPlanLayer(this._cfg().scene || {});
    this._renderer.shadowMap.needsUpdate = true; this._requestRender();
  }
  _applyPlanVis() {
    const hide = !!this._plan && !this._edit?.showFurn;
    for (const [k, g] of this._items) {
      if (PLAN.has(k[0])) continue;
      let vis = !hide;
      if (hide && (k[0] === "o" || k[0] === "v")) vis = STRUCT_TYPES.has(this._get(k)?.type);
      g.visible = vis;
    }
  }
  _migrateWalls() {
    const sc = this._work.scene ||= {};
    if (!sc.walls?.length && !sc.front_walls?.length) return;
    const { segs, opens } = legacyWalls(sc);
    sc.wall_segs = [...(sc.wall_segs || []), ...segs];
    sc.openings = [...(sc.openings || []), ...opens];
    delete sc.walls; delete sc.front_walls;
  }
  _setPlanMode(on) {
    if (!this._edit || !!this._plan === on) return;
    this._plan = on; this._tool = "select"; this._draw = null; this._measure = null; this._hidePreview();
    this._wrap.classList.toggle("plan", on);
    const top = this._sph().phi < 0.3;
    if (on && !top) { this._planTopped = true; this._toggleTop(); }
    else if (!on && this._planTopped) { this._planTopped = false; if (top) this._toggleTop(); }
    this._renderEditorUI();
    this._rebuild(); this._select([]);
    if (on && !this._planHinted) { this._planHinted = true; this._toast(this._list("p").length ? "Floor plan: drag corners and walls, or draw new ones" : "Floor plan: add a blueprint to trace, or start drawing walls", 4000); }
  }
  _setTool(t) {
    this._tool = t;
    this._draw = t === "wall" ? { start: null, first: null } : t === "room" ? { pts: [] } : null;
    this._measure = t === "measure" ? { pts: [], bp: this._measure?.bp || (this._edit.primary?.[0] === "p" ? this._edit.primary : "p:0") } : null;
    this._hidePreview();
    if (t !== "select") this._select([]); else { this._renderInspector(); this._syncBar(); }
    this._syncBar();
  }

  /* ----- snapping ----- */
  _snapPoint(p, { from = null, exclude = [], room = null } = {}) {
    const segs = this._work?.scene?.wall_segs || [], thr = 10 * this._upp();
    const ex = (i, e) => exclude.some(([j, f]) => j === i && f === e);
    let best = null, bd = thr;
    if (room) (this._work.scene?.floors || []).forEach((f, i) => (f.pts || []).forEach((q, k) => {
      if (room.key === "r:" + i && room.k === k) return;
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = q; }
    }));
    segs.forEach((s, i) => { for (const e of ["a", "b"]) {
      if (ex(i, e)) continue;
      const d = Math.hypot(s[e][0] - p[0], s[e][1] - p[1]); if (d < bd) { bd = d; best = s[e]; }
    } });
    if (best) return { p: [best[0], best[1]], kind: "joint" };
    let on = null; bd = thr;
    segs.forEach((s, i) => {
      if (ex(i, "a") || ex(i, "b")) return;
      const [ux, uy, L] = segDir(s), dx = p[0] - s.a[0], dy = p[1] - s.a[1], t = dx * ux + dy * uy, q = Math.abs(-dx * uy + dy * ux);
      if (t > 0 && t < L && q < bd) { bd = q; on = [R1(s.a[0] + ux * t), R1(s.a[1] + uy * t)]; }
    });
    if (on) return { p: on, kind: "wall" };
    if (!this._edit?.snap) return { p: [R1(p[0]), R1(p[1])], kind: "free" };
    if (from) {
      const dx = p[0] - from[0], dy = p[1] - from[1], st = Math.PI / 12, a = Math.round(Math.atan2(dy, dx) / st) * st, L = Math.round(Math.hypot(dx, dy));
      return { p: [R1(from[0] + Math.cos(a) * L), R1(from[1] + Math.sin(a) * L)], kind: "angle" };
    }
    return { p: [Math.round(p[0]), Math.round(p[1])], kind: "grid" };
  }
  _nearestWall(p, thr) {
    let best = null, bd = thr;
    (this._work.scene?.wall_segs || []).forEach((s, i) => {
      const [ux, uy, L] = segDir(s), dx = p[0] - s.a[0], dy = p[1] - s.a[1], t = dx * ux + dy * uy, q = Math.abs(-dx * uy + dy * ux);
      if (t >= -2 && t <= L + 2 && q < bd) { bd = q; best = i; }
    });
    return best;
  }
  /* centre an opening on the wall it sits on and turn it to match */
  _fitOpening(o) {
    if (!o) return;
    const i = this._nearestWall([o.x, o.y], 10); if (i == null) return;
    const s = this._work.scene.wall_segs[i], [ux, uy, L] = segDir(s);
    const t = Math.max(0, Math.min(L, (o.x - s.a[0]) * ux + (o.y - s.a[1]) * uy));
    o.x = R1(s.a[0] + ux * t); o.y = R1(s.a[1] + uy * t);
    let rot = (Math.atan2(uy, ux) * 180) / Math.PI;
    const cur = o.rot || 0; while (rot - cur > 90) rot -= 180; while (cur - rot > 90) rot += 180;   // keep the side it already faced
    o.rot = R1(((rot % 360) + 360) % 360); if (!o.rot) delete o.rot;
    o.d = R1(Math.max(o.d ?? 0, (s.t ?? this._work.scene.wall_thickness ?? 4) + 2));
  }

  /* ----- drawing / placing tools ----- */
  _toolHover(ev, p) {
    if (!p) return;
    const thr = 14 * this._upp() + 4;
    if (this._tool === "wall") {
      const d = this._draw, s = this._snapPoint(p, { from: d?.start });
      this._showMarker(s.p, s.kind);
      if (d?.start) { this._showPreview(d.start, s.p, "wall"); this._showTip(ev, this._fmtLen(Math.hypot(s.p[0] - d.start[0], s.p[1] - d.start[1]))); }
    } else if (this._tool === "measure") {
      const m = this._measure; this._showMarker(p, "free");
      if (m?.pts.length === 1) { this._showPreview(m.pts[0], p, "measure"); this._showTip(ev, this._fmtLen(Math.hypot(p[0] - m.pts[0][0], p[1] - m.pts[0][1]))); }
    } else if (this._tool === "room") {
      const d = this._draw, last = d.pts.at(-1), s = this._snapPoint(p, { from: last, room: {} });
      const closing = d.pts.length >= 3 && Math.hypot(s.p[0] - d.pts[0][0], s.p[1] - d.pts[0][1]) < Math.max(10 * this._upp(), 0.6);
      this._showMarker(closing ? d.pts[0] : s.p, closing ? "joint" : s.kind);
      if (d.pts.length) { this._showRoomPreview([...d.pts, closing ? d.pts[0] : s.p]); this._showTip(ev, closing ? "Click to close the room" : this._fmtLen(Math.hypot(s.p[0] - last[0], s.p[1] - last[1]))); }
    } else if (this._tool === "door" || this._tool === "window") {
      const i = this._nearestWall(p, thr);
      if (i == null) { this._hidePreview(true); return; }
      const s = this._work.scene.wall_segs[i], [ux, uy, L] = segDir(s), t = Math.max(0, Math.min(L, (p[0] - s.a[0]) * ux + (p[1] - s.a[1]) * uy));
      this._showMarker([s.a[0] + ux * t, s.a[1] + uy * t], "wall");
    }
  }
  _toolClick(p, key, ev) {
    const sc = (this._work.scene ||= {});
    if (this._tool === "wall") {
      const d = this._draw, s = this._snapPoint(p, { from: d.start });
      if (!d.start) { d.start = s.p; d.first = s.p; this._showMarker(s.p, s.kind); this._renderInspector(); return; }
      if (Math.hypot(s.p[0] - d.start[0], s.p[1] - d.start[1]) < 1) { this._setTool("wall"); this._toast("Wall finished — click to start another"); return; }
      const a = d.start, b = s.p, closed = Math.hypot(b[0] - d.first[0], b[1] - d.first[1]) < 0.6;
      this._mutate(() => [this._push("w", { a: [R1(a[0]), R1(a[1])], b: [R1(b[0]), R1(b[1])] })]);
      if (closed) { this._setTool("wall"); this._toast("Closed the loop"); } else { d.start = b; this._showPreview(b, b, "wall"); }
      return;
    }
    if (this._tool === "room") {
      const d = this._draw, last = d.pts.at(-1), s = this._snapPoint(p, { from: last, room: {} });
      if (d.pts.length >= 3 && (Math.hypot(s.p[0] - d.pts[0][0], s.p[1] - d.pts[0][1]) < Math.max(10 * this._upp(), 0.6) || Math.hypot(s.p[0] - last[0], s.p[1] - last[1]) < 1)) return this._finishRoom();
      if (last && Math.hypot(s.p[0] - last[0], s.p[1] - last[1]) < 1) return;
      d.pts.push([R1(s.p[0]), R1(s.p[1])]);
      this._showRoomPreview(d.pts); this._showMarker(s.p, s.kind); this._renderInspector();
      return;
    }
    if (this._tool === "door" || this._tool === "window") {
      const kind = this._tool, wi = key?.[0] === "w" ? +key.split(":")[1] : this._nearestWall(p, 14 * this._upp() + 4);
      if (wi == null) return this._toast(`Click on a wall to put the ${kind} in`);
      const s = sc.wall_segs[wi], [ux, uy, L] = segDir(s), t = Math.max(0, Math.min(L, (p[0] - s.a[0]) * ux + (p[1] - s.a[1]) * uy));
      const [sxy, sz] = this._modelScale(), H = sc.wall_height ?? 46, LIN = sc.lintel ?? 8, wh = s.h ?? H, wt = s.t ?? sc.wall_thickness ?? 4;
      const o = kind === "door"
        ? { kind, style: "panel", w: R1(80 / sxy), h: R1(Math.max(4, Math.min(wh, H - LIN))), z: 0 }
        : { kind, w: R1(100 / sxy), z: R1(Math.min(90 / sz, wh * 0.4)), h: 0 };
      if (kind === "window") o.h = R1(Math.max(4, Math.min(120 / sz, H - LIN - o.z)));
      Object.assign(o, { x: R1(s.a[0] + ux * t), y: R1(s.a[1] + uy * t), d: R1(wt + 2) });
      const rot = R1((((Math.atan2(uy, ux) * 180) / Math.PI) % 360 + 360) % 360); if (rot) o.rot = rot;
      this._setTool("select");
      this._mutate(() => [this._push("n", o)]);
      this._toast(`Added a ${kind} — drag it along the wall, or set its size in the panel`);
      return;
    }
    if (this._tool === "measure") {
      const m = this._measure; m.pts.push(p);
      if (m.pts.length === 2) { this._showPreview(m.pts[0], m.pts[1], "measure"); this._hideTip(); this._renderInspector(); }
      else this._showMarker(p, "free");
    }
  }
  _ensurePreview() {
    if (this._prevMesh) return;
    const T = this.T;
    this._prevMesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ color: 0xf2c76b, transparent: true, opacity: 0.6, depthTest: false }));
    this._prevMesh.renderOrder = 12;
    this._prevDot = new T.Mesh(new T.SphereGeometry(1, 14, 10), new T.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
    this._prevDot.renderOrder = 14;
    this._scene.add(this._prevMesh, this._prevDot);
  }
  _showPreview(a, b, kind) {
    this._ensurePreview();
    const sc = this._cfg().scene || {}, m = this._prevMesh, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const wall = kind === "wall", h = wall ? sc.wall_height ?? 46 : 0.6, t = wall ? sc.wall_thickness ?? 4 : 1.2 * 2 * this._upp();
    m.material.color.set(wall ? 0xf2c76b : 0x4ea3ff);
    m.scale.set(Math.max(L, 0.01), h, Math.max(t, 0.6));
    m.position.set((a[0] + b[0]) / 2 - CX, wall ? h / 2 : 1, (a[1] + b[1]) / 2 - CY);
    m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    m.visible = true; this._requestRender();
  }
  _showMarker(p, kind) {
    this._ensurePreview();
    const d = this._prevDot;
    d.material.color.set(kind === "joint" ? 0x6fd39a : kind === "wall" ? 0x4ea3ff : 0xffffff);
    d.position.set(p[0] - CX, (this._cfg().scene?.wall_height ?? 46) + 1, p[1] - CY);
    d.visible = true; this._scaleHandles(); this._requestRender();
  }
  _showRoomPreview(pts) {
    const T = this.T;
    if (!this._prevLine) {
      this._prevLine = new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial({ color: 0xf2c76b, depthTest: false, transparent: true }));
      this._prevLine.renderOrder = 13; this._scene.add(this._prevLine);
    }
    this._prevLine.geometry.dispose();
    this._prevLine.geometry = new T.BufferGeometry().setFromPoints(pts.map((q) => new T.Vector3(q[0] - CX, 1.5, q[1] - CY)));
    this._prevLine.visible = true; this._requestRender();
  }
  _hidePreview(keepLine) {
    if (this._prevLine && !keepLine) this._prevLine.visible = false;
    if (this._prevDot) this._prevDot.visible = false;
    if (this._prevMesh && !keepLine) this._prevMesh.visible = false;
    this._hideTip(); this._requestRender();
  }
  _disposePreview() {
    for (const m of [this._prevMesh, this._prevDot, this._prevLine]) if (m) { this._scene?.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this._prevMesh = this._prevDot = this._prevLine = null; this._hideTip();
  }
  _showTip(ev, text) {
    if (!this._ed) return;
    let t = this._ed.querySelector(".tip");
    if (!t) { t = document.createElement("div"); t.className = "tip"; this._ed.append(t); }
    const r = this._wrap.getBoundingClientRect();
    t.textContent = text; t.style.left = ev.clientX - r.left + "px"; t.style.top = ev.clientY - r.top + "px"; t.style.display = "";
  }
  _hideTip() { const t = this._ed?.querySelector(".tip"); if (t) t.style.display = "none"; }

  /* ----- rooms (scene.floors) ----- */
  _finishRoom() {
    const pts = this._draw?.pts || []; if (pts.length < 3) return;
    const floors = this._work.scene.floors ||= [];
    const used = new Set(floors.map((f) => f.name)); let n = floors.length + 1; while (used.has("room_" + n)) n++;
    this._setTool("select");
    this._mutate(() => {
      const rug = floors.findIndex((f) => f.name === "rug"), f = { name: "room_" + n, fill: ROOM_FILLS[floors.length % ROOM_FILLS.length], pts };
      if (rug >= 0) { floors.splice(rug, 0, f); return ["r:" + rug]; }   // keep rugs drawn on top
      return [this._push("r", f)];
    });
    this._toast("Room added — name it in the panel");
    setTimeout(() => { const i = this._ed.querySelector('.insp input[data-p="name"]'); i?.focus(); i?.select(); }, 50);
  }
  /* a selected string light: a dot on every point (drag to move it; the ends stretch the string) and a smaller dot
   * mid-span (drag to bend it there) */
  _buildStringHandles() {
    const T = this.T;
    if (this._strHG) { this._strHG.parent?.remove(this._strHG); this._disposeTree(this._strHG); this._strHG = null; }
    this._sptMeshes = []; this._smidMeshes = [];
    const key = this._edit?.primary, L = key?.[0] === "l" && this._get(key);
    if (!L?.points?.length || this._plan || this._edit.sel.size !== 1) return;
    this._strHG = new T.Group(); this._world.add(this._strHG);
    const mat = (k, c, o = 1) => (this._mats["__h" + k] ||= new T.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: o }));
    const geo = new T.SphereGeometry(1, 12, 8), z = L.z ?? 17, n = L.points.length;
    L.points.forEach((q, k) => {
      const v = new T.Mesh(geo, mat("spt", 0xffd166)); v.position.set(q[0] - CX, z, q[1] - CY); v.renderOrder = 15; v.userData.spt = { key, k };
      this._strHG.add(v); this._sptMeshes.push(v);
      if (k < n - 1) {
        const r = L.points[k + 1], m = new T.Mesh(geo, mat("mid", 0xffffff, 0.7));
        m.position.set((q[0] + r[0]) / 2 - CX, z, (q[1] + r[1]) / 2 - CY); m.renderOrder = 14; m.userData.smid = { key, k };
        this._strHG.add(m); this._smidMeshes.push(m);
      }
    });
    this._scaleHandles();
  }
  _buildRoomHandles() {
    const T = this.T, G = this._wallG;
    if (this._roomHG) { this._roomHG.parent?.remove(this._roomHG); this._disposeTree(this._roomHG); this._roomHG = null; }
    this._vertMeshes = []; this._midMeshes = [];
    const key = this._edit?.primary;
    if (!G || !this._plan || !key || key[0] !== "r") return;
    const f = this._get(key); if (!f?.pts?.length) return;
    this._roomHG = new T.Group(); G.add(this._roomHG);
    const mat = (k, c, o = 1) => (this._mats["__h" + k] ||= new T.MeshBasicMaterial({ color: c, depthTest: false, transparent: true, opacity: o }));
    const geo = new T.SphereGeometry(1, 12, 8), y = 1.5, n = f.pts.length;
    const pts = f.pts.map((q) => new T.Vector3(q[0] - CX, y, q[1] - CY));
    const line = new T.Line(new T.BufferGeometry().setFromPoints([...pts, pts[0]]), (this._mats.__hline ||= new T.LineBasicMaterial({ color: 0x6fd39a, depthTest: false, transparent: true })));
    line.renderOrder = 13; this._roomHG.add(line);
    f.pts.forEach((q, k) => {
      const act = this._vsel?.key === key && this._vsel.k === k;
      const v = new T.Mesh(geo, act ? mat("act", 0xf2c76b) : mat("vert", 0x6fd39a)); v.position.copy(pts[k]); v.renderOrder = 15; v.userData.vert = { key, k };
      const r = f.pts[(k + 1) % n], m = new T.Mesh(geo, mat("mid", 0xffffff, 0.7));
      m.position.set((q[0] + r[0]) / 2 - CX, y, (q[1] + r[1]) / 2 - CY); m.renderOrder = 14; m.userData.mid = { key, k };
      this._roomHG.add(v, m); this._vertMeshes.push(v); this._midMeshes.push(m);
    });
    this._scaleHandles();
  }
  _toReal(units, vertical) { return R1((units * this._modelScale()[vertical ? 1 : 0]) / (this._imperial() ? 2.54 : 1)); }
  _fromReal(v, vertical) { return (v * (this._imperial() ? 2.54 : 1)) / this._modelScale()[vertical ? 1 : 0]; }

  /* ----- blueprint ----- */
  _pickBlueprintFile(replaceKey) {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = "image/*";
    inp.onchange = () => inp.files?.[0] && this._addBlueprint(inp.files[0], replaceKey);
    inp.click();
  }
  /* upload into Home Assistant's image store (served at /api/image/serve/…); if that's unavailable, keep a small copy inline */
  async _blueprintSrc(file) {
    const bmp = await createImageBitmap(file), aspect = bmp.width / bmp.height;
    const draw = (max) => {
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), cv = document.createElement("canvas");
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height);
      return cv;
    };
    try {
      const blob = await new Promise((r) => draw(2400).toBlob(r, "image/jpeg", 0.85));
      const fd = new FormData(); fd.append("file", blob, "blueprint.jpg");
      const res = await this._hass.fetchWithAuth("/api/image/upload", { method: "POST", body: fd });
      if (res.ok) { const j = await res.json(); if (j.id) return { src: `/api/image/serve/${j.id}/original`, aspect }; }
    } catch (e) { /* fall through to inline */ }
    return { src: draw(1400).toDataURL("image/jpeg", 0.7), aspect, inline: true };
  }
  async _addBlueprint(file, replaceKey) {
    this._toast("Adding blueprint…", 8000);
    let r;
    try { r = await this._blueprintSrc(file); } catch (e) { return this._toast("Couldn't read that image: " + (e.message || e), 5000); }
    if (!this._edit) return;
    this._setTool("select");
    this._mutate(() => {
      if (replaceKey && this._get(replaceKey)) { const bp = this._get(replaceKey); bp.src = r.src; bp.h = R1(bp.w / r.aspect); return [replaceKey]; }
      const segs = this._work.scene?.wall_segs || [];
      let w = 500, c = this._target();
      if (segs.length) {
        const xs = segs.flatMap((s) => [s.a[0], s.b[0]]), ys = segs.flatMap((s) => [s.a[1], s.b[1]]);
        w = (Math.max(...xs) - Math.min(...xs)) * 1.1; c = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
      }
      return [this._push("p", { src: r.src, x: R1(c[0]), y: R1(c[1]), w: R1(w), h: R1(w / r.aspect), opacity: 0.6 })];
    });
    this._toast(`Blueprint added${r.inline ? " (stored in the dashboard)" : ""}. Next: Set scale — click both ends of a length you know.`, 6000);
  }
  _setBlueprintUrl(key, url) {
    url = url.trim(); if (!url) return;
    const img = new Image();
    img.onload = () => this._mutate(() => { const bp = this._get(key); if (bp) { bp.src = url; bp.h = R1(bp.w / (img.naturalWidth / img.naturalHeight)); } return [key]; });
    img.onerror = () => this._toast("Couldn't load that image URL");
    img.src = url;
  }
  _applyScale(realCm) {
    const m = this._measure; if (!m || m.pts.length < 2 || !(realCm > 0)) return;
    const [a, b] = m.pts, meas = Math.hypot(b[0] - a[0], b[1] - a[1]); if (meas < 0.5) return;
    const target = realCm / this._modelScale()[0], f = target / meas, key = m.bp;
    this._setTool("select");
    this._mutate(() => {
      const bp = this._get(key); if (!bp) return [];
      bp.w = R1(bp.w * f); bp.h = R1(bp.h * f); bp.x = R1(a[0] + (bp.x - a[0]) * f); bp.y = R1(a[1] + (bp.y - a[1]) * f);
      return [key];
    });
    this._toast(`Blueprint rescaled — that line is now ${this._fmtLen(target)}`, 4000);
  }

  /* ----- floor plan inspector ----- */
  _renderPlanInspector(box) {
    const e = this._edit, n = e.sel.size, sc = this._work.scene || {}, U = this._imperial() ? "in" : "cm";
    const tw = `<span class="tw">${ic("chevron-down")}</span>`;
    const num = (lab, name, val, step = 1) => `<label>${lab}<input data-p="${name}" type="number" step="${step}" value="${esc(val)}"></label>`;
    const btn = (name, text) => `<button data-pb="${name}">${text}</button>`;
    const bind = () => {
      box.querySelectorAll("input[data-p], select[data-p]").forEach((inp) => inp.addEventListener("change", () => this._planField(e.primary, inp.dataset.p, inp.type === "checkbox" ? inp.checked : inp.value)));
      box.querySelectorAll("button[data-pb]").forEach((b) => b.addEventListener("click", () => this._planField(e.primary, b.dataset.pb)));
      this._bindInspToggle(box);
    };
    if (this._tool === "measure") {
      const m = this._measure, imp = this._imperial();
      box.innerHTML = m.pts.length < 2
        ? `<h4>Set blueprint scale${tw}</h4><div class="sub">Click one end of something whose real length you know (a dimension line or a wall), then the other end.</div><div class="row">${btn("mcancel", "Cancel")}</div>`
        : `<h4>Set blueprint scale${tw}</h4><div class="sub">How long is that line in real life?</div>
          <div class="grid" style="grid-template-columns:2fr 1fr"><label>Length<input data-m="len" type="number" step="0.1" placeholder="${imp ? "12.5" : "350"}"></label>
          <label>Unit<select data-m="unit">${(imp ? ["ft", "in", "m", "cm"] : ["cm", "m", "ft", "in"]).map((u) => `<option>${u}</option>`).join("")}</select></label></div>
          <div class="sub">${imp ? "12′ 6″ is 12.5 ft." : ""}</div><div class="row"><button data-m="apply" class="primary">Apply</button>${btn("mredo", "Measure again")}${btn("mcancel", "Cancel")}</div>`;
      box.querySelector('[data-m="apply"]')?.addEventListener("click", () => {
        const v = Number(box.querySelector('[data-m="len"]').value), u = box.querySelector('[data-m="unit"]').value;
        this._applyScale(v * { cm: 1, m: 100, in: 2.54, ft: 30.48 }[u]);
      });
      box.querySelector('[data-m="len"]')?.focus();
      bind(); return;
    }
    if (!n) {
      const tips = {
        select: "Drag a corner dot to reshape walls (every wall meeting there follows). Drag a wall, door or window to move it. Tap one to edit its size.",
        wall: this._draw?.start ? "Click to place the next corner. Click the last corner again, or press Enter, to finish." : "Click where the wall starts, then where it ends. Keep clicking to chain walls. Ends snap to corners and to other walls.",
        door: "Click a wall to cut a door into it.", window: "Click a wall to cut a window into it.",
        room: this._draw?.pts?.length ? `${this._draw.pts.length} corner${this._draw.pts.length > 1 ? "s" : ""} so far. Click the first corner (or press Enter) to close the room.` : "Click each corner of the room in turn. Corners snap to walls and to other rooms' corners.",
      }[this._tool] || "";
      box.innerHTML = `<h4>Floor plan${tw}</h4><div class="sub">${tips}</div>
        <div class="row">${this._list("p").length ? btn("bpsel", ic("image-outline") + "Blueprint settings") : btn("bpadd", ic("image-plus") + "Add a blueprint image…")}</div>
        <details class="tips"><summary>Tips</summary>Snap lines walls up on corners, other walls and 15° angles; turn it off to trace odd angles. Doors and windows are boxes cut out of whatever wall they overlap, so you can also stretch one across a corner. Lengths are shown in ${this._imperial() ? "feet and inches" : "metric"}.</details>
        ${this._sunHTML(false)}`;
      this._bindSun(box); bind(); return;
    }
    const key = e.primary, k = key[0], it = this._get(key);
    let body = "", sub = n > 1 ? `${n} items selected — drag moves all` : "";
    const texSel = (v, use) => `<label>Texture<select data-p="texture">${[["none", "Plain"], ...Object.entries(SURFACES).filter(([t, [, , u]]) => u.includes(use) || t === v).map(([t, [l]]) => [t, l])]
      .map(([t, l]) => `<option value="${t}"${(SURFACES[v] ? v : "none") === t ? " selected" : ""}>${l}</option>`).join("")}</select></label>`;
    if (k === "w") {
      const [ux, uy, L] = segDir(it), ang = R1((((Math.atan2(uy, ux) * 180) / Math.PI) % 360 + 360) % 360);
      sub ||= `${this._fmtLen(L)} long`;
      body = `<div class="grid">${num(`Length (${U})`, "len", this._toReal(L))}${num(`Thick (${U})`, "t", this._toReal(it.t ?? sc.wall_thickness ?? 4))}${num(`Height (${U})`, "h", this._toReal(it.h ?? sc.wall_height ?? 46, true))}${num("Angle °", "ang", ang, 15)}
        <label>Colour<input data-p="color" type="color" value="${esc(it.color || (sc.wall_colors || ["#e9dcc8"])[0])}"></label>${texSel(it.texture ?? sc.wall_texture, "w")}</div>
        <div class="row">${btn("split", ic("content-cut") + "Split")}${btn("low", it.low ? ic("arrow-expand-up") + "Full height" : ic("arrow-collapse-down") + "Cut-away (low)")}${btn("door", ic("door") + "Add door")}${btn("allwalls", ic("format-paint") + "Use on all walls")}</div>`;
    } else if (k === "n") {
      sub ||= "A box cut out of the walls it overlaps";
      body = `<label style="margin-bottom:8px">Type<select data-p="kind">${[["door", "Door"], ["window", "Window (with glass)"], ["cut", "Plain cut-out"]]
          .map(([v, l]) => `<option value="${v}"${(it.kind || "cut") === v ? " selected" : ""}>${l}</option>`).join("")}</select></label>
        <div class="grid">${num(`Width (${U})`, "w", this._toReal(it.w))}${num(`Height (${U})`, "h", this._toReal(it.h, true))}${num(`${it.kind === "window" ? "Sill" : "Bottom"} (${U})`, "z", this._toReal(it.z || 0, true))}${num(`Depth (${U})`, "d", this._toReal(it.d ?? 6))}${num("Rotate °", "rot", it.rot || 0, 15)}</div>
        <div class="row">${btn("fit", ic("arrow-expand-horizontal") + "Fit to wall")}${btn("rotl", ic("rotate-left") + "90°")}${btn("rotr", ic("rotate-right") + "90°")}</div>`;
      if (it.kind === "door") {
        const st = DOOR_STYLES[it.style] ? it.style : "none", sel = (p, opts, v) => `<select data-p="${p}">${opts.map(([o, l]) => `<option value="${o}"${v === o ? " selected" : ""}>${l}</option>`).join("")}</select>`;
        const ents = Object.keys(this._hass?.states || {}).filter((id) => /^(binary_sensor|cover|input_boolean)\./.test(id)).sort();
        body += `<div class="grid" style="grid-template-columns:1fr 1fr;margin-top:8px"><label>Door${sel("style", Object.entries(DOOR_STYLES).map(([o, [l]]) => [o, l]), st)}</label>`;
        if (st !== "none") {
          body += `<label>Colour<input data-p="color" type="color" value="${esc(it.color || DOOR_STYLES[st][1])}"></label>`;
          // hinge: which jamb a swinging door hangs from, or which way a sliding one moves (the sliding pane starts on the other side)
          const hinge = { panel: ["Hinge", "Left", "Right"], glass: ["Hinge", "Left", "Right"], barn: ["Slides", "Left", "Right"], sliding: ["Slides", "Right", "Left"] }[st];
          if (hinge) body += `<label>${hinge[0]}${sel("hinge", [["left", hinge[1]], ["right", hinge[2]]], it.hinge || "left")}</label>`;
          if (st !== "garage") body += `<label>${{ barn: "Hangs on", sliding: "Front pane" }[st] || "Swings"}${sel("flip", [["", "This side"], ["1", "Other side"]], it.flip ? "1" : "")}</label>`;
          body += `</div><label style="margin-top:8px">Sensor (open / shut)<input data-p="entity" type="text" list="doorents" value="${esc(it.entity || "")}" placeholder="binary_sensor.front_door"></label>
            <datalist id="doorents">${ents.map((id) => `<option value="${id}">`).join("")}</datalist>
            ${it.entity ? `<div class="sub" style="margin-top:4px">${esc(this._hass?.states[it.entity]?.attributes?.friendly_name || "Unknown entity")} · now ${this._doorTarget(it) ? "open" : "shut"}</div>` : `<label class="chk"><input data-p="open" type="checkbox"${it.open ? " checked" : ""}> Show it open</label>`}`;
        } else body += `</div>`;
      }
    } else if (k === "r") {
      const xs = it.pts.map((q) => q[0]), ys = it.pts.map((q) => q[1]);
      sub ||= `${this._fmtArea(polyArea(it.pts))} · ${this._fmtLen(Math.max(...xs) - Math.min(...xs))} × ${this._fmtLen(Math.max(...ys) - Math.min(...ys))}`;
      const vs = this._vsel?.key === key;
      body = `<div class="grid" style="grid-template-columns:2fr 1fr"><label>Name<input data-p="name" type="text" value="${esc(it.name || "")}"></label><label>Colour<input data-p="fill" type="color" value="${esc(it.fill || "#b3a58f")}"></label></div>
        <div class="grid" style="grid-template-columns:1fr;margin-top:6px">${texSel(it.texture, "f")}</div>
        <label class="chk"><input data-p="menu" type="checkbox"${it.menu === false ? "" : " checked"}> Show in the room menu</label>
        <div class="row">${vs && it.pts.length > 3 ? btn("delcorner", ic("close") + "Remove corner") : ""}</div>
        <div class="sub" style="margin-top:6px">Drag the green corners to reshape the room; drag a white dot to add a corner. Tap a corner, then Delete, to remove it. The room menu frames the room by this outline.</div>`;
    } else if (k === "p") {
      sub ||= `${this._fmtLen(it.w)} × ${this._fmtLen(it.h)}`;
      body = `<label style="margin-bottom:8px">Opacity<input data-p="opacity" type="range" min="0.1" max="1" step="0.05" value="${it.opacity ?? 0.6}"></label>
        <div class="grid">${num(`Width (${U})`, "w", this._toReal(it.w))}${num("Rotate °", "rot", it.rot || 0, 1)}</div>
        <div class="row" style="margin:0 0 8px"><button data-pb="scale" class="primary">${ic("ruler")}Set scale…</button>${btn("rotl", ic("rotate-left") + "90°")}${btn("rotr", ic("rotate-right") + "90°")}</div>
        <label class="chk"><input data-p="locked" type="checkbox"${it.locked ? " checked" : ""}> Lock in place (clicks go through it)</label>
        <label class="chk"><input data-p="show" type="checkbox"${it.show ? " checked" : ""}> Also show it outside edit mode</label>
        <label style="margin-top:8px">Image URL<input data-p="url" type="text" value="${esc(String(it.src || "").startsWith("data:") ? "" : it.src || "")}" placeholder="/local/plan.png (or pick a file)"></label>
        <div class="row">${btn("bpreplace", "Replace image…")}</div>`;
    }
    box.innerHTML = `<h4>${esc(this._label(key))}${tw}</h4><div class="sub">${esc(sub)}</div>${body}
      <details style="margin-top:8px"><summary style="cursor:pointer;opacity:.8">Advanced (JSON)</summary>
        <textarea data-json>${esc(JSON.stringify(k === "p" && String(it.src).startsWith("data:") ? { ...it, src: "(inline image)" } : it, null, 1))}</textarea><div class="row"><button data-b="json">Apply JSON</button></div></details>`;
    box.querySelector('[data-b="json"]').addEventListener("click", () => {
      if (k === "p" && String(it.src).startsWith("data:")) { try { const v = JSON.parse(box.querySelector("textarea[data-json]").value); if (v.src === "(inline image)") v.src = it.src; box.querySelector("textarea[data-json]").value = JSON.stringify(v); } catch (er) { /* reported below */ } }
      this._field(key, "json");
    });
    bind();
  }
  _planField(key, name, raw) {
    if (name === "bpadd") return this._pickBlueprintFile();
    if (name === "bpsel") return this._select(["p:0"]);
    if (name === "bpreplace") return this._pickBlueprintFile(key);
    if (name === "scale") { this._measure = { bp: key }; return this._setTool("measure"); }
    if (name === "mcancel") return this._setTool("select");
    if (name === "mredo") { this._measure.pts = []; this._hidePreview(); return this._renderInspector(); }
    if (name === "rotl" || name === "rotr") return this._field(key, name);
    if (name === "url") return this._setBlueprintUrl(key, String(raw));
    if (name === "door") { this._setTool("door"); return this._toast("Click the spot on the wall for the door"); }
    const k = key[0], v = Number(raw), sc = this._work.scene;
    if (["len", "t", "h", "ang", "w", "z", "d", "rot", "opacity"].includes(name) && !isFinite(v)) return;
    let keys = [...this._edit.sel];
    this._mutate(() => {
      const it = this._get(key);
      if (name === "texture" || name === "color" || name === "fill") {   // looks apply to every selected wall / room
        for (const kk of keys) {
          const o = kk[0] === k && this._get(kk); if (!o) continue;
          if (name !== "texture") o[name] = raw;
          else if (k === "w" ? raw === (sc.wall_texture || "none") : raw === "none") delete o.texture;
          else o.texture = raw;
        }
        return keys;
      }
      if (k === "w") {
        const [ux, uy, L] = segDir(it), mid = [(it.a[0] + it.b[0]) / 2, (it.a[1] + it.b[1]) / 2];
        if (name === "len") { const nl = Math.max(1, this._fromReal(v)); it.b = [R1(it.a[0] + ux * nl), R1(it.a[1] + uy * nl)]; }
        else if (name === "t") it.t = R1(Math.max(0.5, this._fromReal(v)));
        else if (name === "h") { it.h = R1(Math.max(0.5, this._fromReal(v, true))); delete it.low; }
        else if (name === "ang") { const a = (v * Math.PI) / 180, c = Math.cos(a) * L / 2, s = Math.sin(a) * L / 2; it.a = [R1(mid[0] - c), R1(mid[1] - s)]; it.b = [R1(mid[0] + c), R1(mid[1] + s)]; }
        else if (name === "allwalls") {   // this wall's look becomes the default; every wall follows it
          sc.wall_colors = [it.color || (sc.wall_colors || ["#e9dcc8"])[0], ...(sc.wall_colors || []).slice(1)];
          const tx = it.texture ?? sc.wall_texture;
          if (SURFACES[tx]) sc.wall_texture = tx; else delete sc.wall_texture;
          for (const w of sc.wall_segs || []) { delete w.color; delete w.texture; }
        }
        else if (name === "low") { if (it.low) { delete it.low; delete it.h; } else { it.low = true; it.h = sc.low ?? 8; } }
        else if (name === "split") { const b = it.b; it.b = [R1(mid[0]), R1(mid[1])]; const nw = jclone(it); nw.a = [R1(mid[0]), R1(mid[1])]; nw.b = b; keys = [key, this._push("w", nw)]; }
      } else if (k === "n") {
        if (name === "kind") it.kind = raw;
        else if (name === "style") { if (raw === "none") delete it.style; else it.style = raw; }
        else if (name === "hinge") { if (raw === "right") it.hinge = "right"; else delete it.hinge; }
        else if (name === "flip") { if (raw) it.flip = true; else delete it.flip; }
        else if (name === "open") { if (raw) it.open = true; else delete it.open; }
        else if (name === "entity") { const v2 = String(raw).trim(); if (v2) it.entity = v2; else delete it.entity; }
        else if (name === "w" || name === "d") it[name] = R1(Math.max(0.5, this._fromReal(v)));
        else if (name === "h") it.h = R1(Math.max(0.5, this._fromReal(v, true)));
        else if (name === "z") it.z = R1(Math.max(0, this._fromReal(v, true)));
        else if (name === "rot") { it.rot = R1(((v % 360) + 360) % 360); if (!it.rot) delete it.rot; }
        else if (name === "fit") this._fitOpening(it);
      } else if (k === "r") {
        if (name === "name") { const v2 = String(raw).trim().toLowerCase().replace(/\s+/g, "_"); if (v2) it.name = v2; }
        else if (name === "menu") { if (raw) delete it.menu; else it.menu = false; }
        else if (name === "delcorner" && this._vsel?.key === key && it.pts.length > 3) { it.pts.splice(this._vsel.k, 1); this._vsel = null; }
      } else if (k === "p") {
        if (name === "opacity") it.opacity = Math.max(0.05, Math.min(1, v));
        else if (name === "w") { const f = Math.max(1, this._fromReal(v)) / it.w; it.w = R1(it.w * f); it.h = R1(it.h * f); }
        else if (name === "rot") { it.rot = R1(((v % 360) + 360) % 360); if (!it.rot) delete it.rot; }
        else if (name === "locked") it.locked = raw ? true : undefined;
        else if (name === "show") it.show = raw ? true : undefined;
      }
      return keys;
    });
  }

  /* ----- save ----- */
  async _save() {
    const h = this._hass, btn = this._ed.querySelector('[data-a="save"]');
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      const seg = this._config.dashboard || decodeURIComponent(location.pathname.split("/")[1] || "lovelace");
      const url_path = seg === "lovelace" ? null : seg;
      const lc = await h.callWS({ type: "lovelace/config", url_path, force: true });
      const out = { ...this._config };
      for (const k of SAVED) out[k] = this._work[k];
      let found = false;
      // dashboard generated by the strategy (current or old name): the layout lives in the strategy config
      if (lc.strategy && STRATEGY_TYPES.includes(lc.strategy.type)) {
        for (const k of SAVED) lc.strategy[k] = this._work[k];
        found = true;
      }
      const match = (c) => c && CARD_TYPES.includes(c.type) && (!this._config.card_id || c.card_id === this._config.card_id);
      const walk = (arr) => {
        if (!Array.isArray(arr) || found) return;
        for (let i = 0; i < arr.length && !found; i++) {
          const c = arr[i];
          if (match(c)) { arr[i] = out; found = true; return; }
          if (c && typeof c === "object") { walk(c.cards); walk(c.sections); if (c.card && match(c.card)) { c.card = out; found = true; } }
        }
      };
      walk(lc.views);
      if (!found) throw new Error("couldn't find this card in the dashboard config");
      await h.callWS({ type: "lovelace/config/save", url_path, config: lc });
      this._edit.dirty = false;
      // remember the config HA is about to hand back (the strategy regenerates the card), so it isn't seen as a change
      this._config = STRATEGY_TYPES.includes(lc.strategy?.type) ? H.strategyCard(lc.strategy) : out;
      this._cfgJSON = H.stableJSON(this._config);
      this._toast("Saved to the dashboard");
      this._exitEdit(false);
    } catch (e) {
      console.error(e);
      this._toast("Save failed: " + (e.message || e.code || e), 5000);
      btn.disabled = false; this._syncBar();
    }
  }

  /* ----- model library ----- */
  _openLibrary() {
    this._ed.querySelector(".lib")?.remove();
    const lib = document.createElement("div"); lib.className = "lib";
    this._ed.append(lib);
    this._libEl = lib;
    this._libHome();
  }
  _libHome() {
    const lib = this._libEl;
    lib.innerHTML = `<header><span class="ttl">Sweet Home 3D model libraries</span><button data-x title="Close">${ic("close")}</button></header>
      <div class="body"><div class="note">Libraries are downloaded once into <code>/config/www/sh3d/</code> by Home Assistant's Downloader integration,
        then opened here. Pick the ones you want — big libraries take a minute to download. Each device caches the models it has displayed.</div>
        <div class="libs">${LIBS.map((l) => `<div class="librow" data-f="${l.file}"><div><b>${esc(l.title)}</b>
          <div class="meta">${l.n} models · ${l.size} · ${esc(l.lic)}</div></div><span class="st meta">checking…</span><button class="act" disabled>…</button></div>`).join("")}</div>
        <div class="note">Models © their authors — see sweethome3d.com/free-3d-models for credits. CC-BY models need attribution if you share renders.</div></div>`;
    lib.querySelector("[data-x]").addEventListener("click", () => lib.remove());
    for (const row of lib.querySelectorAll(".librow")) this._libRow(row);
  }
  async _libRow(row, wait) {
    const file = row.dataset.f, st = row.querySelector(".st"), btn = row.querySelector(".act");
    let ok = false;
    try { ok = (await fetch(LIB_DIR + encodeURIComponent(file), { method: "HEAD", cache: "no-store" })).ok; } catch (e) { /* offline */ }
    if (this._dl?.[file] && !wait) { st.textContent = "downloading…"; btn.disabled = true; btn.textContent = "…"; return; }
    st.textContent = ok ? "downloaded" : "";
    btn.disabled = false; btn.className = "act" + (ok ? " primary" : "");
    btn.textContent = ok ? "Open" : "Download";
    btn.onclick = () => (ok ? this._libBrowse(file) : this._download(file, row));
  }
  async _download(file, row) {
    const h = this._hass, st = row.querySelector(".st"), btn = row.querySelector(".act");
    if (!h.services?.downloader?.download_file) {
      st.textContent = "Downloader integration isn't set up"; return;
    }
    btn.disabled = true; st.textContent = "downloading…";
    (this._dl ||= {})[file] = true;
    const done = async (ok, msg) => {
      if (!this._dl?.[file]) return;
      delete this._dl[file];
      for (const u of unsubs) (await u)?.();
      st.textContent = ok ? "downloaded" : msg || "download failed";
      if (ok && row.isConnected) this._libRow(row, true);
      else { btn.disabled = false; btn.textContent = "Retry"; }
    };
    const evMatch = (ev) => { const d = ev.data || {}; return String(d.filename || d.url || "").includes(file); };
    const unsubs = [
      h.connection.subscribeEvents((ev) => evMatch(ev) && done(true), "downloader_download_completed"),
      h.connection.subscribeEvents((ev) => evMatch(ev) && done(false, "download failed — check the HA log"), "downloader_download_failed"),
    ];
    try {
      await h.callService("downloader", "download_file", { url: SF + file, subdir: "sh3d", filename: file, overwrite: true });
    } catch (e) { done(false, "couldn't start: " + (e.message || e)); }
  }
  async _libBrowse(file) {
    const lib = this._libEl, meta = LIBS.find((l) => l.file === file);
    lib.innerHTML = `<header><button data-back>${ic("chevron-left")}Libraries</button><span class="ttl">${esc(meta?.title || file)}</span><button data-x title="Close">${ic("close")}</button></header>
      <div class="body"><div class="note">Opening library…</div></div>`;
    lib.querySelector("[data-x]").addEventListener("click", () => lib.remove());
    lib.querySelector("[data-back]").addEventListener("click", () => this._libHome());
    let data;
    try { data = await this._openLib(file); }
    catch (e) { lib.querySelector(".body").innerHTML = `<div class="note">Couldn't open this library: ${esc(e.message || e)}. If it was still downloading, wait and try again; otherwise re-download it.</div>`; return; }
    const cats = [...new Set(data.items.map((i) => i.cat))].sort();
    const body = lib.querySelector(".body");
    body.innerHTML = `<div class="tools"><input type="search" placeholder="Search ${data.items.length} models…"><select><option value="">All categories</option>
      ${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div><div class="items"></div>`;
    const q = body.querySelector("input"), sel = body.querySelector("select"), grid = body.querySelector(".items");
    const render = () => {
      const s = q.value.trim().toLowerCase(), c = sel.value;
      const list = data.items.filter((i) => (!c || i.cat === c) && (!s || i.name.toLowerCase().includes(s) || i.cat.toLowerCase().includes(s))).slice(0, 180);
      grid.innerHTML = list.map((it, n) => `<div class="it" data-n="${n}" title="${esc(it.name)} · ${esc(it.creator)}"><img alt=""><div class="n">${esc(it.name)}</div>
        <div class="meta" style="opacity:.6">${Math.round(it.w)}×${Math.round(it.d)}×${Math.round(it.h)} cm</div></div>`).join("");
      grid.querySelectorAll(".it").forEach((el) => {
        const it = list[+el.dataset.n];
        el.addEventListener("click", () => this._placeModel(it));
        this._icon(data, it).then((u) => { if (u) el.querySelector("img").src = u; });
      });
    };
    q.addEventListener("input", render); sel.addEventListener("change", render);
    render();
  }
  async _icon(data, it) {
    if (it._url !== undefined) return it._url;
    const s = data.sh3fs.find((x) => x.name === it.sh3f) || data.sh3fs[0];
    const f = zipFind(s.zip, it.icon);
    it._url = f ? URL.createObjectURL(await f.async("blob")) : null;
    return it._url;
  }
  _placeModel(it) {
    this._libEl?.remove();
    const [sxy, sz] = this._modelScale(), [x, y] = this._target();
    this._mutate(() => [this._push("o", {
      type: "model", name: it.name, lib: it.lib, sh3f: it.sh3f, model: it.model, mr: it.mr || undefined, creator: it.creator || undefined, lic: it.lic,
      x, y, z: R1(it.elev / sz), w: R1(it.w / sxy), d: R1(it.d / sxy), h: R1(it.h / sz), cm: [it.w, it.d, it.h],
    })]);
    this._toast(`Placed ${it.name} at the centre of the view — drag it into place`);
  }
}

const proto = customElements.get("ha-3dhome-card").prototype;
for (const k of Object.getOwnPropertyNames(Home3DEditor.prototype))
  if (k !== "constructor") Object.defineProperty(proto, k, Object.getOwnPropertyDescriptor(Home3DEditor.prototype, k));
window.dispatchEvent(new Event("ha-3dhome-editor-ready"));
