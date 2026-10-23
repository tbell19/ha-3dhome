/* Static batching: outside the editor nothing in the house moves except lights, doors and screens, so the rest is merged
 * into one mesh per material (mergeGeometries). A few dozen draw calls instead of hundreds, and the merged meshes skip
 * the per-frame matrix update. The original meshes stay in the scene, hidden: picking, the editor and the see-through
 * room (_updateFade, which fades meshes one by one) still use them, and showing them again is just a visibility switch.
 */
import type * as THREE from "three";
import type { Home3DCard } from "./card";
import { loadGeometryUtils } from "../core/libs";

/** the vertex data a merged mesh keeps: what the scene's materials read */
const ATTRS = ["position", "normal", "uv", "color"];
/** what else has to match for two materials to draw as one, their colour moving into the vertices */
const SAME = [
  "type",
  "side",
  "flatShading",
  "emissiveIntensity",
  "opacity",
  "alphaTest",
  "wireframe",
  "fog",
  "toneMapped",
  "depthTest",
  "depthWrite",
  "colorWrite",
  "polygonOffset",
  "polygonOffsetFactor",
  "polygonOffsetUnits",
  "blending",
  "shininess",
  "roughness",
  "metalness",
  "reflectivity",
  "combine",
];
const MAPS = ["map", "emissiveMap", "normalMap", "bumpMap", "aoMap", "lightMap", "alphaMap", "specularMap", "envMap"];

export class BatchPart {
  /** Merges the world's static meshes, a moment after the last change (models arrive one by one). Not while editing. */
  _scheduleBatch(this: Home3DCard) {
    clearTimeout(this._batchT);
    this._batchT = null;
    if (this._edit || !this._world) return;
    const world = this._world;
    this._batchT = setTimeout(() => {
      this._batchT = null;
      loadGeometryUtils().then(({ mergeGeometries }) => {
        if (world === this._world && !this._edit) this._batch(mergeGeometries);
      });
    }, 300);
  }

  _batch(this: Home3DCard, merge: (geos: THREE.BufferGeometry[]) => THREE.BufferGeometry | null) {
    const T = this.T;
    const world = this._world!;
    this._unbatch();
    world.updateMatrixWorld(true);
    const moving = new Set<THREE.Object3D>(); // what changes after the build: lamps' glowing parts, door leaves, screens
    for (const g of this._lightGroups || []) for (const m of [...g.fixtures, ...(g.bulbs || [])]) moving.add(m);
    for (const dl of this._doorLeaves || []) for (const p of dl.parts) moving.add(p.node);
    for (const s of this._screens || []) moving.add(s.mesh);
    for (const f of this._fixtures || []) moving.add(f.mesh);
    const groups = new Map<
      string,
      { mat: THREE.Material; tint: boolean; mesh: THREE.Mesh; geos: THREE.BufferGeometry[]; from: THREE.Mesh[] }
    >();
    const visit = (o: THREE.Object3D) => {
      if (moving.has(o) || !o.visible) return; // a hidden group stays hidden
      for (const c of o.children) visit(c);
      const m = o as THREE.Mesh;
      if (!m.isMesh || (m as any).isInstancedMesh || (m as any).isSkinnedMesh || m.userData.batch) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.some((mt) => !mt || !mt.visible || mt.transparent)) return;
      const geo = m.geometry;
      if (!geo.attributes.position || !geo.attributes.normal) return;
      // each material's part of the geometry, in world space
      const parts = Array.isArray(m.material)
        ? geo.groups.map((gr) => ({ mat: mats[gr.materialIndex ?? 0], geo: slice(geo, gr.start, gr.count) }))
        : [{ mat: m.material as THREE.Material, geo: plain(geo) }];
      const flip = m.matrixWorld.determinant() < 0; // a mirrored model: turn its triangles back to face out
      for (const p of parts) {
        if (!p.geo) continue;
        p.geo.applyMatrix4(m.matrixWorld);
        if (flip) reverseWinding(p.geo);
        const tint = tintKey(p.mat);
        if (tint) tintVertices(p.geo, (p.mat as THREE.MeshLambertMaterial).color);
        else if (!(p.mat as any).vertexColors) p.geo.deleteAttribute("color");
        const sig = [
          tint ?? p.mat.uuid,
          m.castShadow,
          m.receiveShadow,
          m.renderOrder,
          m.customDepthMaterial?.uuid, // floors keep out of the shadow maps this way
          m.customDistanceMaterial?.uuid,
          ...ATTRS.map((a) => !!p.geo.attributes[a]),
        ];
        const k = sig.join("|");
        let gr = groups.get(k);
        if (!gr) groups.set(k, (gr = { mat: p.mat, tint: !!tint, mesh: m, geos: [], from: [] }));
        gr.geos.push(p.geo);
        if (!gr.from.includes(m)) gr.from.push(m);
      }
    };
    visit(world);
    const box = new T.Group();
    box.name = "batch";
    box.matrixAutoUpdate = false;
    const hidden = new Set<THREE.Mesh>();
    const kept = new Set<THREE.Mesh>();
    for (const gr of groups.values()) {
      const geo = gr.geos.length > 1 ? merge(gr.geos) : gr.geos[0];
      for (const g of gr.geos) if (g !== geo) g.dispose();
      if (!geo) {
        for (const m of gr.from) kept.add(m); // pieces that wouldn't merge: their meshes stay as they are
        continue;
      }
      let mat = gr.mat;
      if (gr.tint) {
        // one copy of the material in white, tinted by the colours the vertices now carry
        mat = gr.mat.clone();
        (mat as THREE.MeshLambertMaterial).color.setRGB(1, 1, 1);
        (mat as THREE.MeshLambertMaterial).vertexColors = true;
        mat.userData.batchCopy = true;
      }
      const mm = new T.Mesh(geo, mat);
      mm.castShadow = gr.mesh.castShadow;
      mm.receiveShadow = gr.mesh.receiveShadow;
      mm.renderOrder = gr.mesh.renderOrder;
      mm.customDepthMaterial = gr.mesh.customDepthMaterial;
      mm.customDistanceMaterial = gr.mesh.customDistanceMaterial;
      mm.matrixAutoUpdate = false;
      mm.userData.batch = true;
      mm.userData.from = gr.from;
      box.add(mm);
      for (const m of gr.from) hidden.add(m);
    }
    for (const m of kept) hidden.delete(m); // whole, even where another of its materials did merge
    box.visible = false;
    world.add(box);
    box.updateMatrixWorld(true);
    this._batchBox = box;
    this._batched = [...hidden];
    this._batchOn = false;
    // the merged copies' materials are new shaders (colour from the vertices): build them before they show, or the
    // first frame with them waits on the compile
    this._prepareShaders(box)
      .catch(() => {})
      .then(() => {
        if (this._batchBox !== box || this._edit) return;
        box.userData.ready = true;
        this._showBatch(!this._faded?.size); // a see-through room keeps the originals (_updateFade)
        this._renderer.shadowMap.needsUpdate = true;
        this._requestRender();
      });
  }

  /** Shows the merged meshes (on) or the originals (off). The see-through room needs the originals. */
  _showBatch(this: Home3DCard, on: boolean) {
    if (!this._batchBox?.userData.ready || this._batchOn === on) return;
    this._batchOn = on;
    this._batchBox.visible = on;
    for (const m of this._batched || []) m.visible = !on;
  }

  /** Drops the merged meshes and shows the originals again. */
  _unbatch(this: Home3DCard) {
    clearTimeout(this._batchT);
    this._batchT = null;
    this._showBatch(false);
    const box = this._batchBox;
    if (box) {
      box.removeFromParent();
      for (const m of box.children as THREE.Mesh[]) {
        m.geometry.dispose();
        if ((m.material as THREE.Material).userData.batchCopy) (m.material as THREE.Material).dispose();
      }
    }
    this._batchBox = null;
    this._batched = null;
    this._batchOn = false;
  }
}

