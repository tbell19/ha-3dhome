/* Selection, the transform gizmo and drags, undo, duplicate, delete and grouping.
 */
import type * as THREE from "three";
import type { Pt, SceneItem } from "../types";
import type { GenericItem } from "../core/items";
import type { EditState } from "../card/card";
import type { Editor } from "./editor";
import { CX, CY, PLAN, R1, ROTATABLE, itemCenter, jclone, mapPts, mean, rotPt, shiftItem } from "./shared";
import { closeSidePanel } from "./side-panels";

export class EditorSelection {
  /* ----- selection ----- */
  _expand(this: Editor, key: string, alone?: boolean) {
    const set = new Set([key]);
    if (alone) return set;
    const it = this.item(key),
      grp = it && !Array.isArray(it) && it.group;
    if (grp)
      for (const k of this._allKeys()) {
        const o = this.item(k);
        if (o && !Array.isArray(o) && o.group === grp) set.add(k);
      }
    for (const k of [...set]) for (const a of this._attached(k)) set.add(a);
    return set;
  }

  /* lights / hotspots that ride along with a fixture (pendant, fan, track, lamps, plant wall, string bulbs) */
  _attached(this: Editor, key: string) {
    const [k] = key.split(":");
    if (k !== "o" && k !== "v") return [];
    const it = this.item(key);
    let test: ((x: number, y: number) => boolean) | null = null;
    const near = (cx: number, cy: number, rad: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) < rad;
    const rot = it.rot || 0,
      c = itemCenter(k, it);
    const w = (x: number, y: number) => (rot ? rotPt(x, y, c[0], c[1], rot) : [x, y]);
    switch (it.type) {
      case "pendant":
      case "floorlamp":
      case "tablelamp": {
        const [x, y] = w(it.x, it.y);
        test = near(x, y, 8);
        break;
      }
      case "fan": {
        const [x, y] = w(it.x, it.y);
        test = near(x, y, (it.r ?? 22) / 2 + 4);
        break;
      }
      default:
        return [];
    }
    const out: string[] = [];
    this._list("l").forEach((L, i) => {
      const p = itemCenter("l", L);
      if (L.fixture !== "string" && test(p[0], p[1])) out.push("l:" + i);
    });
    this._list("h").forEach((H, i) => {
      if (test(H.x, H.y)) out.push("h:" + i);
    });
    return out;
  }

  clickSelect(this: Editor, key: string | null, additive?: boolean, alone?: boolean) {
    if (!key) {
      if (!additive) this._select([]);
      return;
    }
    const set = this._expand(key, alone);
    if (additive) {
      const cur = new Set(this.card._edit.sel),
        has = cur.has(key);
      for (const k of set) has ? cur.delete(k) : cur.add(k);
      this._select([...cur]);
    } else this._select([...set], key);
  }

  _select(this: Editor, keys: string[], primary?: string) {
    const T = this.card.T,
      e = this.card._edit;
    e.sel = new Set(keys.filter((k) => this.item(k)));
    e.primary = primary && e.sel.has(primary) ? primary : [...e.sel][0];
    for (const hp of this.card._helpers || []) {
      this.card._scene.remove(hp);
      hp.dispose?.();
    }
    this.card._helpers = [];
    const groups = new Set([...e.sel].map((k) => this.card._items.get(k)).filter(Boolean));
    for (const g of groups) {
      const hp = new T.BoxHelper(g, 0xf2c76b);
      hp.material.depthTest = false;
      hp.renderOrder = 11;
      this.card._scene.add(hp);
      this.card._helpers.push(hp);
    }
    this._placePivot();
    if (this.card._vsel && !e.sel.has(this.card._vsel.key)) this.card._vsel = null;
    this.paintJoints();
    this.buildRoomHandles();
    this.buildStringHandles();
    if (e.sel.size) {
      closeSidePanel(this, "lookp"); // they sit where the inspector shows
      closeSidePanel(this, "rcp");
    }
    this.renderInspector();
    this._syncBar();
    this.card._requestRender();
  }

  _groupsOfSel(this: Editor) {
    return [...new Set([...this.card._edit.sel].map((k) => this.card._items.get(k)).filter(Boolean))];
  }

  _setMode(this: Editor, m: EditState["mode"]) {
    const e = this.card._edit;
    if (this.card._plan && m === "scale") m = "translate";
    e.mode = m;
    this.card._tc.setMode(m);
    // the floor plan only moves and turns flat; furniture gets all three axes
    this.card._tc.showX = this.card._tc.showZ = !this.card._plan || m === "translate";
    this.card._tc.showY = !this.card._plan || m === "rotate";
    this._placePivot();
  }

