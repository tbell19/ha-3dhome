/* Lights: the sun, the compass, light fixtures and glow, and the sky light through windows.
 */
import type * as THREE from "three";
import type { CardConfig, Colour, LightConfig, Pt } from "../types";
import type { AnyMesh, Home3DCard, LightGroup } from "./card";
import { CX, CY, OUTDOOR } from "../core/constants";
import { rotPt, inPoly, mean } from "../core/util";
import { FIXTURES, stringLen, spanSag, stringBulbs } from "../core/fixtures";
import { solarPosition, sunVector } from "../core/sun";

export class LightsPart {
  /* ---------- lights ---------- */
  _glowTexture(this: Home3DCard) {
    if (this._glowTex) return this._glowTex;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(255,255,255,1)");
    r.addColorStop(0.25, "rgba(255,255,255,.55)");
    r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
    return (this._glowTex = new this.T.CanvasTexture(c));
  }

  _buildCompass(this: Home3DCard, north: number) {
    // editing only: a flat north arrow beside the house
    const T = this.T;
    const G = new T.Group();
    const noPick = () => {};
    const tri = (pts: Pt[], color: Colour) => {
      const geo = new T.ShapeGeometry(new T.Shape(pts.map(([x, y]) => new T.Vector2(x, y))));
      geo.rotateX(Math.PI / 2);
      const m = new T.Mesh(
        geo,
        new T.MeshBasicMaterial({ color, side: T.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }),
      );
      m.raycast = noPick;
      G.add(m);
    };
    tri(
      [
        [0, -18],
        [-6, 0],
        [6, 0],
      ],
      "#e5484d",
    );
    tri(
      [
        [0, 18],
        [-6, 0],
        [6, 0],
      ],
      "#f2efe8",
    );
    const ring = new T.Mesh(
      new T.RingGeometry(19, 21, 40),
      new T.MeshBasicMaterial({
        color: "#f2efe8",
        side: T.DoubleSide,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.raycast = noPick;
    G.add(ring);
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#e5484d";
    g.font = "bold 48px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("N", 32, 34);
    const lab = new T.Mesh(
      new T.PlaneGeometry(11, 11),
      new T.MeshBasicMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false }),
    );
    lab.rotation.x = -Math.PI / 2;
    lab.position.z = -28;
    lab.raycast = noPick;
    G.add(lab);
    G.traverse((o) => {
      o.castShadow = false;
      o.receiveShadow = false;
      o.renderOrder = 2;
    });
    G.position.set(622 - CX, 1, 250 - CY);
    G.rotation.y = (-north * Math.PI) / 180;
    this._world.add(G);
  }

  /* Where the sun is: editor preview hour, then sun.sun's azimuth/elevation, then computed from HA's home location. */
  _sunPos(this: Home3DCard) {
    const h = this._hass;
    const cfg = this._cfg();
    const lat = h?.config?.latitude;
    const lon = h?.config?.longitude;
    if (this._sunPreview != null && lat != null && lon != null) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setMinutes(this._sunPreview * 60);
      return solarPosition(d, lat, lon);
    }
    const a = h?.states[cfg.sun_entity || "sun.sun"]?.attributes;
    if (a && isFinite(a.azimuth) && isFinite(a.elevation))
      return { azimuth: Number(a.azimuth), elevation: Number(a.elevation) };
    if (lat != null && lon != null) return solarPosition(new Date(), lat, lon);
    return null;
  }

  _placeSun(this: Home3DCard, az: number, el: number, north: number) {
    const [x, y, z] = sunVector(az, el, north);
    const D = 650;
    this._sun.target.position.set(0, 0, 0);
    this._sun.position.set(x * D, y * D, z * D);
    const key = `${Math.round(az * 2)}:${Math.round(el * 2)}:${north}`;
    if (key !== this._sunKey) {
      this._sunKey = key;
      if (this._renderer) this._renderer.shadowMap.needsUpdate = true;
    }
  }

  /* per-light tuning that needs no rebuild: reach (`r`), falloff (`decay`), beam width (`angle`, degrees) and edge (`soft`)
   * for spot lights, and the glow sprite size (`halo`). Brightness and saturation are applied in _update(). */
  _tuneLight(this: Home3DCard, rec: LightGroup) {
    const L = rec.L;
    const l = rec.light as THREE.PointLight & Partial<THREE.SpotLight>;
    const r = L.r ?? 40;
    if (rec.kind === "string") l.distance = Math.max(140, stringLen(L.points || []) * 0.9) * (r / 40);
    else l.distance = r * (l.isSpotLight ? 3.2 : 2.6);
    l.decay = L.decay ?? (rec.kind === "glow" ? 1.1 : 1.2);
    if (l.isSpotLight) {
      l.angle = L.angle != null ? (Math.max(5, Math.min(85, L.angle)) * Math.PI) / 180 : rec.down ? 0.9 : 0.75;
      l.penumbra = L.soft ?? 0.8;
    }
    rec.sprite?.scale.setScalar((L.halo ?? 9) * 2.2);
  }

