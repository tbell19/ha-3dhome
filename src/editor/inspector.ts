/* The inspector's logic: what its fields do to the selected items. The inspector itself is drawn by
 * inspector-panel.tsx (and plan-inspector.tsx in floor plan mode).
 */
import type { BoxEntry } from "../types";
import type { GenericItem } from "../core/items";
import type { LightGroup } from "../card/card";
import type { Editor } from "./editor";
import { showInspector } from "./inspector-panel";
import {
  CX,
  CY,
  round1,
  ROTATABLE,
  bArr,
  itemCenter,
  itemBase,
  itemZ,
  scaleItem,
  mapPts,
  mean,
  stringLen,
  shiftItem,
} from "./shared.js";

/** One light setting slider. `normal` is the value when the light doesn't set it. */
export interface LightTuneRow {
  field: string;
  label: string;
  min: number;
  max: number;
  step: number;
  normal: number;
  format: (v: number) => string;
  hint: string;
}

export class EditorInspector {
  renderInspector(this: Editor) {
    const box = this.card._editorLayer.querySelector<HTMLElement>(".insp");
    if (box) showInspector(this, box);
  }

  /** folds the inspector to its title bar, or unfolds it */
  toggleInspector(this: Editor) {
    this._inspMin = !this._inspMin;
    this.renderInspector();
  }

  toggleScaleLock(this: Editor) {
    this.card._edit.lock = !this.card._edit.lock;
    this.renderInspector();
  }

  /* ----- per-light tuning: what this light looks like at the bulb's full brightness and colour. The live state from
   * Home Assistant still scales it; these set the top end (see _update / _tuneLight in the core). ----- */
  _lightTuneRows(this: Editor, item: GenericItem): LightTuneRow[] {
    const aimed = item.gx != null && Math.hypot(item.gx - item.x, item.gy - item.y) > 12;
    const spot = aimed || (item.fixture === "can" && !item.points);
    const glow = !item.points;
    const pct = (v: number) => Math.round(v * 100) + "%";
    const row = (
      field: string,
      label: string,
      [min, max, step, normal]: number[],
      format: (v: number) => string,
      hint = "",
    ): LightTuneRow => ({ field, label, min, max, step, normal, format, hint });
    const rows = [
      row("intensity", "Brightness", [0, 4, 0.05, 1], pct, "At the bulb's full brightness"),
      row("saturation", "Colour", [0, 2, 0.05, 1], pct, "How strongly the bulb's colour shows"),
      row("r", "Reach", [5, 200, 1, 40], (v) => this.card._fmtLen(v * (spot ? 3.2 : 2.6)), "How far the light travels"),
      row(
        "decay",
        "Falloff",
        [0, 3, 0.1, glow ? 1.1 : 1.2],
        (v) => v.toFixed(1),
        "Low lights evenly to the edge, high fades fast",
      ),
    ];
    if (spot)
      rows.push(
        row("angle", "Beam width", [10, 85, 1, aimed ? 43 : 52], (v) => Math.round(v) + "°"),
        row("soft", "Beam edge", [0, 1, 0.05, 0.8], (v) => (v < 0.15 ? "Sharp" : pct(v) + " soft")),
      );
    if (glow) rows.push(row("halo", "Glow size", [0, 30, 1, 9], (v) => String(v), "The halo drawn around the bulb"));
    return rows;
  }

  /** the light a key belongs to and its items: co-located bulbs (a two-bulb fan) render as one light, so a setting
   * applies to all of them */
  _lightMembers(this: Editor, key: string): [LightGroup | null, GenericItem[]] {
    const group = this.card._lightGroups?.find((g) => g.keys.includes(key));
    return group ? [group, group.keys.map((k) => this.item(k))] : [null, [this.item(key)]];
  }

  /** One step of dragging a light setting slider: shown at once, one undo step for the whole drag. */
  tuneLight(this: Editor, key: string, field: string, value: number) {
    if (!this._ltDrag) {
      this._pushUndo();
      this._ltDrag = true;
    }
    const normal = this._lightTuneRows(this.item(key)).find((r) => r.field === field)?.normal;
    const [group, items] = this._lightMembers(key);
    for (const item of items)
      if (value === normal) delete item[field];
      else item[field] = value;
    if (group) {
      group.L = this.item(group.keys[0]);
      this.card._tuneLight(group);
    }
    this.card._update();
    this.card._requestRender();
    this.renderInspector();
  }

