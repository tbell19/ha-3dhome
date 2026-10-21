/* The inspector for the selected item: its fields, light tuning, the sun, position/size/rotation and fixtures.
 */
import type { BoxEntry } from "../types";
import type { GenericItem } from "../core/items";
import type { Home3DCard, LightGroup } from "../card/card";
import {
  CX,
  CY,
  KINDS,
  R1,
  ROTATABLE,
  FIXTURES,
  bArr,
  esc,
  ic,
  itemCenter,
  itemBase,
  itemZ,
  scaleItem,
  mapPts,
  mean,
  stringCount,
  stringLen,
  shiftItem,
  hm,
} from "./shared.js";

/** One light setting slider: [field, label, min, max, step, default, format for display, description]. */
type TuneRow = [string, string, number, number, number, number, (v: number) => string, string];

export class EditorInspector {
  /* ----- inspector ----- */
  _renderInspector(this: Home3DCard) {
    const box = this._ed.querySelector<HTMLElement>(".insp");
    if (!box) return;
    if (this._plan) return this._renderPlanInspector(box);
    const e = this._edit,
      n = e.sel.size;
    if (!n) {
      box.innerHTML = `<h4>Edit layout<span class="tw">${ic("chevron-down")}</span></h4><div class="sub">Tap something to select it, then drag it to move.
        <details class="tips"><summary>Tips</summary>On touch, one finger only moves things that are already selected — otherwise it pans; two fingers zoom and rotate.
        With a mouse, drag anything to move it; drag empty floor to pan, right-drag to orbit. W / E / R pick the move, rotate and scale gizmo (X switches its axes between the world and the item). Arrow keys nudge, [ / ] turn 15°. Shift-click multi-selects, Alt-click picks one piece of a group.
        Markers: <span style="color:#ffd166">●</span> light <span style="color:#5aa9ff">●</span> hotspot <span style="color:#6fd39a">●</span> chip <span style="color:#ef6b5b">●</span> door.</details></div>
        ${this._sunHTML(true)}`;
      this._bindSun(box);
      this._bindInspToggle(box);
      return;
    }
    const key = e.primary,
      k = key[0],
      it = this._get(key);
    const f = (lab: string, name: string, val: unknown, type = "number", step = 1) =>
      `<label>${lab}<input data-f="${name}" type="${type}" step="${step}" value="${esc(val ?? "")}"></label>`;
    let fields = "";
    const xf = this._transformHTML(key, k, it, n);
    if (!ROTATABLE.has(k) && n === 1) {
      if (k === "h") fields += f(`Tap radius (${this._imperial() ? "in" : "cm"})`, "hit", this._toReal(it.hit ?? 12));
      else if (k !== "l" || (FIXTURES[it.fixture] && it.fixture !== "none"))
        fields += f("Size %", "size", Math.round((it.size ?? 1) * 100), "number", 5);
    }
    const ang = this._itemAngle(k, it);
    let extra = "";
    if (k === "l") extra += this._lightTuneHTML(key, it);
    if (k === "l" && it.kind !== "niche") {
      const fx = FIXTURES[it.fixture] ? it.fixture : "none";
      extra += `<label style="margin-bottom:8px">Fixture<select data-fx>${Object.entries(FIXTURES)
        .map(([v, l]) => `<option value="${v}"${v === fx ? " selected" : ""}>${l}</option>`)
        .join("")}</select></label>`;
      if (it.points?.length && fx === "string") {
        const U = this._imperial() ? "in" : "cm",
          len = stringLen(it.points);
        extra += `<div class="grid">${f(`Length (${U})`, "len", this._toReal(len))}${f("Bulbs (0 = auto)", "count", it.count || 0)}${f("Sag", "sag", R1(it.sag ?? Math.min(8, (len / Math.max(1, it.points.length - 1)) * 0.05)), "number", 0.5)}</div>
          <div class="sub" style="margin:4px 0 8px">${stringCount(it)} bulbs${it.count ? "" : ", about one every " + this._fmtLen(it.spacing || 14)}. Drag the yellow dots to stretch it, or a white dot to bend it.</div>
          ${it.points.length > 2 ? `<div class="row" style="margin:0 0 8px"><button data-b="straighten">Straighten</button></div>` : ""}`;
      }
    }
    if (k === "b") {
      const b = bArr(it as BoxEntry),
        pal = this._work.scene?.palette || {};
      const cur = typeof b[5] === "string" ? (pal[b[5]] || ["#888888"])[0] : b[5][0];
      extra += `<div class="grid"><label>Colour<input data-f="color" type="color" value="${esc(cur)}"></label></div>`;
    }
    if ("lhdc".includes(k) && (k !== "c" || it.entity != null || !it.label)) {
      extra += `<label style="margin-bottom:8px">Entity<input data-f="entity" list="ents" value="${esc(it.entity || "")}" placeholder="light.kitchen"></label>
        <datalist id="ents">${Object.keys(this._hass?.states || {})
          .filter((id) => k !== "l" || /^(light|switch)\./.test(id))
          .sort()
          .map((id) => `<option value="${id}">`)
          .join("")}</datalist>`;
    }
    const eid = (!ROTATABLE.has(k) || it.type === "screen") && (it.entity || it.climate);
    if (eid) {
      const cur =
        it.type === "screen" ? "screen" : k === "l" ? "light" : k === "d" ? "door" : k === "h" ? "hotspot" : "badge";
      const opts = [
        ["badge", "Badge (icon + live state)"],
        ["light", "Light glow"],
        ["door", "Door / window marker"],
        ["hotspot", "Invisible tap spot"],
      ];
      if (/^(media_player|camera)\./.test(eid)) opts.unshift(["screen", "Screen (16:9 with media preview)"]);
      extra += `<label style="margin-bottom:8px">Show as<select data-as>${opts
        .map(([v, l]) => `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`)
        .join("")}</select></label>`;
    }
    if (ang != null || n > 1)
      extra += `<div class="row" style="margin:0 0 8px"><button data-b="rotl" title="Turn left">${ic("rotate-left")}90°</button><button data-b="rotr" title="Turn right">${ic("rotate-right")}90°</button>${ROTATABLE.has(k) || n > 1 ? '<button data-b="level">Level</button>' : ""}</div>`;
    if (it.type === "screen")
      extra += `<div class="row" style="margin:0 0 8px"><button data-b="stand">${it.stand ? "Remove stand" : "Add stand"}</button></div>`;
    if (it.type === "model") {
      extra += `<div class="row"><button data-b="mirror">${ic("flip-horizontal")}Mirror</button><button data-b="resetsize">Reset size</button></div>`;
      if (this._modelErr?.[key])
        extra += `<div class="credit" style="color:#ef8b7b">Couldn't load: ${esc(this._modelErr[key])}</div>`;
      extra += `<div class="credit">${esc(it.name || "")} — ${esc(it.creator || "unknown author")} · ${esc(it.lic || "")} · Sweet Home 3D library</div>`;
    }
    box.innerHTML = `<h4>${esc(this._label(key))}<span class="tw">${ic("chevron-down")}</span></h4><div class="sub">${n > 1 ? `${n} items selected. Position, rotation and size change them all together; other fields edit the highlighted one.` : KINDS[k]}</div>
      ${xf}${fields ? `<div class="grid">${fields}</div>` : ""}${extra}
      <details style="margin-top:8px"><summary style="cursor:pointer;opacity:.8">Advanced (JSON)</summary>
        <textarea data-json>${esc(JSON.stringify(it, null, 1))}</textarea><div class="row"><button data-b="json">Apply JSON</button></div></details>`;
    box
      .querySelectorAll<HTMLInputElement>("input[data-f]")
      .forEach((inp) => inp.addEventListener("change", () => this._field(key, inp.dataset.f, inp.value)));
    box
      .querySelectorAll<HTMLElement>("button[data-b]")
      .forEach((b) => b.addEventListener("click", () => this._field(key, b.dataset.b)));
    box.querySelector<HTMLElement>("[data-lock]")?.addEventListener("click", () => {
      this._edit.lock = !this._edit.lock;
      this._renderInspector();
    });
    box
      .querySelector<HTMLElement>("select[data-as]")
      ?.addEventListener("change", (ev) => this._convertEntity(key, (ev.target as HTMLSelectElement).value));
    box
      .querySelector<HTMLElement>("select[data-fx]")
      ?.addEventListener("change", (ev) => this._setFixture(key, (ev.target as HTMLSelectElement).value));
    if (k === "l") this._bindLightTune(box, key);
    this._bindInspToggle(box);
  }

