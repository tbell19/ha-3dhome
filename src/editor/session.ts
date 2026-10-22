/* Entering and leaving edit mode, item lookup, the editor toolbar and keyboard shortcuts.
 */
import type { Scene, WallSeg } from "../types";
import type { GenericItem } from "../core/items";
import type { EditState } from "../card/card";
import type { Editor } from "./editor";
import { KINDS, TC_URL, ic, jclone, roomTitle, segDir } from "./shared";
import { toggleSidePanel, refreshSidePanels, isOpen, panelButtons } from "./side-panels";

export class EditorSession {
  _list(this: Editor, k: string, create?: boolean): GenericItem[] {
    const w = this.card._work;
    if ("bovwnpr".includes(k)) {
      w.scene ||= {};
      const n = (<Record<string, keyof Scene>>{
        b: "boxes",
        o: "objects",
        v: "overlays",
        w: "wall_segs",
        n: "openings",
        p: "blueprints",
        r: "floors",
      })[k];
      const lists = w.scene as Record<string, GenericItem[]>;
      if (create) lists[n] ||= [];
      return lists[n] || [];
    }
    const n = (<Record<string, string>>{ l: "lights", h: "hotspots", c: "chips", d: "doors" })[k];
    const lists = w as Record<string, GenericItem[]>;
    if (create) lists[n] ||= [];
    return lists[n] || [];
  }

  item(this: Editor, key: string): GenericItem {
    const [k, i] = key.split(":");
    return this._list(k)[+i];
  }

  _setBoxObj(this: Editor, key: string): GenericItem {
    const [k, i] = key.split(":");
    const l = this._list(k);
    if (k === "b" && Array.isArray(l[+i])) l[+i] = { b: l[+i] };
    return l[+i];
  }

  _allKeys(this: Editor) {
    const out: string[] = [];
    for (const k of "bovlhcdwnpr") this._list(k).forEach((_, i) => out.push(k + ":" + i));
    return out;
  }

  _label(this: Editor, key: string) {
    const [k] = key.split(":"),
      it = this.item(key);
    if (!it) return key;
    if (k === "b") return "Box" + (it.group ? ` · ${it.group}` : "");
    if (k === "o" || k === "v")
      return (it.type === "model" ? it.name || "Model" : it.type) + (it.group ? ` · ${it.group}` : "");
    if (k === "w") return `Wall · ${this.card._fmtLen(segDir(it as WallSeg)[2])}`;
    if (k === "n") return (<Record<string, string>>{ door: "Door", window: "Window" })[it.kind] || "Cut-out";
    if (k === "p") return "Blueprint";
    if (k === "r") return `Room · ${roomTitle(it.name || "unnamed")}`;
    const ent = it.entity ? this.card._hass?.states[it.entity]?.attributes?.friendly_name || it.entity : "";
    return `${KINDS[k][0].toUpperCase() + KINDS[k].slice(1)}${ent ? " · " + ent : it.label ? " · " + it.label : ""}`;
  }

