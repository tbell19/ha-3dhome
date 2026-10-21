/* Entering and leaving edit mode, item lookup, the editor toolbar and keyboard shortcuts.
 */
import { KINDS, TC_URL, ic, jclone, roomTitle, segDir } from "./shared.js";

export class EditorSession {
  _list(k, create) {
    const w = this._work;
    if ("bovwnpr".includes(k)) {
      w.scene ||= {};
      const n = {
        b: "boxes",
        o: "objects",
        v: "overlays",
        w: "wall_segs",
        n: "openings",
        p: "blueprints",
        r: "floors",
      }[k];
      if (create) w.scene[n] ||= [];
      return w.scene[n] || [];
    }
    const n = { l: "lights", h: "hotspots", c: "chips", d: "doors" }[k];
    if (create) w[n] ||= [];
    return w[n] || [];
  }

  _get(key) {
    const [k, i] = key.split(":");
    return this._list(k)[+i];
  }

  _setBoxObj(key) {
    const [k, i] = key.split(":");
    const l = this._list(k);
    if (k === "b" && Array.isArray(l[+i])) l[+i] = { b: l[+i] };
    return l[+i];
  }

  _allKeys() {
    const out = [];
    for (const k of "bovlhcdwnpr") this._list(k).forEach((_, i) => out.push(k + ":" + i));
    return out;
  }