  finishLightTune(this: Editor) {
    if (!this._ltDrag) return;
    this._ltDrag = false;
    this.commit();
  }

  resetLightTune(this: Editor, key: string) {
    const fields = this._lightTuneRows(this.item(key)).map((r) => r.field);
    this._mutate(() => {
      for (const item of this._lightMembers(key)[1]) for (const field of fields) delete item[field];
      return [...this.card._edit.sel];
    });
  }

  /* ----- north and the sun preview ----- */
  setNorth(this: Editor, degrees: number) {
    if (!isFinite(degrees)) return;
    const north = round1(((degrees % 360) + 360) % 360);
    this._mutate(() => {
      const scene = (this.card._work.scene ||= {});
      if (north) scene.north = north;
      else delete scene.north;
      return [...this.card._edit.sel];
    });
  }

  /** shows the sun at `hour` (0 to 24), or where it is now with null; leaving the editor ends the preview */
  previewSun(this: Editor, hour: number | null) {
    this.card._sunPreview = hour;
    this.card._update();
    this.card._requestRender();
    this.renderInspector();
  }

  /** replaces an item with JSON typed into the inspector */
  applyJson(this: Editor, key: string, text: string) {
    let value;
    try {
      value = JSON.parse(text);
    } catch (e: any) {
      return this.card._toast("Invalid JSON: " + e.message);
    }
    this._mutate(() => {
      const [kind, i] = key.split(":");
      this._list(kind)[+i] = value;
      return [...this.card._edit.sel];
    });
  }

  _field(this: Editor, key: string, name: string, raw?: any) {
    const num = Number(raw);
    if (name === "level") {
      // take out any tilt, keep the turn
      const sel = [...this.card._edit.sel];
      return this._mutate(() => {
        for (const kk of sel) {
          const o = this.item(kk);
          if (o && !Array.isArray(o) && (o.rx || o.rz)) {
            delete o.rx;
            delete o.rz;
          }
        }
        return sel;
      });
    }
    if (name === "rotl" || name === "rotr") {
      const sel = [...this.card._edit.sel];
      return this._mutate(() => {
        this._applyRotate(sel, name === "rotl" ? -90 : 90, this._pivotC);
        return sel;
      });
    }
    if (!["entity", "color", "mirror", "resetsize", "stand", "straighten"].includes(name) && (isNaN(num) || raw === ""))
      return;
    if (["px", "py", "pz", "rx", "ry", "rz", "sx", "sy", "sz", "wx", "wy", "wz", "size", "hit"].includes(name))
      return this._transformField(name, num);
    this._mutate(() => {
      const item = this.item(key);
      if (name === "len" && item.points?.length > 1) {
        // stretch (or shrink) the last span; bulbs follow
        const P = item.points;
        const a = P[P.length - 2];
        const b = P[P.length - 1];
        const span = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const ns = Math.max(1, span + this._fromReal(num) - stringLen(P));
        P[P.length - 1] = [round1(a[0] + ((b[0] - a[0]) / span) * ns), round1(a[1] + ((b[1] - a[1]) / span) * ns)];
      } else if (name === "count") {
        if (num > 0) item.count = Math.min(200, Math.round(num));
        else delete item.count;
      } else if (name === "sag") item.sag = Math.max(0, num);
      else if (name === "straighten" && item.points?.length > 2) item.points = [item.points[0], item.points.at(-1)];
      else if (name === "entity") item.entity = raw.trim();
      else if (name === "color") {
        const b = bArr(item as BoxEntry);
        const T = this.card.T;
        const col = new T.Color(raw);
        b[5] = [
          raw,
          "#" + col.clone().multiplyScalar(0.78).getHexString(),
          "#" + col.clone().multiplyScalar(0.88).getHexString(),
        ];
      } else if (name === "mirror") item.mirror = !item.mirror || undefined;
      else if (name === "stand") item.stand = !item.stand || undefined;
      else if (name === "resetsize") {
        const [sxy, sz] = this.card._modelScale();
        item.w = round1(item.cm[0] / sxy);
        item.d = round1(item.cm[1] / sxy);
        item.h = round1(item.cm[2] / sz);
      }
      return [...this.card._edit.sel];
    });
  }