  /* ----- per-light tuning: what this light looks like at the bulb's full brightness and colour. The live state from
   * Home Assistant still scales it; these set the top end (see _update / _tuneLight in the core). ----- */
  _lightTuneRows(this: Home3DCard, it: GenericItem): TuneRow[] {
    const aimed = it.gx != null && Math.hypot(it.gx - it.x, it.gy - it.y) > 12,
      spot = aimed || (!aimed && it.fixture === "can" && !it.points),
      glow = !it.points && it.kind !== "niche";
    const pct = (v: number) => Math.round(v * 100) + "%";
    const rows: TuneRow[] = [
      ["intensity", "Brightness", 0, 4, 0.05, 1, pct, "At the bulb's full brightness"],
      ["saturation", "Colour", 0, 2, 0.05, 1, pct, "How strongly the bulb's colour shows"],
      ["r", "Reach", 5, 200, 1, 40, (v) => this._fmtLen(v * (spot ? 3.2 : 2.6)), "How far the light travels"],
      [
        "decay",
        "Falloff",
        0,
        3,
        0.1,
        glow ? 1.1 : 1.2,
        (v) => v.toFixed(1),
        "Low lights evenly to the edge, high fades fast",
      ],
    ];
    if (spot)
      rows.push(
        ["angle", "Beam width", 10, 85, 1, aimed ? 43 : 52, (v) => Math.round(v) + "°", ""],
        ["soft", "Beam edge", 0, 1, 0.05, 0.8, (v) => (v < 0.15 ? "Sharp" : pct(v) + " soft"), ""],
      );
    if (glow) rows.push(["halo", "Glow size", 0, 30, 1, 9, (v) => String(v), "The halo drawn around the bulb"]);
    return rows;
  }