  /* rotation of a furniture item as a quaternion: turn (`rot`, clockwise from above) then tilt (`rx`, `rz`), i.e. Ry·Rx·Rz */
  _itemQuat(this: Editor, k: string, it: GenericItem) {
    const T = this.card.T,
      r = Math.PI / 180;
    if (!ROTATABLE.has(k))
      return new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -(this._itemAngle(k, it) || 0) * r);
    return new T.Quaternion().setFromEuler(
      new T.Euler((it.rx || 0) * r, -(Array.isArray(it) ? 0 : it.rot || 0) * r, (it.rz || 0) * r, "YXZ"),
    );
  }

  /* the point a lone item turns and tilts about (the middle of its bounding box), in Three.js coordinates */
  _tiltPivot(this: Editor, key: string) {
    const T = this.card.T,
      g = this.card._items.get(key),
      tc = g?.userData.tc;
    if (!tc) return null;
    return tc
      .clone()
      .applyAxisAngle(new T.Vector3(0, 1, 0), g.rotation.y)
      .add(g.position);
  }

  /* where the gizmo sits and which way it faces. One item: its own middle, and its own axes in Local (and always for
   * Scale, which works along the item's axes). Several: the middle of their bounding box, world axes. */
  _placePivot(this: Editor) {
    const e = this.card._edit,
      T = this.card.T,
      keys = [...e.sel],
      pv = this.card._pivot;
    if (!pv) return;
    pv.scale.set(1, 1, 1);
    pv.quaternion.identity();
    if (!keys.length) {
      this.card._tc?.detach();
      return;
    }
    const one = keys.length === 1,
      k = keys[0][0],
      it = this.item(keys[0]);
    if (this.card._plan) {
      const cs = keys.map((kk) => itemCenter(kk[0], this.item(kk))).filter(Boolean);
      const [cx, cy] = mean(cs),
        cz = cs.reduce((s, c) => s + (c[2] || 0), 0) / cs.length;
      this._pivotC = [cx, cy];
      pv.position.set(cx - CX, cz, cy - CY);
    } else {
      let G = one && ROTATABLE.has(k) ? this._tiltPivot(keys[0]) : null;
      if (G && one && !it.rx && !it.rz) {
        const c = itemCenter(k, it);
        G.x = c[0] - CX;
        G.z = c[1] - CY;
      } // untilted: turn about its own centre
      if (!G) {
        const box = new T.Box3();
        for (const key of keys) {
          const g = this.card._items.get(key);
          if (ROTATABLE.has(key[0]) && g) {
            g.updateMatrixWorld(true);
            box.expandByObject(g);
          } else {
            const c = itemCenter(key[0], this.item(key));
            if (c) box.expandByPoint(new T.Vector3(c[0] - CX, c[2] ?? 0, c[1] - CY));
          }
        }
        G = box.isEmpty() ? new T.Vector3() : box.getCenter(new T.Vector3());
      }
      pv.position.copy(G);
      this._pivotC = one ? ((itemCenter(k, it) || [G.x + CX, G.z + CY]).slice(0, 2) as Pt) : [G.x + CX, G.z + CY];
      if (one && (e.space === "local" || e.mode === "scale")) pv.quaternion.copy(this._itemQuat(k, it));
    }
    this.card._tc?.setSpace(e.space === "local" ? "local" : "world");
    if (this._coarse || this.card._plan) this.card._tc?.detach();
    else this.card._tc?.attach(pv); // plan mode is all direct dragging; the gizmo would sit on top of what you click next
  }

  /* ----- drag (TransformControls gizmo, or dragging the item itself) ----- */
  dragStart(this: Editor, kind: string) {
    const p = this.card._pivot;
    this.card._drag = {
      kind,
      snap: JSON.stringify(this.card._work),
      pos: p.position.clone(),
      quat: p.quaternion.clone(),
      rot: p.rotation.y,
      groups: this._groupsOfSel().map((g) => ({
        g,
        pos: g.position.clone(),
        quat: g.quaternion.clone(),
        scale: g.scale.clone(),
      })),
    };
  }

  _dragDelta(this: Editor) {
    const d = this.card._drag,
      p = this.card._pivot;
    return {
      move: p.position.clone().sub(d.pos),
      dq: p.quaternion.clone().multiply(d.quat.clone().invert()),
      s: p.scale.clone(),
    };
  }

  /* one factor for scaling several items together: whichever axis was pulled furthest */
  _uniform(this: Editor, s: THREE.Vector3) {
    return [s.x, s.y, s.z].reduce((a, b) => (Math.abs(Math.log(b || 1)) > Math.abs(Math.log(a || 1)) ? b : a), 1);
  }

  dragPreview(this: Editor) {
    const d = this.card._drag;
    if (!d) return;
    const { move, dq, s } = this._dragDelta(),
      f = this.card._edit.sel.size > 1 || !ROTATABLE.has(this.card._edit.primary?.[0]) ? this._uniform(s) : 0;
    for (const { g, pos, quat, scale } of d.groups) {
      if (d.kind === "translate") g.position.copy(pos).add(move);
      else if (d.kind === "rotate") {
        g.position.copy(pos).sub(d.pos).applyQuaternion(dq).add(d.pos);
        g.quaternion.copy(dq).multiply(quat);
      } else if (f) {
        g.position.copy(pos).sub(d.pos).multiplyScalar(f).add(d.pos);
        g.scale.copy(scale).multiplyScalar(f);
      } else g.scale.set(scale.x * s.x, scale.y * s.y, scale.z * s.z);
    }
    this.card._requestRender();
  }

  dragEnd(this: Editor) {
    const d = this.card._drag;
    if (!d) return;
    const { move, dq, s } = this._dragDelta(),
      keys = [...this.card._edit.sel];
    this.card._drag = null;
    const moved =
      d.kind === "translate"
        ? move.length() > 0.01
        : d.kind === "rotate"
          ? Math.abs(dq.w) < 0.9999999
          : [s.x, s.y, s.z].some((v) => Math.abs(v - 1) > 1e-3);
    if (!moved) {
      this._placePivot();
      return;
    }
    this.card._edit.undo.push(d.snap);
    this.card._edit.redo = [];
    if (d.kind === "translate") this._applyMove(keys, move.x, move.z, move.y);
    else if (d.kind === "rotate") this._applyRotQ(keys, dq, d.pos);
    else if (keys.length > 1 || !ROTATABLE.has(keys[0][0])) {
      const f = this._uniform(s);
      this._scaleSel(keys, f, f, f);
    } else this._scaleSel(keys, s.x, s.z, s.y); // the gizmo's own axes: x across, z front to back, y up
    if (this.card._edit.snap && d.kind === "translate")
      for (const k of this.card._edit.sel) if (k[0] === "n") this._fitOpening(this.item(k) as SceneItem);
    this.commit();
  }

  /* turn the selection by the quaternion dq about G (Three.js coordinates). A turn about the vertical alone goes through
   * _applyRotate, as before; a tilt also moves each item so it swings round G as one rigid group. */
  _applyRotQ(this: Editor, keys: string[], dq: THREE.Quaternion, G: THREE.Vector3) {
    const T = this.card.T,
      r = Math.PI / 180,
      up = new T.Vector3(0, 1, 0),
      e = new T.Euler().setFromQuaternion(dq, "YXZ");
    if (Math.abs(e.x) < 1e-5 && Math.abs(e.z) < 1e-5) return this._applyRotate(keys, -e.y / r, [G.x + CX, G.z + CY]);
    const ang = (v: number, half?: boolean) => {
      v = R1((((v / r) % 360) + 360) % 360);
      if (v >= 359.95) v = 0;
      return half && v > 180 ? R1(v - 360) : v;
    };
    for (const key of keys) {
      const k = key[0];
      let it = this.item(key);
      if (!it) continue;
      const c = itemCenter(k, it);
      if (!c) continue;
      if (ROTATABLE.has(k)) {
        it = this._setBoxObj(key);
        const tc = this.card._items.get(key)?.userData.tc || new T.Vector3(),
          O = new T.Vector3(c[0] - CX, 0, c[1] - CY);
        const P = tc
            .clone()
            .applyAxisAngle(up, -(it.rot || 0) * r)
            .add(O),
          P2 = P.clone().sub(G).applyQuaternion(dq).add(G);
        const q = this._itemQuat(k, it).premultiply(dq),
          eu = new T.Euler().setFromQuaternion(q, "YXZ");
        const O2 = P2.clone().sub(tc.clone().applyAxisAngle(up, eu.y));
        shiftItem(k, it, O2.x - O.x, O2.z - O.z, P2.y - P.y);
        it.rot = ang(-eu.y);
        it.rx = ang(eu.x, true);
        it.rz = ang(eu.z, true);
        for (const f of ["rot", "rx", "rz"]) if (!it[f]) delete it[f];
      } else {
        // a light, badge, hotspot or door: its point swings round G, and a string or a beam turns with the group
        const P = new T.Vector3(c[0] - CX, c[2] ?? 0, c[1] - CY),
          P2 = P.clone().sub(G).applyQuaternion(dq).add(G),
          yaw = -e.y / r;
        mapPts(it, (x, y) => {
          const [a, b] = rotPt(x, y, c[0], c[1], yaw);
          return [a + P2.x - P.x, b + P2.z - P.z];
        });
        if (PLAN.has(k)) continue;
        it.z = R1(Math.max(0, P2.y));
      }
    }
  }

  _applyMove(this: Editor, keys: string[], dx: number, dy: number, dz = 0) {
    for (const key of keys) {
      const k = key[0],
        it = this.item(key);
      if (!it) continue;
      if (ROTATABLE.has(k)) {
        shiftItem(k, it, dx, dy, dz);
        continue;
      }
      mapPts(it, (x, y) => [x + dx, y + dy]);
      if (dz) it.z = R1(Math.max(0, itemCenter(k, it)[2] + dz));
    }
  }

  _applyRotate(this: Editor, keys: string[], deg: number, pivot: Pt) {
    const [px, py] = pivot;
    for (const key of keys) {
      const k = key[0];
      let it = this.item(key);
      if (!it) continue;
      if (ROTATABLE.has(k)) {
        const c = itemCenter(k, it);
        if (!c) continue;
        const [nx, ny] = rotPt(c[0], c[1], px, py, deg);
        shiftItem(k, it, nx - c[0], ny - c[1]);
        it = this._setBoxObj(key);
        it.rot = R1(((((it.rot || 0) + deg) % 360) + 360) % 360);
        if (!it.rot) delete it.rot;
      } else mapPts(it, (x, y) => rotPt(x, y, px, py, deg));
    }
  }

  /** change the config being edited: `fn` makes the change and may return the keys to select afterwards */
  _mutate(this: Editor, fn: () => string[] | void) {
    this.card._edit.undo.push(JSON.stringify(this.card._work));
    this.card._edit.redo = [];
    const keys = fn() || undefined;
    this.commit(keys);
  }

  commit(this: Editor, keys?: string[]) {
    this.card._edit.dirty = true;
    const sel = keys || [...this.card._edit.sel],
      primary = this.card._edit.primary;
    this.card._rebuild();
    this._select(sel, primary);
  }

  _undo(this: Editor, redo?: boolean) {
    const e = this.card._edit,
      from = redo ? e.redo : e.undo,
      to = redo ? e.undo : e.redo;
    if (!from.length) return;
    to.push(JSON.stringify(this.card._work));
    this.card._work = JSON.parse(from.pop());
    e.dirty = true;
    this.card._rebuild();
    this._select([...e.sel], e.primary);
  }

  /* ----- commands ----- */
  _target(this: Editor) {
    const t = this.card._controls.target;
    return [R1(t.x + CX), R1(t.z + CY)];
  }

  _push(this: Editor, k: string, item: GenericItem) {
    const l = this._list(k, true);
    l.push(item);
    return k + ":" + (l.length - 1);
  }

  _duplicate(this: Editor) {
    if (!this.card._edit.sel.size) return;
    this._mutate(() => {
      const rename: Record<string, string> = {},
        out: string[] = [];
      for (const key of this.card._edit.sel) {
        const k = key[0],
          it = jclone(this.item(key));
        if (!Array.isArray(it) && it.group)
          it.group = rename[it.group] ||= it.group.replace(/_\d+$/, "") + "_" + Math.random().toString(36).slice(2, 6);
        if (ROTATABLE.has(k)) shiftItem(k, it, 12, 12);
        else mapPts(it, (x, y) => [x + 12, y + 12]);
        out.push(this._push(k, it));
      }
      this.card._toast(`Duplicated ${out.length} item${out.length > 1 ? "s" : ""}`);
      return out;
    });
  }

  _delete(this: Editor) {
    if (!this.card._edit.sel.size) return;
    this._mutate(() => {
      const by: Record<string, number[]> = {};
      for (const key of this.card._edit.sel) {
        const [k, i] = key.split(":");
        (by[k] ||= []).push(+i);
      }
      for (const [k, idx] of Object.entries(by)) {
        const l = this._list(k);
        idx.sort((a, b) => b - a).forEach((i) => l.splice(i, 1));
      }
      return [];
    });
  }

  _group(this: Editor, on?: boolean) {
    const keys = [...this.card._edit.sel];
    if (!keys.length) return;
    this._mutate(() => {
      const name = "g_" + Math.random().toString(36).slice(2, 7);
      for (const key of keys) {
        const it = this._setBoxObj(key);
        if (on) it.group = name;
        else delete it.group;
      }
      this.card._toast(
        on ? `Grouped ${keys.length} items — click selects the whole group (Alt-click picks one piece)` : "Ungrouped",
      );
      return keys;
    });
  }

  /* ----- add panel: any HA entity, drag onto the map ----- */
  _placedEntities(this: Editor) {
    const w = this.card._work,
      out = new Set<string>();
    for (const n of ["lights", "hotspots", "chips", "doors"])
      for (const it of (w as Record<string, GenericItem[]>)[n] || [])
        [it.entity, it.climate, it.temperature, it.humidity].forEach((e) => e && out.add(e));
    for (const o of w.scene?.objects || []) if (o.entity) out.add(o.entity);
    return out;
  }
}
