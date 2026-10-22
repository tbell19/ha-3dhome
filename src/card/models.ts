/* Sweet Home 3D models: opening libraries, extracting and caching models, and placing them in the scene.
 */
import type * as THREE from "three";
import type JSZip from "jszip";
import type { SceneItem } from "../types";
import type { Home3DCard } from "./card";
import { CX, CY, LIBS, LIB_DIR } from "../core/constants";
import { loadJSZip, loadModelLoaders } from "../core/libs";
import { parseProps, zipFind, dirOf, IDB, LIBCACHE, MODELCACHE } from "../core/sh3d";
import type { LibItem, Library, ModelFiles, ModelProto } from "../core/sh3d";

export class ModelsPart {
  /* ---------- Sweet Home 3D models ---------- */
  _jszip(this: Home3DCard): Promise<typeof JSZip> {
    return loadJSZip();
  }

  /** cm per plan unit: [horizontal, vertical] */
  _modelScale(this: Home3DCard): [number, number] {
    const s = this._cfg().scene?.model_scale;
    return Array.isArray(s) ? s : [2.1, 4];
  }

  /** open a downloaded library (once per page): its catalogs and furniture */
  _openLib(this: Home3DCard, file: string): Promise<Library> {
    if (!LIBCACHE.has(file)) {
      const p = (async () => {
        const res = await fetch(LIB_DIR + encodeURIComponent(file), { cache: "no-store" });
        if (!res.ok) throw new Error(`${file} not downloaded (${res.status})`);
        const JSZip = await this._jszip();
        const outer = await JSZip.loadAsync(await res.arrayBuffer());
        const sh3fs: Library["sh3fs"] = [];
        for (const name of Object.keys(outer.files)) {
          if (outer.files[name].dir || !/\.sh3f$/i.test(name)) continue;
          sh3fs.push({
            name: name.split("/").pop()!,
            zip: await JSZip.loadAsync(await outer.file(name)!.async("arraybuffer")),
          });
        }
        if (!sh3fs.length && outer.file(/PluginFurnitureCatalog\.properties$/).length)
          sh3fs.push({ name: "", zip: outer });
        const lic = LIBS.find((l) => l.file === file)?.lic || "";
        const items: LibItem[] = [];
        for (const s of sh3fs) {
          const cands = s.zip.file(/PluginFurnitureCatalog\.properties$/).sort((a, b) => a.name.length - b.name.length);
          if (!cands.length) continue;
          const bytes = await cands[0].async("uint8array");
          const props = parseProps(new TextDecoder("iso-8859-1").decode(bytes));
          for (const k of Object.keys(props)) {
            const m = k.match(/^name#(\d+)$/);
            if (!m) continue;
            const g = (f: string) => props[f + "#" + m[1]];
            const model = g("model");
            if (!model || !/\.(obj|zip)$/i.test(model)) continue;
            items.push({
              name: props[k],
              cat: g("category") || "Misc",
              icon: g("icon"),
              model,
              w: +g("width") || 50,
              d: +g("depth") || 50,
              h: +g("height") || 50,
              elev: +g("elevation") || 0,
              mr: g("modelRotation") || null,
              creator: g("creator") || "",
              sh3f: s.name,
              lib: file,
              lic,
            });
          }
        }
        if (!items.length) throw new Error(`No OBJ furniture found in ${file}`);
        items.sort((a, b) => a.cat.localeCompare(b.cat) || a.name.localeCompare(b.name));
        return { sh3fs, items };
      })();
      p.catch(() => LIBCACHE.delete(file));
      LIBCACHE.set(file, p);
    }
    return LIBCACHE.get(file)!;
  }

  async _extractModel(this: Home3DCard, o: SceneItem): Promise<ModelFiles> {
    const lib = await this._openLib(o.lib!);
    const s = lib.sh3fs.find((x) => x.name === (o.sh3f || "")) || lib.sh3fs[0];
    let zip = s.zip;
    let path = o.model!.replace(/^\/+/, "");
    if (/\.zip$/i.test(path)) {
      const JSZip = await this._jszip();
      const f = zipFind(zip, path);
      if (!f) throw new Error("model zip missing: " + path);
      zip = await JSZip.loadAsync(await f.async("arraybuffer"));
      const inner = Object.keys(zip.files).find((n) => /\.obj$/i.test(n));
      if (!inner) throw new Error("no OBJ inside " + o.model);
      path = inner;
    }
    const of = zipFind(zip, path);
    if (!of) throw new Error("model missing: " + path);
    const obj = await of.async("string");
    const dir = dirOf(of.name);
    const out: ModelFiles = { obj, mtl: null, tex: {} };
    const mtlName = (obj.match(/^\s*mtllib\s+(.+?)\s*$/m) || [])[1];
    if (mtlName) {
      const mf = zipFind(zip, dir + mtlName) || zipFind(zip, mtlName);
      if (mf) {
        out.mtl = await mf.async("string");
        const texDir = dirOf(mf.name);
        for (const mm of out.mtl.matchAll(/^\s*(?:map_\w+|bump|disp|refl)\s+(.+?)\s*$/gim)) {
          const tn = mm[1].split(/\s+/).pop()!.replace(/\\/g, "/");
          const tf = zipFind(zip, texDir + tn) || zipFind(zip, tn);
          if (tf) out.tex[tn.split("/").pop()!.toLowerCase()] = await tf.async("blob");
        }
      }
    }
    return out;
  }

  /** a library model, loaded once and shared by every copy (each device caches its files in IndexedDB) */
  _modelProto(this: Home3DCard, o: SceneItem): Promise<ModelProto> {
    const key = `${o.lib}|${o.sh3f || ""}|${o.model}`;
    if (!MODELCACHE.has(key)) {
      const p = (async () => {
        const T = this.T;
        let files: ModelFiles = await IDB.get(key);
        if (!files) {
          files = await this._extractModel(o);
          IDB.put(key, files);
        }
        const [{ OBJLoader }, { MTLLoader }] = await loadModelLoaders();
        const urls: Record<string, string> = {};
        for (const [n, b] of Object.entries(files.tex || {})) urls[n] = URL.createObjectURL(b);
        const mgr = new T.LoadingManager();
        mgr.setURLModifier((u) => urls[decodeURIComponent(u.split(/[\\/]/).pop()!).toLowerCase()] || u);
        mgr.onLoad = () => document.dispatchEvent(new Event("ha-3dhome-tex"));
        const loader = new OBJLoader(mgr);
        if (files.mtl) {
          const mats = new MTLLoader(mgr).parse(files.mtl, "");
          mats.preload();
          loader.setMaterials(mats);
        }
        const obj: THREE.Group = loader.parse(files.obj);
        if (o.mr) {
          const v = String(o.mr).trim().split(/\s+/).map(Number);
          if (v.length === 9 && v.every((n) => !isNaN(n)))
            obj.applyMatrix4(
              new T.Matrix4().set(v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, 0, 0, 0, 1),
            );
        }
        obj.traverse((m: any) => {
          if (!m.isMesh) return;
          m.castShadow = true;
          m.receiveShadow = true;
          m.userData.shared = true;
          for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
            mt.side = T.DoubleSide;
            if (mt.shininess != null) mt.shininess = Math.min(mt.shininess, 30);
          }
        });
        obj.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(obj);
        const size = box.getSize(new T.Vector3());
        const center = box.getCenter(new T.Vector3());
        return { node: obj, size, center, min: box.min.clone() };
      })();
      p.catch((e) => {
        console.warn("ha-3dhome model", key, e);
        MODELCACHE.delete(key);
      });
      MODELCACHE.set(key, p);
    }
    return MODELCACHE.get(key)!;
  }