  _lightTuneHTML(this: Home3DCard, key: string, it: GenericItem) {
    const rows = this._lightTuneRows(it),
      set = rows.some(([n]) => it[n] != null);
    return `<details class="ltune"${this._ltuneOpen ? " open" : ""}><summary>Light settings</summary>
      ${rows
        .map(
          ([
            n,
            lab,
            min,
            max,
            step,
            d,
            fmt,
            desc,
          ]) => `<label><span class="n">${lab}</span><output data-lo="${n}">${esc(fmt(it[n] ?? d))}</output>
        <input type="range" data-lt="${n}" min="${min}" max="${max}" step="${step}" value="${it[n] ?? d}">${desc ? `<span class="d">${desc}</span>` : ""}</label>`,
        )
        .join("")}
      ${set ? `<div class="row"><button data-lreset>Reset light settings</button></div>` : ""}</details>`;
  }

  _bindLightTune(this: Home3DCard, box: HTMLElement, key: string) {
    const det = box.querySelector<HTMLDetailsElement>(".ltune");
    if (!det) return;
    det.addEventListener("toggle", () => {
      this._ltuneOpen = det.open;
    });
    const rows = Object.fromEntries(this._lightTuneRows(this._get(key)).map((r) => [r[0], r]));
    // co-located bulbs (a two-bulb fan) render as one light, so a setting applies to all of them
    const members = (): [LightGroup | null, GenericItem[]] => {
      const rec = this._lightGroups?.find((g) => g.keys.includes(key));
      return rec ? [rec, rec.keys.map((kk) => this._get(kk))] : [null, [this._get(key)]];
    };
    det.addEventListener("input", (ev) => {
      const n = (ev.target as HTMLElement).dataset.lt;
      if (!n) return;
      if (!this._ltDrag) {
        this._edit.undo.push(JSON.stringify(this._work));
        this._edit.redo = [];
        this._edit.dirty = true;
        this._ltDrag = true;
      }
      const v = +(ev.target as HTMLInputElement).value,
        [, , , , , d, fmt] = rows[n],
        [rec, its] = members();
      for (const it of its)
        if (v === d) delete it[n];
        else it[n] = v;
      det.querySelector<HTMLElement>(`[data-lo="${n}"]`).textContent = fmt(v);
      if (rec) {
        rec.L = this._get(rec.keys[0]);
        this._tuneLight(rec);
      }
      this._update();
      this._requestRender();
    });
    det.addEventListener("change", () => {
      if (this._ltDrag) {
        this._ltDrag = false;
        this._commit();
      }
    });
    det.querySelector<HTMLElement>("[data-lreset]")?.addEventListener("click", () =>
      this._mutate(() => {
        for (const it of members()[1]) for (const n of Object.keys(rows)) delete it[n];
        return [...this._edit.sel];
      }),
    );
  }

