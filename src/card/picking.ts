/* Picking: tap and click targets, hover, and what happens when an entity is tapped.
 */
import type * as THREE from "three";
import type { LightConfig, Pt, WallEnd } from "../types";
import type { Home3DCard } from "./card";
import { CX, CY } from "../core/constants";
import { round1, polyArea } from "../core/util";
import { TOGGLE_DOMAINS } from "../core/entities";
import { PLAN, itemCenter } from "../core/items";
import { stringLen, stringCount, spanSag } from "../core/fixtures";
import { segDir } from "../core/plan-geometry";

/** What a tap target does: stored in the target mesh's userData. */
interface TapTarget {
  entity: string;
  action: string; // "toggle", "more-info", …
}

type HandleType = "spt" | "smid" | "vert" | "mid" | "joint";
/** One wall end: the wall's index in scene.wall_segs and which end. */

/** A drag handle under the pointer. `d` is the handle mesh's userData[type]: an item key and point index for string
 * light points and room corners, or the wall ends meeting at a joint. */
interface Handle {
  type: HandleType;
  d: { key?: string; k?: number; m?: WallEnd[] };
}

interface CamSnap {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  zoom: number;
}

/** One press on the canvas, from pointerdown to the last pointerup. */
interface PointerPress {
  x: number; // where it started (client px)
  y: number;
  moved?: boolean; // went past the drag threshold
  /* viewing */
  hit?: TapTarget | null; // the tap target pressed
  held?: boolean; // a long press, which already opened more-info
  /* editing */
  edit?: boolean;
  touch?: boolean;
  cam?: CamSnap; // the camera when the press started, restored once a drag begins
  tool?: boolean; // a plan tool other than select is active: acts on click
  cancelled?: boolean; // a second finger took over
  key?: string | null; // the item a drag would move
  dragging?: boolean; // an item drag is under way
  prevMode?: string;
  rot?: boolean; // the drag turns rather than moves
  piv0?: THREE.Vector3; // the selection pivot at drag start
  p0?: THREE.Vector3 | null; // the floor point at drag start
  handle?: Handle | null; // the handle a drag would move
  jdrag?: boolean; // a handle drag is under way
  snap0?: string; // the config at handle drag start (JSON), for undo
  m?: WallEnd[]; // joint drag: the wall ends that follow
  vert?: { key: string; k: number } | null; // room corner drag
  spt?: { key: string; k: number } | null; // string light point drag
}

export class PickingPart {
  /* ---------- picking ---------- */
  _keyGroup(this: Home3DCard, key: string) {
    if (!this._items.has(key)) {
      const g = new this.T.Group();
      g.userData.key = key;
      this._world.add(g);
      this._items.set(key, g);
    }
    return this._items.get(key);
  }