  _label(key) {
    const [k] = key.split(":"),
      it = this._get(key);
    if (!it) return key;
    if (k === "b") return "Box" + (it.group ? ` · ${it.group}` : "");
    if (k === "o" || k === "v")
      return (it.type === "model" ? it.name || "Model" : it.type) + (it.group ? ` · ${it.group}` : "");
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
    this._work = jclone({
      scene: this._config.scene || {},
      lights: this._config.lights || [],
      hotspots: this._config.hotspots || [],
      chips: this._config.chips || [],
      doors: this._config.doors || [],
      room_cards: this._config.room_cards,
    });
    this._work = { ...this._config, ...this._work };
    this._migrateWalls();
    this._edit = {
      sel: new Set(),
      undo: [],
      redo: [],
      dirty: false,
      mode: "translate",
      space: "world",
      lock: false,
      snap: true,
      showFurn: false,
    };
    this._plan = false;
    this._tool = "select";
    this._coarse = matchMedia("(pointer: coarse)").matches; // touch-first device: no gizmo, drag selected items directly
    this._inspMin = this._coarse && this._wrap.clientWidth < 640; // phones: inspector starts folded to its title bar
    this._wrap.classList.add("editing");
    this._edBtn.style.display = "none";
    const T = this.T;
    this._pivot = new T.Object3D();
    this._scene.add(this._pivot);
    const tc = (this._tc = new TransformControls(this._cam, this._renderer.domElement));
    tc.setSize(0.9);
    tc.addEventListener("change", () => this._requestRender());
    tc.addEventListener("dragging-changed", (e) => {
      this._controls.enabled = !e.value;
      this._tcDragging = e.value;
      if (e.value) this._tcUsed = true;
    });
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
    this._tc.detach();
    this._scene.remove(this._tc);
    this._tc.dispose();
    this._tc = null;
    this._scene.remove(this._pivot);
    for (const hp of this._helpers || []) {
      this._scene.remove(hp);
      hp.dispose?.();
    }
    this._helpers = [];
    this._disposePreview();
    if (this._plan && this._planTopped && this._sph().phi < 0.3) this._toggleTop();
    this._plan = false;
    this._planTopped = false;
    this._tool = "select";
    this._sunPreview = null;
    this._edit = null;
    this._work = null;
    this._controls.enabled = true;
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
    if (!t) {
      t = document.createElement("div");
      t.className = "toast";
      this._ed.append(t);
    }
    t.textContent = msg;
    t.style.opacity = 1;
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => (t.style.opacity = 0), ms);
  }

  /* The toolbar: a top row (mode switch, undo/redo, Cancel, Save) and a row of tools for what is selected. Item tools
   * (`.selo`) show only with a selection and scene tools (`.idle`) only without one; the rest sit in the Draw and More
   * menus. On a phone the rows stack and only `.ico` buttons drop their label. */
  _renderEditorUI() {
    const ed = this._ed,
      plan = !!this._plan;
    const b = (a, icon, label, title, cls = "") =>
      `<button data-a="${a}"${cls ? ` class="${cls}"` : ""}${title ? ` title="${title}"` : ""}>${ic(icon)}<span class="lbl">${label}</span></button>`;
    const menu = (m, icon, label, title, cls = "") =>
      `<button data-m="${m}"${cls ? ` class="${cls}"` : ""} title="${title}">${ic(icon)}<span class="lbl">${label}</span>${ic("menu-down")}</button>`;
    const modes = `<span class="seg modes">${b("m-furn", "sofa-outline", "Furniture", "Edit furniture and devices")}${b("m-plan", "floor-plan", "Floor plan", "Edit walls, doors, windows and the blueprint")}</span>`;
    const acts = `<span class="acts">${b("undo", "undo", "Undo", "Undo (Ctrl+Z)", "ico")}${b("redo", "redo", "Redo", "Redo (Ctrl+Shift+Z)", "ico")}
      <button data-a="cancel">Cancel</button><button data-a="save" class="primary">Save</button></span>`;
    const tools = plan
      ? b("t-select", "cursor-default-outline", "Select", "Select and move (V)") +
        b("rotate", "rotate-right", "Rotate", "Rotate (R)", "selo") +
        menu("draw", "pencil-ruler", "Draw", "Draw walls, doors, windows and rooms") +
        b("bp", "image-outline", "Blueprint", "Blueprint image to trace over", "idle") +
        b("del", "delete-outline", "Delete", "Delete (Del)", "selo ico") +
        menu("more", "dots-horizontal", "More", "More options")
      : b("add", "plus", "Add", "Add entities, boxes or models", "idle") +
        b("look", "palette-outline", "Look", "Lighting, effects and idle view", "idle") +
        b("controls", "tune-variant", "Controls", "Cards shown for each room", "idle") +
        b("translate", "cursor-move", "Move", "Move (W)", "selo") +
        b("rotate", "rotate-right", "Rotate", "Rotate (E)", "selo") +
        b("scale", "resize", "Scale", "Scale (R)", "selo") +
        b("del", "delete-outline", "Delete", "Delete (Del)", "selo ico") +
        menu("more", "dots-horizontal", "More", "More options", "selo");
    const pops = plan
      ? `<div class="menu pop hide" data-pop="draw">${b("t-wall", "wall", "Walls", "Draw walls (W)")}${b("t-door", "door", "Door", "Add a door to a wall (D)")}${b("t-window", "window-closed-variant", "Window", "Add a window to a wall")}${b("t-room", "vector-polygon", "Room", "Draw a room outline")}</div>
        <div class="menu pop hide" data-pop="more">${b("furnvis", "eye-outline", "Show furniture", "Show furniture while editing the plan")}${b("snap", "magnet", "Snap to corners and angles", "Snap to grid, corners and 15° angles")}</div>`
      : `<div class="menu pop hide" data-pop="more">${b("dup", "content-copy", "Duplicate", "Duplicate (Ctrl+D)")}${b("group", "group", "Group", "Group the selected items")}${b("ungroup", "ungroup", "Ungroup", "Ungroup")}
        ${b("space", "earth", "Global axes", "Gizmo axes: the world's, or the selected item's own (X)")}${b("snap", "magnet", "Snap to grid", "Snap to grid / 15° / 5%")}</div>`;
    ed.innerHTML = `<div class="tb">
      <div class="bar"><div class="top">${modes}${acts}</div><div class="tools">${tools}</div></div>${pops}</div>
      <div class="insp"></div>`;
    ed.querySelector(".tb").addEventListener("click", (ev) => {
      const mb = ev.target.closest("[data-m]");
      if (mb) return this._togglePop(mb.dataset.m, mb);
      const bt = ev.target.closest("[data-a]");
      if (!bt) return;
      const a = bt.dataset.a;
      this._togglePop(null);
      if (a === "m-furn" || a === "m-plan") this._setPlanMode(a === "m-plan");
      else if (a === "translate" || a === "rotate" || a === "scale" || a === "t-select") {
        this._setMode(a === "t-select" ? "translate" : a);
        if (this._plan && this._tool !== "select") this._setTool("select");
        else this._syncBar();
      } else if (a === "space") {
        this._edit.space = this._edit.space === "local" ? "world" : "local";
        this._placePivot();
        this._syncBar();
      } else if (a === "t-wall" || a === "t-door" || a === "t-window" || a === "t-room") {
        const t = a.slice(2);
        this._setTool(this._tool === t ? "select" : t);
      } else if (a === "bp") {
        const n = this._list("p").length;
        if (n) {
          this._setTool("select");
          this._select(["p:0"]);
        } else this._pickBlueprintFile();
      } else if (a === "furnvis") {
        this._edit.showFurn = !this._edit.showFurn;
        this._applyPlanVis();
        this._syncBar();
        this._requestRender();
      } else if (a === "snap") {
        this._edit.snap = !this._edit.snap;
        this._applySnap();
        this._syncBar();
      } else if (a === "add") this._toggleEntityPanel();
      else if (a === "models") this._openLibrary();
      else if (a === "look") {
        this._select([]);
        this._toggleLookPanel();
      } else if (a === "controls") {
        this._select([]);
        this._toggleRoomCardsPanel();
      } else if (a === "dup") this._duplicate();
      else if (a === "del") this._delete();
      else if (a === "group") this._group(true);
      else if (a === "ungroup") this._group(false);
      else if (a === "undo") this._undo(false);
      else if (a === "redo") this._undo(true);
      else if (a === "cancel") this._exitEdit(true);
      else if (a === "save") this._save();
    });
    if (!this._wrap._popWired) {
      // a press anywhere outside an open menu closes it
      this._wrap._popWired = true;
      this._wrap.addEventListener(
        "pointerdown",
        (ev) => {
          if (!ev.composedPath().some((n) => n.classList?.contains("pop") || n.dataset?.m)) this._togglePop?.(null);
        },
        { capture: true },
      );
    }
    this._syncBar();
  }

  /* Opens the Draw or More menu under its button (or closes it when it's already open); null closes any open menu. */
  _togglePop(name, btn) {
    const ed = this._ed;
    if (!ed) return;
    for (const p of ed.querySelectorAll(".pop")) {
      const open = p.dataset.pop === name && p.classList.contains("hide");
      p.classList.toggle("hide", !open);
      ed.querySelector(`[data-m="${p.dataset.pop}"]`)?.classList.toggle("open", open);
      if (!open || !btn) continue;
      const wr = this._wrap.getBoundingClientRect(),
        br = btn.getBoundingClientRect(),
        bar = ed.querySelector(".bar").getBoundingClientRect();
      p.style.top = bar.bottom - wr.top + 6 + "px";
      p.style.left = Math.max(8, Math.min(br.left - wr.left, wr.width - p.offsetWidth - 8)) + "px";
    }
  }

  _syncBar() {
    const ed = this._ed,
      bar = ed?.querySelector(".bar");
    if (!bar) return;
    const e = this._edit,
      q = (a) => ed.querySelector(`.tb [data-a="${a}"]`),
      on = (a, v) => q(a)?.classList.toggle("on", !!v),
      dis = (a, v) => {
        const b = q(a);
        if (b) b.disabled = !!v;
      };
    const sel = !this._plan || this._tool === "select",
      n = e.sel.size;
    on("m-furn", !this._plan);
    on("m-plan", this._plan);
    on("translate", e.mode === "translate");
    on("t-select", sel && e.mode !== "rotate");
    on("rotate", sel && e.mode === "rotate");
    on("scale", e.mode === "scale");
    on("space", e.space === "local");
    const sp = q("space");
    if (sp)
      sp.innerHTML =
        e.space === "local"
          ? `${ic("compass-outline")}<span class="lbl">Own axes</span>`
          : `${ic("earth")}<span class="lbl">Global axes</span>`;
    const tools = {
      wall: ["wall", "Walls"],
      door: ["door", "Door"],
      window: ["window-closed-variant", "Window"],
      room: ["vector-polygon", "Room"],
    };
    for (const t in tools) on("t-" + t, this._tool === t);
    const dm = ed.querySelector('[data-m="draw"]');
    if (dm) {
      const [icon, label] = tools[this._tool] || ["pencil-ruler", "Draw"];
      dm.classList.toggle("on", !!tools[this._tool]);
      dm.innerHTML = `${ic(icon)}<span class="lbl">${label}</span>${ic("menu-down")}`;
    }
    for (const b of bar.querySelectorAll(".selo")) b.classList.toggle("hide", !n);
    for (const b of bar.querySelectorAll(".idle")) b.classList.toggle("hide", !!n);
    on("furnvis", e.showFurn);
    on("snap", e.snap);
    this._syncLookPanel();
    this._syncRoomCardsPanel();
    on("controls", ed.querySelector(".rcp"));
    on("bp", e.primary?.[0] === "p" && n);
    dis("dup", !n);
    dis("ungroup", !n);
    dis("group", n < 2);
    dis("undo", !e.undo.length);
    dis("redo", !e.redo.length);
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
      if ((ev.key === "Delete" || ev.key === "Backspace") && this._vsel && this._tool === "select") {
        ev.preventDefault();
        this._planField(this._vsel.key, "delcorner");
        return;
      }
      if ((ev.key === "Escape" || ev.key === "Enter") && this._tool !== "select") {
        if (this._tool === "wall" && this._draw?.start && ev.key === "Enter") {
          this._setTool("wall");
          return;
        }
        if (this._tool === "room" && ev.key === "Enter" && this._draw?.pts?.length >= 3) {
          this._finishRoom();
          return;
        }
        this._setTool("select");
        return;
      }
      const tk = { w: "wall", d: "door", v: "select" }[ev.key.toLowerCase()];
      if (tk) {
        this._setTool(tk);
        return;
      }
    }
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (arrows[ev.key] && sel.length) {
      ev.preventDefault();
      const [dx, dy] = this._screenDir(...arrows[ev.key]),
        step = ev.shiftKey ? 10 : 1;
      this._mutate(() => {
        this._applyMove(sel, dx * step, dy * step);
        return sel;
      });
      return;
    }
    // [ and ] turn the selection 15° (Shift: 90°); Q / E do the same on the floor plan, where E isn't the rotate tool
    const turn = { "[": -1, "{": -1, "]": 1, "}": 1, ...(this._plan ? { q: -1, Q: -1, e: 1, E: 1 } : {}) }[ev.key];
    if (turn && !mod && sel.length) {
      this._mutate(() => {
        this._applyRotate(sel, (ev.shiftKey ? 90 : 15) * turn, this._pivotC);
        return sel;
      });
      return;
    }
    // Unity / Godot gizmo keys in furniture mode: W move, E rotate, R scale, X local / global axes
    const gk = !this._plan && !mod && { w: "translate", e: "rotate", r: "scale" }[ev.key.toLowerCase()];
    if (gk) {
      this._setMode(gk);
      this._syncBar();
      return;
    }
    if (!this._plan && !mod && ev.key.toLowerCase() === "x") {
      this._ed.querySelector('[data-a="space"]')?.click();
      return;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      if (this._edit.sel.size) {
        ev.preventDefault();
        this._delete();
      }
    } else if (mod && ev.key.toLowerCase() === "z") {
      ev.preventDefault();
      this._undo(ev.shiftKey);
    } else if (mod && ev.key.toLowerCase() === "d") {
      ev.preventDefault();
      this._duplicate();
    } else if (ev.key === "Escape") this._select([]);
    else if (ev.key === "r" && !mod) this._ed.querySelector('[data-a="rotate"]')?.click();
    else if ((ev.key === "g" || ev.key === "t") && !mod) this._ed.querySelector('[data-a="translate"]')?.click();
  }
}