  /* ----- north + sun preview (no selection) ----- */
  _sunHTML(this: Home3DCard, preview?: boolean) {
    const north = Number(this._work.scene?.north) || 0,
      c = this._hass?.config || {},
      hr = this._sunPreview;
    const where = c.latitude != null && c.longitude != null;
    return `<div class="sun" style="margin-top:8px"><div class="grid" style="grid-template-columns:1fr 1fr"><label>North °<input data-sun="north" type="number" step="5" value="${north}"></label>
      <div class="row" style="align-items:end"><button data-sun="nl" title="Turn north left">${ic("rotate-left")}15°</button><button data-sun="nr" title="Turn north right">${ic("rotate-right")}15°</button></div></div>
      <div class="sub">How far north is turned clockwise from the top of the floor plan. The red arrow points north; the sun follows Home Assistant's sun position.</div>
      ${
        preview && where
          ? `<label style="margin-top:6px">Preview the sun at <b data-sun="t">${hr == null ? "now" : hm(hr)}</b><input data-sun="hour" type="range" min="0" max="24" step="0.25" value="${hr ?? new Date().getHours() + new Date().getMinutes() / 60}"></label>
        ${hr == null ? "" : '<div class="row"><button data-sun="live">Back to now</button></div>'}`
          : ""
      }</div>`;
  }

  _bindSun(this: Home3DCard, box: HTMLElement) {
    const setNorth = (v: number) => {
      if (!isFinite(v)) return;
      v = R1(((v % 360) + 360) % 360);
      this._mutate(() => {
        this._work.scene ||= {};
        if (v) this._work.scene.north = v;
        else delete this._work.scene.north;
        return [...this._edit.sel];
      });
    };
    box
      .querySelector<HTMLElement>('[data-sun="north"]')
      ?.addEventListener("change", (ev) => setNorth(Number((ev.target as HTMLInputElement).value)));
    box
      .querySelector<HTMLElement>('[data-sun="nl"]')
      ?.addEventListener("click", () => setNorth((Number(this._work.scene?.north) || 0) - 15));
    box
      .querySelector<HTMLElement>('[data-sun="nr"]')
      ?.addEventListener("click", () => setNorth((Number(this._work.scene?.north) || 0) + 15));
    const hour = box.querySelector<HTMLInputElement>('[data-sun="hour"]');
    hour?.addEventListener("input", () => {
      this._sunPreview = Number(hour.value);
      const v = this._sunPreview;
      box.querySelector<HTMLElement>('[data-sun="t"]').textContent = hm(v);
      this._update();
      this._requestRender();
    });
    hour?.addEventListener("change", () => {
      if (!box.querySelector<HTMLElement>('[data-sun="live"]')) this._renderInspector();
    });
    box.querySelector<HTMLElement>('[data-sun="live"]')?.addEventListener("click", () => {
      this._sunPreview = null;
      this._update();
      this._requestRender();
      this._renderInspector();
    });
  }

  _bindInspToggle(this: Home3DCard, box: HTMLElement) {
    box.classList.toggle("min", !!this._inspMin);
    box.querySelector<HTMLElement>("h4").onclick = () => {
      this._inspMin = !this._inspMin;
      box.classList.toggle("min", this._inspMin);
    };
  }