  _buildTargets(this: Home3DCard) {
    const T = this.T;
    const cfg = this._cfg();
    const editing = !!this._edit;
    this._targets = [];
    const addTarget = (key: string, x: number, y: number, z: number, r: number, entity: string, action: string) => {
      const m = new T.Mesh(
        new T.SphereGeometry(Math.max(r, 3) * 0.9, 8, 6),
        new T.MeshBasicMaterial({ visible: false }),
      );
      m.position.set(x - CX, z, y - CY);
      m.userData = { entity, action };
      this._keyGroup(key).add(m);
      this._targets.push(m);
    };
    /* string lights: a tap anywhere along the cord toggles them, so the target is a tube that follows each sagging span */
    const stringTarget = (key: string, L: LightConfig) => {
      const pts = L.points!;
      const z = L.z ?? (L.fixture === "string" ? 40 : 20);
      const r = Math.max(3, (L.hit ?? 10) * 0.6);
      const mat = new T.MeshBasicMaterial({ visible: false });
      const up = new T.Vector3(0, 1, 0);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const sag = spanSag(L, Math.hypot(b[0] - a[0], b[1] - a[1])) + 2; // bulbs hang ~2 below the cord
        const at = (t: number) =>
          new T.Vector3(a[0] + (b[0] - a[0]) * t - CX, z - sag * 4 * t * (1 - t), a[1] + (b[1] - a[1]) * t - CY);
        for (let k = 0; k < 6; k++) {
          const p = at(k / 6);
          const q = at((k + 1) / 6);
          const len = p.distanceTo(q);
          if (len < 0.01) continue;
          const m = new T.Mesh(new T.CapsuleGeometry(r, len, 2, 6), mat);
          m.position.copy(p).add(q).multiplyScalar(0.5);
          m.quaternion.setFromUnitVectors(up, q.clone().sub(p).normalize());
          m.userData = { entity: L.entity, action: L.tap || "toggle" };
          this._keyGroup(key).add(m);
          this._targets.push(m);
        }
      }
    };
    const marker = (key: string, p: number[], color: number) => {
      const m = new T.Mesh(
        new T.SphereGeometry(2.4, 12, 8),
        new T.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }),
      );
      m.renderOrder = 10;
      m.position.set(p[0] - CX, p[2], p[1] - CY);
      m.userData.key = key;
      this._keyGroup(key).add(m);
    };
    (cfg.lights || []).forEach((L, i) => {
      if (editing) {
        marker("l:" + i, itemCenter("l", L), 0xffd166);
        return;
      }
      if (L.hit === 0) return;
      if (L.points?.length >= 2) {
        stringTarget("l:" + i, L);
        if (L.hx == null) return;
      }
      const [x, y, z] =
        L.hx != null ? [L.hx, L.hy, L.hz ?? 0] : [L.x ?? L.points[0][0], L.y ?? L.points[0][1], L.z ?? 20];
      addTarget("l:" + i, x, y, z, L.hit ?? 10, L.entity, L.tap || "toggle");
    });
    (cfg.hotspots || []).forEach((H, i) => {
      if (editing) marker("h:" + i, [H.x, H.y, H.z ?? 10], 0x5aa9ff);
      else addTarget("h:" + i, H.x, H.y, H.z ?? 10, H.hit ?? 12, H.entity, H.tap || "more-info");
    });
    if (!editing)
      for (const sc of this._screens || []) {
        sc.mesh.userData = { entity: sc.o.entity, action: sc.o.tap || "more-info" };
        this._targets.push(sc.mesh);
      }
    if (editing) {
      (cfg.chips || []).forEach((c, i) => marker("c:" + i, [c.x, c.y, c.z ?? 50], 0x6fd39a));
      (cfg.doors || []).forEach((d, i) => marker("d:" + i, [d.x, d.y, d.z ?? 22], 0xef6b5b));
    }
  }

  /** Pointer handling on the canvas. Viewing: tap toggles or opens an entity, hold opens more-info. Editing: press and
   * drag moves the selection or a handle, click selects, and plan tools act on click. */
  _bindPicking(this: Home3DCard) {
    const T = this.T;
    const el = this._renderer.domElement;
    const ray = new T.Raycaster();
    const v = new T.Vector2();
    const ptrs = new Set<number>(); // pointers currently down (more than one = pinch)
    let down: PointerPress | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    /* ----- ray casts ----- */
    const setRay = (ev: PointerEvent) => {
      const r = el.getBoundingClientRect();
      v.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, this._cam);
    };
    /** the tap target under the pointer (viewing) */
    const pick = (ev: PointerEvent): TapTarget | undefined => {
      setRay(ev);
      return ray.intersectObjects(this._targets, false)[0]?.object.userData as TapTarget | undefined;
    };
    /* every editable item under the pointer, nearest first. Furniture mode ignores walls/openings/blueprint/rooms;
     * plan mode ignores everything else. Clicking the same spot again steps through this list (plan mode). */
    const pickKeys = (ev: PointerEvent): string[] => {
      setRay(ev);
      const out: string[] = [];
      for (const hit of ray.intersectObject(this._world, true)) {
        const o = hit.object;
        if ((o as THREE.Sprite).isSprite || o.userData.joint || o.userData.vert || o.userData.mid) continue;
        if (o.userData.wall && !this._plan) continue;
        let key: string | null = null;
        for (let p: THREE.Object3D | null = o; p && p !== this._world; p = p.parent)
          if (p.userData.key) {
            key = p.userData.key;
            break;
          }
        if (key) {
          const isPlan = PLAN.has(key[0]);
          if (this._plan ? !isPlan || o.userData.locked : isPlan) continue;
          if (!out.includes(key)) out.push(key);
          if (!this._plan) break;
        } else if (o.userData.floor) break;
      }
      return this._plan ? [...out.filter((k) => k[0] === "n"), ...out.filter((k) => k[0] !== "n")] : out; // doors and windows sit inside walls: offer them first
    };
    const pickKey = (ev: PointerEvent) => pickKeys(ev)[0] || null;
    /* handles: a selected string light's points and span midpoints; in plan mode the selected room's corners, then its
     * edge midpoints, then wall joints */
    const pickHandle = (ev: PointerEvent): Handle | null => {
      setRay(ev);
      const kinds: [THREE.Mesh[] | null, HandleType][] = [
        [this._sptMeshes, "spt"],
        [this._smidMeshes, "smid"],
        [this._vertMeshes, "vert"],
        [this._midMeshes, "mid"],
        [this._jointMeshes, "joint"],
      ];
      for (const [arr, type] of kinds) {
        if (!arr?.length) continue;
        const h = ray.intersectObjects(arr, false)[0];
        if (h) return { type, d: h.object.userData[type] };
      }
      return null;
    };
    /** where the pointer ray meets the horizontal plane at height y (Three.js units) */
    const floorPoint = (ev: PointerEvent, y: number) => {
      setRay(ev);
      return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -y), new T.Vector3());
    };
    /** the plan point under the pointer, on the floor */
    const planPt = (ev: PointerEvent): Pt | null => {
      const p = floorPoint(ev, 0);
      return p ? [p.x + CX, p.z + CY] : null;
    };

    /* ----- camera ----- */
    const camSnap = (): CamSnap => ({
      pos: this._cam.position.clone(),
      target: this._controls.target.clone(),
      zoom: this._cam.zoom,
    });
    /** put the camera back where the press started (the controls may already have panned a little) */
    const camRestore = (c: CamSnap) => {
      const oc = this._controls;
      const damp = oc.enableDamping;
      oc.enableDamping = false;
      oc.update(); // flush any pan/orbit that already started
      this._cam.position.copy(c.pos);
      oc.target.copy(c.target);
      this._cam.zoom = c.zoom;
      this._cam.updateProjectionMatrix();
      oc.update();
      oc.enableDamping = damp;
    };

    /* ----- editing: selecting ----- */
    /* click without dragging: in plan mode a repeat click on the same spot selects the next thing underneath */
    const clickPick = (ev: PointerEvent, extra: string[] = []) => {
      const keys = [...pickKeys(ev)];
      for (const k of extra) if (!keys.includes(k)) keys.push(k);
      const add = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      if (!this._plan || add) return this._editor.clickSelect(keys[0] || null, add, ev.altKey);
      const i = keys.indexOf(this._edit!.primary);
      this._editor.clickSelect(keys.length ? keys[(i + 1) % keys.length] : null, false, true);
      if (keys.length > 1 && i < 0 && !this._cycleHinted) {
        this._cycleHinted = true;
        this._toast("Several things here — click again to pick the next one underneath");
      }
    };
    /** a second finger arrived: put things back and hand over to the camera */
    const cancelDrag = () => {
      if (down?.dragging && this._drag) {
        this._pivot.position.copy(down.piv0!);
        this._pivot.quaternion.copy(this._drag.quat);
        this._editor.dragPreview();
        this._drag = null;
      }
      if (down?.jdrag) {
        this._work = JSON.parse(down.snap0!);
        if (down.spt) this._editor.commit();
        else this._editor.rebuildPlan();
        this._editor.hideTip();
      }
      if (down) {
        down.key = null;
        down.handle = null;
        down.vert = down.spt = null;
        down.dragging = down.jdrag = false;
        down.cancelled = true;
      }
      this._controls.enabled = true;
    };

    /* ----- pointer down ----- */
    const editPress = (ev: PointerEvent) => {
      if (ptrs.size > 1) {
        cancelDrag();
        return;
      }
      const edit = this._edit!;
      const press: PointerPress = (down = {
        x: ev.clientX,
        y: ev.clientY,
        edit: true,
        touch: ev.pointerType !== "mouse",
        cam: camSnap(),
      });
      this._tcUsed = false;
      if (this._plan && this._tool !== "select") {
        press.tool = true; // drawing / placing: acts on click
        return;
      }
      const modifier = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      // a string light's handles win over the move gizmo (its arrows often point straight at them)
      if (this._sptMeshes?.length && ev.button === 0 && !modifier) {
        const h = pickHandle(ev);
        if (h?.type === "spt" || h?.type === "smid") {
          press.handle = h;
          ev.stopImmediatePropagation();
          return;
        }
      }
      // press on furniture / a marker can drag it — with a mouse anything, on touch only what's already selected
      if (ev.button !== 0 || modifier || this._tc?.axis) return;
      if (this._plan || this._sptMeshes?.length) {
        const h = pickHandle(ev);
        if (h && (h.type !== "joint" || !press.touch || h.d.m!.some(([i]) => edit.sel.has("w:" + i)))) {
          press.handle = h;
          return;
        }
      }
      const keys = pickKeys(ev);
      const key = keys.find((k) => edit.sel.has(k)) || keys[0];
      // rooms cover most of the plan, so they only drag once selected (otherwise a drag pans)
      if (key && ((!press.touch && key[0] !== "r") || edit.sel.has(key))) press.key = key;
    };
    const viewPress = (ev: PointerEvent) => {
      const press: PointerPress = (down = { x: ev.clientX, y: ev.clientY, hit: pick(ev), held: false });
      if (press.hit)
        timer = setTimeout(() => {
          if (down) {
            down.held = true;
            this._moreInfo(down.hit!.entity);
          }
        }, 500);
    };
    el.addEventListener(
      "pointerdown",
      (ev) => {
        ptrs.add(ev.pointerId);
        if (this._edit) editPress(ev);
        else viewPress(ev);
      },
      { capture: true },
    ); // capture: runs before the camera controls, so a 2nd finger re-enables them in time

    /* ----- pointer move ----- */
    /** first move of a handle drag: freeze the camera, remember the config for undo, and add a point if it's a midpoint */
    const startHandleDrag = (press: PointerPress, h: Handle) => {
      this._controls.enabled = false;
      camRestore(press.cam!);
      press.jdrag = true;
      press.snap0 = JSON.stringify(this._work);
      for (const hp of this._helpers || []) hp.visible = false;
      if (h.type === "joint") press.m = h.d.m!.map((x) => [...x] as WallEnd);
      else if (h.type === "spt" || h.type === "smid") {
        // string light: move a point, or bend a span by adding one
        const L = this._editor.item(h.d.key!);
        if (h.type === "smid") {
          const a = L.points[h.d.k!];
          const b = L.points[h.d.k! + 1];
          L.points.splice(h.d.k! + 1, 0, [round1((a[0] + b[0]) / 2), round1((a[1] + b[1]) / 2)]);
        }
        press.spt = { key: h.d.key!, k: h.type === "smid" ? h.d.k! + 1 : h.d.k! };
      } else {
        const f = this._editor.item(h.d.key!);
        if (h.type === "mid") {
          const a = f.pts[h.d.k!];
          const b = f.pts[(h.d.k! + 1) % f.pts.length];
          f.pts.splice(h.d.k! + 1, 0, [round1((a[0] + b[0]) / 2), round1((a[1] + b[1]) / 2)]);
        }
        press.vert = { key: h.d.key!, k: h.type === "mid" ? h.d.k! + 1 : h.d.k! };
      }
    };
    /* drag a handle: a wall joint (every wall end at that corner follows), a room corner, or a room edge midpoint (adds a corner) */
    const dragHandle = (ev: PointerEvent, press: PointerPress) => {
      if (!press.jdrag) startHandleDrag(press, press.handle!);
      if (press.spt) {
        const L = this._editor.item(press.spt.key);
        const q = floorPoint(ev, L.z ?? 17);
        if (!q) return;
        let pt: Pt = [q.x + CX, q.z + CY];
        if (this._edit!.snap) pt = [Math.round(pt[0]), Math.round(pt[1])];
        L.points[press.spt.k] = [round1(pt[0]), round1(pt[1])];
        this._refreshFixture(press.spt.key);
        this._editor.buildStringHandles();
        this._editor.showTip(ev, `${this._fmtLen(stringLen(L.points))} · ${stringCount(L)} bulbs`);
        this._requestRender();
        return;
      }
      const p = planPt(ev);
      if (!p) return;
      if (press.vert) {
        const f = this._editor.item(press.vert.key);
        const n = f.pts.length;
        const k = press.vert.k;
        const prev = f.pts[(k - 1 + n) % n];
        const s = this._editor.snapPoint(p, { from: prev, room: press.vert });
        f.pts[k] = [round1(s.p[0]), round1(s.p[1])];
        this._vsel = press.vert;
        this._editor.rebuildPlan();
        this._editor.showMarker(s.p, s.kind);
        this._editor.showTip(ev, this._fmtArea(polyArea(f.pts)));
        return;
      }
      const segs = this._work!.scene!.wall_segs!;
      const m = press.m!;
      const [i0, e0] = m[0];
      const other = segs[i0][e0 === "a" ? "b" : "a"];
      const s = this._editor.snapPoint(p, { from: m.length === 1 ? other : null, exclude: m });
      for (const [i, e] of m) segs[i][e] = [round1(s.p[0]), round1(s.p[1])];
      this._editor.rebuildPlan();
      this._editor.showMarker(s.p, s.kind);
      this._editor.showTip(ev, m.map(([i]) => this._fmtLen(segDir(segs[i])[2])).join(" · "));
    };
    /** first move of an item drag: freeze the camera, select the item if needed, and start the move or turn */
    const startItemDrag = (ev: PointerEvent, press: PointerPress): boolean => {
      this._controls.enabled = false;
      camRestore(press.cam!);
      if (!this._edit!.sel.has(press.key!)) this._editor.clickSelect(press.key!, false, ev.altKey);
      press.prevMode = this._edit!.mode;
      press.rot = press.prevMode === "rotate"; // scale mode drags move things too
      press.piv0 = this._pivot.position.clone();
      press.p0 = floorPoint(ev, press.piv0.y);
      if (!press.p0) {
        press.key = null;
        this._controls.enabled = true;
        return false;
      }
      this._editor.dragStart(press.rot ? "rotate" : "translate");
      press.dragging = true;
      el.style.cursor = "grabbing";
      return true;
    };
    /* drag the selection: move it with the pointer, or in rotate mode turn it around its centre */
    const dragItem = (ev: PointerEvent, press: PointerPress) => {
      if (this._tcDragging) {
        press.key = null;
        return;
      }
      if (!press.dragging && !startItemDrag(ev, press)) return;
      const piv0 = press.piv0!;
      const p0 = press.p0!;
      const p = floorPoint(ev, piv0.y);
      if (!p) return;
      if (press.rot) {
        // rotate mode: turn the selection around its centre as the pointer circles it
        const a0 = Math.atan2(p0.z - piv0.z, p0.x - piv0.x);
        const a1 = Math.atan2(p.z - piv0.z, p.x - piv0.x);
        let dr = -(a1 - a0);
        if (this._edit!.snap) dr = Math.round(dr / (Math.PI / 12)) * (Math.PI / 12);
        this._pivot.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), dr).multiply(this._drag!.quat);
      } else {
        let dx = p.x - p0.x;
        let dz = p.z - p0.z;
        if (this._edit!.snap) {
          dx = Math.round(dx / 2) * 2;
          dz = Math.round(dz / 2) * 2;
        }
        this._pivot.position.set(piv0.x + dx, piv0.y, piv0.z + dz);
      }
      this._editor.dragPreview();
    };
    /** mouse hover with nothing pressed: show what a press would do through the cursor */
    const hover = (ev: PointerEvent) => {
      if (this._edit) {
        if ((this._plan || this._sptMeshes?.length) && pickHandle(ev)) {
          el.style.cursor = "move";
          return;
        }
        const k = pickKey(ev);
        el.style.cursor = k ? (this._edit.sel.has(k) ? "move" : "pointer") : "grab";
      } else el.style.cursor = pick(ev) ? "pointer" : "grab";
    };
    el.addEventListener("pointermove", (ev) => {
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > (down.touch ? 8 : 5)) {
        clearTimeout(timer);
        down.hit = null;
        down.moved = true;
      }
      const dragging = down?.moved && this._edit && ptrs.size === 1;
      if (dragging && down!.handle) return dragHandle(ev, down!);
      if (dragging && down!.key) return dragItem(ev, down!);
      if (this._plan && this._tool !== "select" && (!down || !down.moved) && ev.pointerType === "mouse") {
        this._editor.toolHover(ev, planPt(ev));
        return;
      }
      if (!down && ev.pointerType === "mouse") hover(ev);
    });

    /* ----- pointer up ----- */
    /** the end of an editing press: finish a drag, or treat it as a click */
    const editRelease = (ev: PointerEvent, press: PointerPress) => {
      if (press.jdrag) {
        this._edit!.undo.push(press.snap0!);
        this._edit!.redo = [];
        this._editor.hideTip();
        this._editor.hidePreview();
        this._editor.commit();
      } else if (press.dragging) this._editor.dragEnd();
      else if (!press.moved && !press.cancelled && !this._tcUsed && !this._tcDragging && ev.type === "pointerup") {
        if (press.tool) {
          const p = planPt(ev);
          if (p) this._editor.toolClick(p, pickKey(ev), ev);
        } else if (press.handle?.type === "vert") {
          this._vsel = press.handle.d;
          this._editor.buildRoomHandles();
          this._editor.renderInspector();
          this._requestRender();
        } else if (press.handle?.type === "joint")
          clickPick(
            ev,
            press.handle.d.m!.map(([i]) => "w:" + i),
          );
        else clickPick(ev);
      }
      if (!this._tcDragging) this._controls.enabled = true;
    };
    /** the end of a viewing tap: toggle or open the entity (a hold already opened more-info) */
    const viewRelease = (ev: PointerEvent, press: PointerPress) => {
      const hit = press.hit;
      if (!hit || press.held || ev.type !== "pointerup") return;
      if (hit.action === "toggle") {
        if (!this._offlineTap()) this._hass.callService("homeassistant", "toggle", { entity_id: hit.entity });
      } else this._moreInfo(hit.entity);
    };
    const up = (ev: PointerEvent) => {
      ptrs.delete(ev.pointerId);
      clearTimeout(timer);
      if (down?.edit) {
        if (ptrs.size) return; // wait until the last finger lifts
        editRelease(ev, down);
      } else if (down) viewRelease(ev, down);
      down = null;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", () => {
      if (this._plan && !down) this._editor.hidePreview(true);
    });
  }

  _moreInfo(this: Home3DCard, entityId: string) {
    this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } }));
  }

  /** a tap on this element opens the entity's more-info */
  _bindTap(this: Home3DCard, node: HTMLElement, entity: string | undefined) {
    if (!entity) return;
    node.addEventListener("click", () => this._moreInfo(entity));
  }

  /* badge taps: toggle lights/switches, run scripts/scenes/buttons, otherwise more-info; hold = more-info */
  _bindEntityTap(this: Home3DCard, node: HTMLElement, entity: string, tap: string | undefined) {
    let t: ReturnType<typeof setTimeout> | undefined;
    let held = false;
    node.addEventListener("pointerdown", () => {
      held = false;
      t = setTimeout(() => {
        held = true;
        this._moreInfo(entity);
      }, 500);
    });
    node.addEventListener("pointerleave", () => clearTimeout(t));
    node.addEventListener("pointerup", () => {
      clearTimeout(t);
      if (!held && !this._edit) this._entityAction(entity, tap);
    });
  }

  _entityAction(this: Home3DCard, entity: string, tap: string) {
    const d = entity.split(".")[0];
    const h = this._hass;
    const a =
      tap ||
      (TOGGLE_DOMAINS.has(d)
        ? "toggle"
        : ["script", "scene"].includes(d)
          ? "run"
          : ["button", "input_button"].includes(d)
            ? "press"
            : "more-info");
    if (a !== "more-info" && this._offlineTap()) return;
    if (a === "toggle") h.callService("homeassistant", "toggle", { entity_id: entity });
    else if (a === "run") h.callService(d, "turn_on", { entity_id: entity });
    else if (a === "press") h.callService(d, "press", { entity_id: entity });
    else this._moreInfo(entity);
  }
}
