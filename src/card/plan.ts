/* The floor plan layer (wall segments and joints, openings, blueprint underlay), room labels and length units.
 */
import type { Scene } from "../types";
import type { Home3DCard } from "./card";
import { CX, CY } from "../core/constants";
import { esc, polyArea, roomTitle, mean } from "../core/util";
import { DOOR_STYLES } from "../core/fixtures";
import { segDir, wallExtensions, wallPieces, planJoints } from "../core/plan-geometry";

export class PlanPart {
  _buildPlanLayer(this: Home3DCard, sc: Scene) {
    const T = this.T,
      plan = !!this._plan,
      edit = !!this._edit;
    const H = sc.wall_height ?? 46,
      WT = sc.wall_thickness ?? 4,
      wallCol = (sc.wall_colors || ["#e9dcc8"])[0];
    const segs = sc.wall_segs || [],
      opens = sc.openings || [];
    const G = (this._wallG = new T.Group());
    this._world.add(G);
    this._mats ||= {};
    this._doorLeaves = [];
    this._doorAnim = null;
    // room floors (r:i) — polygons; the room menu frames each room by its outline
    this._floorMeshes = [];
    (sc.floors || []).forEach((f, i) => {
      if (!(f.pts?.length >= 3)) return;
      this._begin("r:" + i, mean(f.pts), 0, G);
      const geo = new T.ShapeGeometry(new T.Shape(f.pts.map(([x, y]) => new T.Vector2(x - CX, y - CY))));
      geo.rotateX(Math.PI / 2);
      const m = new T.Mesh(geo, this._surfMat(f.fill || "#b3a58f", f.texture, { side: T.DoubleSide })); // ShapeGeometry UVs are already plan units
      m.position.y = f.name === "rug" ? 0.4 : 0.01 * i;
      m.receiveShadow = true;
      m.userData.floor = true;
      m.userData.room = f.name;
      this._cur.add(m);
      this._floorMeshes.push(m);
      this._endItem();
    });
    this._buildRoomLabels(sc);
    const invis = (this._mats.__invis ||= new T.MeshBasicMaterial({ visible: false }));
    const ext = wallExtensions(segs, WT);
    segs.forEach((s, i) => {
      const [ux, uy, L] = segDir(s),
        t = s.t ?? WT,
        h = s.h ?? H,
        ry = -Math.atan2(uy, ux);
      this._begin("w:" + i, [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2], 0, G);
      const mat = this._surfMat(s.color || wallCol, s.texture ?? sc.wall_texture);
      for (const [p0, p1, z0, z1] of wallPieces(s, ext[i], opens, H, WT)) {
        if (z1 - z0 < 0.05) continue;
        const sm = (p0 + p1) / 2,
          m = new T.Mesh(this._planUV(new T.BoxGeometry(p1 - p0, z1 - z0, t), sm, (z0 + z1) / 2), mat);
        m.position.set(s.a[0] + ux * sm - CX, z0 + (z1 - z0) / 2, s.a[1] + uy * sm - CY);
        m.rotation.y = ry;
        m.userData.wall = true;
        this._add(m);
      }
      if (plan) {
        // fatter invisible slab so thin walls are easy to click
        const m = new T.Mesh(new T.BoxGeometry(L + Math.min(t, 2), h, Math.max(t + 4, 12 * this._upp())), invis);
        m.position.set((s.a[0] + s.b[0]) / 2 - CX, h / 2, (s.a[1] + s.b[1]) / 2 - CY);
        m.rotation.y = ry;
        m.castShadow = false;
        this._cur.add(m);
      }
      this._endItem();
    });
    const tint: Record<string, string> = { door: "#f08c3a", window: "#4ea3ff" };
    opens.forEach((o, i) => {
      this._begin("n:" + i, [o.x, o.y], o.rot || 0, G);
      const d = o.d ?? 6;
      if (plan) {
        // drawn over the wall so doors and windows still show from above
        const m = this._box(
          o.x - o.w / 2,
          o.x + o.w / 2,
          o.y - d / 2,
          o.y + d / 2,
          o.z || 0,
          o.h,
          tint[o.kind] || "#e5484d",
          { transparent: true, opacity: 0.55, depthWrite: false, depthTest: false },
        );
        m.castShadow = false;
        m.renderOrder = 12;
      } else if (o.kind === "window")
        this._box(o.x - o.w / 2, o.x + o.w / 2, o.y - 0.3, o.y + 0.3, o.z || 0, o.h, "#a9cfe6", {
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        }).castShadow = false;
      else if (o.kind === "door" && DOOR_STYLES[o.style]?.[1]) this._buildDoorLeaf(o);
      this._endItem();
    });
    (sc.blueprints || []).forEach((bp, i) => {
      if (!bp.src || !(plan || bp.show)) return;
      this._begin("p:" + i, [bp.x, bp.y], bp.rot || 0, G);
      const m = new T.Mesh(
        new T.PlaneGeometry(bp.w, bp.h),
        new T.MeshBasicMaterial({
          map: this._bpTexture(bp.src),
          transparent: true,
          opacity: bp.opacity ?? 0.6,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(bp.x - CX, plan ? 0.7 : 0.45, bp.y - CY);
      m.renderOrder = 1;
      if (bp.locked) m.userData.locked = true;
      this._add(m, false);
      m.receiveShadow = false;
      this._endItem();
    });
    for (const dl of this._doorLeaves) {
      dl.t = dl.target = this._doorTarget(dl.o);
      this._poseDoor(dl);
    } // start at the sensor's state
    this._jointMeshes = [];
    if (plan) {
      const geo = new T.SphereGeometry(1, 14, 10);
      this._joints = planJoints(segs);
      for (const j of this._joints) {
        const m = new T.Mesh(geo, this._jointMat(false));
        m.position.set(j.p[0] - CX, (segs[j.m[0][0]].h ?? H) + 0.6, j.p[1] - CY);
        m.renderOrder = 13;
        m.userData.joint = j;
        G.add(m);
        this._jointMeshes.push(m);
      }
      if (edit) this._paintJoints?.();
    }
    this._buildRoomHandles?.();
  }

  _bpTexture(this: Home3DCard, src: string) {
    this._bpTex ||= new Map();
    if (!this._bpTex.has(src)) {
      const tex = new this.T.TextureLoader().load(
        src,
        () => this._requestRender(),
        undefined,
        () => this._edit && this._toast("Couldn't load the blueprint image"),
      );
      tex.colorSpace = this.T.SRGBColorSpace;
      this._bpTex.set(src, tex);
    }
    return this._bpTex.get(src);
  }

  /* world units per screen pixel (for pixel-sized handles and snapping radii) */
  _upp(this: Home3DCard) {
    const c = this._cam;
    return (c.right - c.left) / c.zoom / (this._renderer.domElement.clientWidth || 1);
  }

  _scaleHandles(this: Home3DCard) {
    const u = this._upp();
    for (const m of this._sptMeshes || []) m.scale.setScalar(4.5 * u); // string-light points (furniture mode too)
    for (const m of this._smidMeshes || []) m.scale.setScalar(3 * u);
    if (!this._plan) return;
    for (const m of this._jointMeshes || []) m.scale.setScalar(5 * u);
    for (const m of this._vertMeshes || []) m.scale.setScalar(5 * u);
    for (const m of this._midMeshes || []) m.scale.setScalar(3.2 * u);
    if (this._prevDot) this._prevDot.scale.setScalar(4 * u);
  }

  _buildRoomLabels(this: Home3DCard, sc: Scene) {
    let box = this._wrap?.querySelector<HTMLElement>(".rlabels");
    if (!box && this._wrap) {
      box = document.createElement("div");
      box.className = "rlabels";
      this._wrap.append(box);
    }
    this._roomLabels = [];
    if (!box) return;
    box.innerHTML = "";
    if (!this._plan) return;
    (sc.floors || []).forEach((f) => {
      if (!(f.pts?.length >= 3) || f.name === "rug") return;
      const node = document.createElement("div");
      node.className = "rlabel";
      node.innerHTML = `${esc(roomTitle(f.name || "room"))}<small>${esc(this._fmtArea(polyArea(f.pts)))}</small>`;
      box.append(node);
      this._roomLabels.push({ node, p: [...mean(f.pts), 1] });
    });
  }

  /** an area in plan units² → "12.3 m²" or "132 ft²" */
  _fmtArea(this: Home3DCard, a: number) {
    const cm2 = a * this._modelScale()[0] ** 2;
    return this._imperial() ? `${Math.round(cm2 / 929.03)} ft²` : `${(cm2 / 10000).toFixed(1)} m²`;
  }

  /* ----- units: the plan stores model units; people see cm or feet/inches ----- */
  _imperial(this: Home3DCard) {
    const u = this._cfg()?.scene?.units;
    return u ? u === "imperial" : this._hass?.config?.unit_system?.length === "mi";
  }

  _fmtLen(this: Home3DCard, units: number, vertical?: boolean) {
    const cm = units * this._modelScale()[vertical ? 1 : 0];
    if (this._imperial()) {
      const inch = Math.round(cm / 2.54),
        ft = Math.floor(inch / 12);
      return ft ? `${ft}′ ${inch - ft * 12}″` : `${inch}″`;
    }
    return cm >= 100 ? `${(cm / 100).toFixed(2)} m` : `${Math.round(cm)} cm`;
  }
}
