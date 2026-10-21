/* Editor side panels: render looks, per-room cards, and the entity list you drag onto the map.
 */
import type { LovelaceCardConfig, Looks } from "../types";
import type { GenericItem } from "../core/items";
import type { Editor } from "./editor";
import { renderLookPanel, clearLookPanel, type LookName } from "./look-panel";
import {
  inPoly,
  ACTIVE,
  CX,
  CY,
  DOOR_CLASSES,
  R1,
  entIcon,
  esc,
  ic,
  itemCenter,
  lookOf,
  AMBIENT,
  YAML_URL,
} from "./shared.js";

export class EditorPanels {
  /* Look panel (look-panel.tsx): a strength slider per render look, applied live while dragging. One undo step per drag. */
  _toggleLookPanel(this: Editor) {
    const old = this.card._ed.querySelector<HTMLElement>(".lookp");
    this.card._ed.querySelector<HTMLElement>('[data-a="look"]')?.classList.toggle("on", !old);
    if (old) {
      clearLookPanel(old);
      return old.remove();
    }
    if (this.card._ed.querySelector<HTMLElement>(".rcp")) this._toggleRoomCardsPanel();
    const host = document.createElement("div");
    host.className = "lookp";
    this.card._ed.append(host);
    renderLookPanel(host, this);
  }

  /** Redraws the Look panel, if it is open, from card._work (after undo, redo or a save). */
  _syncLookPanel(this: Editor) {
    const host = this.card._ed?.querySelector<HTMLElement>(".lookp");
    if (host) renderLookPanel(host, this);
  }

  /** Sets one look's strength (0 to 1) while its slider moves. Only values that differ from the default are stored. */
  setLook(this: Editor, name: LookName, strength: number) {
    const work = this.card._work;
    if (!this._lookDrag) {
      this._pushUndo();
      this._lookDrag = true;
    }
    if (name === "ambient") {
      if (strength === AMBIENT) delete work.ambient;
      else work.ambient = strength;
    } else {
      const look: Partial<Record<keyof Looks, number | boolean>> =
        work.look === false ? { light: 0, ao: 0, stage: 0, bloom: 0 } : { ...(work.look || {}) };
      if (strength === lookOf({})[name]) delete look[name];
      else look[name] = strength;
      if (Object.keys(look).length) work.look = look;
      else delete work.look;
    }
    this._syncLookPanel();
    this.card._update();
    this.card._requestRender();
  }

  /** The slider was let go: the next move starts a new undo step. */
  finishLookDrag(this: Editor) {
    this._lookDrag = false;
  }

  /** Where the map goes after `seconds` without a touch: a room, or the whole home when `room` is empty. 0 turns it off. */
  setIdleView(this: Editor, seconds: number, room: string) {
    this._pushUndo();
    if (seconds > 0) this.card._work.idle_view = room ? { room, after: seconds } : { after: seconds };
    else delete this.card._work.idle_view;
    this._syncLookPanel();
  }

  /** One undo step for a panel change. */
  _pushUndo(this: Editor) {
    const edit = this.card._edit;
    edit.undo.push(JSON.stringify(this.card._work));
    edit.redo = [];
    edit.dirty = true;
  }