  async enter(this: Editor) {
    if (this.card._edit) return;
    const { TransformControls } = await this.card._mod(TC_URL);
    this.card._work = jclone({
      scene: this.card._config.scene || {},
      lights: this.card._config.lights || [],
      hotspots: this.card._config.hotspots || [],
      chips: this.card._config.chips || [],
      doors: this.card._config.doors || [],
      room_cards: this.card._config.room_cards,
    });
    this.card._work = { ...this.card._config, ...this.card._work };
    this.card._edit = {
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
    this.card._plan = false;
    this.card._tool = "select";
    this._coarse = matchMedia("(pointer: coarse)").matches; // touch-first device: no gizmo, drag selected items directly
    this._inspMin = this._coarse && this.card._wrap.clientWidth < 640; // phones: inspector starts folded to its title bar
    this.card._wrap.classList.add("editing");
    this.card._edBtn.style.display = "none";
    const T = this.card.T;
    this.card._pivot = new T.Object3D();
    this.card._scene.add(this.card._pivot);
    const tc = (this.card._tc = new TransformControls(this.card._cam, this.card._renderer.domElement));
    tc.setSize(0.9);
    tc.addEventListener("change", () => this.card._requestRender());
    tc.addEventListener("dragging-changed", (e: { value?: boolean }) => {
      this.card._controls.enabled = !e.value;
      this.card._tcDragging = e.value;
      if (e.value) this.card._tcUsed = true;
    });
    tc.addEventListener("mouseDown", () => this.dragStart(this.card._edit.mode));
    tc.addEventListener("objectChange", () => this.dragPreview());
    tc.addEventListener("mouseUp", () => this.dragEnd());
    this.card._scene.add(tc);
    this._applySnap();
    this.card._keys = (ev) => this._onKey(ev);
    window.addEventListener("keydown", this.card._keys);
    this._renderEditorUI();
    this.card._rebuild();
    this._select([]);
    this.card.dispatchEvent(new CustomEvent("ha-3dhome-editing", { detail: { editing: true } }));
  }

  _exitEdit(this: Editor, discard?: boolean) {
    if (!this.card._edit) return;
    if (discard && this.card._edit.dirty && !confirm("Discard your unsaved layout changes?")) return;
    window.removeEventListener("keydown", this.card._keys);
    this.card._tc.detach();
    this.card._scene.remove(this.card._tc);
    this.card._tc.dispose();
    this.card._tc = null;
    this.card._scene.remove(this.card._pivot);
    for (const hp of this.card._helpers || []) {
      this.card._scene.remove(hp);
      hp.dispose?.();
    }
    this.card._helpers = [];
    this.disposePreview();
    if (this.card._plan && this._planTopped && this.card._sph().phi < 0.3) this.card._toggleTop();
    this.card._plan = false;
    this._planTopped = false;
    this.card._tool = "select";
    this.card._sunPreview = null;
    this.card._edit = null;
    this.card._work = null;
    this.card._controls.enabled = true;
    this.card._wrap.classList.remove("editing", "plan", "tool");
    this.card._ed.innerHTML = "";
    this.card._edBtn.style.display = this.card._hass?.user?.is_admin ? "" : "none";
    this.card._applyLayout(); // the saved config, or the one from before editing
    this.card.dispatchEvent(new CustomEvent("ha-3dhome-editing", { detail: { editing: false } }));
  }

  _applySnap(this: Editor) {
    const s = this.card._edit.snap;
    this.card._tc.setTranslationSnap(s ? 2 : null);
    this.card._tc.setRotationSnap(s ? Math.PI / 12 : null);
    this.card._tc.setScaleSnap(s ? 0.05 : null);
  }

  /* The toolbar: a top row (mode switch, undo/redo, Cancel, Save) and a row of tools for what is selected. Item tools
   * (`.selo`) show only with a selection and scene tools (`.idle`) only without one; the rest sit in the Draw and More
   * menus. On a phone the rows stack and only `.ico` buttons drop their label. */
  _renderEditorUI(this: Editor) {
    const ed = this.card._ed,
      plan = !!this.card._plan;
    const b = (a: string, icon: string, label: string, title: string, cls = "") =>
      `<button data-a="${a}"${cls ? ` class="${cls}"` : ""}${title ? ` title="${title}"` : ""}>${ic(icon)}<span class="lbl">${label}</span></button>`;
    const menu = (m: string, icon: string, label: string, title: string, cls = "") =>
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
    ed.querySelector<HTMLElement>(".tb").addEventListener("click", (ev) => {
      const mb = (ev.target as HTMLElement).closest<HTMLElement>("[data-m]");
      if (mb) return this._togglePop(mb.dataset.m, mb);
      const bt = (ev.target as HTMLElement).closest<HTMLElement>("[data-a]");
      if (!bt) return;
      const a = bt.dataset.a;
      this._togglePop(null);
      if (a === "m-furn" || a === "m-plan") this._setPlanMode(a === "m-plan");
      else if (a === "translate" || a === "rotate" || a === "scale" || a === "t-select") {
        this._setMode(a === "t-select" ? "translate" : a);
        if (this.card._plan && this.card._tool !== "select") this._setTool("select");
        else this._syncBar();
      } else if (a === "space") {
        this.card._edit.space = this.card._edit.space === "local" ? "world" : "local";
        this._placePivot();
        this._syncBar();
      } else if (a === "t-wall" || a === "t-door" || a === "t-window" || a === "t-room") {
        const t = a.slice(2);
        this._setTool(this.card._tool === t ? "select" : t);
      } else if (a === "bp") {
        const n = this._list("p").length;
        if (n) {
          this._setTool("select");
          this._select(["p:0"]);
        } else this._pickBlueprintFile();
      } else if (a === "furnvis") {
        this.card._edit.showFurn = !this.card._edit.showFurn;
        this.applyPlanVis();
        this._syncBar();
        this.card._requestRender();
      } else if (a === "snap") {
        this.card._edit.snap = !this.card._edit.snap;
        this._applySnap();
        this._syncBar();
      } else if (a === "add") toggleSidePanel(this, "ents");
      else if (a === "models") this._openLibrary();
      else if (a === "look" || a === "controls") {
        this._select([]);
        toggleSidePanel(this, panelButtons[a]);
      } else if (a === "dup") this._duplicate();
      else if (a === "del") this._delete();
      else if (a === "group") this._group(true);
      else if (a === "ungroup") this._group(false);
      else if (a === "undo") this._undo(false);
      else if (a === "redo") this._undo(true);
      else if (a === "cancel") this._exitEdit(true);
      else if (a === "save") this._save();
    });
    const wrap = this.card._wrap as HTMLElement & { _popWired?: boolean };
    if (!wrap._popWired) {
      // a press anywhere outside an open menu closes it
      wrap._popWired = true;
      wrap.addEventListener(
        "pointerdown",
        (ev) => {
          const path = ev.composedPath() as HTMLElement[];
          if (!path.some((n) => n.classList?.contains("pop") || n.dataset?.m)) this._togglePop?.(null);
        },
        { capture: true },
      );
    }
    this._syncBar();
  }

  /* Opens the Draw or More menu under its button (or closes it when it's already open); null closes any open menu. */
  _togglePop(this: Editor, name: string | null, btn?: HTMLElement) {
    const ed = this.card._ed;
    if (!ed) return;
    for (const p of ed.querySelectorAll<HTMLElement>(".pop")) {
      const open = p.dataset.pop === name && p.classList.contains("hide");
      p.classList.toggle("hide", !open);
      ed.querySelector<HTMLElement>(`[data-m="${p.dataset.pop}"]`)?.classList.toggle("open", open);
      if (!open || !btn) continue;
      const wr = this.card._wrap.getBoundingClientRect(),
        br = btn.getBoundingClientRect(),
        bar = ed.querySelector<HTMLElement>(".bar").getBoundingClientRect();
      p.style.top = bar.bottom - wr.top + 6 + "px";
      p.style.left = Math.max(8, Math.min(br.left - wr.left, wr.width - p.offsetWidth - 8)) + "px";
    }
  }

  _syncBar(this: Editor) {
    const ed = this.card._ed,
      bar = ed?.querySelector<HTMLElement>(".bar");
    if (!bar) return;
    const e = this.card._edit,
      q = (a: string) => ed.querySelector<HTMLButtonElement>(`.tb [data-a="${a}"]`),
      on = (a: string, v: unknown) => q(a)?.classList.toggle("on", !!v),
      dis = (a: string, v: unknown) => {
        const b = q(a);
        if (b) b.disabled = !!v;
      };
    const sel = !this.card._plan || this.card._tool === "select",
      n = e.sel.size;
    on("m-furn", !this.card._plan);
    on("m-plan", this.card._plan);
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
    const tools: Record<string, [string, string]> = {
      wall: ["wall", "Walls"],
      door: ["door", "Door"],
      window: ["window-closed-variant", "Window"],
      room: ["vector-polygon", "Room"],
    };
    for (const t in tools) on("t-" + t, this.card._tool === t);
    const dm = ed.querySelector<HTMLElement>('[data-m="draw"]');
    if (dm) {
      const [icon, label] = tools[this.card._tool] || ["pencil-ruler", "Draw"];
      dm.classList.toggle("on", !!tools[this.card._tool]);
      dm.innerHTML = `${ic(icon)}<span class="lbl">${label}</span>${ic("menu-down")}`;
    }
    for (const b of bar.querySelectorAll<HTMLElement>(".selo")) b.classList.toggle("hide", !n);
    for (const b of bar.querySelectorAll<HTMLElement>(".idle")) b.classList.toggle("hide", !!n);
    on("furnvis", e.showFurn);
    on("snap", e.snap);
    for (const [button, panel] of Object.entries(panelButtons)) on(button, isOpen(this, panel));
    refreshSidePanels(this);
    on("bp", e.primary?.[0] === "p" && n);
    dis("dup", !n);
    dis("ungroup", !n);
    dis("group", n < 2);
    dis("undo", !e.undo.length);
    dis("redo", !e.redo.length);
    q("save").textContent = e.dirty ? "Save •" : "Save";
    this.card._wrap.classList.toggle("tool", !!this.card._plan && this.card._tool !== "select");
  }

  _onKey(this: Editor, ev: KeyboardEvent) {
    const t = ev.composedPath()[0] as HTMLElement;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (!this.card.isConnected) return;
    const mod = ev.ctrlKey || ev.metaKey;
    const sel = [...this.card._edit.sel];
    if (this.card._plan && !mod) {
      if ((ev.key === "Delete" || ev.key === "Backspace") && this.card._vsel && this.card._tool === "select") {
        ev.preventDefault();
        this._planField(this.card._vsel.key, "delcorner");
        return;
      }
      if ((ev.key === "Escape" || ev.key === "Enter") && this.card._tool !== "select") {
        if (this.card._tool === "wall" && this._draw?.start && ev.key === "Enter") {
          this._setTool("wall");
          return;
        }
        if (this.card._tool === "room" && ev.key === "Enter" && this._draw?.pts?.length >= 3) {
          this._finishRoom();
          return;
        }
        this._setTool("select");
        return;
      }
      const tk = (<Record<string, string>>{ w: "wall", d: "door", v: "select" })[ev.key.toLowerCase()];
      if (tk) {
        this._setTool(tk);
        return;
      }
    }
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
    };
    if (arrows[ev.key] && sel.length) {
      ev.preventDefault();
      const [dx, dy] = this.card._screenDir(...arrows[ev.key]),
        step = ev.shiftKey ? 10 : 1;
      this._mutate(() => {
        this._applyMove(sel, dx * step, dy * step);
        return sel;
      });
      return;
    }
    // [ and ] turn the selection 15° (Shift: 90°); Q / E do the same on the floor plan, where E isn't the rotate tool
    const turns: Record<string, number> = {
      "[": -1,
      "{": -1,
      "]": 1,
      "}": 1,
      ...(this.card._plan ? { q: -1, Q: -1, e: 1, E: 1 } : {}),
    };
    const turn = turns[ev.key];
    if (turn && !mod && sel.length) {
      this._mutate(() => {
        this._applyRotate(sel, (ev.shiftKey ? 90 : 15) * turn, this._pivotC);
        return sel;
      });
      return;
    }
    // Unity / Godot gizmo keys in furniture mode: W move, E rotate, R scale, X local / global axes
    const gizmoKeys: Record<string, EditState["mode"]> = { w: "translate", e: "rotate", r: "scale" };
    const gk = !this.card._plan && !mod && gizmoKeys[ev.key.toLowerCase()];
    if (gk) {
      this._setMode(gk);
      this._syncBar();
      return;
    }
    if (!this.card._plan && !mod && ev.key.toLowerCase() === "x") {
      this.card._ed.querySelector<HTMLElement>('[data-a="space"]')?.click();
      return;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      if (this.card._edit.sel.size) {
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
    else if (ev.key === "r" && !mod) this.card._ed.querySelector<HTMLElement>('[data-a="rotate"]')?.click();
    else if ((ev.key === "g" || ev.key === "t") && !mod)
      this.card._ed.querySelector<HTMLElement>('[data-a="translate"]')?.click();
  }
}
