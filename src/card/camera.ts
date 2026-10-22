/* Camera: sizing, the home view, flying between views, panning limits, and on-demand rendering.
 */
import type * as THREE from "three";
import type { Home3DCard } from "./card";

/** where _flyTo() takes the camera; anything left out stays as it is */
export interface CameraGoal {
  target?: THREE.Vector3;
  zoom?: number;
  theta?: number; // azimuth
  phi?: number; // tilt from straight down
}
import { CX, CY } from "../core/constants";

export class CameraPart {
  _resize(this: Home3DCard) {
    const w = this._wrap.clientWidth;
    const h = this._wrap.clientHeight;
    if (!w || !h) return;
    this._renderer.setSize(w, h, false);
    this._composer?.setPixelRatio(this._renderer.getPixelRatio());
    this._composer?.setSize(w, h);
    const span = this._config.view_size || 375;
    const a = w / h;
    const c = this._cam;
    if (a >= 1.6) {
      c.top = span / 1.6;
      c.bottom = -span / 1.6;
      c.left = -c.top * a;
      c.right = c.top * a;
    } else {
      c.left = -span;
      c.right = span;
      c.top = span / a;
      c.bottom = -span / a;
    }
    this._applyOffset();
    if (this._moved || this._edit) {
      /* the view is the user's own: leave it */
    } else if (this._fitRoom || this._fly)
      this._frame(this._fitRoom || null, 350); // the safe area changed (room cards loaded, resize): re-frame
    else {
      // nobody has moved the view yet: the whole home, as big as fits in the safe area
      const v = this._homeView();
      const oc = this._controls;
      oc.target.copy(v.target);
      c.position.setFromSpherical(this._homeSph).add(v.target);
      c.lookAt(v.target);
      c.zoom = v.zoom;
      c.updateProjectionMatrix();
    }
    this._requestRender();
  }

  /* The part of the card the controls leave clear, in px of the wrap: inside the device's safe areas (the .safe box, inset by
   * the panel's --ha-3dhome-safe-* insets), above the room bar and nav, and below the room cards on a phone (they span the
   * top) or beside them on a wide screen, whichever is bigger. Collapsed cards leave the full width. */
  _safeArea(this: Home3DCard) {
    const wr = this._wrap.getBoundingClientRect();
    const w = this._wrap.clientWidth;
    const h = this._wrap.clientHeight;
    const M = 8;
    const rel = (el: Element | null | undefined) => {
      const r = el && !el.classList.contains("hide") ? el.getBoundingClientRect() : null;
      return r?.width && r?.height ? r : null;
    };
    const safe = rel(this.shadowRoot?.querySelector<HTMLElement>(".safe"));
    const sx = safe ? safe.left - wr.left : 0;
    const sy = safe ? safe.top - wr.top : 0;
    const sw = safe ? safe.width : w;
    const sh = safe ? safe.bottom - wr.top : h;
    // the room bar and the nav buttons along the bottom: the view stops above the higher of them
    const bars = [".rooms", ".nav"].map((q) => rel(this.shadowRoot?.querySelector<HTMLElement>(q))).filter(Boolean);
    const bottom = bars.length ? Math.max(h * 0.6, Math.min(...bars.map((r) => r.top - wr.top)) - M) : sh;
    const full = { x: sx, y: sy, w: sw, h: bottom - sy };
    const box = this.shadowRoot?.querySelector<HTMLElement>(".rcards");
    if (!box || box.classList.contains("min") || this._edit) return full;
    const r = rel(box);
    if (!r) return full;
    const top = r.bottom - wr.top + M;
    const below = bottom - top;
    const left = r.left - wr.left - M;
    if (below * sw >= (left - sx) * (bottom - sy)) return below > h * 0.25 ? { x: sx, y: top, w: sw, h: below } : full;
    return left - sx > w * 0.3 ? { x: sx, y: sy, w: left - sx, h: bottom - sy } : full;
  }