  _buildLights(this: Home3DCard) {
    const T = this.T;
    const cfg = this._cfg();
    const W = this._world;
    this._amb = new T.AmbientLight(0xffffff, 0.6);
    W.add(this._amb);
    this._hemi = new T.HemisphereLight(0xdfe8ff, 0x3a2f25, 0.4);
    W.add(this._hemi);
    const sun = (this._sun = new T.DirectionalLight(0xfff1dc, 1.2));
    sun.position.set(-260, 420, -160);
    sun.castShadow = true; // moved by _placeSun() from the sun's real position
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -380, right: 380, top: 380, bottom: -380, near: 10, far: 1400 });
    sun.shadow.bias = -0.0008;
    W.add(sun);
    W.add(sun.target);
    this._sunKey = null;
    if (this._edit) this._buildCompass(cfg.scene?.north || 0);
    // cool fill from the front-right, used by the gradient-lighting look (see _applyLook)
    this._fill = new T.DirectionalLight(0xb9c8ff, 0);
    this._fill.position.set(300, 260, 360);
    this._fill.visible = false;
    W.add(this._fill);
    this._buildSkyLights(cfg);

    // group co-located bulbs into one physical light per fixture
    const groups = new Map<string, Pick<LightGroup, "kind" | "members" | "keys" | "L">>();
    (cfg.lights || []).forEach((L, i) => {
      if (L.fixture === "string") {
        groups.set("e" + i, { kind: "string", members: [L], keys: ["l:" + i], L });
        return;
      }
      const key = `${Math.round(L.x)}:${Math.round(L.y)}:${Math.round(L.z ?? 40)}`;
      if (!groups.has(key)) groups.set(key, { kind: "glow", members: [], keys: [], L });
      groups.get(key)!.members.push(L);
      groups.get(key)!.keys.push("l:" + i);
    });
    let shadowBudget = cfg.max_shadow_lights ?? 8;
    const ranked = [...groups.values()].sort((a, b) => (b.L.r ?? 40) - (a.L.r ?? 40));
    this._lightGroups = ranked.map((g) => {
      const L = g.L;
      const rec = { ...g, fixtures: [] } as unknown as LightGroup; // the rest is filled in below
      const grp = new T.Group();
      grp.userData.key = g.keys[0];
      W.add(grp);
      for (const k of g.keys) this._items.set(k, grp);
      rec.group = grp;
      if (g.kind === "string") {
        const pts = L.points || [];
        const [mx, my] = pts.length ? mean(pts) : [CX, CY];
        rec.light = new T.PointLight(0xffd59a, 0, 140, 1.2);
        rec.light.position.set(mx - CX, (L.z ?? 17) + 4, my - CY);
        rec.bulbs = this._buildFixture(L, grp);
      } else {
        const aimed = L.gx != null && Math.hypot(L.gx - L.x, L.gy - L.y) > 12;
        const down = !aimed && L.fixture === "can"; // can lights shine straight down
        const r = L.r ?? 40;
        const z = L.z ?? 40;
        if (aimed || down) {
          rec.light = new T.SpotLight(0xffffff, 0, r * 3.2, down ? 0.9 : 0.75, 0.8, 1.1);
          rec.down = down;
          const spot = rec.light as THREE.SpotLight;
          spot.target.position.set((down ? L.x : L.gx) - CX, down ? 0 : (L.gz ?? 0), (down ? L.y : L.gy) - CY);
          grp.add(spot.target);
        } else rec.light = new T.PointLight(0xffffff, 0, r * 2.6, 1.1);
        rec.light.position.set(L.x - CX, z - 2, L.y - CY);
        rec.fixtures = [
          ...this._buildFixture(L, grp),
          ...this._fixtures.filter((f) => Math.hypot(f.x - L.x, f.y - L.y) < 6).map((f) => f.mesh),
        ];
        const sp = new T.Sprite(
          new T.SpriteMaterial({
            map: this._glowTexture(),
            color: 0xffffff,
            transparent: true,
            depthWrite: false,
            blending: T.AdditiveBlending,
            opacity: 0,
          }),
        );
        sp.position.set(L.x - CX, z - 1, L.y - CY);
        grp.add(sp);
        rec.sprite = sp;
      }
      this._tuneLight(rec);
      if (shadowBudget > 0 && g.kind === "glow" && cfg.shadows !== false && L.shadow !== false) {
        rec.light.castShadow = true;
        shadowBudget--;
        rec.light.shadow.mapSize.set(cfg.shadow_map_size || 512, cfg.shadow_map_size || 512);
        rec.light.shadow.bias = -0.002;
        rec.light.shadow.camera.near = 1;
        (rec.light.shadow as THREE.LightShadow & { blurSamples: number }).blurSamples = 8; // only used by the soft (VSM) shadows of the gradient-lighting look
      }
      grp.add(rec.light);
      return rec;
    });
  }

  /* a light's own fixture model (`L.fixture`), built into the light's group so it moves with it. Returns the meshes that
   * glow (emissive) when the light is on. Fixtures never cast shadows, or they would shadow their own light. */
  _buildFixture(this: Home3DCard, L: LightConfig, grp: THREE.Group): AnyMesh[] {
    const T = this.T;
    const f = L.fixture;
    if (!f || !FIXTURES[f] || f === "none") return [];
    const fix = new T.Group();
    fix.userData.fixture = true;
    grp.add(fix);
    const cur = this._cur;
    const nc = this._noCast;
    this._cur = fix;
    this._noCast = true;
    const H = this._cfg().scene?.wall_height ?? 46;
    const x = L.x;
    const y = L.y;
    const z = L.z ?? 40;
    const lit: AnyMesh[] = [];
    const glow = (c = "#fff1cf") => this._emissive(c);
    const metal = L.trim || "#2a2a2a";
    const s = L.size! > 0 ? L.size! : 1; // `size` scales the fixture about the bulb; cords still reach the ceiling
    if (f === "can") {
      this._cyl(x, y, z - 0.4 * s, 2.8 * s, 0.4 * s, "#e4e0d8", 20);
      lit.push(this._cyl(x, y, z - 0.5 * s, 2 * s, 0.2 * s, glow(), 20));
    } else if (f === "ceiling") {
      this._cyl(x, y, z - 0.6 * s, 5.2 * s, 0.6 * s, "#e8e4dc", 24);
      lit.push(this._cyl(x, y, z - 2.6 * s, 4.8 * s, 2 * s, glow(), 24, 3.6 * s));
    } else if (f === "pendant") {
      if (H - z > 4 * s) this._cyl(x, y, z + 3 * s, 0.25, H - z - 3 * s, "#3a3a3a", 6);
      this._cyl(x, y, z - 1 * s, 4.2 * s, 4 * s, L.shade || metal, 20, 1.2 * s);
      lit.push(this._cyl(x, y, z - 1.1 * s, 3.8 * s, 0.2 * s, glow(), 20));
    } else if (f === "bulb") {
      if (H - z > 3 * s) this._cyl(x, y, z + 1.4 * s, 0.2, H - z - 1.4 * s, "#3a3a3a", 6);
      this._cyl(x, y, z + 0.6 * s, 0.6 * s, 1 * s, "#8a7a5a", 8);
      lit.push(this._sphere(x, y, z, 1.4 * s, glow("#fff1c4")));
    } else if (f === "floorlamp") {
      this._cyl(x, y, 0, 4 * s, 1 * s, metal, 18);
      this._cyl(x, y, 0, 0.6 * s, Math.max(1, z - 3 * s), metal, 8);
      lit.push(this._cyl(x, y, z - 3 * s, 5.5 * s, 8 * s, glow("#fbf3e2"), 20, 4.5 * s));
    } else if (f === "tablelamp") {
      this._cyl(x, y, z - 9 * s, 2 * s, 6 * s, L.shade || "#cfcfcf", 14, 1.4 * s);
      lit.push(this._cyl(x, y, z - 3 * s, 4.5 * s, 6 * s, glow("#fbf3e2"), 20, 3.6 * s));
    } else if (f === "string") {
      const pts = L.points || [];
      const mat = glow("#fff1c4");
      const cord = this._mat("#2b2b2b");
      const seg = (a: number[], b: number[]) => {
        // a cord piece between two [x, y, z] points
        const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (len < 0.01) return;
        const m = new T.Mesh(new T.CylinderGeometry(0.18, 0.18, len, 5), cord);
        m.position.set((a[0] + b[0]) / 2 - CX, (a[2] + b[2]) / 2, (a[1] + b[1]) / 2 - CY);
        m.quaternion.setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          new T.Vector3(b[0] - a[0], b[2] - a[2], b[1] - a[1]).normalize(),
        );
        this._add(m, false);
      };
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        const sag = spanSag(L, Math.hypot(b[0] - a[0], b[1] - a[1]));
        let prev = [a[0], a[1], z];
        for (let k = 1; k <= 12; k++) {
          const t = k / 12;
          const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, z - sag * 4 * t * (1 - t)];
          seg(prev, p);
          prev = p;
        }
      }
      for (const [bx, by, drop] of stringBulbs(L)) {
        this._cyl(bx, by, z - drop - 1 * s, 0.35 * s, 1 * s, "#2b2b2b", 6);
        lit.push(this._sphere(bx, by, z - drop - 1.8 * s, 0.95 * s, mat));
      }
    }
    this._cur = cur;
    this._noCast = nc;
    return lit;
  }

  /* rebuild one light's model in place (dragging a string's ends), keeping its live colour */
  _refreshFixture(this: Home3DCard, key: string) {
    const rec = this._lightGroups?.find((g) => g.keys.includes(key));
    if (!rec) return;
    for (const c of [...rec.group.children])
      if (c.userData.fixture) {
        rec.group.remove(c);
        this._disposeTree(c);
      }
    const L = (rec.L = rec.members[0] = this._editor.item(key) as LightConfig);
    if (rec.kind === "string") {
      rec.bulbs = this._buildFixture(L, rec.group);
      const [mx, my] = mean(L.points!);
      rec.light.position.set(mx - CX, (L.z ?? 17) + 4, my - CY);
      this._tuneLight(rec);
    } else rec.fixtures = this._buildFixture(L, rec.group);
    this._update();
  }

  /* Daylight through windows: the roof blocks the sun except through openings, but a bright sky still lights a room.
   * Each window, glass door or glass wall between a roofed room and the outside gets a soft, shadowless spot light
   * aimed into the room, scaled by daylight in _update (`window_light` multiplies it; `daylight: false` on an opening skips it). */
  _buildSkyLights(this: Home3DCard, cfg: CardConfig) {
    const T = this.T;
    const sc = cfg.scene || {};
    this._skyLights = [];
    if (this._plan || cfg.window_light === 0) return;
    const rooms = (sc.floors || []).filter(
      (f) =>
        f.pts?.length >= 3 && f.name !== "rug" && f.roof !== false && (f.roof === true || !OUTDOOR.test(f.name || "")),
    );
    const indoor = (x: number, y: number) => rooms.some((f) => inPoly(x, y, f.pts));
    const H = sc.wall_height ?? 46;
    const aps: { x: number; y: number; ax: number; ay: number; w: number; z: number; h: number }[] = [];
    for (const o of sc.openings || []) {
      if (
        o.daylight === false ||
        !(o.kind === "window" || o.daylight || (o.kind === "door" && /glass|sliding/.test(o.style || "")))
      )
        continue;
      const [ax, ay] = rotPt(1, 0, 0, 0, o.rot || 0);
      aps.push({ x: o.x, y: o.y, ax, ay, w: o.w, z: o.z || 0, h: o.h ?? H });
    }
    aps.sort((a, b) => b.w - a.w);
    for (const a of aps.slice(0, cfg.max_window_lights ?? 10)) {
      let [nx, ny] = [-a.ay, a.ax]; // pick the normal that points from outside into a room
      const p = 10;
      const inA = indoor(a.x + nx * p, a.y + ny * p);
      const inB = indoor(a.x - nx * p, a.y - ny * p);
      if (inA === inB) continue; // interior partition, or nowhere near a room
      if (!inA) {
        nx = -nx;
        ny = -ny;
      }
      const reach = Math.min(90, Math.max(30, a.w * 0.8));
      const top = Math.min(a.z + a.h, H) - 4;
      const L = new T.SpotLight(
        0xe4ecff,
        0,
        reach * 2.4,
        Math.min(1.3, Math.atan((a.w / 2 + 20) / reach) + 0.35),
        1,
        1,
      );
      L.position.set(a.x + nx * 3 - CX, Math.max(a.z + 6, top), a.y + ny * 3 - CY);
      L.target.position.set(a.x + nx * reach - CX, 0, a.y + ny * reach - CY);
      this._world.add(L, L.target);
      this._skyLights.push({ light: L, w: a.w });
    }
  }
}