  _field(this: Home3DCard, key: string, name: string, raw?: any) {
    const num = Number(raw);
    if (name === "level") {
      // take out any tilt, keep the turn
      const sel = [...this._edit.sel];
      return this._mutate(() => {
        for (const kk of sel) {
          const o = this._get(kk);
          if (o && !Array.isArray(o) && (o.rx || o.rz)) {
            delete o.rx;
            delete o.rz;
          }
        }
        return sel;
      });
    }
    if (name === "rotl" || name === "rotr") {
      const sel = [...this._edit.sel];
      return this._mutate(() => {
        this._applyRotate(sel, name === "rotl" ? -90 : 90, this._pivotC);
        return sel;
      });
    }
    if (name === "json") {
      let v;
      try {
        v = JSON.parse(this._ed.querySelector<HTMLTextAreaElement>("textarea[data-json]").value);
      } catch (e: any) {
        return this._toast("Invalid JSON: " + e.message);
      }
      return this._mutate(() => {
        const [kk, i] = key.split(":");
        this._list(kk)[+i] = v;
        return [...this._edit.sel];
      });
    }
    if (!["entity", "color", "mirror", "resetsize", "stand", "straighten"].includes(name) && (isNaN(num) || raw === ""))
      return;
    if (["px", "py", "pz", "rx", "ry", "rz", "sx", "sy", "sz", "wx", "wy", "wz", "size", "hit"].includes(name))
      return this._transformField(name, num);
    this._mutate(() => {
      const it = this._get(key);
      if (name === "len" && it.points?.length > 1) {
        // stretch (or shrink) the last span; bulbs follow
        const P = it.points,
          a = P[P.length - 2],
          b = P[P.length - 1],
          span = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const ns = Math.max(1, span + this._fromReal(num) - stringLen(P));
        P[P.length - 1] = [R1(a[0] + ((b[0] - a[0]) / span) * ns), R1(a[1] + ((b[1] - a[1]) / span) * ns)];
      } else if (name === "count") {
        if (num > 0) it.count = Math.min(200, Math.round(num));
        else delete it.count;
      } else if (name === "sag") it.sag = Math.max(0, num);
      else if (name === "straighten" && it.points?.length > 2) it.points = [it.points[0], it.points.at(-1)];
      else if (name === "entity") it.entity = raw.trim();
      else if (name === "color") {
        const b = bArr(it as BoxEntry);
        const T = this.T,
          col = new T.Color(raw);
        b[5] = [
          raw,
          "#" + col.clone().multiplyScalar(0.78).getHexString(),
          "#" + col.clone().multiplyScalar(0.88).getHexString(),
        ];
      } else if (name === "mirror") it.mirror = !it.mirror || undefined;
      else if (name === "stand") it.stand = !it.stand || undefined;
      else if (name === "resetsize") {
        const [sxy, sz] = this._modelScale();
        it.w = R1(it.cm[0] / sxy);
        it.d = R1(it.cm[1] / sxy);
        it.h = R1(it.cm[2] / sz);
      }
      return [...this._edit.sel];
    });
  }

  /* ----- transform fields: position, rotation and size of the selection. Inputs are in cm or inches (model_scale, the
   * same scale Set scale fits the blueprint to); the plan stores plan units. ----- */
  _selPos(this: Home3DCard) {
    const keys = [...this._edit.sel];
    if (keys.length === 1) {
      const k = keys[0][0],
        it = this._get(keys[0]),
        c = itemCenter(k, it) || [CX, CY];
      return [c[0], c[1], itemZ(k, it)];
    }
    return [...this._pivotC, Math.min(...keys.map((key) => itemBase(key[0], this._get(key))))];
  }