  /* Centre the view in the safe area: a camera view offset shifts the whole picture, so everything that centres on the orbit
   * target (Home, room buttons, zoom) lands in the middle of the clear part. _requestRender eases it in when the area changes. */
  _applyOffset(this: Home3DCard) {
    const w = this._wrap.clientWidth;
    const h = this._wrap.clientHeight;
    const s = this._safeArea();
    this._voT = [w / 2 - (s.x + s.w / 2), h / 2 - (s.y + s.h / 2)];
    if (!this._vo) this._vo = [...this._voT];
    this._setOffset();
  }

  _setOffset(this: Home3DCard) {
    const cam = this._cam;
    const w = this._wrap.clientWidth;
    const h = this._wrap.clientHeight;
    const [x, y] = this._vo;
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) cam.clearViewOffset();
    else cam.setViewOffset(w, h, x, y, w, h);
  }

  _stepOffset(this: Home3DCard) {
    // → true while still easing
    const a = this._vo;
    const b = this._voT;
    if (!a || !b || (a[0] === b[0] && a[1] === b[1])) return false;
    for (const i of [0, 1]) a[i] = Math.abs(b[i] - a[i]) < 0.5 ? b[i] : a[i] + (b[i] - a[i]) * 0.2;
    this._setOffset();
    return true;
  }

  /* the home view: the whole house (its floors, walls' height and lights) as large as fits in the safe area, from the home angle.
   * The camera is orthographic, so the box's centre projects to the centre of its outline and can be the orbit target. */
  _homeView(this: Home3DCard) {
    const T = this.T;
    const cfg = this._cfg();
    const sc = cfg.scene || {};
    const w = this._wrap.clientWidth || 1;
    const h = this._wrap.clientHeight || 1;
    const s = this._safeArea();
    const pts = [
      ...(sc.floors || []).flatMap((f) => f.pts || []),
      ...(cfg.lights || []).filter((L) => L.x != null).map((L) => [L.x, L.y]),
    ];
    if (!pts.length) return { target: this._home.target.clone(), zoom: this._home.zoom };
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const H = sc.wall_height ?? 46;
    const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const target = new T.Vector3((x1 + x2) / 2 - CX, H / 2, (y1 + y2) / 2 - CY);
    const probe = this._cam.clone();
    probe.clearViewOffset();
    probe.zoom = 1;
    probe.updateProjectionMatrix();
    probe.position.setFromSpherical(this._homeSph).add(target);
    probe.lookAt(target);
    probe.updateMatrixWorld(true);
    let ex = 0;
    let ey = 0;
    for (const x of [x1, x2])
      for (const y of [y1, y2])
        for (const z of [0, H]) {
          const v = new T.Vector3(x - CX, z, y - CY).project(probe);
          ex = Math.max(ex, Math.abs(v.x));
          ey = Math.max(ey, Math.abs(v.y));
        }
    const c = this._controls;
    const zoom = 0.96 * Math.min(s.w / w / (ex || 1), s.h / h / (ey || 1));
    return { target, zoom: Math.min(c.maxZoom, Math.max(c.minZoom, zoom)) };
  }

  _requestRender(this: Home3DCard) {
    if (this._raf || !this._renderer || document.hidden) return; // hidden tab: render once it's visible again
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      if (!this._renderer) return;
      this._camMv = false;
      this._controls.update(); // sets _camMv (via "change") only if the camera really moved
      const stepped = this._stepOffset(); // always steps the offset easing
      const moving = this._camMv || stepped;
      for (const hp of this._helpers || []) hp.update();
      this._scaleHandles();
      this._updateFade();
      if (this._usePP) this._composer.render();
      else this._renderer.render(this._scene, this._cam);
      this._placeOverlays();
      if (moving) this._requestRender();
    });
  }

  /* ---------- camera ---------- */
  /* → true when the camera moved, zoomed or retargeted since the last call (same tolerances as OrbitControls) */
  _camMoved(this: Home3DCard) {
    const T = this.T;
    const c = this._cam;
    const t = this._controls.target;
    const k = (this._camK ||= { p: new T.Vector3(), q: new T.Quaternion(), t: new T.Vector3(), z: null });
    const moved =
      k.z !== c.zoom ||
      k.p.distanceToSquared(c.position) > 1e-6 ||
      8 * (1 - k.q.dot(c.quaternion)) > 1e-6 ||
      k.t.distanceToSquared(t) > 1e-6;
    if (moved) {
      k.p.copy(c.position);
      k.q.copy(c.quaternion);
      k.t.copy(t);
      k.z = c.zoom;
    }
    return moved;
  }

  _clampPan(this: Home3DCard) {
    const t = this._controls.target;
    const b = this._config.pan_bounds || [-340, 340, -240, 240];
    const nx = Math.min(b[1], Math.max(b[0], t.x));
    const nz = Math.min(b[3], Math.max(b[2], t.z));
    if (nx !== t.x || nz !== t.z) {
      this._cam.position.x += nx - t.x;
      this._cam.position.z += nz - t.z;
      t.x = nx;
      t.z = nz;
    }
  }

  _sph(this: Home3DCard) {
    return new this.T.Spherical().setFromVector3(this._cam.position.clone().sub(this._controls.target));
  }

  /* smooth camera move: any of target (Vector3), zoom, theta (azimuth), phi (tilt) */
  _flyTo(this: Home3DCard, { target, zoom, theta, phi }: CameraGoal, ms = 650) {
    const T = this.T;
    const c = this._controls;
    const cam = this._cam;
    const s0 = this._sph();
    const t0 = c.target.clone();
    const t1 = target ? target.clone() : t0.clone();
    const z0 = cam.zoom;
    const z1 = Math.min(c.maxZoom, Math.max(c.minZoom, zoom ?? z0));
    let th1 = theta ?? s0.theta;
    while (th1 - s0.theta > Math.PI) th1 -= 2 * Math.PI;
    while (th1 - s0.theta < -Math.PI) th1 += 2 * Math.PI;
    const ph1 = Math.min(c.maxPolarAngle, Math.max(c.minPolarAngle, phi ?? s0.phi));
    const fly = (this._fly = {});
    const start = performance.now();
    const damp = c.enableDamping;
    c.enableDamping = false;
    const step = (now: number) => {
      if (this._fly !== fly || !this._renderer) {
        c.enableDamping = damp;
        return;
      }
      const k = Math.min(1, (now - start) / ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      c.target.lerpVectors(t0, t1, e);
      cam.position
        .setFromSpherical(new T.Spherical(s0.radius, s0.phi + (ph1 - s0.phi) * e, s0.theta + (th1 - s0.theta) * e))
        .add(c.target);
      cam.zoom = z0 * Math.pow(z1 / z0, e);
      cam.updateProjectionMatrix();
      cam.lookAt(c.target);
      if (k < 1) requestAnimationFrame(step);
      else {
        this._fly = null;
        c.enableDamping = damp;
      }
      this._syncNav();
      this._requestRender();
    };
    requestAnimationFrame(step);
  }

  /** turn the view about the target by d radians */
  _orbitBy(this: Home3DCard, d: number) {
    this._flyTo({ theta: this._sph().theta + d }, 450);
  }

  _toggleTop(this: Home3DCard) {
    const s = this._sph();
    const q = Math.PI / 2;
    if (s.phi > 0.3) {
      this._lastPhi = s.phi;
      this._lastTheta = s.theta;
      this._flyTo({ phi: 0.02, theta: Math.round(s.theta / q) * q }, 550);
    } else this._flyTo({ phi: this._lastPhi || this._homeSph.phi, theta: this._lastTheta ?? s.theta + q / 2 }, 550);
  }

  _syncNav(this: Home3DCard) {
    this.shadowRoot?.querySelector<HTMLElement>('.nav [data-v="top"]')?.classList.toggle("on", this._sph().phi < 0.3);
  }

  /* plan-axis step that best matches a screen direction (sx right, sy up) */
  _screenDir(this: Home3DCard, sx: number, sy: number) {
    const T = this.T;
    const right = new T.Vector3().setFromMatrixColumn(this._cam.matrixWorld, 0);
    const fwd = this._controls.target.clone().sub(this._cam.position);
    right.y = 0;
    fwd.y = 0;
    right.normalize();
    fwd.normalize();
    const v = right.multiplyScalar(sx).add(fwd.multiplyScalar(sy));
    return Math.abs(v.x) >= Math.abs(v.z) ? [Math.sign(v.x), 0] : [0, Math.sign(v.z)];
  }
}
