/* The floor plan editor: drawing walls, rooms and openings, snapping, handles, blueprints and scale.
 */
import type { Pt, SceneItem, WallEnd, WallSeg, Opening } from "../types";
import type { GenericItem } from "../core/items";
import type { Editor } from "./editor";
import { CX, CY, PLAN, R1, ROOM_FILLS, SURFACES, DOOR_STYLES, esc, ic, jclone, polyArea, segDir } from "./shared.js";

/** What snapPoint snaps against: `from` is the previous point (angle snapping), `exclude` the wall ends being dragged,
 * `room` the room corner being dragged. */
export interface SnapOptions {
  from?: Pt | null;
  exclude?: WallEnd[];
  room?: { key?: string; k?: number } | null; // {} snaps to every room corner
}

export class EditorPlan {
  jointMat(this: Editor, sel: boolean) {
    const k = sel ? "__jointSel" : "__joint";
    return (this.card._mats[k] ||= new this.card.T.MeshBasicMaterial({
      color: sel ? 0xf2c76b : 0xffffff,
      depthTest: false,
      transparent: true,
    }));
  }

  paintJoints(this: Editor) {
    if (!this.card._jointMeshes?.length || !this.card._edit) return;
    for (const m of this.card._jointMeshes)
      m.material = this.jointMat(m.userData.joint.m.some(([i]: WallEnd) => this.card._edit.sel.has("w:" + i)));
  }

  /* rebuild only the plan layer (walls, openings, blueprint, joints) — used while dragging a corner */
  rebuildPlan(this: Editor) {
    if (!this.card._wallG) return this.card._rebuild();
    this.card._world.remove(this.card._wallG);
    this.card._disposeTree(this.card._wallG);
    this.card._roomHG = null;
    for (const k of [...this.card._items.keys()]) if (PLAN.has(k[0])) this.card._items.delete(k);
    this.card._buildPlanLayer(this.card._cfg().scene || {});
    this.card._renderer.shadowMap.needsUpdate = true;
    this.card._requestRender();
  }

  applyPlanVis(this: Editor) {
    const hide = !!this.card._plan && !this.card._edit?.showFurn;
    for (const [k, g] of this.card._items) {
      if (PLAN.has(k[0])) continue;
      g.visible = !hide;
    }
  }

  _setPlanMode(this: Editor, on: boolean) {
    if (!this.card._edit || !!this.card._plan === on) return;
    this.card._plan = on;
    this.card._tool = "select";
    this._draw = null;
    this._measure = null;
    this.hidePreview();
    this.card._wrap.classList.toggle("plan", on);
    const top = this.card._sph().phi < 0.3;
    if (on && !top) {
      this._planTopped = true;
      this.card._toggleTop();
    } else if (!on && this._planTopped) {
      this._planTopped = false;
      if (top) this.card._toggleTop();
    }
    this._renderEditorUI();
    this.card._rebuild();
    this._select([]);
    if (on && !this._planHinted) {
      this._planHinted = true;
      this.card._toast(
        this._list("p").length
          ? "Floor plan: drag corners and walls, or draw new ones"
          : "Floor plan: add a blueprint to trace, or start drawing walls",
        4000,
      );
    }
  }

  _setTool(this: Editor, t: string) {
    this.card._tool = t;
    this._draw = t === "wall" ? { start: null, first: null } : t === "room" ? { pts: [] } : null;
    this._measure =
      t === "measure"
        ? { pts: [], bp: this._measure?.bp || (this.card._edit.primary?.[0] === "p" ? this.card._edit.primary : "p:0") }
        : null;
    this.hidePreview();
    if (t !== "select") this._select([]);
    else {
      this.renderInspector();
      this._syncBar();
    }
    this._syncBar();
  }

