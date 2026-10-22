/* Entering and leaving edit mode, item lookup, the editor toolbar and keyboard shortcuts.
 */
import type { Scene, WallSeg } from "../types";
import type { GenericItem } from "../core/items";
import type { EditState } from "../card/card";
import type { Editor } from "./editor";
import { render } from "preact";
import { KINDS, TC_URL, jclone, roomTitle, segDir } from "./shared";
import { closeSidePanels, toggleSidePanel, refreshSidePanels, panelButtons } from "./side-panels";
import { showToolbar } from "./toolbar";

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
    this._clearEditorUI();
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

  /* The editor's layer over the map: the toolbar (toolbar.tsx) and the inspector (inspector-panel.tsx). Switching
   * between Furniture and Floor plan draws it again and closes the side panels. */
  _renderEditorUI(this: Editor) {
    const layer = this.card._ed;
    closeSidePanels(this);
    this.closeLibrary();
    this._menu = null;
    if (!layer.querySelector(":scope > .tb")) {
      const toolbar = document.createElement("div"),
        inspector = document.createElement("div");
      toolbar.className = "tb";
      inspector.className = "insp";
      layer.append(toolbar, inspector);
    }
    const wrap = this.card._wrap as HTMLElement & { _menuWired?: boolean };
    if (!wrap._menuWired) {
      // a press anywhere outside an open menu closes it
      wrap._menuWired = true;
      wrap.addEventListener(
        "pointerdown",
        (ev) => {
          const path = ev.composedPath() as HTMLElement[];
          if (!path.some((n) => n.classList?.contains("pop") || n.dataset?.m)) this.closeMenu?.();
        },
        { capture: true },
      );
    }
    this._syncBar();
  }

  /** Takes the editor's layer down when leaving edit mode, so every component cleans up. */
  _clearEditorUI(this: Editor) {
    closeSidePanels(this);
    this.closeLibrary();
    for (const host of this.card._ed.querySelectorAll<HTMLElement>(":scope > .tb, :scope > .insp")) render(null, host);
    this.card._ed.innerHTML = "";
  }

  /** Opens the Draw or More menu under its button, or closes it when it is already open. */
  toggleMenu(this: Editor, name: string, button: HTMLElement) {
    this._menu = this._menu?.name === name ? null : { name, button };
    this._syncBar();
  }

  closeMenu(this: Editor) {
    if (!this._menu) return;
    this._menu = null;
    this._syncBar();
  }

  /** Draws the toolbar and the open side panels again from the editor's state. */
  _syncBar(this: Editor) {
    const toolbar = this.card._ed?.querySelector<HTMLElement>(":scope > .tb");
    if (!toolbar || !this.card._edit) return;
    showToolbar(this, toolbar);
    refreshSidePanels(this);
    this.card._wrap.classList.toggle("tool", !!this.card._plan && this.card._tool !== "select");
  }

  toolbarAction(this: Editor, action: string) {
    const edit = this.card._edit;
    this._menu = null;
    switch (action) {
      case "m-furn":
      case "m-plan":
        this._setPlanMode(action === "m-plan");
        break;
      case "translate":
      case "rotate":
      case "scale":
      case "t-select":
        this._setMode(action === "t-select" ? "translate" : action);
        if (this.card._plan && this.card._tool !== "select") this._setTool("select");
        break;
      case "space":
        edit.space = edit.space === "local" ? "world" : "local";
        this._placePivot();
        break;
      case "t-wall":
      case "t-door":
      case "t-window":
      case "t-room": {
        const tool = action.slice(2);
        this._setTool(this.card._tool === tool ? "select" : tool);
        break;
      }
      case "bp":
        if (this._list("p").length) {
          this._setTool("select");
          this._select(["p:0"]);
        } else this._pickBlueprintFile();
        break;
      case "furnvis":
        edit.showFurn = !edit.showFurn;
        this.applyPlanVis();
        this.card._requestRender();
        break;
      case "snap":
        edit.snap = !edit.snap;
        this._applySnap();
        break;
      case "add":
        toggleSidePanel(this, "ents");
        break;
      case "look":
      case "controls":
        this._select([]);
        toggleSidePanel(this, panelButtons[action]);
        break;
      case "dup":
        this._duplicate();
        break;
      case "del":
        this._delete();
        break;
      case "group":
      case "ungroup":
        this._group(action === "group");
        break;
      case "undo":
      case "redo":
        this._undo(action === "redo");
        break;
      case "cancel":
        return this._exitEdit(true);
      case "save":
        this._save();
        break;
    }
    this._syncBar();
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
