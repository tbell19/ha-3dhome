/* Rooms: the room bar, focusing a room, per-room control cards, the idle return, and fading the walls in front.
 */
import { CX, CY } from "../core/constants.js";
import { ic, esc, inPoly, roomTitle } from "../core/util.js";

export const RoomsMixin = (Base) => class Rooms extends Base {
  _rooms() {
    const floors = this._cfg().scene?.floors || [];
    const title = roomTitle;
    const bbox = (pts) => [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
    const ptsOf = (names) => floors.filter((f) => names.includes(f.name)).flatMap((f) => f.pts);
    if (Array.isArray(this._config.room_menu))
      return this._config.room_menu.map((r) => { const pts = ptsOf(r.floors || [r.name]);
        return { name: r.name, label: r.label || title(r.name), rect: r.rect || (pts.length ? bbox(pts) : null), floors: r.floors || [r.name] }; }).filter((r) => r.rect);
    const skip = new Set(this._config.room_menu_exclude || ["rug", "shower_tub"]);
    const order = ["living", "kitchen", "dining", "bedroom", "office", "bath", "hallway", "balcony", "laundry", "closet"];
    const rank = (n) => { const i = order.indexOf(n); return i < 0 ? 99 : i; };
    return floors.filter((f) => f.name && !skip.has(f.name) && f.menu !== false && f.pts?.length >= 3)
      .map((f) => { const names = f.name === "bath" ? ["bath", "shower_tub"] : [f.name]; return { name: f.name, label: title(f.name), rect: bbox(ptsOf(names)), floors: names }; })
      .sort((a, b) => rank(a.name) - rank(b.name));
  }

  _buildRoomBar() {
    const bar = this.shadowRoot.querySelector(".rooms"); if (!bar) return;
    if (this._config.room_menu === false) { bar.style.display = "none"; return; }
    const rooms = this._rooms();
    bar.innerHTML = `<button data-r="">${ic("home-outline")}Home</button>` + rooms.map((r) => `<button data-r="${esc(r.name)}">${esc(r.label)}</button>`).join("");
    bar.onclick = (ev) => { const b = ev.target.closest("button"); if (!b) return; this._focusRoom(rooms.find((r) => r.name === b.dataset.r) || null); };
  }

  _setActiveRoom(name) { this.shadowRoot?.querySelectorAll(".rooms button").forEach((b) => b.classList.toggle("on", name !== null && b.dataset.r === (name || ""))); }

  _focusRoom(room) {
    const T = this.T;
    this._showRoomCards(room ? room.name : "home");
    this._setFocus(room);
    this._fitRoom = room; this._applyOffset();
    this._frame(room, 700);
    this._setActiveRoom(room ? room.name : "");
    this._moved = false;   // until a hand moves the view, a change in the room controls' size re-frames it (see _resize)
  }

  /* fly to frame a room (or the whole home, room null) inside the safe area, keeping the tilt */
  _frame(room, ms) {
    const T = this.T;
    if (!room) { const v = this._homeView(); this._flyTo({ target: v.target, zoom: v.zoom, theta: this._homeSph.theta, phi: this._homeSph.phi }, ms); return; }
    const [x1, x2, y1, y2] = room.rect, H = this._cfg().scene?.wall_height ?? 46, s = this._sph();
    const target = new T.Vector3((x1 + x2) / 2 - CX, 5, (y1 + y2) / 2 - CY);
    const phi = s.phi < 0.3 ? s.phi : Math.min(Math.max(s.phi, 0.7), 1.0);
    const probe = this._cam.clone(); probe.clearViewOffset(); probe.zoom = 1; probe.updateProjectionMatrix();
    probe.position.setFromSpherical(new T.Spherical(s.radius, phi, s.theta)).add(target); probe.lookAt(target); probe.updateMatrixWorld(true);
    let ex = 0, ey = 0;
    for (const x of [x1, x2]) for (const y of [y1, y2]) for (const z of [0, H]) {
      const v = new T.Vector3(x - CX, z, y - CY).project(probe); ex = Math.max(ex, Math.abs(v.x)); ey = Math.max(ey, Math.abs(v.y));
    }
    const sa = this._safeArea(), fw = sa.w / (this._wrap.clientWidth || 1), fh = sa.h / (this._wrap.clientHeight || 1);
    const zoom = Math.min(0.82 * fw / (ex || 1), 0.72 * fh / (ey || 1));   // fit the room inside the part the controls leave clear
    this._flyTo({ target, zoom, phi }, ms);
  }

  /* Room controls: `room_cards: { home: [card, …], <room name>: [card, …] }` holds ordinary Lovelace card configs, shown top right
   * for the room in view (`home` = the whole-home view). HA's own card helpers build them, so any card a dashboard can show works here.
   * Elements are cached per room and rebuilt only when that room's config changes. */
  _showRoomCards(key) {
    this._rcRoom = key;
    const box = this.shadowRoot?.querySelector(".rcards"); if (!box) return;
    const list = this._config.room_cards?.[key];
    if (!Array.isArray(list) || !list.length) { box.classList.add("hide"); return; }
    const label = key === "home" ? "Home" : this._rooms().find((r) => r.name === key)?.label || roomTitle(key);
    box.querySelector(".ttl").textContent = label;
    const mb = box.querySelector("[data-m]"); mb.innerHTML = ic(this._rcMin ? "chevron-down" : "chevron-up"); mb.title = this._rcMin ? "Show controls" : "Hide controls";
    box.classList.toggle("min", !!this._rcMin); box.classList.remove("hide");
    const body = box.querySelector(".rcbody"), sig = JSON.stringify(list), gen = this._gen;
    const c = (this._rcCache ||= new Map()).get(key);
    if (c?.sig === sig) { if (body.firstChild !== c.els[0] || body.children.length !== c.els.length) body.replaceChildren(...c.els); this._rcHass(); return; }
    body.replaceChildren();
    this._makeCards(list).then((els) => {
      if (gen !== this._gen) return;
      this._rcCache?.set(key, { sig, els });
      if (this._rcRoom === key && this.shadowRoot?.contains(body)) { body.replaceChildren(...els); this._rcHass(); }
    });
  }

  /* build Lovelace card elements; a card whose element isn't defined yet asks to be rebuilt (ll-rebuild) */
  async _makeCards(list) {
    const helpers = await window.loadCardHelpers?.().catch(() => null);
    const make = (conf) => {
      let el;
      try {
        if (helpers) el = helpers.createCardElement(conf);
        else { const t = String(conf.type || ""); el = document.createElement(t.startsWith("custom:") ? t.slice(7) : `hui-${t}-card`); el.setConfig?.(conf); }   // no card helpers (outside HA)
      }
      catch (e) { el = document.createElement("div"); el.textContent = "Card error: " + (e.message || e); }
      if (helpers) el.addEventListener("ll-rebuild", (ev) => { ev.stopPropagation(); const n = make(conf); el.replaceWith(n); n.hass = this._hass; }, { once: true });
      el.hass = this._hass;
      return el;
    };
    return (list || []).filter((c) => c && typeof c === "object").map(make);
  }

  _rcHass() {
    if (!this._hass || !this.shadowRoot) return;
    for (const b of this.shadowRoot.querySelectorAll(".rcards:not(.hide):not(.min) .rcbody, .rcp .rcprev")) for (const el of b.children) el.hass = this._hass;
  }

  /* `idle_view: {room, after}`: after `after` seconds without a touch, fly back to that room ("" or missing = whole home) */
  _armIdle() {
    clearTimeout(this._backT); this._backT = null;
    const s = +this._config?.idle_view?.after;
    if (!(s > 0) || !this._renderer) return;
    this._backT = setTimeout(() => {
      this._backT = null;
      if (!this._renderer) return;
      if (this._edit) return this._armIdle();   // never yank the view away mid-edit
      const name = this._config.idle_view?.room || "";
      this._focusRoom((name && this._rooms().find((r) => r.name === name)) || null);
    }, s * 1000);
  }

  _roomAt(ev) {
    const T = this.T, el = this._renderer.domElement, r = el.getBoundingClientRect(), ray = new T.Raycaster();
    ray.setFromCamera(new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), this._cam);
    const hit = ray.intersectObjects(this._floorMeshes || [], false).find((h) => h.object.userData.room && h.object.userData.room !== "rug");
    if (!hit) return null;
    const n = hit.object.userData.room;
    return this._rooms().find((rm) => rm.floors.includes(n)) || null;
  }

  /* See-through room view: while a room is framed, walls and furniture of other rooms that stand between the camera and
   * it fade out. Rays run from a grid of points inside the room towards the camera (orthographic, so they are parallel)
   * and are tested against bounding boxes, per mesh for walls and openings, per item for everything else.
   * Faded meshes get a see-through copy of their material (cached in _fadeMats), still cast shadows, and are restored
   * before the world is disposed. `room_fade: false` turns it off; a number 0–1 sets how much of them stays visible. */
  _setFocus(room) {
    const polys = room ? this._roomPolys(room) : null;
    this._focus = room && polys.length ? { room, polys } : null;
    this._fadeSig = null;
    if (!this._focus) this._clearFade();
    this._requestRender();
  }

  _roomPolys(room) {
    const floors = (this._cfg().scene?.floors || []).filter((f) => room.floors.includes(f.name) && f.pts?.length >= 3).map((f) => f.pts);
    if (floors.length) return floors;
    const [x1, x2, y1, y2] = room.rect || [];
    return room.rect ? [[[x1, y1], [x2, y1], [x2, y2], [x1, y2]]] : [];
  }

  _fadeAmount() { const v = this._config.room_fade; return v === false || this._edit ? null : Math.max(0, Math.min(1, typeof v === "number" ? v : 0.15)); }

  _updateFade() {
    const f = this._focus, a = this._fadeAmount();
    if (!f || a == null || !this._world) { if (this._faded?.size) this._clearFade(); return; }
    const T = this.T, dir = this._cam.position.clone().sub(this._controls.target).normalize();
    const sig = `${dir.x.toFixed(3)},${dir.y.toFixed(3)},${dir.z.toFixed(3)}|${this._fadeGen || 0}`;
    if (sig === this._fadeSig) return;
    this._fadeSig = sig;
    const sc = this._cfg().scene || {}, H = sc.wall_height ?? 46, inset = (sc.wall_thickness ?? 4) + 1;
    const pts = f.polys.flat(), x1 = Math.min(...pts.map((p) => p[0])), x2 = Math.max(...pts.map((p) => p[0]));
    const y1 = Math.min(...pts.map((p) => p[1])), y2 = Math.max(...pts.map((p) => p[1]));
    const inRoom = (x, y) => f.polys.some((pl) => inPoly(x, y, pl));
    // sample points inside the room, kept off its own walls, on the floor and at half height
    const N = 7, samples = [];
    for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
      const x = x1 + inset + ((x2 - x1 - 2 * inset) * i) / N, y = y1 + inset + ((y2 - y1 - 2 * inset) * j) / N;
      if (x2 - x1 > 2 * inset && y2 - y1 > 2 * inset && inRoom(x, y)) for (const z of [2, H * 0.55]) samples.push(new T.Vector3(x - CX, z, y - CY));
    }
    if (!samples.length) samples.push(new T.Vector3((x1 + x2) / 2 - CX, 2, (y1 + y2) / 2 - CY));
    // what can block: walls and openings piece by piece, furniture, models and fixtures as whole items
    const box = new T.Box3(), c = new T.Vector3(), ray = new T.Ray(), hit = new T.Vector3(), want = new Set(), seen = new Set();
    const blocks = (b) => samples.some((s) => { ray.set(s, dir); return ray.intersectBox(b, hit) && !b.containsPoint(s); });
    const piece = (m) => { if (m.isMesh && m.material?.visible !== false && blocks(box.setFromObject(m))) want.add(m); };
    this._world.traverse((m) => { if (m.userData.wall) piece(m); });   // legacy walls have no item key
    for (const [key, g] of this._items) {
      if (seen.has(g) || !"nbov".includes(key[0])) continue;
      seen.add(g);
      if (key[0] === "n") { g.traverse(piece); continue; }
      if (box.setFromObject(g).isEmpty()) continue;
      box.getCenter(c);
      if (inRoom(c.x + CX, c.z + CY) || !blocks(box)) continue;
      g.traverse((m) => { if (m.isMesh) want.add(m); });
    }
    for (const m of this._faded || []) if (!want.has(m)) this._unfadeMesh(m);
    this._faded = want;
    for (const m of want) this._fadeMesh(m, a);
  }

  _fadeMesh(m, a) {
    if (m.userData.fadeOrig) return;
    const orig = m.material, one = (mt) => {
      if (!mt || mt.visible === false || mt.colorWrite === false) return mt;
      const ck = mt.uuid + "|" + a;
      let fm = (this._fadeMats ||= new Map()).get(ck);
      if (!fm) { fm = mt.clone(); fm.transparent = true; fm.opacity = (mt.opacity ?? 1) * a; fm.depthWrite = false; this._fadeMats.set(ck, fm); }
      return fm;
    };
    m.userData.fadeOrig = orig;
    m.material = Array.isArray(orig) ? orig.map(one) : one(orig);
  }

  _unfadeMesh(m) { if (m.userData.fadeOrig) { m.material = m.userData.fadeOrig; delete m.userData.fadeOrig; } }

  _clearFade(free) {   // `free` also drops the see-through materials (world rebuild); otherwise they stay for the next room
    for (const m of this._faded || []) this._unfadeMesh(m);
    this._faded = null; this._fadeSig = null;
    if (free) { for (const fm of this._fadeMats?.values() || []) fm.dispose(); this._fadeMats = null; }   // clones share their originals' textures
    this._requestRender();
  }
};