  _loadModels(this: Home3DCard) {
    const objs = this._cfg().scene?.objects || [];
    objs.forEach((o, i) => {
      if (o.type !== "model") return;
      const key = "o:" + i;
      const world = this._world;
      this._modelProto(o)
        .then((proto) => {
          const outer = this._items.get(key);
          if (world !== this._world || !outer) return;
          const inner = outer.userData.inner;
          const T = this.T;
          const ph = inner.children.find((c: THREE.Object3D) => c.userData.placeholder);
          if (ph) {
            inner.remove(ph);
            ph.geometry.dispose();
          }
          const inst = proto.node.clone();
          inst.position.set(-proto.center.x, -proto.min.y, -proto.center.z);
          const holder = new T.Group();
          holder.add(inst);
          const sz = proto.size;
          holder.scale.set(o.w / (sz.x || 1), o.h / (sz.y || 1), o.d / (sz.z || 1));
          if (o.mirror) holder.scale.x *= -1;
          holder.position.set(o.x - CX, o.z || 0, o.y - CY);
          inner.add(holder);
          this._fadeGen = (this._fadeGen || 0) + 1; // its real size can change what blocks the framed room
          this._renderer.shadowMap.needsUpdate = true;
          this._scheduleBatch();
          this._requestRender();
        })
        .catch((e) => {
          const outer = this._items.get(key);
          const ph = outer?.userData.inner?.children.find((c: THREE.Object3D) => c.userData.placeholder);
          if (ph) ph.material = this._mat("#c2483d", { transparent: true, opacity: 0.45, depthWrite: false });
          if (world === this._world) (this._modelErr ||= {})[key] = String(e.message || e);
          this._requestRender();
        });
    });
  }
}
