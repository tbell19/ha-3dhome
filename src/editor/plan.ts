/* The floor plan editor: drawing walls, rooms and openings, snapping, handles, blueprints and scale.
 */
import type { Pt, SceneItem, WallEnd, WallSeg } from "../types";
import type { GenericItem } from "../core/items";
import type { Editor } from "./editor";
import { CX, CY, PLAN, round1, ROOM_FILLS, SURFACES, jclone, segDir } from "./shared.js";

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
    const segs = this.card._work?.scene?.wall_segs || [];
    const thr = 10 * this.card._upp();
    const ex = (i: number, e: string) => exclude.some(([j, f]) => j === i && f === e);
    let best: Pt | null = null;
    let bd = thr;
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
      const [ux, uy, L] = segDir(s);
      const dx = p[0] - s.a[0];
      const dy = p[1] - s.a[1];
      const t = dx * ux + dy * uy;
      const q = Math.abs(-dx * uy + dy * ux);
      if (t > 0 && t < L && q < bd) {
        bd = q;
        on = [round1(s.a[0] + ux * t), round1(s.a[1] + uy * t)];
      }
    });
    if (on) return { p: on, kind: "wall" };
    if (!this.card._edit?.snap) return { p: [round1(p[0]), round1(p[1])], kind: "free" };
    if (from) {
      const dx = p[0] - from[0];
      const dy = p[1] - from[1];
      const st = Math.PI / 12;
      const a = Math.round(Math.atan2(dy, dx) / st) * st;
      const L = Math.round(Math.hypot(dx, dy));
      return { p: [round1(from[0] + Math.cos(a) * L), round1(from[1] + Math.sin(a) * L)], kind: "angle" };
    }
    return { p: [Math.round(p[0]), Math.round(p[1])], kind: "grid" };
  }

  /** the index of the wall within thr of p, or null */
  _nearestWall(this: Editor, p: Pt, thr: number): number | null {
    let best: number | null = null;
    let bd = thr;
    (this.card._work.scene?.wall_segs || []).forEach((s, i) => {
      const [ux, uy, L] = segDir(s);
      const dx = p[0] - s.a[0];
      const dy = p[1] - s.a[1];
      const t = dx * ux + dy * uy;
      const q = Math.abs(-dx * uy + dy * ux);
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
    const s = this.card._work.scene.wall_segs[i];
    const [ux, uy, L] = segDir(s);
    const t = Math.max(0, Math.min(L, (o.x - s.a[0]) * ux + (o.y - s.a[1]) * uy));
    o.x = round1(s.a[0] + ux * t);
    o.y = round1(s.a[1] + uy * t);
    let rot = (Math.atan2(uy, ux) * 180) / Math.PI;
    const cur = o.rot || 0;
    while (rot - cur > 90) rot -= 180;
    while (cur - rot > 90) rot += 180; // keep the side it already faced
    o.rot = round1(((rot % 360) + 360) % 360);
    if (!o.rot) delete o.rot;
    o.d = round1(Math.max(o.d ?? 0, (s.t ?? this.card._work.scene.wall_thickness ?? 4) + 2));
  }

  /* ----- drawing / placing tools ----- */
  toolHover(this: Editor, ev: PointerEvent, p: Pt | null) {
    if (!p) return;
    const thr = 14 * this.card._upp() + 4;
    if (this.card._tool === "wall") {
      const d = this._draw;
      const s = this.snapPoint(p, { from: d?.start });
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
      const d = this._draw;
      const last = d.pts.at(-1);
      const s = this.snapPoint(p, { from: last, room: {} });
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
      const s = this.card._work.scene.wall_segs[i];
      const [ux, uy, L] = segDir(s);
      const t = Math.max(0, Math.min(L, (p[0] - s.a[0]) * ux + (p[1] - s.a[1]) * uy));
      this.showMarker([s.a[0] + ux * t, s.a[1] + uy * t], "wall");
    }
  }

  toolClick(this: Editor, p: Pt, key: string | null, ev: PointerEvent) {
    const sc = (this.card._work.scene ||= {});
    if (this.card._tool === "wall") {
      const d = this._draw;
      const s = this.snapPoint(p, { from: d.start });
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
      const a = d.start;
      const b = s.p;
      const closed = Math.hypot(b[0] - d.first[0], b[1] - d.first[1]) < 0.6;
      this._mutate(() => [this._push("w", { a: [round1(a[0]), round1(a[1])], b: [round1(b[0]), round1(b[1])] })]);
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
      const d = this._draw;
      const last = d.pts.at(-1);
      const s = this.snapPoint(p, { from: last, room: {} });
      if (
        d.pts.length >= 3 &&
        (Math.hypot(s.p[0] - d.pts[0][0], s.p[1] - d.pts[0][1]) < Math.max(10 * this.card._upp(), 0.6) ||
          Math.hypot(s.p[0] - last[0], s.p[1] - last[1]) < 1)
      )
        return this._finishRoom();
      if (last && Math.hypot(s.p[0] - last[0], s.p[1] - last[1]) < 1) return;
      d.pts.push([round1(s.p[0]), round1(s.p[1])]);
      this._showRoomPreview(d.pts);
      this.showMarker(s.p, s.kind);
      this.renderInspector();
      return;
    }
    if (this.card._tool === "door" || this.card._tool === "window") {
      const kind = this.card._tool;
      const wi = key?.[0] === "w" ? +key.split(":")[1] : this._nearestWall(p, 14 * this.card._upp() + 4);
      if (wi == null) return this.card._toast(`Click on a wall to put the ${kind} in`);
      const s = sc.wall_segs[wi];
      const [ux, uy, L] = segDir(s);
      const t = Math.max(0, Math.min(L, (p[0] - s.a[0]) * ux + (p[1] - s.a[1]) * uy));
      const [sxy, sz] = this.card._modelScale();
      const H = sc.wall_height ?? 46;
      const LIN = sc.lintel ?? 8;
      const wh = s.h ?? H;
      const wt = s.t ?? sc.wall_thickness ?? 4;
      const o: GenericItem =
        kind === "door"
          ? { kind, style: "panel", w: round1(80 / sxy), h: round1(Math.max(4, Math.min(wh, H - LIN))), z: 0 }
          : { kind, w: round1(100 / sxy), z: round1(Math.min(90 / sz, wh * 0.4)), h: 0 };
      if (kind === "window") o.h = round1(Math.max(4, Math.min(120 / sz, H - LIN - o.z)));
      Object.assign(o, { x: round1(s.a[0] + ux * t), y: round1(s.a[1] + uy * t), d: round1(wt + 2) });
      const rot = round1(((((Math.atan2(uy, ux) * 180) / Math.PI) % 360) + 360) % 360);
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
    const sc = this.card._cfg().scene || {};
    const m = this._prevMesh;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const wall = kind === "wall";
    const h = wall ? (sc.wall_height ?? 46) : 0.6;
    const t = wall ? (sc.wall_thickness ?? 4) : 1.2 * 2 * this.card._upp();
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
    if (!this.card._editorLayer) return;
    let t = this.card._editorLayer.querySelector<HTMLElement>(".tip");
    if (!t) {
      t = document.createElement("div");
      t.className = "tip";
      this.card._editorLayer.append(t);
    }
    const r = this.card._wrap.getBoundingClientRect();
    t.textContent = text;
    t.style.left = ev.clientX - r.left + "px";
    t.style.top = ev.clientY - r.top + "px";
    t.style.display = "";
  }

  hideTip(this: Editor) {
    const t = this.card._editorLayer?.querySelector<HTMLElement>(".tip");
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
      const rug = floors.findIndex((f) => f.name === "rug");
      const f = { name: "room_" + n, fill: ROOM_FILLS[floors.length % ROOM_FILLS.length], pts };
      if (rug >= 0) {
        floors.splice(rug, 0, f);
        return ["r:" + rug];
      } // keep rugs drawn on top
      return [this._push("r", f)];
    });
    this.card._toast("Room added — name it in the panel");
    setTimeout(() => {
      const i = this.card._editorLayer.querySelector<HTMLInputElement>('.insp input[data-p="name"]');
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
    const key = this.card._edit?.primary;
    const L = key?.[0] === "l" && this.item(key);
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
    const geo = new T.SphereGeometry(1, 12, 8);
    const z = L.z ?? 17;
    const n = L.points.length;
    L.points.forEach((q: Pt, k: number) => {
      const v = new T.Mesh(geo, mat("spt", 0xffd166));
      v.position.set(q[0] - CX, z, q[1] - CY);
      v.renderOrder = 15;
      v.userData.spt = { key, k };
      this.card._strHG.add(v);
      this.card._sptMeshes.push(v);
      if (k < n - 1) {
        const r = L.points[k + 1];
        const m = new T.Mesh(geo, mat("mid", 0xffffff, 0.7));
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
    const T = this.card.T;
    const G = this.card._wallG;
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
    const geo = new T.SphereGeometry(1, 12, 8);
    const y = 1.5;
    const n = f.pts.length;
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
      const r = f.pts[(k + 1) % n];
      const m = new T.Mesh(geo, mat("mid", 0xffffff, 0.7));
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
    return round1((units * this.card._modelScale()[vertical ? 1 : 0]) / (this.card._imperial() ? 2.54 : 1));
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
    const bmp = await createImageBitmap(file);
    const aspect = bmp.width / bmp.height;
    const draw = (max: number) => {
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const cv = document.createElement("canvas");
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
        bp.h = round1(bp.w / r.aspect);
        return [replaceKey];
      }
      const segs = this.card._work.scene?.wall_segs || [];
      let w = 500;
      let c = this._target();
      if (segs.length) {
        const xs = segs.flatMap((s) => [s.a[0], s.b[0]]);
        const ys = segs.flatMap((s) => [s.a[1], s.b[1]]);
        w = (Math.max(...xs) - Math.min(...xs)) * 1.1;
        c = [(Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2];
      }
      return [
        this._push("p", {
          src: r.src,
          x: round1(c[0]),
          y: round1(c[1]),
          w: round1(w),
          h: round1(w / r.aspect),
          opacity: 0.6,
        }),
      ];
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
          bp.h = round1(bp.w / (img.naturalWidth / img.naturalHeight));
        }
        return [key];
      });
    img.onerror = () => this.card._toast("Couldn't load that image URL");
    img.src = url;
  }

  _applyScale(this: Editor, realCm: number) {
    const m = this._measure;
    if (!m || m.pts.length < 2 || !(realCm > 0)) return;
    const [a, b] = m.pts;
    const meas = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (meas < 0.5) return;
    const target = realCm / this.card._modelScale()[0];
    const f = target / meas;
    const key = m.bp;
    this._setTool("select");
    this._mutate(() => {
      const bp = this.item(key);
      if (!bp) return [];
      bp.w = round1(bp.w * f);
      bp.h = round1(bp.h * f);
      bp.x = round1(a[0] + (bp.x - a[0]) * f);
      bp.y = round1(a[1] + (bp.y - a[1]) * f);
      return [key];
    });
    this.card._toast(`Blueprint rescaled — that line is now ${this.card._fmtLen(target)}`, 4000);
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
    const kind = key[0];
    const v = Number(raw);
    const sc = this.card._work.scene;
    if (["len", "t", "h", "ang", "w", "z", "d", "rot", "opacity"].includes(name) && !isFinite(v)) return;
    let keys = [...this.card._edit.sel];
    this._mutate(() => {
      const item = this.item(key);
      if (name === "texture" || name === "color" || name === "fill") {
        // looks apply to every selected wall / room
        for (const kk of keys) {
          const o = kk[0] === kind && this.item(kk);
          if (!o) continue;
          if (name !== "texture") o[name] = raw;
          else if (kind === "w" ? raw === (sc.wall_texture || "none") : raw === "none") delete o.texture;
          else o.texture = raw;
        }
        return keys;
      }
      if (kind === "w") {
        const [ux, uy, L] = segDir(item as WallSeg);
        const mid = [(item.a[0] + item.b[0]) / 2, (item.a[1] + item.b[1]) / 2];
        if (name === "len") {
          const nl = Math.max(1, this._fromReal(v));
          item.b = [round1(item.a[0] + ux * nl), round1(item.a[1] + uy * nl)];
        } else if (name === "t") item.t = round1(Math.max(0.5, this._fromReal(v)));
        else if (name === "h") {
          item.h = round1(Math.max(0.5, this._fromReal(v, true)));
          delete item.low;
        } else if (name === "ang") {
          const a = (v * Math.PI) / 180;
          const c = (Math.cos(a) * L) / 2;
          const s = (Math.sin(a) * L) / 2;
          item.a = [round1(mid[0] - c), round1(mid[1] - s)];
          item.b = [round1(mid[0] + c), round1(mid[1] + s)];
        } else if (name === "allwalls") {
          // this wall's look becomes the default; every wall follows it
          sc.wall_colors = [item.color || (sc.wall_colors || ["#e9dcc8"])[0], ...(sc.wall_colors || []).slice(1)];
          const tx = item.texture ?? sc.wall_texture;
          if (SURFACES[tx]) sc.wall_texture = tx;
          else delete sc.wall_texture;
          for (const w of sc.wall_segs || []) {
            delete w.color;
            delete w.texture;
          }
        } else if (name === "low") {
          if (item.low) {
            delete item.low;
            delete item.h;
          } else {
            item.low = true;
            item.h = sc.low ?? 8;
          }
        } else if (name === "split") {
          const b = item.b;
          item.b = [round1(mid[0]), round1(mid[1])];
          const nw = jclone(item);
          nw.a = [round1(mid[0]), round1(mid[1])];
          nw.b = b;
          keys = [key, this._push("w", nw)];
        }
      } else if (kind === "n") {
        if (name === "kind") item.kind = raw;
        else if (name === "style") {
          if (raw === "none") delete item.style;
          else item.style = raw;
        } else if (name === "hinge") {
          if (raw === "right") item.hinge = "right";
          else delete item.hinge;
        } else if (name === "flip") {
          if (raw) item.flip = true;
          else delete item.flip;
        } else if (name === "open") {
          if (raw) item.open = true;
          else delete item.open;
        } else if (name === "entity") {
          const v2 = String(raw).trim();
          if (v2) item.entity = v2;
          else delete item.entity;
        } else if (name === "w" || name === "d") item[name] = round1(Math.max(0.5, this._fromReal(v)));
        else if (name === "h") item.h = round1(Math.max(0.5, this._fromReal(v, true)));
        else if (name === "z") item.z = round1(Math.max(0, this._fromReal(v, true)));
        else if (name === "rot") {
          item.rot = round1(((v % 360) + 360) % 360);
          if (!item.rot) delete item.rot;
        } else if (name === "fit") this._fitOpening(item as SceneItem);
      } else if (kind === "r") {
        if (name === "name") {
          const v2 = String(raw).trim().toLowerCase().replace(/\s+/g, "_");
          if (v2) item.name = v2;
        } else if (name === "menu") {
          if (raw) delete item.menu;
          else item.menu = false;
        } else if (name === "delcorner" && this.card._vsel?.key === key && item.pts.length > 3) {
          item.pts.splice(this.card._vsel.k, 1);
          this.card._vsel = null;
        }
      } else if (kind === "p") {
        if (name === "opacity") item.opacity = Math.max(0.05, Math.min(1, v));
        else if (name === "w") {
          const f = Math.max(1, this._fromReal(v)) / item.w;
          item.w = round1(item.w * f);
          item.h = round1(item.h * f);
        } else if (name === "rot") {
          item.rot = round1(((v % 360) + 360) % 360);
          if (!item.rot) delete item.rot;
        } else if (name === "locked") item.locked = raw ? true : undefined;
        else if (name === "show") item.show = raw ? true : undefined;
      }
      return keys;
    });
  }
}