/** a non-indexed copy holding only the attributes in ATTRS (merged meshes all match) */
function plain(geo: THREE.BufferGeometry) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const name of Object.keys(g.attributes)) if (!ATTRS.includes(name)) g.deleteAttribute(name);
  for (const name of Object.keys(g.morphAttributes)) delete g.morphAttributes[name];
  g.clearGroups();
  return g;
}

/** one material group of a geometry, as its own non-indexed geometry */
function slice(geo: THREE.BufferGeometry, start: number, count: number) {
  const g = plain(geo);
  const n = g.attributes.position.count;
  const end = Math.min(n, start + (isFinite(count) ? count : n));
  if (end <= start) return null;
  if (start === 0 && end === n) return g;
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    const s = a.itemSize;
    g.setAttribute(name, new (a.constructor as any)(a.array.slice(start * s, end * s), s, a.normalized));
  }
  return g;
}

/** swaps the second and third corner of every triangle (non-indexed) */
function reverseWinding(geo: THREE.BufferGeometry) {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name] as THREE.BufferAttribute;
    const arr = a.array;
    const s = a.itemSize;
    for (let t = 0; t + 2 < a.count; t += 3)
      for (let c = 0; c < s; c++) {
        const i = (t + 1) * s + c;
        const j = (t + 2) * s + c;
        const v = arr[i];
        arr[i] = arr[j];
        arr[j] = v;
      }
  }
}

/** → a key shared by materials that differ only in colour, or null when the colour can't move into the vertices */
function tintKey(mat: THREE.Material): string | null {
  const m = mat as any;
  const hooked = m.onBeforeCompile !== mat.constructor.prototype.onBeforeCompile;
  if (!m.color?.isColor || m.vertexColors || hooked) return null;
  const parts = SAME.map((k) => (m[k]?.isColor ? m[k].getHex() : m[k]));
  for (const k of [...MAPS, "emissive", "specular"]) parts.push(m[k]?.uuid ?? (m[k]?.isColor ? m[k].getHex() : null));
  return "tint|" + JSON.stringify(parts);
}

/** gives every vertex the material's colour (linear, as the material holds it) */
function tintVertices(geo: THREE.BufferGeometry, color: THREE.Color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = color.r;
    arr[i * 3 + 1] = color.g;
    arr[i * 3 + 2] = color.b;
  }
  geo.setAttribute("color", new (geo.attributes.position.constructor as any)(arr, 3));
}