  /* Controls panel: the Lovelace cards each room shows top right (`room_cards`). Tiles for entities, the room's own devices in one go,
   * or any card as YAML (pasted from another dashboard's card code editor). One undo step per change; no 3D rebuild. */
  _toggleRoomCardsPanel(this: Editor) {
    const old = this.card._ed.querySelector<HTMLElement>(".rcp");
    if (old) {
      old.remove();
      this._syncBar();
      return;
    }
    if (this.card._ed.querySelector<HTMLElement>(".ents")) this._toggleEntityPanel();
    if (this.card._ed.querySelector<HTMLElement>(".lookp")) this._toggleLookPanel();
    const p = document.createElement("div");
    p.className = "rcp";
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
    this.card._ed.append(p);
    const room = p.querySelector<HTMLSelectElement>("[data-room]"),
      ta = p.querySelector<HTMLTextAreaElement>("textarea"),
      code = p.querySelector<HTMLElement>(".rccode");
    room.innerHTML = [["home", "Whole home"], ...this.card._rooms().map((r) => [r.name, r.label])]
      .map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`)
      .join("");
    room.value = this.card._rooms().some((r) => r.name === this.card._rcRoom) ? this.card._rcRoom : "home";
    p.querySelector<HTMLElement>("datalist").innerHTML = Object.entries(this.card._hass?.states || {})
      .map(([id, st]) => `<option value="${esc(id)}">${esc(st.attributes?.friendly_name || "")}</option>`)
      .join("");
    room.addEventListener("change", () => {
      this.card._rcRoom = room.value;
      code.classList.add("hide");
      this._syncRoomCardsPanel(true);
      this.card._focusRoom(this.card._rooms().find((r) => r.name === room.value) || null);
    });
    const cur = () => this.card._work.room_cards?.[room.value] || [];
    p.querySelector<HTMLElement>("[data-x]").addEventListener("click", () => this._toggleRoomCardsPanel());
    p.querySelector<HTMLElement>(".rcl").addEventListener("click", (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>("button[data-i]");
      if (!b) return;
      const i = +b.dataset.i,
        l = [...cur()];
      if (b.dataset.op === "del") l.splice(i, 1);
      else {
        const j = i + (b.dataset.op === "up" ? -1 : 1);
        if (j < 0 || j >= l.length) return;
        [l[i], l[j]] = [l[j], l[i]];
      }
      this._rcSet(room.value, l);
    });
    const ent = p.querySelector<HTMLInputElement>("[data-ent]"),
      addTile = () => {
        const e = ent.value.trim();
        if (!e) return;
        if (!this.card._hass?.states[e]) return this.card._toast("No entity called " + e);
        this._rcSet(room.value, [...cur(), { type: "tile", entity: e }]);
        ent.value = "";
      };
    p.querySelector<HTMLElement>("[data-add]").addEventListener("click", addTile);
    ent.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") addTile();
    });
    p.querySelector<HTMLElement>("[data-auto]").addEventListener("click", () => {
      const have = new Set(
          cur()
            .map((c) => c.entity)
            .filter(Boolean),
        ),
        add = this._roomEntities(room.value).filter((e) => !have.has(e));
      if (!add.length)
        return this.card._toast(room.value === "home" ? "Pick a room first" : "No more devices placed in this room");
      this._rcSet(room.value, [...cur(), ...add.map((entity) => ({ type: "tile", entity }))]);
      this.card._toast(`Added ${add.length} ${add.length === 1 ? "tile" : "tiles"}`);
    });
    const yaml = () =>
      this.card
        ._mod(YAML_URL)
        .then((m) => m.default || m)
        .catch(() => null);
    p.querySelector<HTMLElement>("[data-code]").addEventListener("click", async () => {
      if (!code.classList.contains("hide")) return code.classList.add("hide");
      const l = cur(),
        Y = await yaml();
      ta.value = l.length ? (Y ? Y.dump(l, { lineWidth: -1 }) : JSON.stringify(l, null, 2)) : "";
      code.classList.remove("hide");
      ta.focus();
    });
    p.querySelector<HTMLElement>("[data-codex]").addEventListener("click", () => code.classList.add("hide"));
    p.querySelector<HTMLElement>("[data-apply]").addEventListener("click", async () => {
      const txt = ta.value.trim();
      let v;
      try {
        if (!txt) v = [];
        else if (/^[[{]/.test(txt)) v = JSON.parse(txt);
        else {
          const Y = await yaml();
          if (!Y) throw new Error("couldn't load the YAML reader, use JSON");
          v = Y.load(txt);
        }
      } catch (e: any) {
        return this.card._toast("That code doesn't read right: " + (e.reason || e.message || e), 5000);
      }
      if (v && !Array.isArray(v) && Array.isArray(v.cards) && !v.type) v = v.cards; // a pasted view or stack body
      const l = Array.isArray(v) ? v : v ? [v] : [];
      if (l.some((c) => !c || typeof c !== "object" || !c.type))
        return this.card._toast("Every card needs a type, like type: tile", 5000);
      this._rcSet(room.value, l);
      code.classList.add("hide");
    });
    this._syncRoomCardsPanel(true);
  }

  _rcSet(this: Editor, key: string, list: LovelaceCardConfig[]) {
    const e = this.card._edit;
    e.undo.push(JSON.stringify(this.card._work));
    e.redo = [];
    e.dirty = true;
    const rc = { ...(this.card._work.room_cards || {}) };
    if (list.length) rc[key] = list;
    else delete rc[key];
    if (Object.keys(rc).length) this.card._work.room_cards = rc;
    else delete this.card._work.room_cards;
    this._syncBar();
  }

  /* entities of the lights, hotspots, chips, doors and objects placed inside a room's outline */
  _roomEntities(this: Editor, key: string) {
    const room = this.card._rooms().find((r) => r.name === key);
    if (!room) return [];
    const w = this.card._work,
      polys = (w.scene?.floors || [])
        .filter((f) => room.floors.includes(f.name) && f.pts?.length >= 3)
        .map((f) => f.pts);
    const inside = (x: number, y: number) =>
      polys.length
        ? polys.some((pts) => inPoly(x, y, pts))
        : x >= room.rect[0] && x <= room.rect[1] && y >= room.rect[2] && y <= room.rect[3];
    const out: string[] = [];
    const add = (k: string, it: GenericItem) => {
      if (!it?.entity || out.includes(it.entity)) return;
      const [x, y] = itemCenter(k, it);
      if (inside(x, y)) out.push(it.entity);
    };
    for (const [k, n] of [
      ["l", "lights"],
      ["h", "hotspots"],
      ["c", "chips"],
      ["d", "doors"],
    ])
      for (const it of (w as Record<string, GenericItem[]>)[n] || []) add(k, it);
    for (const o of w.scene?.objects || []) add("o", o);
    return out;
  }

  _syncRoomCardsPanel(this: Editor, force?: boolean) {
    const p = this.card._ed?.querySelector<HTMLElement & { _sig?: string }>(".rcp"); // _sig: what the preview shows
    if (!p) return;
    const key = p.querySelector<HTMLSelectElement>("[data-room]").value,
      list = this.card._work.room_cards?.[key] || [],
      sig = key + JSON.stringify(list);
    if (!force && p._sig === sig) return;
    p._sig = sig;
    const st = this.card._hass?.states || {};
    const name = (c: LovelaceCardConfig) => {
      const e = c.entity || (typeof c.entities?.[0] === "string" ? c.entities[0] : c.entities?.[0]?.entity);
      const what = c.name || c.title || (e && (st[e]?.attributes?.friendly_name || e)) || "";
      return {
        t: String(c.type)
          .replace(/^custom:/, "")
          .replace(/-/g, " "),
        what:
          (c.entities?.length > 1 ? `${what} +${c.entities.length - 1}` : what) ||
          (c.cards ? `${c.cards.length} cards` : ""),
      };
    };
    p.querySelector<HTMLElement>(".rcl").innerHTML =
      list
        .map((c, i) => {
          const n = name(c);
          return `<div class="rcrow"><div style="min-width:0"><div class="n">${esc(n.what || n.t)}</div><div class="id">${esc(n.t)}</div></div>
      <span><button data-i="${i}" data-op="up" title="Move up"${i ? "" : " disabled"}>${ic("arrow-up")}</button><button data-i="${i}" data-op="down" title="Move down"${i < list.length - 1 ? "" : " disabled"}>${ic("arrow-down")}</button><button data-i="${i}" data-op="del" title="Remove">${ic("close")}</button></span></div>`;
        })
        .join("") || `<div class="hint">No controls for this room yet.</div>`;
    const prev = p.querySelector<HTMLElement>(".rcprev"),
      gen = this.card._gen;
    prev.replaceChildren();
    this.card._makeCards(list).then((els) => {
      if (gen === this.card._gen && p._sig === sig && p.isConnected) prev.replaceChildren(...els);
    });
  }

  _toggleEntityPanel(this: Editor, force?: boolean) {
    const old = this.card._ed.querySelector<HTMLElement>(".ents");
    if (old && force !== true) {
      old.remove();
      this.card._ed.querySelector<HTMLElement>('[data-a="add"]')?.classList.remove("on");
      return;
    }
    if (old) return;
    if (this.card._ed.querySelector<HTMLElement>(".rcp")) this._toggleRoomCardsPanel();
    this.card._ed.querySelector<HTMLElement>('[data-a="add"]')?.classList.add("on");
    const p = document.createElement("div");
    p.className = "ents";
    const doms = [
      ["", "All"],
      ["light", "Lights"],
      ["switch", "Switches"],
      ["sensor", "Sensors"],
      ["binary_sensor", "Binary"],
      ["climate", "Climate"],
      ["media_player", "Media"],
      ["cover", "Covers"],
      ["fan", "Fans"],
      ["lock", "Locks"],
      ["camera", "Cameras"],
      ["*", "Other"],
    ];
    p.innerHTML = `<header><span class="ttl">Add to map</span><button data-x title="Close">${ic("close")}</button></header>
      <div class="quick"><button data-q="box">${ic("cube-outline")}Box</button><button data-q="label">${ic("label-outline")}Label</button><button data-q="model" title="Browse 3D model libraries">${ic("sofa-outline")}Model</button></div>
      <input type="search" placeholder="Search entities…"><div class="doms">${doms.map(([d, l]) => `<button data-d="${d}"${d === "" ? ' class="on"' : ""}>${l}</button>`).join("")}</div>
      <div class="hint">${this._coarse ? "Tap an entity to add it in the middle of the view, then drag it into place." : "Drag an entity onto the floor plan (or click to drop it in the middle of the view)."}</div><div class="list"></div>`;
    this.card._ed.append(p);
    let dom = "";
    const q = p.querySelector<HTMLInputElement>("input"),
      list = p.querySelector<HTMLElement>(".list");
    const main = new Set(doms.map((d) => d[0]).filter((d) => d && d !== "*"));
    const render = () => {
      const s = q.value.trim().toLowerCase(),
        placed = this._placedEntities(),
        states = this.card._hass?.states || {};
      const rows = Object.entries(states)
        .map(([id, st]) => ({ id, st, name: String(st.attributes?.friendly_name || id) }))
        .filter(({ id, name }) => {
          const d = id.split(".")[0];
          if (dom === "*" ? main.has(d) : dom && d !== dom) return false;
          return !s || id.toLowerCase().includes(s) || name.toLowerCase().includes(s);
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 250);
      list.innerHTML =
        rows
          .map(
            ({
              id,
              st,
              name,
            }) => `<div class="erow${ACTIVE.has(st.state) ? " act" : ""}" data-e="${esc(id)}"><ha-icon icon="${esc(entIcon(st, id))}"></ha-icon>
        <div style="min-width:0"><div class="n">${esc(name)}</div><div class="id">${esc(id)} · ${esc(st.state)}</div></div>
        <span class="ok">${placed.has(id) ? `${ic("check")}On map` : ""}</span></div>`,
          )
          .join("") || `<div class="hint">No matching entities.</div>`;
    };
    q.addEventListener("input", render);
    p.querySelector<HTMLElement>(".doms").addEventListener("click", (ev) => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>("button");
      if (!b) return;
      dom = b.dataset.d;
      p.querySelectorAll<HTMLElement>(".doms button").forEach((x) => x.classList.toggle("on", x === b));
      render();
    });
    p.querySelector<HTMLElement>("[data-x]").addEventListener("click", () => this._toggleEntityPanel());
    p.querySelector<HTMLElement>(".quick").addEventListener("click", (ev) => {
      const k = (ev.target as HTMLElement).closest<HTMLElement>("button")?.dataset.q;
      if (!k) return;
      if (k === "model") return this._openLibrary();
      const [x, y] = this._target();
      this._mutate(() => [
        k === "box"
          ? this._push("b", { b: [x - 10, x + 10, y - 10, y + 10, 10, "cream", 0] })
          : this._push("c", { label: "Label", x, y, z: 50 }),
      ]);
    });
    // Mouse and pen drag an entity onto the map. A finger scrolls the list instead, and a tap adds the entity mid-view.
    let touched = false;
    list.addEventListener("pointerdown", (ev) => {
      const row = (ev.target as HTMLElement).closest<HTMLElement>(".erow");
      touched = ev.pointerType === "touch";
      if (!row || ev.button > 0 || touched) return;
      ev.preventDefault();
      this._dragEntity(row.dataset.e, ev, row);
    });
    list.addEventListener("click", (ev) => {
      const row = (ev.target as HTMLElement).closest<HTMLElement>(".erow");
      if (!row || !touched) return;
      const [x, y] = this._target();
      this._placeEntity(row.dataset.e, x, y);
      this._toggleEntityPanel(); // out of the way, so the new item can be dragged into place
    });
    render();
    this._entsRender = render;
  }

  /* pointer-driven drag from the panel onto the canvas (works with mouse and touch) */
  _dragEntity(this: Editor, id: string, ev0: PointerEvent, row: HTMLElement) {
    const st = this.card._hass?.states[id],
      wrapR = () => this.card._wrap.getBoundingClientRect(),
      canvas = this.card._renderer.domElement;
    let ghost: HTMLElement | null = null;
    const over = (ev: PointerEvent) => {
      const r = canvas.getBoundingClientRect(),
        panel = this.card._ed.querySelector<HTMLElement>(".ents")?.getBoundingClientRect();
      const inCanvas = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
      const inPanel =
        panel &&
        ev.clientX >= panel.left &&
        ev.clientX <= panel.right &&
        ev.clientY >= panel.top &&
        ev.clientY <= panel.bottom;
      return inCanvas && !inPanel;
    };
    const move = (ev: PointerEvent) => {
      if (!ghost && Math.hypot(ev.clientX - ev0.clientX, ev.clientY - ev0.clientY) < 6) return;
      if (!ghost) {
        ghost = document.createElement("div");
        ghost.className = "ghost";
        ghost.textContent = st?.attributes.friendly_name || id;
        this.card._ed.append(ghost);
      }
      const w = wrapR();
      ghost.style.left = ev.clientX - w.left + "px";
      ghost.style.top = ev.clientY - w.top + "px";
      ghost.classList.toggle("off", !over(ev));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      const dragged = !!ghost;
      ghost?.remove();
      if (ev.type === "pointercancel") return;
      if (!dragged) {
        const [x, y] = this._target();
        return this._placeEntity(id, x, y);
      }
      if (!over(ev)) return;
      const T = this.card.T,
        r = canvas.getBoundingClientRect(),
        ray = new T.Raycaster();
      ray.setFromCamera(
        new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1),
        this.card._cam,
      );
      const p = ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), 0), new T.Vector3());
      if (p) this._placeEntity(id, R1(p.x + CX), R1(p.z + CY));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /* pick a sensible representation for an entity: light glow, door marker, climate chip, or a live badge */
  _entityItem(this: Editor, id: string, x: number, y: number, as?: string): [string, GenericItem] {
    const st = this.card._hass?.states[id],
      d = id.split(".")[0],
      dc = st?.attributes?.device_class;
    as ||=
      d === "light"
        ? "light"
        : d === "binary_sensor" && DOOR_CLASSES.has(dc)
          ? "door"
          : d === "media_player" && dc === "tv"
            ? "screen"
            : "badge";
    if (as === "screen") return ["o", { type: "screen", entity: id, x, y, z: 20, w: 32 }];
    if (as === "light") return ["l", { entity: id, x, y, z: 40, r: 40, hit: 10 }];
    if (as === "door") return ["d", { entity: id, x, y }];
    if (as === "hotspot") return ["h", { entity: id, x, y, z: 10, hit: 12 }];
    if (d === "climate") return ["c", { climate: id, x, y, z: 40 }];
    return ["c", { entity: id, x, y, z: 30 }];
  }

  _placeEntity(this: Editor, id: string, x: number, y: number) {
    const [k, item] = this._entityItem(id, x, y);
    this._mutate(() => [this._push(k, item)]);
    this.card._toast(`Added ${this.card._hass?.states[id]?.attributes.friendly_name || id}. Drag it into place.`);
    this._entsRender?.();
  }

  _convertEntity(this: Editor, key: string, as: string) {
    const it = this.item(key),
      id = it.entity || it.climate;
    if (!id) return;
    const c = itemCenter(key[0], it);
    this._mutate(() => {
      const [k, i] = key.split(":");
      this._list(k).splice(+i, 1);
      const [nk, item] = this._entityItem(id, R1(c[0]), R1(c[1]), as);
      if (as === "badge" && id.startsWith("climate.")) {
        delete item.climate;
        item.entity = id;
      }
      return [this._push(nk, item)];
    });
  }
}