  /* ----- transform fields: position, rotation and size of the selection. Inputs are in cm or inches (model_scale, the
   * same scale Set scale fits the blueprint to); the plan stores plan units. ----- */
  _selPos(this: Editor) {
    const keys = [...this.card._edit.sel];
    if (keys.length === 1) {
      const kind = keys[0][0];
      const item = this.item(keys[0]);
      const c = itemCenter(kind, item) || [CX, CY];
      return [c[0], c[1], itemZ(kind, item)];
    }
    return [...this._pivotC, Math.min(...keys.map((key) => itemBase(key[0], this.item(key))))];
  }

  /* which way an item faces: `rot` for furniture, the run of a string light, or an aimed light's beam; null if it has no direction */
  _itemAngle(this: Editor, kind: string, item: GenericItem) {
    if (ROTATABLE.has(kind)) return Array.isArray(item) ? 0 : item.rot || 0;
    const p =
      item.points?.length > 1
        ? [item.points[0], item.points.at(-1)]
        : item.gx != null && Math.hypot(item.gx - item.x, item.gy - item.y) > 12
          ? [
              [item.x, item.y],
              [item.gx, item.gy],
            ]
          : null;
    return p
      ? round1(((((Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]) * 180) / Math.PI) % 360) + 360) % 360)
      : null;
  }

  /* [width, depth, height] of one item along its own axes, in plan units (0 where that axis can't change) */
  _dims(this: Editor, key: string) {
    const kind = key[0];
    const item = this.item(key);
    if (kind === "b") {
      const b = bArr(item as BoxEntry);
      return [b[1] - b[0], b[3] - b[2], b[4]];
    }
    if (item.type === "model") return [item.w, item.d, item.h];
    if (item.type === "screen") {
      const w = item.w || 32;
      return [w, 0, (w * 9) / 16];
    }
    if (item.type === "table") return [item.r * 2, 0, item.z];
    const g = this.card._items.get(key);
    if (!g) return null;
    const r = g.rotation.y;
    const tg = g.children[0]?.userData.tilt ? g.children[0] : null;
    const tr = tg?.rotation.clone(); // measured untilted
    g.rotation.y = 0;
    tg?.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const box = new this.card.T.Box3().setFromObject(g);
    g.rotation.y = r;
    if (tg) tg.rotation.copy(tr);
    g.updateMatrixWorld(true);
    if (box.isEmpty()) return null;
    const s = box.getSize(new this.card.T.Vector3());
    return [s.x, s.z, s.y];
  }

  /* the selection's overall size, lined up with the plan */
  _selDims(this: Editor) {
    const T = this.card.T;
    const box = new T.Box3();
    for (const key of this.card._edit.sel) {
      const kind = key[0];
      const g = this.card._items.get(key);
      if (ROTATABLE.has(kind) && g) {
        g.updateMatrixWorld(true);
        box.expandByObject(g);
      } else {
        const c = itemCenter(kind, this.item(key));
        if (c) box.expandByPoint(new T.Vector3(c[0] - CX, c[2] ?? 0, c[1] - CY));
      }
    }
    if (box.isEmpty()) return null;
    const s = box.getSize(new T.Vector3());
    return [s.x, s.z, s.y];
  }

  _transformField(this: Editor, name: string, v: number) {
    const T = this.card.T;
    const sel = [...this.card._edit.sel];
    const key = this.card._edit.primary;
    const kind = key[0];
    const item = this.item(key);
    const pos = this._selPos();
    this._mutate(() => {
      if (name[0] === "p") {
        // position: x across, y up (elevation), z front to back
        const i = { px: 0, pz: 1, py: 2 }[name];
        const d = this._fromReal(v, i === 2) - (pos[i] ?? 0);
        if (Math.abs(d) > 0.01) this._applyMove(sel, i === 0 ? d : 0, i === 1 ? d : 0, i === 2 ? d : 0);
      } else if (name[0] === "r") {
        // rotation: set the highlighted item's angle; the rest of the selection turns with it
        const r = Math.PI / 180;
        const q0 = this._itemQuat(kind, item);
        const e = new T.Euler().setFromQuaternion(q0, "YXZ");
        if (name === "rx") e.x = v * r;
        else if (name === "rz") e.z = v * r;
        else e.y = -v * r;
        if (!ROTATABLE.has(kind) || Array.isArray(item)) {
          e.x = 0;
          e.z = 0;
        }
        const dq = new T.Quaternion().setFromEuler(e).multiply(q0.invert());
        if (Math.abs(dq.w) < 0.9999999) this._applyRotQ(sel, dq, this.card._pivot.position.clone());
      } else if (name === "size") {
        const s = Math.max(5, v) / 100;
        if (s === 1) delete item.size;
        else item.size = s;
      } else if (name === "hit") item.hit = Math.max(1, round1(this._fromReal(v)));
      else {
        // scale % or size: x across, y up, z front to back → scaleItem's (sx, sy = depth, sz = height)
        const i = { x: 0, z: 1, y: 2 }[name[1]];
        const uni = sel.length > 1 || this.card._edit.lock || !ROTATABLE.has(kind);
        let r = v / 100;
        if (name[0] === "w") {
          const cur = (sel.length > 1 ? this._selDims() : this._dims(key))?.[i];
          if (!(cur > 0)) return sel;
          r = this._fromReal(v, i === 2) / cur;
        }
        if (r > 0 && Math.abs(r - 1) > 1e-4)
          this._scaleSel(
            sel,
            ...((uni ? [r, r, r] : [1, 1, 1].map((x, j) => (j === i ? r : x))) as [number, number, number]),
          );
      }
      return sel;
    });
  }

  /* resize the selection about its centre. One item stretches along its own axes; several scale evenly together, so the
   * gaps between them grow too and anything stacked (a lamp on a table) stays on top. */
  _scaleSel(this: Editor, keys: string[], sx: number, sy: number, sz: number) {
    const [px, py] = this._pivotC;
    const multi = keys.length > 1;
    const z0 = multi ? Math.min(...keys.map((key) => itemBase(key[0], this.item(key)))) : undefined;
    for (const key of keys) {
      const kind = key[0];
      const item = this.item(key);
      if (!item) continue;
      if (ROTATABLE.has(kind)) {
        const c = itemCenter(kind, item);
        if (c && multi) shiftItem(kind, item, (c[0] - px) * (sx - 1), (c[1] - py) * (sy - 1));
      } else mapPts(item, (x, y) => [px + (x - px) * sx, py + (y - py) * sy]);
      scaleItem(kind, item, sx, sy, sz, z0);
    }
  }

  /* pick a fixture model for a light. String lights run along `points`; everything else sits at x/y. Heights move to a
   * sensible spot for the new fixture (ceiling, table, floor lamp), which the Height field can then fine-tune. */
  _setFixture(this: Editor, key: string, fx: string) {
    this._mutate(() => {
      const L = this.item(key);
      const H = this.card._work.scene?.wall_height ?? 46;
      const c = itemCenter("l", L);
      if (fx === "string" && !L.points?.length) {
        L.points = [
          [round1(c[0] - 30), round1(c[1])],
          [round1(c[0] + 30), round1(c[1])],
        ];
        for (const f of ["x", "y", "gx", "gy", "gz"]) delete L[f];
      } else if (fx !== "string" && L.points?.length) {
        [L.x, L.y] = mean(L.points).map(round1);
        delete L.points;
        delete L.count;
        delete L.sag;
        delete L.spacing;
      }
      if (fx === "none") delete L.fixture;
      else L.fixture = fx;
      const z = {
        can: H - 0.5,
        ceiling: H - 0.5,
        pendant: round1(H * 0.7),
        bulb: round1(H * 0.72),
        floorlamp: 36,
        tablelamp: 25,
        string: round1(H * 0.8),
      }[fx];
      if (z != null) L.z = z;
      return [key];
    });
  }
}
