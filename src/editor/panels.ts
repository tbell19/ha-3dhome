/* What the editor's side panels change (the panels themselves are the .tsx files next to this one): the render looks
 * and idle view (look-panel.tsx), a room's cards (room-controls-panel.tsx) and the entities placed from the Add to map
 * panel (add-panel.tsx), dragged onto the map or dropped in the middle of the view.
 */
import type { LovelaceCardConfig, Looks } from "../types";
import type { GenericItem } from "../core/items";
import type { Editor } from "./editor";
import type { LookName } from "./look-panel";
import { inPoly, CX, CY, DOOR_CLASSES, R1, itemCenter, lookOf, AMBIENT } from "./shared.js";

export class EditorPanels {
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
    this._syncBar(); // draws the panel again
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
    this._syncBar();
  }

  /** One undo step for a panel change. */
  _pushUndo(this: Editor) {
    const edit = this.card._edit;
    edit.undo.push(JSON.stringify(this.card._work));
    edit.redo = [];
    edit.dirty = true;
  }

  /** Sets the cards a room shows (room-controls-panel.tsx). One undo step; nothing in 3D changes. */
  setRoomCards(this: Editor, key: string, list: LovelaceCardConfig[]) {
    this._pushUndo();
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

  /* pointer-driven drag from the panel onto the canvas (works with mouse and touch) */
  _dragEntity(this: Editor, id: string, ev0: PointerEvent) {
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