  /* ----- snapping ----- */
  snapPoint(
    this: Editor,
    p: Pt,
    { from = null, exclude = [], room = null }: SnapOptions = {},
  ): { p: Pt; kind: string } {
    const segs = this.card._work?.scene?.wall_segs || [],
      thr = 10 * this.card._upp();
    const ex = (i: number, e: string) => exclude.some(([j, f]) => j === i && f === e);
    let best: Pt | null = null,
      bd = thr;
    if (room)
      (this.card._work.scene?.floors || []).forEach((f, i) =>
        (f.pts || []).forEach((q: Pt, k: number) => {
          if (room.key === "r:" + i && room.k === k) return;
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d < bd) {
            bd = d;
            best = q;
          }
        }),
      );
    segs.forEach((s, i) => {
      for (const e of ["a", "b"] as const) {
        if (ex(i, e)) continue;
        const d = Math.hypot(s[e][0] - p[0], s[e][1] - p[1]);
        if (d < bd) {
          bd = d;
          best = s[e];
        }
      }
    });
    if (best) return { p: [best[0], best[1]], kind: "joint" };
    let on = null;
    bd = thr;
    segs.forEach((s, i) => {
      if (ex(i, "a") || ex(i, "b")) return;
      const [ux, uy, L] = segDir(s),
        dx = p[0] - s.a[0],
        dy = p[1] - s.a[1],
        t = dx * ux + dy * uy,
        q = Math.abs(-dx * uy + dy * ux);
      if (t > 0 && t < L && q < bd) {
        bd = q;
        on = [R1(s.a[0] + ux * t), R1(s.a[1] + uy * t)];
      }
    });
    if (on) return { p: on, kind: "wall" };
    if (!this.card._edit?.snap) return { p: [R1(p[0]), R1(p[1])], kind: "free" };
    if (from) {
      const dx = p[0] - from[0],
        dy = p[1] - from[1],
        st = Math.PI / 12,
        a = Math.round(Math.atan2(dy, dx) / st) * st,
        L = Math.round(Math.hypot(dx, dy));
      return { p: [R1(from[0] + Math.cos(a) * L), R1(from[1] + Math.sin(a) * L)], kind: "angle" };
    }
    return { p: [Math.round(p[0]), Math.round(p[1])], kind: "grid" };
  }

  /** the index of the wall within thr of p, or null */
  _nearestWall(this: Editor, p: Pt, thr: number): number | null {
    let best: number | null = null,
      bd = thr;
    (this.card._work.scene?.wall_segs || []).forEach((s, i) => {
      const [ux, uy, L] = segDir(s),
        dx = p[0] - s.a[0],
        dy = p[1] - s.a[1],
        t = dx * ux + dy * uy,
        q = Math.abs(-dx * uy + dy * ux);
      if (t >= -2 && t <= L + 2 && q < bd) {
        bd = q;
        best = i;
      }
    });
    return best;
  }

  /* centre an opening on the wall it sits on and turn it to match */
  _fitOpening(this: Editor, o: SceneItem) {
    if (!o) return;
    const i = this._nearestWall([o.x, o.y], 10);
    if (i == null) return;
    const s = this.card._work.scene.wall_segs[i],
      [ux, uy, L] = segDir(s);
    const t = Math.max(0, Math.min(L, (o.x - s.a[0]) * ux + (o.y - s.a[1]) * uy));
    o.x = R1(s.a[0] + ux * t);
    o.y = R1(s.a[1] + uy * t);
    let rot = (Math.atan2(uy, ux) * 180) / Math.PI;
    const cur = o.rot || 0;
    while (rot - cur > 90) rot -= 180;
    while (cur - rot > 90) rot += 180; // keep the side it already faced
    o.rot = R1(((rot % 360) + 360) % 360);
    if (!o.rot) delete o.rot;
    o.d = R1(Math.max(o.d ?? 0, (s.t ?? this.card._work.scene.wall_thickness ?? 4) + 2));
  }

  /* ----- drawing / placing tools ----- */
  toolHover(this: Editor, ev: PointerEvent, p: Pt | null) {
    if (!p) return;
    const thr = 14 * this.card._upp() + 4;
    if (this.card._tool === "wall") {
      const d = this._draw,
        s = this.snapPoint(p, { from: d?.start });
      this.showMarker(s.p, s.kind);
      if (d?.start) {
        this._showPreview(d.start, s.p, "wall");
        this.showTip(ev, this.card._fmtLen(Math.hypot(s.p[0] - d.start[0], s.p[1] - d.start[1])));
      }
    } else if (this.card._tool === "measure") {
      const m = this._measure;
      this.showMarker(p, "free");
      if (m?.pts.length === 1) {
        this._showPreview(m.pts[0], p, "measure");
        this.showTip(ev, this.card._fmtLen(Math.hypot(p[0] - m.pts[0][0], p[1] - m.pts[0][1])));
      }
    } else if (this.card._tool === "room") {
      const d = this._draw,
        last = d.pts.at(-1),
        s = this.snapPoint(p, { from: last, room: {} });
      const closing =
        d.pts.length >= 3 &&
        Math.hypot(s.p[0] - d.pts[0][0], s.p[1] - d.pts[0][1]) < Math.max(10 * this.card._upp(), 0.6);
      this.showMarker(closing ? d.pts[0] : s.p, closing ? "joint" : s.kind);
      if (d.pts.length) {
        this._showRoomPreview([...d.pts, closing ? d.pts[0] : s.p]);
        this.showTip(
          ev,
          closing ? "Click to close the room" : this.card._fmtLen(Math.hypot(s.p[0] - last[0], s.p[1] - last[1])),
        );
      }
    } else if (this.card._tool === "door" || this.card._tool === "window") {
      const i = this._nearestWall(p, thr);
      if (i == null) {
        this.hidePreview(true);
        return;
      }
      const s = this.card._work.scene.wall_segs[i],
        [ux, uy, L] = segDir(s),
        t = Math.max(0, Math.min(L, (p[0] - s.a[0]) * ux + (p[1] - s.a[1]) * uy));
      this.showMarker([s.a[0] + ux * t, s.a[1] + uy * t], "wall");
    }
  }

  toolClick(this: Editor, p: Pt, key: string | null, ev: PointerEvent) {
    const sc = (this.card._work.scene ||= {});
    if (this.card._tool === "wall") {
      const d = this._draw,
        s = this.snapPoint(p, { from: d.start });
      if (!d.start) {
        d.start = s.p;
        d.first = s.p;
        this.showMarker(s.p, s.kind);
        this.renderInspector();
        return;
      }
      if (Math.hypot(s.p[0] - d.start[0], s.p[1] - d.start[1]) < 1) {
        this._setTool("wall");
        this.card._toast("Wall finished — click to start another");
        return;
      }
      const a = d.start,
        b = s.p,
        closed = Math.hypot(b[0] - d.first[0], b[1] - d.first[1]) < 0.6;
      this._mutate(() => [this._push("w", { a: [R1(a[0]), R1(a[1])], b: [R1(b[0]), R1(b[1])] })]);
      if (closed) {
        this._setTool("wall");
        this.card._toast("Closed the loop");
      } else {
        d.start = b;
        this._showPreview(b, b, "wall");
      }
      return;
    }
    if (this.card._tool === "room") {
      const d = this._draw,
        last = d.pts.at(-1),
        s = this.snapPoint(p, { from: last, room: {} });
      if (
        d.pts.length >= 3 &&
        (Math.hypot(s.p[0] - d.pts[0][0], s.p[1] - d.pts[0][1]) < Math.max(10 * this.card._upp(), 0.6) ||
          Math.hypot(s.p[0] - last[0], s.p[1] - last[1]) < 1)
      )
        return this._finishRoom();
      if (last && Math.hypot(s.p[0] - last[0], s.p[1] - last[1]) < 1) return;
      d.pts.push([R1(s.p[0]), R1(s.p[1])]);
      this._showRoomPreview(d.pts);
      this.showMarker(s.p, s.kind);
      this.renderInspector();
      return;
    }
    if (this.card._tool === "door" || this.card._tool === "window") {
      const kind = this.card._tool,
        wi = key?.[0] === "w" ? +key.split(":")[1] : this._nearestWall(p, 14 * this.card._upp() + 4);
      if (wi == null) return this.card._toast(`Click on a wall to put the ${kind} in`);
      const s = sc.wall_segs[wi],
        [ux, uy, L] = segDir(s),
        t = Math.max(0, Math.min(L, (p[0] - s.a[0]) * ux + (p[1] - s.a[1]) * uy));
      const [sxy, sz] = this.card._modelScale(),
        H = sc.wall_height ?? 46,
        LIN = sc.lintel ?? 8,
        wh = s.h ?? H,
        wt = s.t ?? sc.wall_thickness ?? 4;
      const o: GenericItem =
        kind === "door"
          ? { kind, style: "panel", w: R1(80 / sxy), h: R1(Math.max(4, Math.min(wh, H - LIN))), z: 0 }
          : { kind, w: R1(100 / sxy), z: R1(Math.min(90 / sz, wh * 0.4)), h: 0 };
      if (kind === "window") o.h = R1(Math.max(4, Math.min(120 / sz, H - LIN - o.z)));
      Object.assign(o, { x: R1(s.a[0] + ux * t), y: R1(s.a[1] + uy * t), d: R1(wt + 2) });
      const rot = R1(((((Math.atan2(uy, ux) * 180) / Math.PI) % 360) + 360) % 360);
      if (rot) o.rot = rot;
      this._setTool("select");
      this._mutate(() => [this._push("n", o)]);
      this.card._toast(`Added a ${kind} — drag it along the wall, or set its size in the panel`);
      return;
    }
    if (this.card._tool === "measure") {
      const m = this._measure;
      m.pts.push(p);
      if (m.pts.length === 2) {
        this._showPreview(m.pts[0], m.pts[1], "measure");
        this.hideTip();
        this.renderInspector();
      } else this.showMarker(p, "free");
    }
  }

  _ensurePreview(this: Editor) {
    if (this._prevMesh) return;
    const T = this.card.T;
    this._prevMesh = new T.Mesh(
      new T.BoxGeometry(1, 1, 1),
      new T.MeshBasicMaterial({ color: 0xf2c76b, transparent: true, opacity: 0.6, depthTest: false }),
    );
    this._prevMesh.renderOrder = 12;
    this._prevDot = new T.Mesh(
      new T.SphereGeometry(1, 14, 10),
      new T.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
    );
    this._prevDot.renderOrder = 14;
    this.card._scene.add(this._prevMesh, this._prevDot);
  }

  _showPreview(this: Editor, a: Pt, b: Pt, kind: string) {
    this._ensurePreview();
    const sc = this.card._cfg().scene || {},
      m = this._prevMesh,
      L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const wall = kind === "wall",
      h = wall ? (sc.wall_height ?? 46) : 0.6,
      t = wall ? (sc.wall_thickness ?? 4) : 1.2 * 2 * this.card._upp();
    m.material.color.set(wall ? 0xf2c76b : 0x4ea3ff);
    m.scale.set(Math.max(L, 0.01), h, Math.max(t, 0.6));
    m.position.set((a[0] + b[0]) / 2 - CX, wall ? h / 2 : 1, (a[1] + b[1]) / 2 - CY);
    m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    m.visible = true;
    this.card._requestRender();
  }

  showMarker(this: Editor, p: Pt, kind: string) {
    this._ensurePreview();
    const d = this._prevDot;
    d.material.color.set(kind === "joint" ? 0x6fd39a : kind === "wall" ? 0x4ea3ff : 0xffffff);
    d.position.set(p[0] - CX, (this.card._cfg().scene?.wall_height ?? 46) + 1, p[1] - CY);
    d.visible = true;
    this.card._scaleHandles();
    this.card._requestRender();
  }

  _showRoomPreview(this: Editor, pts: Pt[]) {
    const T = this.card.T;
    if (!this._prevLine) {
      this._prevLine = new T.Line(
        new T.BufferGeometry(),
        new T.LineBasicMaterial({ color: 0xf2c76b, depthTest: false, transparent: true }),
      );
      this._prevLine.renderOrder = 13;
      this.card._scene.add(this._prevLine);
    }
    this._prevLine.geometry.dispose();
    this._prevLine.geometry = new T.BufferGeometry().setFromPoints(
      pts.map((q: Pt) => new T.Vector3(q[0] - CX, 1.5, q[1] - CY)),
    );
    this._prevLine.visible = true;
    this.card._requestRender();
  }

  /** keeps the snap marker a few pixels across at any zoom (u = world units per pixel) */
  scalePreview(this: Editor, u: number) {
    this._prevDot?.scale.setScalar(4 * u);
  }

  hidePreview(this: Editor, keepLine?: boolean) {
    if (this._prevLine && !keepLine) this._prevLine.visible = false;
    if (this._prevDot) this._prevDot.visible = false;
    if (this._prevMesh && !keepLine) this._prevMesh.visible = false;
    this.hideTip();
    this.card._requestRender();
  }

  disposePreview(this: Editor) {
    for (const m of [this._prevMesh, this._prevDot, this._prevLine])
      if (m) {
        this.card._scene?.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
    this._prevMesh = this._prevDot = this._prevLine = null;
    this.hideTip();
  }

  showTip(this: Editor, ev: MouseEvent, text: string) {
    if (!this.card._ed) return;
    let t = this.card._ed.querySelector<HTMLElement>(".tip");
    if (!t) {
      t = document.createElement("div");
      t.className = "tip";
      this.card._ed.append(t);
    }
    const r = this.card._wrap.getBoundingClientRect();
    t.textContent = text;
    t.style.left = ev.clientX - r.left + "px";
    t.style.top = ev.clientY - r.top + "px";
    t.style.display = "";
  }

  hideTip(this: Editor) {
    const t = this.card._ed?.querySelector<HTMLElement>(".tip");
    if (t) t.style.display = "none";
  }

  /* ----- rooms (scene.floors) ----- */
  _finishRoom(this: Editor) {
    const pts = this._draw?.pts || [];
    if (pts.length < 3) return;
    const floors = (this.card._work.scene.floors ||= []);
    const used = new Set(floors.map((f) => f.name));
    let n = floors.length + 1;
    while (used.has("room_" + n)) n++;
    this._setTool("select");
    this._mutate(() => {
      const rug = floors.findIndex((f) => f.name === "rug"),
        f = { name: "room_" + n, fill: ROOM_FILLS[floors.length % ROOM_FILLS.length], pts };
      if (rug >= 0) {
        floors.splice(rug, 0, f);
        return ["r:" + rug];
      } // keep rugs drawn on top
      return [this._push("r", f)];
    });
    this.card._toast("Room added — name it in the panel");
    setTimeout(() => {
      const i = this.card._ed.querySelector<HTMLInputElement>('.insp input[data-p="name"]');
      i?.focus();
      i?.select();
    }, 50);
  }

  /* a selected string light: a dot on every point (drag to move it; the ends stretch the string) and a smaller dot
   * mid-span (drag to bend it there) */
  buildStringHandles(this: Editor) {
    const T = this.card.T;
    if (this.card._strHG) {
      this.card._strHG.parent?.remove(this.card._strHG);
      this.card._disposeTree(this.card._strHG);
      this.card._strHG = null;
    }
    this.card._sptMeshes = [];
    this.card._smidMeshes = [];
    const key = this.card._edit?.primary,
      L = key?.[0] === "l" && this.item(key);
    if (!L?.points?.length || this.card._plan || this.card._edit.sel.size !== 1) return;
    this.card._strHG = new T.Group();
    this.card._world.add(this.card._strHG);
    const mat = (k: string, c: number, o = 1) =>
      (this.card._mats["__h" + k] ||= new T.MeshBasicMaterial({
        color: c,
        depthTest: false,
        transparent: true,
        opacity: o,
      }));
    const geo = new T.SphereGeometry(1, 12, 8),
      z = L.z ?? 17,
      n = L.points.length;
    L.points.forEach((q: Pt, k: number) => {
      const v = new T.Mesh(geo, mat("spt", 0xffd166));
      v.position.set(q[0] - CX, z, q[1] - CY);
      v.renderOrder = 15;
      v.userData.spt = { key, k };
      this.card._strHG.add(v);
      this.card._sptMeshes.push(v);
      if (k < n - 1) {
        const r = L.points[k + 1],
          m = new T.Mesh(geo, mat("mid", 0xffffff, 0.7));
        m.position.set((q[0] + r[0]) / 2 - CX, z, (q[1] + r[1]) / 2 - CY);
        m.renderOrder = 14;
        m.userData.smid = { key, k };
        this.card._strHG.add(m);
        this.card._smidMeshes.push(m);
      }
    });
    this.card._scaleHandles();
  }

  buildRoomHandles(this: Editor) {
    const T = this.card.T,
      G = this.card._wallG;
    if (this.card._roomHG) {
      this.card._roomHG.parent?.remove(this.card._roomHG);
      this.card._disposeTree(this.card._roomHG);
      this.card._roomHG = null;
    }
    this.card._vertMeshes = [];
    this.card._midMeshes = [];
    const key = this.card._edit?.primary;
    if (!G || !this.card._plan || !key || key[0] !== "r") return;
    const f = this.item(key);
    if (!f?.pts?.length) return;
    this.card._roomHG = new T.Group();
    G.add(this.card._roomHG);
    const mat = (k: string, c: number, o = 1) =>
      (this.card._mats["__h" + k] ||= new T.MeshBasicMaterial({
        color: c,
        depthTest: false,
        transparent: true,
        opacity: o,
      }));
    const geo = new T.SphereGeometry(1, 12, 8),
      y = 1.5,
      n = f.pts.length;
    const pts = f.pts.map((q: Pt) => new T.Vector3(q[0] - CX, y, q[1] - CY));
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints([...pts, pts[0]]),
      (this.card._mats.__hline ||= new T.LineBasicMaterial({ color: 0x6fd39a, depthTest: false, transparent: true })),
    );
    line.renderOrder = 13;
    this.card._roomHG.add(line);
    f.pts.forEach((q: Pt, k: number) => {
      const act = this.card._vsel?.key === key && this.card._vsel.k === k;
      const v = new T.Mesh(geo, act ? mat("act", 0xf2c76b) : mat("vert", 0x6fd39a));
      v.position.copy(pts[k]);
      v.renderOrder = 15;
      v.userData.vert = { key, k };
      const r = f.pts[(k + 1) % n],
        m = new T.Mesh(geo, mat("mid", 0xffffff, 0.7));
      m.position.set((q[0] + r[0]) / 2 - CX, y, (q[1] + r[1]) / 2 - CY);
      m.renderOrder = 14;
      m.userData.mid = { key, k };
      this.card._roomHG.add(v, m);
      this.card._vertMeshes.push(v);
      this.card._midMeshes.push(m);
    });
    this.card._scaleHandles();
  }

  _toReal(this: Editor, units: number, vertical?: boolean) {
    return R1((units * this.card._modelScale()[vertical ? 1 : 0]) / (this.card._imperial() ? 2.54 : 1));
  }

  _fromReal(this: Editor, v: number, vertical?: boolean) {
    return (v * (this.card._imperial() ? 2.54 : 1)) / this.card._modelScale()[vertical ? 1 : 0];
  }

  /* ----- blueprint ----- */
  _pickBlueprintFile(this: Editor, replaceKey?: string) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = () => inp.files?.[0] && this._addBlueprint(inp.files[0], replaceKey);
    inp.click();
  }

  /* upload into Home Assistant's image store (served at /api/image/serve/…); if that's unavailable, keep a small copy inline */
  async _blueprintSrc(this: Editor, file: File) {
    const bmp = await createImageBitmap(file),
      aspect = bmp.width / bmp.height;
    const draw = (max: number) => {
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height)),
        cv = document.createElement("canvas");
      cv.width = Math.round(bmp.width * k);
      cv.height = Math.round(bmp.height * k);
      const g = cv.getContext("2d");
      g.fillStyle = "#fff";
      g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(bmp, 0, 0, cv.width, cv.height);
      return cv;
    };
    try {
      const blob = await new Promise<Blob | null>((r) => draw(2400).toBlob(r, "image/jpeg", 0.85));
      const fd = new FormData();
      fd.append("file", blob, "blueprint.jpg");
      const res = await this.card._hass.fetchWithAuth("/api/image/upload", { method: "POST", body: fd });
      if (res.ok) {
        const j = await res.json();
        if (j.id) return { src: `/api/image/serve/${j.id}/original`, aspect };
      }
    } catch (e: any) {
      /* fall through to inline */
    }
    return { src: draw(1400).toDataURL("image/jpeg", 0.7), aspect, inline: true };
  }

  async _addBlueprint(this: Editor, file: File, replaceKey?: string) {
    this.card._toast("Adding blueprint…", 8000);
    let r;
    try {
      r = await this._blueprintSrc(file);
    } catch (e: any) {
      return this.card._toast("Couldn't read that image: " + (e.message || e), 5000);
    }
    if (!this.card._edit) return;
    this._setTool("select");
    this._mutate(() => {
      if (replaceKey && this.item(replaceKey)) {
        const bp = this.item(replaceKey);
        bp.src = r.src;
        bp.h = R1(bp.w / r.aspect);
        return [replaceKey];
      }
      const segs = this.card._work.scene?.wall_segs || [];
      let w = 500,
        c = this._target();
      if (segs.length) {
        const xs = segs.flatMap((s) => [s.a[0], s.b[0]]),
          ys = segs.flatMap((s) => [s.a[1], s.b[1]]);
        w = (Math.max(...xs) - Math.min(...xs)) * 1.1;
        c = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
      }
      return [this._push("p", { src: r.src, x: R1(c[0]), y: R1(c[1]), w: R1(w), h: R1(w / r.aspect), opacity: 0.6 })];
    });
    this.card._toast(
      `Blueprint added${r.inline ? " (stored in the dashboard)" : ""}. Next: Set scale — click both ends of a length you know.`,
      6000,
    );
  }

  _setBlueprintUrl(this: Editor, key: string, url: string) {
    url = url.trim();
    if (!url) return;
    const img = new Image();
    img.onload = () =>
      this._mutate(() => {
        const bp = this.item(key);
        if (bp) {
          bp.src = url;
          bp.h = R1(bp.w / (img.naturalWidth / img.naturalHeight));
        }
        return [key];
      });
    img.onerror = () => this.card._toast("Couldn't load that image URL");
    img.src = url;
  }

  _applyScale(this: Editor, realCm: number) {
    const m = this._measure;
    if (!m || m.pts.length < 2 || !(realCm > 0)) return;
    const [a, b] = m.pts,
      meas = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (meas < 0.5) return;
    const target = realCm / this.card._modelScale()[0],
      f = target / meas,
      key = m.bp;
    this._setTool("select");
    this._mutate(() => {
      const bp = this.item(key);
      if (!bp) return [];
      bp.w = R1(bp.w * f);
      bp.h = R1(bp.h * f);
      bp.x = R1(a[0] + (bp.x - a[0]) * f);
      bp.y = R1(a[1] + (bp.y - a[1]) * f);
      return [key];
    });
    this.card._toast(`Blueprint rescaled — that line is now ${this.card._fmtLen(target)}`, 4000);
  }

  /* ----- floor plan inspector ----- */
  _renderPlanInspector(this: Editor, box: HTMLElement) {
    const e = this.card._edit,
      n = e.sel.size,
      sc = this.card._work.scene || {},
      U = this.card._imperial() ? "in" : "cm";
    const tw = `<span class="tw">${ic("chevron-down")}</span>`;
    const num = (lab: string, name: string, val: unknown, step = 1) =>
      `<label>${lab}<input data-p="${name}" type="number" step="${step}" value="${esc(val)}"></label>`;
    const btn = (name: string, text: string) => `<button data-pb="${name}">${text}</button>`;
    const bind = () => {
      box
        .querySelectorAll<HTMLInputElement>("input[data-p], select[data-p]")
        .forEach((inp) =>
          inp.addEventListener("change", () =>
            this._planField(e.primary, inp.dataset.p, inp.type === "checkbox" ? inp.checked : inp.value),
          ),
        );
      box
        .querySelectorAll<HTMLElement>("button[data-pb]")
        .forEach((b) => b.addEventListener("click", () => this._planField(e.primary, b.dataset.pb)));
      this._bindInspToggle(box);
    };
    if (this.card._tool === "measure") {
      const m = this._measure,
        imp = this.card._imperial();
      box.innerHTML =
        m.pts.length < 2
          ? `<h4>Set blueprint scale${tw}</h4><div class="sub">Click one end of something whose real length you know (a dimension line or a wall), then the other end.</div><div class="row">${btn("mcancel", "Cancel")}</div>`
          : `<h4>Set blueprint scale${tw}</h4><div class="sub">How long is that line in real life?</div>
          <div class="grid" style="grid-template-columns:2fr 1fr"><label>Length<input data-m="len" type="number" step="0.1" placeholder="${imp ? "12.5" : "350"}"></label>
          <label>Unit<select data-m="unit">${(imp ? ["ft", "in", "m", "cm"] : ["cm", "m", "ft", "in"]).map((u) => `<option>${u}</option>`).join("")}</select></label></div>
          <div class="sub">${imp ? "12′ 6″ is 12.5 ft." : ""}</div><div class="row"><button data-m="apply" class="primary">Apply</button>${btn("mredo", "Measure again")}${btn("mcancel", "Cancel")}</div>`;
      box.querySelector<HTMLElement>('[data-m="apply"]')?.addEventListener("click", () => {
        const v = Number(box.querySelector<HTMLInputElement>('[data-m="len"]').value),
          u = box.querySelector<HTMLSelectElement>('[data-m="unit"]').value;
        this._applyScale(v * { cm: 1, m: 100, in: 2.54, ft: 30.48 }[u]);
      });
      box.querySelector<HTMLElement>('[data-m="len"]')?.focus();
      bind();
      return;
    }
    if (!n) {
      const tips =
        {
          select:
            "Drag a corner dot to reshape walls (every wall meeting there follows). Drag a wall, door or window to move it. Tap one to edit its size.",
          wall: this._draw?.start
            ? "Click to place the next corner. Click the last corner again, or press Enter, to finish."
            : "Click where the wall starts, then where it ends. Keep clicking to chain walls. Ends snap to corners and to other walls.",
          door: "Click a wall to cut a door into it.",
          window: "Click a wall to cut a window into it.",
          room: this._draw?.pts?.length
            ? `${this._draw.pts.length} corner${this._draw.pts.length > 1 ? "s" : ""} so far. Click the first corner (or press Enter) to close the room.`
            : "Click each corner of the room in turn. Corners snap to walls and to other rooms' corners.",
        }[this.card._tool] || "";
      box.innerHTML = `<h4>Floor plan${tw}</h4><div class="sub">${tips}</div>
        <div class="row">${this._list("p").length ? btn("bpsel", ic("image-outline") + "Blueprint settings") : btn("bpadd", ic("image-plus") + "Add a blueprint image…")}</div>
        <details class="tips"><summary>Tips</summary>Snap lines walls up on corners, other walls and 15° angles; turn it off to trace odd angles. Doors and windows are boxes cut out of whatever wall they overlap, so you can also stretch one across a corner. Lengths are shown in ${this.card._imperial() ? "feet and inches" : "metric"}.</details>
        ${this._sunHTML(false)}`;
      this._bindSun(box);
      bind();
      return;
    }
    const key = e.primary,
      k = key[0],
      it = this.item(key);
    let body = "",
      sub = n > 1 ? `${n} items selected — drag moves all` : "";
    const texSel = (v: string | undefined, use: string) =>
      `<label>Texture<select data-p="texture">${[
        ["none", "Plain"],
        ...Object.entries(SURFACES)
          .filter(([t, [, , u]]) => u.includes(use) || t === v)
          .map(([t, [l]]) => [t, l]),
      ]
        .map(([t, l]) => `<option value="${t}"${(SURFACES[v] ? v : "none") === t ? " selected" : ""}>${l}</option>`)
        .join("")}</select></label>`;
    if (k === "w") {
      const [ux, uy, L] = segDir(it as WallSeg),
        ang = R1(((((Math.atan2(uy, ux) * 180) / Math.PI) % 360) + 360) % 360);
      sub ||= `${this.card._fmtLen(L)} long`;
      body = `<div class="grid">${num(`Length (${U})`, "len", this._toReal(L))}${num(`Thick (${U})`, "t", this._toReal(it.t ?? sc.wall_thickness ?? 4))}${num(`Height (${U})`, "h", this._toReal(it.h ?? sc.wall_height ?? 46, true))}${num("Angle °", "ang", ang, 15)}
        <label>Colour<input data-p="color" type="color" value="${esc(it.color || (sc.wall_colors || ["#e9dcc8"])[0])}"></label>${texSel(it.texture ?? sc.wall_texture, "w")}</div>
        <div class="row">${btn("split", ic("content-cut") + "Split")}${btn("low", it.low ? ic("arrow-expand-up") + "Full height" : ic("arrow-collapse-down") + "Cut-away (low)")}${btn("door", ic("door") + "Add door")}${btn("allwalls", ic("format-paint") + "Use on all walls")}</div>`;
    } else if (k === "n") {
      sub ||= "A box cut out of the walls it overlaps";
      body = `<label style="margin-bottom:8px">Type<select data-p="kind">${[
        ["door", "Door"],
        ["window", "Window (with glass)"],
        ["cut", "Plain cut-out"],
      ]
        .map(([v, l]) => `<option value="${v}"${(it.kind || "cut") === v ? " selected" : ""}>${l}</option>`)
        .join("")}</select></label>
        <div class="grid">${num(`Width (${U})`, "w", this._toReal(it.w))}${num(`Height (${U})`, "h", this._toReal(it.h, true))}${num(`${it.kind === "window" ? "Sill" : "Bottom"} (${U})`, "z", this._toReal(it.z || 0, true))}${num(`Depth (${U})`, "d", this._toReal(it.d ?? 6))}${num("Rotate °", "rot", it.rot || 0, 15)}</div>
        <div class="row">${btn("fit", ic("arrow-expand-horizontal") + "Fit to wall")}${btn("rotl", ic("rotate-left") + "90°")}${btn("rotr", ic("rotate-right") + "90°")}</div>`;
      if (it.kind === "door") {
        const st = DOOR_STYLES[it.style] ? it.style : "none",
          sel = (p: string, opts: [string, string][], v: string) =>
            `<select data-p="${p}">${opts.map(([o, l]) => `<option value="${o}"${v === o ? " selected" : ""}>${l}</option>`).join("")}</select>`;
        const ents = Object.keys(this.card._hass?.states || {})
          .filter((id) => /^(binary_sensor|cover|input_boolean)\./.test(id))
          .sort();
        body += `<div class="grid" style="grid-template-columns:1fr 1fr;margin-top:8px"><label>Door${sel(
          "style",
          Object.entries(DOOR_STYLES).map(([o, [l]]) => [o, l]),
          st,
        )}</label>`;
        if (st !== "none") {
          body += `<label>Colour<input data-p="color" type="color" value="${esc(it.color || DOOR_STYLES[st][1])}"></label>`;
          // hinge: which jamb a swinging door hangs from, or which way a sliding one moves (the sliding pane starts on the other side)
          const hinge = (<Record<string, string[]>>{
            panel: ["Hinge", "Left", "Right"],
            glass: ["Hinge", "Left", "Right"],
            barn: ["Slides", "Left", "Right"],
            sliding: ["Slides", "Right", "Left"],
          })[st];
          if (hinge)
            body += `<label>${hinge[0]}${sel(
              "hinge",
              [
                ["left", hinge[1]],
                ["right", hinge[2]],
              ],
              it.hinge || "left",
            )}</label>`;
          if (st !== "garage")
            body += `<label>${(<Record<string, string>>{ barn: "Hangs on", sliding: "Front pane" })[st] || "Swings"}${sel(
              "flip",
              [
                ["", "This side"],
                ["1", "Other side"],
              ],
              it.flip ? "1" : "",
            )}</label>`;
          body += `</div><label style="margin-top:8px">Sensor (open / shut)<input data-p="entity" type="text" list="doorents" value="${esc(it.entity || "")}" placeholder="binary_sensor.front_door"></label>
            <datalist id="doorents">${ents.map((id) => `<option value="${id}">`).join("")}</datalist>
            ${it.entity ? `<div class="sub" style="margin-top:4px">${esc(this.card._hass?.states[it.entity]?.attributes?.friendly_name || "Unknown entity")} · now ${this.card._doorTarget(it as Opening) ? "open" : "shut"}</div>` : `<label class="chk"><input data-p="open" type="checkbox"${it.open ? " checked" : ""}> Show it open</label>`}`;
        } else body += `</div>`;
      }
    } else if (k === "r") {
      const xs = it.pts.map((q: Pt) => q[0]),
        ys = it.pts.map((q: Pt) => q[1]);
      sub ||= `${this.card._fmtArea(polyArea(it.pts))} · ${this.card._fmtLen(Math.max(...xs) - Math.min(...xs))} × ${this.card._fmtLen(Math.max(...ys) - Math.min(...ys))}`;
      const vs = this.card._vsel?.key === key;
      body = `<div class="grid" style="grid-template-columns:2fr 1fr"><label>Name<input data-p="name" type="text" value="${esc(it.name || "")}"></label><label>Colour<input data-p="fill" type="color" value="${esc(it.fill || "#b3a58f")}"></label></div>
        <div class="grid" style="grid-template-columns:1fr;margin-top:6px">${texSel(it.texture, "f")}</div>
        <label class="chk"><input data-p="menu" type="checkbox"${it.menu === false ? "" : " checked"}> Show in the room menu</label>
        <div class="row">${vs && it.pts.length > 3 ? btn("delcorner", ic("close") + "Remove corner") : ""}</div>
        <div class="sub" style="margin-top:6px">Drag the green corners to reshape the room; drag a white dot to add a corner. Tap a corner, then Delete, to remove it. The room menu frames the room by this outline.</div>`;
    } else if (k === "p") {
      sub ||= `${this.card._fmtLen(it.w)} × ${this.card._fmtLen(it.h)}`;
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
    box.querySelector<HTMLElement>('[data-b="json"]').addEventListener("click", () => {
      if (k === "p" && String(it.src).startsWith("data:")) {
        try {
          const v = JSON.parse(box.querySelector<HTMLTextAreaElement>("textarea[data-json]").value);
          if (v.src === "(inline image)") v.src = it.src;
          box.querySelector<HTMLTextAreaElement>("textarea[data-json]").value = JSON.stringify(v);
        } catch (er) {
          /* reported below */
        }
      }
      this._field(key, "json");
    });
    bind();
  }

  _planField(this: Editor, key: string, name: string, raw?: any) {
    if (name === "bpadd") return this._pickBlueprintFile();
    if (name === "bpsel") return this._select(["p:0"]);
    if (name === "bpreplace") return this._pickBlueprintFile(key);
    if (name === "scale") {
      this._measure = { bp: key };
      return this._setTool("measure");
    }
    if (name === "mcancel") return this._setTool("select");
    if (name === "mredo") {
      this._measure.pts = [];
      this.hidePreview();
      return this.renderInspector();
    }
    if (name === "rotl" || name === "rotr") return this._field(key, name);
    if (name === "url") return this._setBlueprintUrl(key, String(raw));
    if (name === "door") {
      this._setTool("door");
      return this.card._toast("Click the spot on the wall for the door");
    }
    const k = key[0],
      v = Number(raw),
      sc = this.card._work.scene;
    if (["len", "t", "h", "ang", "w", "z", "d", "rot", "opacity"].includes(name) && !isFinite(v)) return;
    let keys = [...this.card._edit.sel];
    this._mutate(() => {
      const it = this.item(key);
      if (name === "texture" || name === "color" || name === "fill") {
        // looks apply to every selected wall / room
        for (const kk of keys) {
          const o = kk[0] === k && this.item(kk);
          if (!o) continue;
          if (name !== "texture") o[name] = raw;
          else if (k === "w" ? raw === (sc.wall_texture || "none") : raw === "none") delete o.texture;
          else o.texture = raw;
        }
        return keys;
      }
      if (k === "w") {
        const [ux, uy, L] = segDir(it as WallSeg),
          mid = [(it.a[0] + it.b[0]) / 2, (it.a[1] + it.b[1]) / 2];
        if (name === "len") {
          const nl = Math.max(1, this._fromReal(v));
          it.b = [R1(it.a[0] + ux * nl), R1(it.a[1] + uy * nl)];
        } else if (name === "t") it.t = R1(Math.max(0.5, this._fromReal(v)));
        else if (name === "h") {
          it.h = R1(Math.max(0.5, this._fromReal(v, true)));
          delete it.low;
        } else if (name === "ang") {
          const a = (v * Math.PI) / 180,
            c = (Math.cos(a) * L) / 2,
            s = (Math.sin(a) * L) / 2;
          it.a = [R1(mid[0] - c), R1(mid[1] - s)];
          it.b = [R1(mid[0] + c), R1(mid[1] + s)];
        } else if (name === "allwalls") {
          // this wall's look becomes the default; every wall follows it
          sc.wall_colors = [it.color || (sc.wall_colors || ["#e9dcc8"])[0], ...(sc.wall_colors || []).slice(1)];
          const tx = it.texture ?? sc.wall_texture;
          if (SURFACES[tx]) sc.wall_texture = tx;
          else delete sc.wall_texture;
          for (const w of sc.wall_segs || []) {
            delete w.color;
            delete w.texture;
          }
        } else if (name === "low") {
          if (it.low) {
            delete it.low;
            delete it.h;
          } else {
            it.low = true;
            it.h = sc.low ?? 8;
          }
        } else if (name === "split") {
          const b = it.b;
          it.b = [R1(mid[0]), R1(mid[1])];
          const nw = jclone(it);
          nw.a = [R1(mid[0]), R1(mid[1])];
          nw.b = b;
          keys = [key, this._push("w", nw)];
        }
      } else if (k === "n") {
        if (name === "kind") it.kind = raw;
        else if (name === "style") {
          if (raw === "none") delete it.style;
          else it.style = raw;
        } else if (name === "hinge") {
          if (raw === "right") it.hinge = "right";
          else delete it.hinge;
        } else if (name === "flip") {
          if (raw) it.flip = true;
          else delete it.flip;
        } else if (name === "open") {
          if (raw) it.open = true;
          else delete it.open;
        } else if (name === "entity") {
          const v2 = String(raw).trim();
          if (v2) it.entity = v2;
          else delete it.entity;
        } else if (name === "w" || name === "d") it[name] = R1(Math.max(0.5, this._fromReal(v)));
        else if (name === "h") it.h = R1(Math.max(0.5, this._fromReal(v, true)));
        else if (name === "z") it.z = R1(Math.max(0, this._fromReal(v, true)));
        else if (name === "rot") {
          it.rot = R1(((v % 360) + 360) % 360);
          if (!it.rot) delete it.rot;
        } else if (name === "fit") this._fitOpening(it as SceneItem);
      } else if (k === "r") {
        if (name === "name") {
          const v2 = String(raw).trim().toLowerCase().replace(/\s+/g, "_");
          if (v2) it.name = v2;
        } else if (name === "menu") {
          if (raw) delete it.menu;
          else it.menu = false;
        } else if (name === "delcorner" && this.card._vsel?.key === key && it.pts.length > 3) {
          it.pts.splice(this.card._vsel.k, 1);
          this.card._vsel = null;
        }
      } else if (k === "p") {
        if (name === "opacity") it.opacity = Math.max(0.05, Math.min(1, v));
        else if (name === "w") {
          const f = Math.max(1, this._fromReal(v)) / it.w;
          it.w = R1(it.w * f);
          it.h = R1(it.h * f);
        } else if (name === "rot") {
          it.rot = R1(((v % 360) + 360) % 360);
          if (!it.rot) delete it.rot;
        } else if (name === "locked") it.locked = raw ? true : undefined;
        else if (name === "show") it.show = raw ? true : undefined;
      }
      return keys;
    });
  }
}
