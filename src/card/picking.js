/* Picking: tap and click targets, hover, and what happens when an entity is tapped.
 */
import { CX, CY } from "../core/constants.js";
import { R1, polyArea } from "../core/util.js";
import { TOGGLE_DOMAINS } from "../core/entities.js";
import { PLAN, itemCenter } from "../core/items.js";
import { stringLen, stringCount, spanSag } from "../core/fixtures.js";
import { segDir } from "../core/plan-geometry.js";

export const PickingMixin = (Base) => class Picking extends Base {
  /* ---------- picking ---------- */
  _keyGroup(key) {
    if (!this._items.has(key)) { const g = new this.T.Group(); g.userData.key = key; this._world.add(g); this._items.set(key, g); }
    return this._items.get(key);
  }

  _buildTargets() {
    const T = this.T, cfg = this._cfg(), editing = !!this._edit;
    this._targets = [];
    const addTarget = (key, x, y, z, r, entity, action) => {
      const m = new T.Mesh(new T.SphereGeometry(Math.max(r, 3) * 0.9, 8, 6), new T.MeshBasicMaterial({ visible: false }));
      m.position.set(x - CX, z, y - CY); m.userData = { entity, action }; this._keyGroup(key).add(m); this._targets.push(m);
    };
    /* string lights: a tap anywhere along the cord toggles them, so the target is a tube that follows each sagging span */
    const stringTarget = (key, L) => {
      const pts = L.points, z = L.z ?? (L.fixture === "string" ? 40 : 20), r = Math.max(3, (L.hit ?? 10) * 0.6), mat = new T.MeshBasicMaterial({ visible: false });
      const up = new T.Vector3(0, 1, 0);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], sag = spanSag(L, Math.hypot(b[0] - a[0], b[1] - a[1])) + 2;   // bulbs hang ~2 below the cord
        const at = (t) => new T.Vector3(a[0] + (b[0] - a[0]) * t - CX, z - sag * 4 * t * (1 - t), a[1] + (b[1] - a[1]) * t - CY);
        for (let k = 0; k < 6; k++) {
          const p = at(k / 6), q = at((k + 1) / 6), len = p.distanceTo(q); if (len < 0.01) continue;
          const m = new T.Mesh(new T.CapsuleGeometry(r, len, 2, 6), mat);
          m.position.copy(p).add(q).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(up, q.clone().sub(p).normalize());
          m.userData = { entity: L.entity, action: L.tap || "toggle" }; this._keyGroup(key).add(m); this._targets.push(m);
        }
      }
    };
    const marker = (key, p, color) => {
      const m = new T.Mesh(new T.SphereGeometry(2.4, 12, 8), new T.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
      m.renderOrder = 10; m.position.set(p[0] - CX, p[2], p[1] - CY); m.userData.key = key; this._keyGroup(key).add(m);
    };
    (cfg.lights || []).forEach((L, i) => {
      if (editing) { marker("l:" + i, itemCenter("l", L), 0xffd166); return; }
      if (L.hit === 0) return;
      if (L.points?.length >= 2) { stringTarget("l:" + i, L); if (L.hx == null) return; }
      const [x, y, z] = L.hx != null ? [L.hx, L.hy, L.hz ?? 0] : [L.x ?? L.points[0][0], L.y ?? L.points[0][1], L.z ?? 20];
      addTarget("l:" + i, x, y, z, L.hit ?? 10, L.entity, L.tap || "toggle");
    });
    (cfg.hotspots || []).forEach((H, i) => {
      if (editing) marker("h:" + i, [H.x, H.y, H.z ?? 10], 0x5aa9ff);
      else addTarget("h:" + i, H.x, H.y, H.z ?? 10, H.hit ?? 12, H.entity, H.tap || "more-info");
    });
    if (!editing) for (const sc of this._screens || []) { sc.mesh.userData = { entity: sc.o.entity, action: sc.o.tap || "more-info" }; this._targets.push(sc.mesh); }
    if (editing) {
      (cfg.chips || []).forEach((c, i) => marker("c:" + i, [c.x, c.y, c.z ?? 50], 0x6fd39a));
      (cfg.doors || []).forEach((d, i) => marker("d:" + i, [d.x, d.y, d.z ?? 22], 0xef6b5b));
    }
  }

  _bindPicking() {
    const T = this.T, el = this._renderer.domElement;
    const ray = new T.Raycaster(), v = new T.Vector2();
    let down = null, timer = null;
    const setRay = (ev) => {
      const r = el.getBoundingClientRect();
      v.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(v, this._cam);
    };
    const pick = (ev) => { setRay(ev); return ray.intersectObjects(this._targets, false)[0]?.object.userData; };
    /* the editable item under the pointer. Furniture mode ignores walls/openings/blueprint; plan mode ignores everything else. */
    /* every editable item under the pointer, nearest first. Furniture mode ignores walls/openings/blueprint/rooms;
     * plan mode ignores everything else. Clicking the same spot again steps through this list (plan mode). */
    const pickKeys = (ev) => {
      setRay(ev);
      const out = [];
      for (const hit of ray.intersectObject(this._world, true)) {
        const o = hit.object;
        if (o.isSprite || o.userData.joint || o.userData.vert || o.userData.mid) continue;
        if (o.userData.wall && !this._plan) continue;
        let key = null;
        for (let p = o; p && p !== this._world; p = p.parent) if (p.userData.key) { key = p.userData.key; break; }
        if (key) {
          const isPlan = PLAN.has(key[0]);
          if (this._plan ? !isPlan || o.userData.locked : isPlan) continue;
          if (!out.includes(key)) out.push(key);
          if (!this._plan) break;
        } else if (o.userData.floor) break;
      }
      return this._plan ? [...out.filter((k) => k[0] === "n"), ...out.filter((k) => k[0] !== "n")] : out;   // doors and windows sit inside walls: offer them first
    };
    const pickKey = (ev) => pickKeys(ev)[0] || null;
    /* handles: a selected string light's points and span midpoints; in plan mode the selected room's corners, then its
     * edge midpoints, then wall joints */
    const pickHandle = (ev) => {
      setRay(ev);
      for (const [arr, type] of [[this._sptMeshes, "spt"], [this._smidMeshes, "smid"], [this._vertMeshes, "vert"], [this._midMeshes, "mid"], [this._jointMeshes, "joint"]]) {
        if (!arr?.length) continue;
        const h = ray.intersectObjects(arr, false)[0];
        if (h) return { type, d: h.object.userData[type] };
      }
      return null;
    };
    /* click without dragging: in plan mode a repeat click on the same spot selects the next thing underneath */
    const clickPick = (ev, extra = []) => {
      const keys = [...pickKeys(ev)]; for (const k of extra) if (!keys.includes(k)) keys.push(k);
      const add = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      if (!this._plan || add) return this._clickSelect(keys[0] || null, add, ev.altKey);
      const i = keys.indexOf(this._edit.primary);
      this._clickSelect(keys.length ? keys[(i + 1) % keys.length] : null, false, true);
      if (keys.length > 1 && i < 0 && !this._cycleHinted) { this._cycleHinted = true; this._toast("Several things here — click again to pick the next one underneath"); }
    };
    const floorPoint = (ev, y) => { setRay(ev); return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -y), new T.Vector3()); };
    const planPt = (ev) => { const p = floorPoint(ev, 0); return p ? [p.x + CX, p.z + CY] : null; };
    const ptrs = new Set();
    const camSnap = () => ({ pos: this._cam.position.clone(), target: this._controls.target.clone(), zoom: this._cam.zoom });
    const camRestore = (c) => {
      const oc = this._controls, damp = oc.enableDamping;
      oc.enableDamping = false; oc.update();                       // flush any pan/orbit that already started
      this._cam.position.copy(c.pos); oc.target.copy(c.target); this._cam.zoom = c.zoom; this._cam.updateProjectionMatrix();
      oc.update(); oc.enableDamping = damp;
    };
    const cancelDrag = () => {   // a second finger arrived: put things back and hand over to the camera
      if (down?.dragging && this._drag) { this._pivot.position.copy(down.piv0); this._pivot.quaternion.copy(this._drag.quat); this._dragPreview(); this._drag = null; }
      if (down?.jdrag) { this._work = JSON.parse(down.snap0); if (down.spt) this._commit(); else this._rebuildPlan(); this._hideTip(); }
      if (down) { down.key = null; down.handle = null; down.vert = down.spt = null; down.dragging = down.jdrag = false; down.cancelled = true; }
      this._controls.enabled = true;
    };
    el.addEventListener("pointerdown", (ev) => {
      ptrs.add(ev.pointerId);
      if (this._edit) {
        if (ptrs.size > 1) { cancelDrag(); return; }
        down = { x: ev.clientX, y: ev.clientY, edit: true, touch: ev.pointerType !== "mouse", cam: camSnap() }; this._tcUsed = false;
        if (this._plan && this._tool !== "select") { down.tool = true; return; }   // drawing / placing: acts on click
        // a string light's handles win over the move gizmo (its arrows often point straight at them)
        if (this._sptMeshes?.length && ev.button === 0 && !(ev.shiftKey || ev.ctrlKey || ev.metaKey)) {
          const h = pickHandle(ev);
          if (h?.type === "spt" || h?.type === "smid") { down.handle = h; ev.stopImmediatePropagation(); return; }
        }
        // press on furniture / a marker can drag it — with a mouse anything, on touch only what's already selected
        if (ev.button === 0 && !(ev.shiftKey || ev.ctrlKey || ev.metaKey) && !this._tc?.axis) {
          if (this._plan || this._sptMeshes?.length) {
            const h = pickHandle(ev);
            if (h && (h.type !== "joint" || !down.touch || h.d.m.some(([i]) => this._edit.sel.has("w:" + i)))) { down.handle = h; return; }
          }
          const keys = pickKeys(ev), key = keys.find((k) => this._edit.sel.has(k)) || keys[0];
          // rooms cover most of the plan, so they only drag once selected (otherwise a drag pans)
          if (key && ((!down.touch && key[0] !== "r") || this._edit.sel.has(key))) down.key = key;
        }
        return;
      }
      down = { x: ev.clientX, y: ev.clientY, hit: pick(ev), held: false };
      if (down.hit) timer = setTimeout(() => { if (down) { down.held = true; this._moreInfo(down.hit.entity); } }, 500);
    }, { capture: true });   // capture: runs before the camera controls, so a 2nd finger re-enables them in time
    el.addEventListener("pointermove", (ev) => {
      if (down && Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > (down.touch ? 8 : 5)) { clearTimeout(timer); down.hit = null; down.moved = true; }
      // drag a handle: a wall joint (every wall end at that corner follows), a room corner, or a room edge midpoint (adds a corner)
      if (down?.handle && down.moved && this._edit && ptrs.size === 1) {
        const h = down.handle;
        if (!down.jdrag) {
          this._controls.enabled = false; camRestore(down.cam);
          down.jdrag = true; down.snap0 = JSON.stringify(this._work);
          for (const hp of this._helpers || []) hp.visible = false;
          if (h.type === "joint") down.m = h.d.m.map((x) => [...x]);
          else if (h.type === "spt" || h.type === "smid") {   // string light: move a point, or bend a span by adding one
            const L = this._get(h.d.key);
            if (h.type === "smid") { const a = L.points[h.d.k], b = L.points[h.d.k + 1]; L.points.splice(h.d.k + 1, 0, [R1((a[0] + b[0]) / 2), R1((a[1] + b[1]) / 2)]); }
            down.spt = { key: h.d.key, k: h.type === "smid" ? h.d.k + 1 : h.d.k };
          } else {
            const f = this._get(h.d.key);
            if (h.type === "mid") { const a = f.pts[h.d.k], b = f.pts[(h.d.k + 1) % f.pts.length]; f.pts.splice(h.d.k + 1, 0, [R1((a[0] + b[0]) / 2), R1((a[1] + b[1]) / 2)]); }
            down.vert = { key: h.d.key, k: h.type === "mid" ? h.d.k + 1 : h.d.k };
          }
        }
        if (down.spt) {
          const L = this._get(down.spt.key), q = floorPoint(ev, L.z ?? 17); if (!q) return;
          let pt = [q.x + CX, q.z + CY];
          if (this._edit.snap) pt = pt.map((v) => Math.round(v));
          L.points[down.spt.k] = pt.map(R1);
          this._refreshFixture(down.spt.key); this._buildStringHandles();
          this._showTip(ev, `${this._fmtLen(stringLen(L.points))} · ${stringCount(L)} bulbs`);
          this._requestRender();
          return;
        }
        const p = planPt(ev); if (!p) return;
        if (down.vert) {
          const f = this._get(down.vert.key), n = f.pts.length, k = down.vert.k, prev = f.pts[(k - 1 + n) % n];
          const s = this._snapPoint(p, { from: prev, room: down.vert });
          f.pts[k] = [R1(s.p[0]), R1(s.p[1])];
          this._vsel = down.vert;
          this._rebuildPlan(); this._showMarker(s.p, s.kind);
          this._showTip(ev, this._fmtArea(polyArea(f.pts)));
          return;
        }
        const segs = this._work.scene.wall_segs, [i0, e0] = down.m[0], other = segs[i0][e0 === "a" ? "b" : "a"];
        const s = this._snapPoint(p, { from: down.m.length === 1 ? other : null, exclude: down.m });
        for (const [i, e] of down.m) segs[i][e] = [R1(s.p[0]), R1(s.p[1])];
        this._rebuildPlan(); this._showMarker(s.p, s.kind);
        this._showTip(ev, down.m.map(([i]) => this._fmtLen(segDir(segs[i])[2])).join(" · "));
        return;
      }
      if (down?.key && down.moved && this._edit && ptrs.size === 1) {
        if (this._tcDragging) { down.key = null; return; }
        if (!down.dragging) {
          this._controls.enabled = false; camRestore(down.cam);
          if (!this._edit.sel.has(down.key)) this._clickSelect(down.key, false, ev.altKey);
          down.prevMode = this._edit.mode; down.rot = down.prevMode === "rotate";   // scale mode drags move things too
          down.piv0 = this._pivot.position.clone();
          down.p0 = floorPoint(ev, down.piv0.y);
          if (!down.p0) { down.key = null; this._controls.enabled = true; return; }
          this._dragStart(down.rot ? "rotate" : "translate"); down.dragging = true; el.style.cursor = "grabbing";
        }
        const p = floorPoint(ev, down.piv0.y); if (!p) return;
        if (down.rot) {   // rotate mode: turn the selection around its centre as the pointer circles it
          const a0 = Math.atan2(down.p0.z - down.piv0.z, down.p0.x - down.piv0.x), a1 = Math.atan2(p.z - down.piv0.z, p.x - down.piv0.x);
          let dr = -(a1 - a0); if (this._edit.snap) dr = Math.round(dr / (Math.PI / 12)) * (Math.PI / 12);
          this._pivot.quaternion.setFromAxisAngle(new T.Vector3(0, 1, 0), dr).multiply(this._drag.quat);
        } else {
          let dx = p.x - down.p0.x, dz = p.z - down.p0.z;
          if (this._edit.snap) { dx = Math.round(dx / 2) * 2; dz = Math.round(dz / 2) * 2; }
          this._pivot.position.set(down.piv0.x + dx, down.piv0.y, down.piv0.z + dz);
        }
        this._dragPreview();
        return;
      }
      if (this._plan && this._tool !== "select" && (!down || !down.moved) && ev.pointerType === "mouse") { this._toolHover(ev, planPt(ev)); return; }
      if (!down && ev.pointerType === "mouse") {
        if (this._edit) {
          if ((this._plan || this._sptMeshes?.length) && pickHandle(ev)) { el.style.cursor = "move"; return; }
          const k = pickKey(ev); el.style.cursor = k ? (this._edit.sel.has(k) ? "move" : "pointer") : "grab";
        } else el.style.cursor = pick(ev) ? "pointer" : "grab";
      }
    });
    const up = (ev) => {
      ptrs.delete(ev.pointerId);
      clearTimeout(timer);
      if (down?.edit) {
        if (ptrs.size) return;                       // wait until the last finger lifts
        if (down.jdrag) { this._edit.undo.push(down.snap0); this._edit.redo = []; this._hideTip(); this._hidePreview(); this._commit(); }
        else if (down.dragging) this._dragEnd();
        else if (!down.moved && !down.cancelled && !this._tcUsed && !this._tcDragging && ev.type === "pointerup") {
          if (down.tool) { const p = planPt(ev); if (p) this._toolClick(p, pickKey(ev), ev); }
          else if (down.handle?.type === "vert") { this._vsel = down.handle.d; this._buildRoomHandles(); this._renderInspector(); this._requestRender(); }
          else if (down.handle?.type === "joint") clickPick(ev, down.handle.d.m.map(([i]) => "w:" + i));
          else clickPick(ev);
        }
        if (!this._tcDragging) this._controls.enabled = true;
      } else if (down && down.hit && !down.held && ev.type === "pointerup") {
        if (down.hit.action === "toggle") { if (!this._offlineTap()) this._hass.callService("homeassistant", "toggle", { entity_id: down.hit.entity }); }
        else this._moreInfo(down.hit.entity);
      }
      down = null;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", () => { if (this._plan && !down) this._hidePreview(true); });
  }

  _moreInfo(entityId) { this.dispatchEvent(new CustomEvent("hass-more-info", { bubbles: true, composed: true, detail: { entityId } })); }

  _bindTap(node, entity) {
    if (!entity) return;
    node.addEventListener("click", () => this._moreInfo(entity));
  }

  /* badge taps: toggle lights/switches, run scripts/scenes/buttons, otherwise more-info; hold = more-info */
  _bindEntityTap(node, entity, tap) {
    let t = null, held = false;
    node.addEventListener("pointerdown", () => { held = false; t = setTimeout(() => { held = true; this._moreInfo(entity); }, 500); });
    node.addEventListener("pointerleave", () => clearTimeout(t));
    node.addEventListener("pointerup", () => { clearTimeout(t); if (!held && !this._edit) this._entityAction(entity, tap); });
  }

  _entityAction(entity, tap) {
    const d = entity.split(".")[0], h = this._hass;
    const a = tap || (TOGGLE_DOMAINS.has(d) ? "toggle" : ["script", "scene"].includes(d) ? "run" : ["button", "input_button"].includes(d) ? "press" : "more-info");
    if (a !== "more-info" && this._offlineTap()) return;
    if (a === "toggle") h.callService("homeassistant", "toggle", { entity_id: entity });
    else if (a === "run") h.callService(d, "turn_on", { entity_id: entity });
    else if (a === "press") h.callService(d, "press", { entity_id: entity });
    else this._moreInfo(entity);
  }
};