  /* which way an item faces: `rot` for furniture, the run of a string light, or an aimed light's beam; null if it has no direction */
  _itemAngle(this: Home3DCard, k: string, it: GenericItem) {
    if (ROTATABLE.has(k)) return Array.isArray(it) ? 0 : it.rot || 0;
    const p =
      it.points?.length > 1
        ? [it.points[0], it.points.at(-1)]
        : it.gx != null && Math.hypot(it.gx - it.x, it.gy - it.y) > 12
          ? [
              [it.x, it.y],
              [it.gx, it.gy],
            ]
          : null;
    return p ? R1(((((Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]) * 180) / Math.PI) % 360) + 360) % 360) : null;
  }

  /* [width, depth, height] of one item along its own axes, in plan units (0 where that axis can't change) */
  _dims(this: Home3DCard, key: string) {
    const k = key[0],
      it = this._get(key);
    if (k === "b") {
      const b = bArr(it as BoxEntry);
      return [b[1] - b[0], b[3] - b[2], b[4]];
    }
    if (it.type === "model") return [it.w, it.d, it.h];
    if (it.type === "screen") {
      const w = it.w || 32;
      return [w, 0, (w * 9) / 16];
    }
    if (it.type === "table") return [it.r * 2, 0, it.z];
    const g = this._items.get(key);
    if (!g) return null;
    const r = g.rotation.y,
      tg = g.children[0]?.userData.tilt ? g.children[0] : null,
      tr = tg?.rotation.clone(); // measured untilted
    g.rotation.y = 0;
    tg?.rotation.set(0, 0, 0);
    g.updateMatrixWorld(true);
    const box = new this.T.Box3().setFromObject(g);
    g.rotation.y = r;
    if (tg) tg.rotation.copy(tr);
    g.updateMatrixWorld(true);
    if (box.isEmpty()) return null;
    const s = box.getSize(new this.T.Vector3());
    return [s.x, s.z, s.y];
  }

  /* the selection's overall size, lined up with the plan */
  _selDims(this: Home3DCard) {
    const T = this.T,
      box = new T.Box3();
    for (const key of this._edit.sel) {
      const k = key[0],
        g = this._items.get(key);
      if (ROTATABLE.has(k) && g) {
        g.updateMatrixWorld(true);
        box.expandByObject(g);
      } else {
        const c = itemCenter(k, this._get(key));
        if (c) box.expandByPoint(new T.Vector3(c[0] - CX, c[2] ?? 0, c[1] - CY));
      }
    }
    if (box.isEmpty()) return null;
    const s = box.getSize(new T.Vector3());
    return [s.x, s.z, s.y];
  }

  /* The Transform rows, laid out like Unity / Godot: X across, Y up, Z front to back (the gizmo's red, green and blue).
   * Position and Size are in cm or inches; Rotation in degrees (Y turns, X and Z tilt); Scale in % (applied, then back to 100). */
  _transformHTML(this: Home3DCard, key: string, k: string, it: GenericItem, n: number) {
    const U = this._imperial() ? "in" : "cm",
      pos = this._selPos(),
      rotatable = ROTATABLE.has(k);
    const inp = (ax: string, name: string, val: unknown, step = 1, off?: boolean) =>
      `<label class="ax-${ax}"><i>${ax.toUpperCase()}</i><input data-f="${name}" type="number" step="${step}" value="${esc(val ?? "")}"${off ? " disabled" : ""}></label>`;
    const row = (lab: string, cells: string) => `<div class="xf"><b>${lab}</b>${cells}</div>`;
    let h = row(
      `Position <span style="opacity:.6;font-weight:400">${U}</span>`,
      inp("x", "px", this._toReal(pos[0])) +
        inp("y", "py", pos[2] == null ? "" : this._toReal(pos[2], true), 1, pos[2] == null) +
        inp("z", "pz", this._toReal(pos[1])),
    );
    const ang = this._itemAngle(k, it);
    if (rotatable || n > 1 || ang != null) {
      const tilt = rotatable && !Array.isArray(it);
      h += row(
        "Rotation °",
        inp("x", "rx", tilt ? it.rx || 0 : 0, 15, !tilt) +
          inp("y", "ry", ang ?? 0, 15) +
          inp("z", "rz", tilt ? it.rz || 0 : 0, 15, !tilt),
      );
    }
    if (rotatable || n > 1) {
      const lock = `<button data-lock title="Keep proportions">${ic(this._edit.lock || n > 1 ? "link-variant" : "link-variant-off")}</button>`;
      h += row(
        `Scale % ${n > 1 ? "" : lock}`,
        inp("x", "sx", 100, 5) + inp("y", "sy", 100, 5) + inp("z", "sz", 100, 5),
      );
      const d = n > 1 ? this._selDims() : this._dims(key);
      if (d)
        h += row(
          `Size <span style="opacity:.6;font-weight:400">${U}</span>`,
          inp("x", "wx", d[0] > 0 ? this._toReal(d[0]) : "", 0.5, !(d[0] > 0)) +
            inp("y", "wy", d[2] > 0 ? this._toReal(d[2], true) : "", 0.5, !(d[2] > 0)) +
            inp("z", "wz", d[1] > 0 ? this._toReal(d[1]) : "", 0.5, !(d[1] > 0)),
        );
    }
    return h;
  }

  _transformField(this: Home3DCard, name: string, v: number) {
    const T = this.T,
      sel = [...this._edit.sel],
      key = this._edit.primary,
      k = key[0],
      it = this._get(key),
      pos = this._selPos();
    this._mutate(() => {
      if (name[0] === "p") {
        // position: x across, y up (elevation), z front to back
        const i = { px: 0, pz: 1, py: 2 }[name],
          d = this._fromReal(v, i === 2) - (pos[i] ?? 0);
        if (Math.abs(d) > 0.01) this._applyMove(sel, i === 0 ? d : 0, i === 1 ? d : 0, i === 2 ? d : 0);
      } else if (name[0] === "r") {
        // rotation: set the highlighted item's angle; the rest of the selection turns with it
        const r = Math.PI / 180,
          q0 = this._itemQuat(k, it),
          e = new T.Euler().setFromQuaternion(q0, "YXZ");
        if (name === "rx") e.x = v * r;
        else if (name === "rz") e.z = v * r;
        else e.y = -v * r;
        if (!ROTATABLE.has(k) || Array.isArray(it)) {
          e.x = 0;
          e.z = 0;
        }
        const dq = new T.Quaternion().setFromEuler(e).multiply(q0.invert());
        if (Math.abs(dq.w) < 0.9999999) this._applyRotQ(sel, dq, this._pivot.position.clone());
      } else if (name === "size") {
        const s = Math.max(5, v) / 100;
        if (s === 1) delete it.size;
        else it.size = s;
      } else if (name === "hit") it.hit = Math.max(1, R1(this._fromReal(v)));
      else {
        // scale % or size: x across, y up, z front to back → scaleItem's (sx, sy = depth, sz = height)
        const i = { x: 0, z: 1, y: 2 }[name[1]],
          uni = sel.length > 1 || this._edit.lock || !ROTATABLE.has(k);
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
  _scaleSel(this: Home3DCard, keys: string[], sx: number, sy: number, sz: number) {
    const [px, py] = this._pivotC,
      multi = keys.length > 1;
    const z0 = multi ? Math.min(...keys.map((key) => itemBase(key[0], this._get(key)))) : undefined;
    for (const key of keys) {
      const k = key[0],
        it = this._get(key);
      if (!it) continue;
      if (ROTATABLE.has(k)) {
        const c = itemCenter(k, it);
        if (c && multi) shiftItem(k, it, (c[0] - px) * (sx - 1), (c[1] - py) * (sy - 1));
      } else mapPts(it, (x, y) => [px + (x - px) * sx, py + (y - py) * sy]);
      scaleItem(k, it, sx, sy, sz, z0);
    }
  }

  /* pick a fixture model for a light. String lights run along `points`; everything else sits at x/y. Heights move to a
   * sensible spot for the new fixture (ceiling, table, floor lamp), which the Height field can then fine-tune. */
  _setFixture(this: Home3DCard, key: string, fx: string) {
    this._mutate(() => {
      const L = this._get(key),
        H = this._work.scene?.wall_height ?? 46,
        c = itemCenter("l", L);
      if (fx === "string" && !L.points?.length) {
        L.points = [
          [R1(c[0] - 30), R1(c[1])],
          [R1(c[0] + 30), R1(c[1])],
        ];
        for (const f of ["x", "y", "gx", "gy", "gz"]) delete L[f];
      } else if (fx !== "string" && L.points?.length && L.kind !== "niche") {
        [L.x, L.y] = mean(L.points).map(R1);
        delete L.points;
        delete L.count;
        delete L.sag;
        delete L.spacing;
        if (L.kind === "string") delete L.kind;
      }
      if (fx === "string") L.kind = "string";
      if (fx === "none") delete L.fixture;
      else L.fixture = fx;
      const z = {
        can: H - 0.5,
        ceiling: H - 0.5,
        pendant: R1(H * 0.7),
        bulb: R1(H * 0.72),
        floorlamp: 36,
        tablelamp: 25,
        string: R1(H * 0.8),
      }[fx];
      if (z != null) L.z = z;
      return [key];
    });
  }
}
