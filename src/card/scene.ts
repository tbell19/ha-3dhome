/* Building the scene: roof, doors, materials, primitive shapes, the stage shadow, boxes, objects and overlays.
 */
import type * as THREE from "three";
import type { Colour, Opening, Scene, SceneItem, WallSeg } from "../types";
import type { Home3DCard, DoorLeaf } from "./card";

/** what a mesh is painted with: a colour (cached as a material), or a material */
export type Paint = Colour | THREE.Material;
import { CX, CY, OUTDOOR } from "../core/constants";
import { rotPt } from "../core/util";
import { bArr, itemCenter, SIZED, sizeOf, sizeAnchor } from "../core/items";
import { DOOR_STYLES, OPEN_STATES } from "../core/fixtures";
import { SURFACES, paintSurface, type SurfaceCanvas } from "../core/surfaces";
import { segDir, wallExtensions, wallPieces } from "../core/plan-geometry";

export class ScenePart {
  /* The house has no visible roof, so the sun would light every room from above. An invisible roof over the rooms, plus
   * walls raised to roof height wherever they are lower (cut-away front walls), lets sunlight in only through windows and
   * doors. Their material writes neither colour nor depth, so they only show up in shadow maps, and they can't be picked.
   * The slab sits just above the tallest wall so ceiling lamps still light the room below. */
  _buildRoof(this: Home3DCard, sc: Scene) {
    if (this._plan || sc.roof === false) return;
    const T = this.T,
      WT = sc.wall_thickness ?? 4,
      G = new T.Group();
    const segs = sc.wall_segs || [],
      opens = sc.openings || [];
    const H = Math.max(sc.wall_height ?? 46, ...segs.filter((w) => !w.low).map((w) => w.h ?? 0)) + 0.5,
      TOP = H + 1.5; // over the tallest wall
    const mat = (this._mats.__roof ||= new T.MeshBasicMaterial({
      side: T.DoubleSide,
      colorWrite: false,
      depthWrite: false,
    }));
    const add = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, ry = 0) => {
      const m = new T.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.castShadow = true;
      m.receiveShadow = false;
      m.raycast = () => {};
      m.userData.roof = true;
      G.add(m);
    };
    for (const f of sc.floors || []) {
      if (
        !(f.pts?.length >= 3) ||
        f.roof === false ||
        f.name === "rug" ||
        (f.roof !== true && OUTDOOR.test(f.name || ""))
      )
        continue;
      const geo = new T.ExtrudeGeometry(new T.Shape(f.pts.map(([x, y]) => new T.Vector2(x - CX, y - CY))), {
        depth: 1.5,
        bevelEnabled: false,
      });
      geo.rotateX(Math.PI / 2);
      add(geo, 0, TOP); // a 1.5-thick slab just above the walls
    }
    // every wall, raised to the top of the roof: fills the cut-away walls, and covers wall tops so they aren't sunlit
    const ext = wallExtensions(segs, WT);
    segs.forEach((w, i) => {
      const full: WallSeg = { ...w, h: TOP };
      delete full.low;
      const [ux, uy] = segDir(w),
        t = w.t ?? WT,
        ry = -Math.atan2(uy, ux);
      for (const [p0, p1, z0, z1] of wallPieces(full, ext[i], opens, TOP, WT)) {
        const sm = (p0 + p1) / 2;
        add(
          new T.BoxGeometry(p1 - p0, z1 - z0, t),
          w.a[0] + ux * sm - CX,
          z0 + (z1 - z0) / 2,
          w.a[1] + uy * sm - CY,
          ry,
        );
      }
    });
    if (G.children.length) this._world.add(G);
  }

  /* ---------- door leaves ----------
   * Built inside the opening's item group (so `rot` applies), in plan coordinates. Each moving part is a pivot group
   * whose `mv` says how it opens: a turn about its hinge, or a slide along x / up. `t` runs 0 (shut) → 1 (open). */
  _buildDoorLeaf(this: Home3DCard, o: Opening) {
    const T = this.T,
      [, def] = DOOR_STYLES[o.style],
      col = o.color || def,
      th = 1.4,
      gap = 0.3;
    const x1 = o.x - o.w / 2,
      x2 = o.x + o.w / 2,
      z0 = o.z || 0,
      hh = o.h - gap,
      y = o.y,
      d = o.d ?? 6;
    const right = o.hinge === "right",
      side = o.flip ? -1 : 1,
      parent = this._cur,
      parts: DoorLeaf["parts"] = [];
    const glassMat = this._mat("#a9cfe6", { transparent: true, opacity: 0.3, depthWrite: false });
    const pivot = (px: number, py: number, mv: { rot?: number; x?: number; y?: number }) => {
      const outer = new T.Group(),
        inner = new T.Group();
      outer.position.set(px - CX, 0, py - CY);
      inner.position.set(-(px - CX), 0, -(py - CY));
      outer.add(inner);
      parent.add(outer);
      this._cur = inner;
      parts.push({ node: outer, mv, x0: outer.position.x, y0: 0 });
    };
    const slab = (a: number, b: number, yc: number, t = th) => this._box(a, b, yc - t / 2, yc + t / 2, z0, hh, col);
    const framed = (a: number, b: number, yc: number) => {
      // glass pane in a thin frame
      const f = 1.6;
      for (const [p, q, zz, h] of [
        [a, a + f, z0, hh],
        [b - f, b, z0, hh],
        [a, b, z0, f],
        [a, b, z0 + hh - f, f],
      ])
        this._box(p, q, yc - th / 2, yc + th / 2, zz, h, col);
      this._box(a + f, b - f, yc - 0.3, yc + 0.3, z0 + f, hh - 2 * f, glassMat).castShadow = false;
    };
    if (o.style === "panel" || o.style === "glass") {
      // swings towards +y (−y when flipped)
      pivot(right ? x2 : x1, y, { rot: (right ? 1 : -1) * side * (Math.PI / 2) });
      (o.style === "glass" ? framed : slab)(x1 + gap, x2 - gap, y);
    } else if (o.style === "double") {
      const m = o.x;
      pivot(x1, y, { rot: -side * (Math.PI / 2) });
      slab(x1 + gap, m - gap / 2, y);
      pivot(x2, y, { rot: side * (Math.PI / 2) });
      slab(m + gap / 2, x2 - gap, y);
    } else if (o.style === "sliding") {
      const m = o.x,
        ov = 1;
      this._cur = parent;
      framed(right ? x1 + gap : m - ov, right ? m + ov : x2 - gap, y - side * 0.9); // fixed pane
      pivot(o.x, y, { x: (right ? -1 : 1) * (o.w / 2 - gap) });
      framed(right ? m - ov : x1 + gap, right ? x2 - gap : m + ov, y + side * 0.9);
    } else if (o.style === "barn") {
      const yf = y + side * (d / 2 + 0.9); // hangs on the wall face
      const yr = yf - side * 1.2;
      this._cur = parent;
      this._box(
        right ? x1 - 1 : x1 - o.w - 1,
        right ? x2 + o.w + 1 : x2 + 1,
        yr - 0.4,
        yr + 0.4,
        z0 + hh,
        1.2,
        "#2a2a2a",
      ); // rail
      pivot(o.x, y, { x: (right ? 1 : -1) * o.w });
      slab(x1 - 1, x2 + 1, yf, 1.6);
    } else if (o.style === "garage") {
      pivot(o.x, y, { y: hh * 0.92 });
      slab(x1 + gap, x2 - gap, y, 1.2);
      for (let k = 1; k < 4; k++)
        this._box(x1 + gap, x2 - gap, y - 0.8, y + 0.8, z0 + (hh * k) / 4 - 0.25, 0.5, this._mat("#b9b3aa")); // panel seams
    }
    this._cur = parent;
    this._doorLeaves.push({ o, parts, t: 0 });
  }

  /** 1 when the door should be open (its sensor says so, or `open: true`), else 0 */
  _doorTarget(this: Home3DCard, o: Opening) {
    return o.entity ? (OPEN_STATES.has(this._hass?.states[o.entity]?.state) ? 1 : 0) : o.open ? 1 : 0;
  }

  _poseDoor(this: Home3DCard, dl: DoorLeaf) {
    const e = dl.t < 0.5 ? 2 * dl.t * dl.t : 1 - Math.pow(-2 * dl.t + 2, 2) / 2;
    for (const p of dl.parts) {
      if (p.mv.rot) p.node.rotation.y = p.mv.rot * e;
      if (p.mv.x) p.node.position.x = p.x0 + p.mv.x * e;
      if (p.mv.y) p.node.position.y = p.mv.y * e;
    }
  }

  /* animate every door towards its sensor's state */
  _setDoors(this: Home3DCard) {
    const leaves = this._doorLeaves;
    if (!leaves?.length) return;
    let moving = false;
    for (const dl of leaves)
      if (dl.target !== this._doorTarget(dl.o)) {
        dl.target = this._doorTarget(dl.o);
        moving = true;
      }
    if (!moving || this._doorAnim) return;
    const anim = (this._doorAnim = {}); // identifies this animation: a newer one replaces it
    let last = performance.now();
    const step = (now: number) => {
      if (this._doorAnim !== anim || this._doorLeaves !== leaves || !this._renderer) return;
      const k = Math.min(1, Math.max(0, now - last) / 700);
      last = Math.max(last, now);
      let busy = false; // rAF time can be earlier than performance.now()
      for (const dl of leaves) {
        if (dl.t === dl.target) continue;
        dl.t = dl.t < dl.target ? Math.min(dl.target, dl.t + k) : Math.max(dl.target, dl.t - k);
        this._poseDoor(dl);
        busy ||= dl.t !== dl.target;
      }
      this._requestRender();
      if (busy) requestAnimationFrame(step);
      else {
        this._doorAnim = null;
        this._renderer.shadowMap.needsUpdate = true;
        this._requestRender();
      }
    };
    requestAnimationFrame(step);
  }

  /* ---------- geometry ---------- */
  /** a cached Lambert material of this colour (and options) */
  _mat(this: Home3DCard, color: Colour, opts: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
    const key = color + JSON.stringify(opts);
    this._mats ||= {};
    return (this._mats[key] ||= new this.T.MeshLambertMaterial({ color, ...opts })) as THREE.MeshLambertMaterial;
  }

  /* a wall / floor material: the colour, optionally with a SURFACES texture. Geometry needs plan-unit UVs (see _planUV). */
  _surfMat(this: Home3DCard, color: Colour, tex: string | undefined, opts: THREE.MeshLambertMaterialParameters = {}) {
    if (!SURFACES[tex]) return this._mat(color, opts);
    const key = color + "~" + tex + JSON.stringify(opts);
    this._mats ||= {};
    if (this._mats[key]) return this._mats[key] as THREE.MeshLambertMaterial;
    const map = this._surfTex(tex),
      m = (this._mats[key] = new this.T.MeshLambertMaterial({ color, map, ...opts }));
    m.color.multiplyScalar(1 / (map.image as SurfaceCanvas).mean!);
    return m;
  }

  _surfTex(this: Home3DCard, name: string) {
    const T = this.T,
      cm = this._modelScale()[0];
    let t = (this._surfTexs ||= {})[name];
    if (!t) {
      t = this._surfTexs![name] = new T.CanvasTexture(paintSurface(name));
      t.wrapS = t.wrapT = T.RepeatWrapping;
      t.anisotropy = Math.min(8, this._renderer?.capabilities.getMaxAnisotropy() || 1);
    }
    t.repeat.set(cm / SURFACES[name][1], cm / SURFACES[name][1]); // UVs are in plan units
    return t;
  }

  /* box UVs in plan units, projected along each face's normal, so textures keep their real size and line up across pieces.
   * (ox, oy, oz) is the box centre in the frame the texture should be continuous in; heights are stretched back to true scale. */
  _planUV(this: Home3DCard, geo: THREE.BufferGeometry, ox = 0, oy = 0, oz = 0) {
    const [mx, mz] = this._modelScale(),
      vs = mz / mx,
      P = geo.attributes.position,
      N = geo.attributes.normal,
      U = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i) + ox,
        y = (P.getY(i) + oy) * vs,
        z = P.getZ(i) + oz;
      if (Math.abs(N.getY(i)) > 0.5) U.setXY(i, x, z);
      else if (Math.abs(N.getX(i)) > 0.5) U.setXY(i, z, y);
      else U.setXY(i, x, y);
    }
    U.needsUpdate = true;
    return geo;
  }

  _add<M extends THREE.Mesh>(this: Home3DCard, mesh: M, cast = true): M {
    mesh.castShadow = cast && !this._noCast;
    mesh.receiveShadow = true;
    (this._cur || this._world).add(mesh);
    return mesh;
  }

  /* start a keyed, pivot-rotatable item group */
  /* An item's groups: outer (centre + turn about the vertical, `rot`) → tilt (`rx` / `rz`, about the middle of the item's
   * own bounding box, set up in _endItem) → size (fixed-shape `size`) → inner (the meshes, in plan coordinates).
   * Together that is the rotation Ry·Rx·Rz, Unity's order: turn, then tilt. */
  _begin(
    this: Home3DCard,
    key: string,
    center: number[],
    rot = 0,
    parent?: THREE.Object3D | null,
    size?: number[] | null,
    az = 0,
    tilt?: number[],
  ) {
    const T = this.T,
      outer = new T.Group(),
      inner = new T.Group();
    outer.position.set(center[0] - CX, 0, center[1] - CY);
    outer.rotation.y = (-rot * Math.PI) / 180;
    inner.position.set(-(center[0] - CX), 0, -(center[1] - CY));
    let top: THREE.Group = outer;
    if (tilt) {
      const tg = new T.Group();
      tg.userData.tilt = tilt;
      outer.add(tg);
      top = tg;
    }
    if (size) {
      // `size` multiplier of a fixed-shape object, about the height `az` it stands on or hangs from
      const sg = new T.Group();
      sg.position.y = az;
      sg.scale.set(size[0], size[2], size[1]);
      inner.position.y = -az;
      sg.add(inner);
      top.add(sg);
    } else top.add(inner);
    outer.userData.key = key;
    outer.userData.inner = inner;
    (parent || this._world).add(outer);
    this._items.set(key, outer);
    this._outer = outer;
    this._cur = inner;
    this._xf = rot ? (x: number, y: number) => rotPt(x, y, center[0], center[1], rot) : null;
    return outer;
  }

  _endItem(this: Home3DCard) {
    const o = this._outer,
      tg = o?.children[0];
    if (tg?.userData.tilt) {
      // the tilt pivot: middle of the untilted item, in the outer group's frame (o.userData.tc)
      const T = this.T,
        ry = o.rotation.y;
      o.rotation.y = 0;
      o.updateMatrixWorld(true);
      const box = new T.Box3().setFromObject(tg);
      o.rotation.y = ry;
      const tc = box.isEmpty()
        ? new T.Vector3()
        : box
            .getCenter(new T.Vector3())
            .sub(o.position)
            .sub(o.parent?.position || new T.Vector3());
      o.userData.tc = tc;
      const [rx, rz] = tg.userData.tilt;
      if (rx || rz) {
        for (const c of tg.children) c.position.sub(tc);
        tg.position.copy(tc);
        tg.rotation.set((rx * Math.PI) / 180, 0, (rz * Math.PI) / 180);
      }
      o.updateMatrixWorld(true);
    }
    this._cur = null;
    this._xf = null;
    this._outer = null;
  }

  /** a box from x1..x2, y1..y2 (plan units), z..z+h high */
  _box(
    this: Home3DCard,
    x1: number,
    x2: number,
    y1: number,
    y2: number,
    z: number,
    h: number,
    color: Paint,
    opts?: THREE.MeshLambertMaterialParameters,
  ) {
    const T = this.T;
    const m = new T.Mesh(
      new T.BoxGeometry(Math.max(x2 - x1, 0.3), Math.max(h, 0.3), Math.max(y2 - y1, 0.3)),
      typeof color === "string" ? this._mat(color, opts) : color,
    );
    m.position.set((x1 + x2) / 2 - CX, z + h / 2, (y1 + y2) / 2 - CY);
    return this._add(m);
  }

  /** an upright cylinder standing at z (radius r at the bottom, r2 at the top) */
  _cyl(this: Home3DCard, x: number, y: number, z: number, r: number, h: number, color: Paint, seg = 16, r2?: number) {
    const T = this.T;
    const m = new T.Mesh(
      new T.CylinderGeometry(r2 ?? r, r, h, seg),
      typeof color === "string" ? this._mat(color) : color,
    );
    m.position.set(x - CX, z + h / 2, y - CY);
    return this._add(m);
  }

  _sphere(this: Home3DCard, x: number, y: number, z: number, r: number, color: Paint) {
    const T = this.T;
    const m = new T.Mesh(new T.SphereGeometry(r, 12, 10), typeof color === "string" ? this._mat(color) : color);
    m.position.set(x - CX, z, y - CY);
    return this._add(m);
  }

  /* stage look: a soft, offset "drop shadow" under the house, baked from the floor outlines into a blurred texture */
  _buildStageShadow(this: Home3DCard, sc: Scene) {
    const T = this.T,
      pts = (sc.floors || []).flatMap((f) => f.pts || []);
    if (!pts.length) return;
    const M = 60,
      [x1, x2, y1, y2] = [
        Math.min(...pts.map((p) => p[0])) - M,
        Math.max(...pts.map((p) => p[0])) + M,
        Math.min(...pts.map((p) => p[1])) - M,
        Math.max(...pts.map((p) => p[1])) + M,
      ];
    const k = 1,
      c = document.createElement("canvas");
    c.width = Math.ceil((x2 - x1) * k);
    c.height = Math.ceil((y2 - y1) * k);
    const g = c.getContext("2d")!;
    for (const [blur, a] of [
      [22, 0.6],
      [6, 0.5],
    ]) {
      // a wide soft penumbra plus a tighter contact shadow
      g.filter = `blur(${blur}px)`;
      g.fillStyle = `rgba(0,0,0,${a})`;
      for (const f of sc.floors) {
        if (!(f.pts?.length >= 3)) continue;
        g.beginPath();
        f.pts.forEach(([x, y], i) => (i ? g.lineTo((x - x1) * k, (y - y1) * k) : g.moveTo((x - x1) * k, (y - y1) * k)));
        g.closePath();
        g.fill();
      }
    }
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    const m = new T.Mesh(
      new T.PlaneGeometry(x2 - x1, y2 - y1),
      new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }),
    );
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = -1;
    m.raycast = () => {}; // never picked
    m.position.set((x1 + x2) / 2 - CX + 10, -6, (y1 + y2) / 2 - CY + 14); // offset toward the viewer, below the floor slab
    this._world.add(m);
    this._stage = m;
    /* the backdrop's spotlight lies on the ground under the house, so it pans, zooms and turns with it. It only brightens
     * (alpha falls to 0 at its rim), so it blends into the flat card background with no seam. */
    const cs = document.createElement("canvas");
    cs.width = cs.height = 256;
    const gs = cs.getContext("2d")!,
      rg = gs.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [at, al] of [
      [0, 1],
      [0.55, 0.47],
      [1, 0],
    ])
      rg.addColorStop(at, `rgba(54,49,42,${al})`);
    gs.fillStyle = rg;
    gs.fillRect(0, 0, 256, 256);
    const st = new T.CanvasTexture(cs);
    st.colorSpace = T.SRGBColorSpace;
    const sp = new T.Mesh(
      new T.PlaneGeometry((x2 - x1) * 2.4, (y2 - y1) * 2.6),
      new T.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false, toneMapped: false }),
    );
    sp.rotation.x = -Math.PI / 2;
    sp.renderOrder = -2;
    sp.raycast = () => {};
    sp.position.set((x1 + x2) / 2 - CX, -7, (y1 + y2) / 2 - CY);
    this._world.add(sp);
    this._stageSpot = sp;
  }

  _emissive(this: Home3DCard, color: Colour) {
    return new this.T.MeshStandardMaterial({
      color,
      emissive: new this.T.Color(color),
      emissiveIntensity: 0.05,
      roughness: 0.4,
    });
  }

  _fixture(this: Home3DCard, x: number, y: number, mesh: THREE.Mesh) {
    mesh.castShadow = false;
    const [wx, wy] = this._xf ? this._xf(x, y) : [x, y];
    this._fixtures.push({ x: wx, y: wy, mesh });
  }

  _buildScene(this: Home3DCard, sc: Scene) {
    const pal = sc.palette || {};
    const col = (c: Colour | Colour[]) => (typeof c === "string" ? (pal[c] || ["#888"])[0] : c[0]);
    // wall segments, openings, blueprint underlay (the editable floor plan)
    this._buildPlanLayer(sc);
    // boxes
    (sc.boxes || []).forEach((e, i) => {
      const [x1, x2, y1, y2, h, c, z = 0] = bArr(e);
      this._begin(
        "b:" + i,
        itemCenter("b", e),
        Array.isArray(e) ? 0 : e.rot || 0,
        null,
        null,
        0,
        Array.isArray(e) ? [0, 0] : [e.rx || 0, e.rz || 0],
      );
      this._box(x1, x2, y1, y2, z, h, col(c));
      this._endItem();
    });
    // objects
    (sc.objects || []).forEach((o, i) => {
      this._begin(
        "o:" + i,
        itemCenter("o", o),
        o.rot || 0,
        null,
        SIZED.has(o.type) && o.size ? sizeOf(o) : null,
        sizeAnchor(o),
        [o.rx || 0, o.rz || 0],
      );
      this._buildObject(o);
      this._endItem();
    });
    // overlays (sinks, burners, pendants, fans) never block light
    this._noCast = true;
    (sc.overlays || []).forEach((o, i) => {
      const c = itemCenter("v", o);
      if (c)
        this._begin("v:" + i, c, o.rot || 0, null, SIZED.has(o.type) && o.size ? sizeOf(o) : null, sizeAnchor(o), [
          o.rx || 0,
          o.rz || 0,
        ]);
      this._buildOverlay(o);
      this._endItem();
    });
    this._noCast = false;
  }

  _buildObject(this: Home3DCard, o: SceneItem) {
    if (o.type === "shelf") {
      const [x1, x2, y1, y2, h] = o.box;
      const c = (o.colors || ["#2c2622"])[0];
      this._box(x1, x2, y2 - 1.5, y2, 0, h, c);
      this._box(x1, x1 + 1.5, y1, y2, 0, h, c);
      this._box(x2 - 1.5, x2, y1, y2, 0, h, c);
      for (const z of [0, ...(o.shelves || []), h - 1]) this._box(x1, x2, y1, y2, z, 1, c);
    } else if (o.type === "table") {
      this._cyl(o.x, o.y, o.z - 2, o.r, 2, "#b39672", 32);
      this._cyl(o.x, o.y, 0, 1.6, o.z - 2, "#6e5a40");
      this._cyl(o.x, o.y, 0, 7, 1, "#6e5a40");
      this._sphere(o.x, o.y, o.z + 3, 2.6, "#5f8a55");
    } else if (o.type === "floorlamp") {
      this._cyl(o.x, o.y, 0, 4, 1, "#2a2a2a");
      this._cyl(o.x, o.y, 0, 0.6, o.z, "#2a2a2a");
      this._fixture(o.x, o.y, this._cyl(o.x, o.y, o.z - 3, 5.5, 8, this._emissive("#fbf3e2"), 20, 4.5));
    } else if (o.type === "tablelamp") {
      this._cyl(o.x, o.y, o.z, 2, 6, "#cfcfcf");
      this._fixture(o.x, o.y, this._cyl(o.x, o.y, o.z + 6, 4.5, 6, this._emissive("#fbf3e2"), 20, 3.6));
    } else if (o.type === "plant") {
      const z = o.z || 0;
      this._cyl(o.x, o.y, z, 3, 5, "#d9cbb0", 12, 3.6);
      for (const [dx, dy, dz, r] of [
        [-2, 0, 9, 3.5],
        [2, 1, 11, 3.5],
        [0, -1, 14, 4],
      ])
        this._sphere(o.x + dx, o.y + dy, z + dz, r, "#4f7a45");
    } else if (o.type === "screen") {
      // 16:9 screen showing the entity's artwork / snapshot (drawn into a canvas texture in _drawScreen)
      const T = this.T,
        w = o.w || 32,
        h = (w * 9) / 16,
        z = o.z ?? 20,
        par = this._cur || this._world;
      this._box(o.x - w / 2 - 0.8, o.x + w / 2 + 0.8, o.y - 1, o.y, z - 0.8, h + 1.6, "#121212");
      if (o.stand) {
        this._box(o.x - 1, o.x + 1, o.y - 1.6, o.y - 0.6, 0, z, "#1b1b1b");
        this._box(o.x - w / 4, o.x + w / 4, o.y - 4, o.y + 2, 0, 0.8, "#1b1b1b");
      }
      const c = document.createElement("canvas");
      c.width = 512;
      c.height = 288;
      const tex = new T.CanvasTexture(c);
      tex.colorSpace = T.SRGBColorSpace;
      const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
      m.position.set(o.x - CX, z + h / 2, o.y - CY + 0.12);
      par.add(m);
      const light = new T.PointLight(0xffffff, 0, w * 2.4, 1.4);
      light.position.set(o.x - CX, z + h / 2, o.y - CY + 8);
      par.add(light);
      this._screens.push({ o, mesh: m, tex, canvas: c, light, sig: null });
    } else if (o.type === "model") {
      // placeholder until the model loads
      const ph = this._box(
        o.x - o.w / 2,
        o.x + o.w / 2,
        o.y - o.d / 2,
        o.y + o.d / 2,
        o.z || 0,
        o.h,
        this._mat("#d8cdb9", { transparent: true, opacity: 0.35, depthWrite: false }),
      );
      ph.castShadow = false;
      ph.userData.placeholder = true;
    }
  }

  _buildOverlay(this: Home3DCard, o: SceneItem) {
    const T = this.T;
    if (o.type === "sink") {
      const [x1, x2, y1, y2] = o.rect;
      this._box(x1, x2, y1, y2, o.z - 1.2, 1.4, "#8d9296");
      if (o.faucet) this._cyl(o.faucet[0], o.faucet[1], o.z, 0.6, 6, "#d8dadc");
    } else if (o.type === "burners")
      for (const [x, y] of o.pts) {
        const m = new T.Mesh(new T.TorusGeometry(3.2, 0.5, 6, 20), this._mat("#6b6f73"));
        m.rotation.x = Math.PI / 2;
        m.position.set(x - CX, o.z + 0.3, y - CY);
        this._add(m, false);
      }
    else if (o.type === "pendant") {
      this._cyl(o.x, o.y, o.z + 6, 0.25, (o.top ?? 62) - o.z - 6, "#3a3a3a", 6);
      this._fixture(o.x, o.y, this._cyl(o.x, o.y, o.z, 2.8, 6, this._emissive("#fff1cf"), 16));
    } else if (o.type === "fan") {
      const z = o.z ?? 44,
        r = o.r ?? 22;
      this._cyl(o.x, o.y, z + 1, 0.6, (o.ceiling ?? z + 8) - z - 1, "#2a1f17", 6);
      this._cyl(o.x, o.y, z, 4, 2.5, "#3b2d22", 16);
      for (let k = 0; k < 5; k++) {
        const a = (k * 2 * Math.PI) / 5 + 0.3;
        const m = new T.Mesh(new T.BoxGeometry(r - 4, 0.5, 5), this._mat("#5a4636"));
        m.position.set(o.x - CX + Math.cos(a) * (r / 2 + 2), z + 1.5, o.y - CY + Math.sin(a) * (r / 2 + 2));
        m.rotation.y = -a;
        this._add(m);
      }
      this._fixture(o.x, o.y, this._sphere(o.x, o.y, z - 0.5, 3.6, this._emissive("#fff3d0")));
    }
  }
}
