/* Live state: screens, overlays, formatted values, render looks, post-processing, and _update() applying hass.
 */
import type * as THREE from "three";
import type { CardConfig, Hass, HassEntity } from "../types";
import type { Home3DCard, Screen } from "./card";
import { JSM, CX, CY, AMBIENT, lookOf } from "../core/constants";
import { esc, smooth } from "../core/util";
import { WEATHER_ICON3, stateRgb, entIcon, ACTIVE, SCREEN_OFF } from "../core/entities";

export class LivePart {
  /* ---------- screens ---------- */
  /** paint a screen with its entity's artwork and title (async when there is artwork), and tint its light */
  _drawScreen(this: Home3DCard, sc: Screen, st: HassEntity | undefined, boost: number) {
    const a = st?.attributes || {},
      on = !!st && !SCREEN_OFF.has(st.state);
    const pic = on ? a.entity_picture_local || a.entity_picture || "" : "";
    const title = on ? a.media_title || a.app_name || a.source || a.friendly_name || "" : "";
    const sub = on
      ? a.media_artist || a.media_series_title || a.media_album_name || (a.media_title && a.app_name) || ""
      : "";
    const sig = [st?.state, pic, title, sub].join("|");
    const setLight = () => {
      sc.light.intensity = on && sc.rgb ? 20 * boost * ((sc.o.w || 32) / 32) * (st.state === "playing" ? 1 : 0.5) : 0;
      if (sc.rgb) sc.light.color.setRGB(sc.rgb[0], sc.rgb[1], sc.rgb[2]);
    };
    if (sc.sig === sig) return setLight();
    sc.sig = sig;
    const g = sc.canvas.getContext("2d")!,
      W = 512,
      H = 288;
    const fit = (txt: unknown, max: number) => {
      let t = String(txt);
      if (g.measureText(t).width <= max) return t;
      while (t.length > 1 && g.measureText(t + "…").width > max) t = t.slice(0, -1);
      return t + "…";
    };
    const paint = (img: HTMLImageElement | null) => {
      if (sc.sig !== sig || !this._renderer) return;
      g.save();
      g.fillStyle = "#050506";
      g.fillRect(0, 0, W, H);
      if (!on) {
        const gr = g.createLinearGradient(0, 0, W, H);
        gr.addColorStop(0, "rgba(255,255,255,.07)");
        gr.addColorStop(0.45, "rgba(255,255,255,0)");
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
        sc.rgb = null;
      } else {
        let textX = 32,
          textW = W - 64,
          textY = H - 64;
        if (img) {
          const ar = img.width / img.height,
            cover = Math.max(W / img.width, H / img.height);
          g.filter = "blur(16px)";
          g.drawImage(
            img,
            (W - img.width * cover) / 2,
            (H - img.height * cover) / 2,
            img.width * cover,
            img.height * cover,
          );
          g.filter = "none";
          g.fillStyle = "rgba(0,0,0,.5)";
          g.fillRect(0, 0, W, H);
          if (ar > 1.3) {
            // video / app thumbnail: fill the screen, caption on a gradient
            const s2 = Math.min(W / img.width, H / img.height);
            g.drawImage(img, (W - img.width * s2) / 2, (H - img.height * s2) / 2, img.width * s2, img.height * s2);
            const gr = g.createLinearGradient(0, H * 0.55, 0, H);
            gr.addColorStop(0, "rgba(0,0,0,0)");
            gr.addColorStop(1, "rgba(0,0,0,.8)");
            g.fillStyle = gr;
            g.fillRect(0, 0, W, H);
          } else {
            // album art: square cover on the left, text beside it
            const S = H - 56,
              sw = S * Math.min(ar, 1.2);
            g.shadowColor = "rgba(0,0,0,.6)";
            g.shadowBlur = 18;
            g.drawImage(img, 28, 28, sw, S);
            g.shadowBlur = 0;
            textX = 28 + sw + 26;
            textW = W - textX - 24;
            textY = H / 2 - 4;
          }
          try {
            const t = document.createElement("canvas");
            t.width = t.height = 6;
            const tg = t.getContext("2d");
            tg.drawImage(img, 0, 0, 6, 6);
            const d = tg.getImageData(0, 0, 6, 6).data;
            let r = 0,
              gg = 0,
              b = 0;
            for (let i = 0; i < d.length; i += 4) {
              r += d[i];
              gg += d[i + 1];
              b += d[i + 2];
            }
            const n = d.length / 4,
              mx = Math.max(r, gg, b) / n || 1;
            sc.rgb = [r / n / mx, gg / n / mx, b / n / mx];
          } catch (e: any) {
            sc.rgb = [1, 1, 1];
          }
        } else {
          const gr = g.createLinearGradient(0, 0, W, H);
          gr.addColorStop(0, "#23324a");
          gr.addColorStop(1, "#3a2340");
          g.fillStyle = gr;
          g.fillRect(0, 0, W, H);
          textY = H / 2 + 6;
          sc.rgb = [0.6, 0.7, 1];
        }
        g.fillStyle = "#fff";
        g.font = "600 30px system-ui, sans-serif";
        g.fillText(fit(title, textW), textX, textY);
        g.fillStyle = "rgba(255,255,255,.72)";
        g.font = "400 21px system-ui, sans-serif";
        if (sub) g.fillText(fit(sub, textW), textX, textY + 32);
        g.fillStyle = "rgba(255,255,255,.85)";
        g.font = "600 18px system-ui, sans-serif";
        g.fillText(st.state === "playing" ? "▶" : st.state === "paused" ? "❚❚" : "", W - 40, 38);
      }
      g.restore();
      sc.tex.needsUpdate = true;
      setLight();
      this._requestRender();
    };
    if (pic) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => paint(img);
      img.onerror = () => paint(null);
      img.src = pic;
    } else paint(null);
  }

  /* ---------- html overlays ---------- */
  _buildOverlays(this: Home3DCard) {
    const cfg = this._cfg(),
      ov = this._ov;
    ov.innerHTML = "";
    this._anchors = [];
    this._chips = (cfg.chips || []).map((cc) => {
      const d = document.createElement("div");
      d.className = "chip";
      ov.append(d);
      if (cc.size > 0 && cc.size !== 1) d.style.fontSize = `max(${9 * cc.size}px, ${1.1 * cc.size}cqw)`;
      if (cc.entity) this._bindEntityTap(d, cc.entity, cc.tap);
      else this._bindTap(d, cc.tap_entity || cc.temperature || cc.climate || cc.humidity);
      this._anchors.push({ node: d, p: [cc.x, cc.y, cc.z ?? 50] });
      return { cfg: cc, node: d };
    });
    this._doors = (cfg.doors || []).map((dc) => {
      const d = document.createElement("div");
      d.className = "door";
      d.title = dc.name || dc.entity;
      d.innerHTML = "<ha-icon></ha-icon>";
      ov.append(d);
      if (dc.size > 0 && dc.size !== 1) d.style.width = d.style.height = `max(${14 * dc.size}px, ${1.8 * dc.size}cqw)`;
      this._bindTap(d, dc.entity);
      this._anchors.push({ node: d, p: [dc.x, dc.y, dc.z ?? 22] });
      return { cfg: dc, node: d };
    });
    this._weather = null;
    if (cfg.weather) {
      const w = document.createElement("div");
      w.className = "weather";
      w.innerHTML = `<ha-icon></ha-icon><div class="t"></div><div class="s"></div>`;
      ov.append(w);
      this._bindTap(w, cfg.weather);
      this._weather = w;
    }
  }

  _placeOverlays(this: Home3DCard) {
    const T = this.T,
      v = new T.Vector3();
    for (const a of [...(this._anchors || []), ...(this._roomLabels || [])]) {
      v.set(a.p[0] - CX, a.p[2], a.p[1] - CY).project(this._cam);
      a.node.style.left = ((v.x + 1) / 2) * 100 + "%";
      a.node.style.top = ((1 - v.y) / 2) * 100 + "%";
    }
  }

  _fmt(this: Home3DCard, entity: string, digits = 0) {
    const st = this._hass.states[entity];
    if (!st || ["unknown", "unavailable"].includes(st.state)) return "–";
    const n = Number(st.state);
    return isNaN(n) ? st.state : n.toFixed(digits);
  }

  /* ---------- looks ----------
   * light = sky/ground gradient lighting with a cool fill and soft shadows, ao = ambient occlusion,
   * stage = soft drop shadow under the house + spotlit backdrop, bloom = glow around lit lamps (night only).
   * Each is a 0..1 strength (lookOf). The post-processing passes (ao, bloom) load on first use. */
  _applyLook(this: Home3DCard, day: number) {
    // day: daylight 0 (night) .. 1, from _update
    const T = this.T,
      L = lookOf(this._cfg()),
      r = this._renderer,
      t = L.light,
      mix = (a: number, b: number) => a + (b - a) * t,
      night = day < 0.5;
    const A = Math.max(0, Math.min(1, +(this._cfg().ambient ?? AMBIENT) || 0)); // daytime room fill: the even light everywhere
    this._amb.intensity = mix(0.22 + 0.53 * day * A, 0.08 + 0.17 * day * A);
    this._hemi.intensity = mix(0.16 + 0.39 * day * A, 0.35 + 0.9 * day * A);
    this._hemi.color.lerpColors(new T.Color(0xdfe8ff), new T.Color(0xd6e4ff), t);
    this._hemi.groundColor.lerpColors(new T.Color(0x3a2f25), new T.Color(0x5a4636), t);
    this._sun.intensity *= mix(1, 1.3); // _update set the sun from its elevation
    this._fill.intensity = (0.06 + 0.29 * day) * t;
    r.toneMappingExposure = mix(1, 1.05);
    if (!this._stage && L.stage && !this._plan) this._buildStageShadow(this._cfg().scene || {});
    for (const m of [this._stage, this._stageSpot])
      if (m) {
        m.visible = L.stage > 0;
        m.material.opacity = L.stage;
      }
    const sig = JSON.stringify(L) + night;
    if (sig !== this._lkSig) {
      // things that need a shadow re-render or a shader recompile: only when the look changes
      this._lkSig = sig;
      this._fill.visible = t > 0;
      const type = t > 0 ? T.VSMShadowMap : T.PCFSoftShadowMap;
      if (r.shadowMap.type !== type) r.shadowMap.type = type;
      Object.assign(this._sun.shadow, {
        radius: 1 + 8 * t,
        blurSamples: 16,
        bias: mix(-0.0008, -0.0004),
        normalBias: 0.6 * t,
      });
      for (const g of this._lightGroups) if (g.light.castShadow) g.light.shadow.radius = 1 + 3 * t;
      r.shadowMap.needsUpdate = true;
      const s = L.stage,
        hex = (a: number, b: number) => "#" + new T.Color(a).lerp(new T.Color(b), s).getHexString();
      const card = this.shadowRoot.querySelector<HTMLElement>("ha-card");
      if (card) card.style.background = s ? hex(0x1b1a18, 0x141311) : ""; // the spotlight itself is _stageSpot, in the scene
    }
    if ((L.ao || L.bloom) && !this._composer) this._loadPost();
    const bloom = night && L.bloom > 0; // by day the lamps are dim and bloom only washes out white surfaces
    if (this._aoPass) {
      this._aoPass.enabled = L.ao > 0;
      this._aoPass.blendIntensity = L.ao;
    }
    if (this._bloomPass) {
      this._bloomPass.enabled = bloom;
      this._bloomPass.strength = 0.9 * L.bloom;
    }
    this._usePP = !!this._composer && !this._plan && (L.ao > 0 || bloom); // floor plan editing stays plain and quick
    // the bloom pass writes opaque alpha, so the card background has to be painted into the scene
    const bgKey = this._usePP && bloom ? L.stage + "|" + r.toneMappingExposure : null; // _sceneBg reads computed styles: only when it changes
    if (bgKey !== this._bgKey) {
      this._bgKey = bgKey;
      this._scene.background = bgKey ? this._sceneBg(L.stage) : null;
    }
  }

  /* the card background as a scene background colour. The output pass tone-maps it, so undo ACES first (per channel; fine for greys). */
  _sceneBg(this: Home3DCard, s: number) {
    const T = this.T,
      k = this._renderer.toneMappingExposure / 0.6;
    const aces = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081);
    const untone = (c: THREE.Color) => {
      for (const ch of ["r", "g", "b"] as const) {
        let lo = 0,
          hi = 1;
        for (let i = 0; i < 30; i++) {
          const m = (lo + hi) / 2;
          if (aces(m * k) < c[ch]) lo = m;
          else hi = m;
        }
        c[ch] = lo;
      }
      return c;
    };
    const bg = new T.Color(
      ((s) => s.getPropertyValue("--ha-3dhome-bg").trim() || s.getPropertyValue("--iso-bg").trim())(
        getComputedStyle(this),
      ) || "#1b1a18",
    );
    return untone(s ? bg.lerp(new T.Color(0x141311), s) : bg); // the stage spotlight is a mesh (_stageSpot), so this stays flat
  }

  async _loadPost(this: Home3DCard) {
    const gen = this._gen,
      cfg = this._config;
    if (this._ppLoading === gen) return;
    this._ppLoading = gen;
    try {
      const [{ EffectComposer }, { RenderPass }, { OutputPass }, { GTAOPass }, { UnrealBloomPass }] = await Promise.all(
        ["EffectComposer", "RenderPass", "OutputPass", "GTAOPass", "UnrealBloomPass"].map(
          (f) => import((cfg.jsm_url || JSM) + "postprocessing/" + f + ".js/+esm"),
        ),
      );
      if (gen !== this._gen || !this._renderer) return;
      const T = this.T,
        comp = (this._composer = new EffectComposer(this._renderer));
      comp.addPass(new RenderPass(this._scene, this._cam));
      const ao = (this._aoPass = new GTAOPass(this._scene, this._cam, 256, 256));
      ao.updateGtaoMaterial({
        radius: 20,
        distanceExponent: 1.3,
        thickness: 8,
        scale: 1.8,
        samples: 16,
        distanceFallOff: 1,
        screenSpaceRadius: false,
      });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      // sprites (glows), glass and invisible hit targets must not occlude anything
      const hide = ao.overrideVisibility.bind(ao);
      ao.overrideVisibility = () => {
        hide();
        this._scene.traverse((o: any) => {
          const m = o.material;
          if (o.isSprite || (m && !Array.isArray(m) && (!m.visible || m.transparent || !m.depthWrite)))
            o.visible = false;
        });
      };
      comp.addPass(ao);
      comp.addPass((this._bloomPass = new UnrealBloomPass(new T.Vector2(256, 256), 0.45, 0.55, 0.72)));
      comp.addPass(new OutputPass());
      this._resize();
      this._update();
      this._requestRender();
    } catch (e: any) {
      console.warn("ha-3dhome: effects unavailable", e);
    } finally {
      if (this._ppLoading === gen) this._ppLoading = null;
    }
  }

  /* ---------- live update ---------- */
  /** apply the entities' states to the scene: daylight, lamps, screens, chips, door badges, 3D doors and weather */
  _update(this: Home3DCard) {
    const h = this._hass,
      cfg = this._cfg();
    if (!h || !this._lightGroups) return;
    const boost = this._updateDaylight(h, cfg);
    this._updateLamps(h, cfg, boost);
    for (const sc of this._screens || []) this._drawScreen(sc, h.states[sc.o.entity], boost);
    this._updateChips(h);
    this._updateDoorBadges(h);
    this._setDoors(); // 3D doors follow their sensors
    this._updateWeather(h, cfg);
    this._requestRender();
  }

  /** the sun's position, colour and strength, the ambient look and window light. Returns how much to boost lamps
   * (1 at night, less by day) */
  _updateDaylight(this: Home3DCard, h: Hass, cfg: CardConfig): number {
    const sun = h.states[cfg.sun_entity || "sun.sun"],
      pos = this._sunPos(),
      north = Number(cfg.scene?.north) || 0;
    // daylight 0..1: from the sun's elevation (civil twilight is −6°), or sun.sun's state when there is no position
    let el = pos ? pos.elevation : sun && sun.state === "below_horizon" ? -10 : 45;
    if (cfg.night_mode === "never" || this._plan) el = Math.max(el, this._plan ? 55 : 30); // plan editing is always lit
    if (cfg.night_mode === "always" && !this._plan) el = -18;
    const day = smooth(-6, 4, el);
    if (this._plan)
      this._placeSun(0, 89, 0); // (nearly) overhead: full-height walls would otherwise throw long shadows across the plan
    else if (pos)
      this._placeSun(pos.azimuth, Math.max(el, 7), north); // keep a little height so dawn shadows stay on the map
    else this._sun.position.set(-260, 420, -160);
    this._sun.intensity = 1.3 * smooth(-1, 8, el);
    const warm = smooth(2, 30, el); // orange at sunrise/sunset, white-ish by mid-morning
    this._sun.color.setRGB(1, 0.62 + 0.325 * warm, 0.38 + 0.483 * warm);
    this._applyLook(day); // ambient + hemisphere (and the optional looks)
    for (const s of this._skyLights || [])
      s.light.intensity = 160 * Math.sqrt(s.w / 60) * day * (cfg.window_light ?? 1);
    return 1 - 0.45 * day; // lamps look brighter in the dark
  }

  /** each light group's colour and brightness from its bulbs' states */
  _updateLamps(this: Home3DCard, h: Hass, cfg: CardConfig, boost: number) {
    const T = this.T;
    for (const g of this._lightGroups) {
      let sum = 0,
        rgb = [0, 0, 0],
        anyOn = false;
      for (const L of g.members) {
        const st = h.states[L.entity];
        if (!st || st.state !== "on") continue;
        anyOn = true;
        const bri = (st.attributes.brightness ?? 255) / 255,
          c = L.color || stateRgb(st);
        sum += bri;
        rgb = rgb.map((v, i) => v + c[i] * bri);
      }
      const n = g.members.length;
      const color = (this._tmpCol ||= new T.Color());
      if (anyOn && sum > 0) color.setRGB(rgb[0] / sum / 255, rgb[1] / sum / 255, rgb[2] / sum / 255);
      else color.setRGB(1, 0.8, 0.55);
      const avg = Math.min(1, sum / n),
        level = anyOn ? (0.06 + 0.94 * avg) * Math.sqrt(n) : 0; // follows the bulbs' real brightness; per-light settings set the top end
      const L = g.L,
        strength = (cfg.light_strength ?? 1) * (L.intensity ?? 1);
      if (L.saturation != null && L.saturation !== 1) {
        const c = { h: 0, s: 0, l: 0 };
        color.getHSL(c);
        color.setHSL(c.h, Math.min(1, c.s * Math.max(0, L.saturation)), c.l);
      }
      g.light.color.copy(color);
      if (g.kind === "string") {
        g.light.intensity = level * 48 * boost * strength;
        for (const b of g.bulbs) {
          b.material.emissive.copy(color);
          b.material.emissiveIntensity = anyOn ? 2.2 : 0.05;
        }
      } else {
        const r = L.r ?? 40;
        g.light.intensity =
          level * ((g.light as THREE.SpotLight).isSpotLight ? 175 : 115) * boost * strength * (r / 60);
        for (const f of g.fixtures) {
          f.material.emissive.copy(color);
          f.material.emissiveIntensity = anyOn ? 0.5 + 1.1 * avg : 0.04;
        }
        g.sprite.material.color.copy(color);
        g.sprite.material.opacity = anyOn ? 0.3 + 0.65 * avg : 0;
      }
    }
  }

  /** the text badges (chips): an entity's state, or a room summary (climate, temperature, humidity, media, occupancy) */
  _updateChips(this: Home3DCard, h: Hass) {
    for (const { cfg: cc, node } of this._chips) {
      const parts: string[] = [];
      if (cc.entity) {
        const st = h.states[cc.entity];
        const txt = !st
          ? "–"
          : h.formatEntityState
            ? h.formatEntityState(st)
            : `${st.state}${st.attributes.unit_of_measurement ? " " + st.attributes.unit_of_measurement : ""}`;
        const name = cc.label ?? (cc.show_name ? st?.attributes.friendly_name || cc.entity : "");
        const html =
          `<ha-icon icon="${esc(cc.icon || entIcon(st, cc.entity))}"></ha-icon>${name ? `<span>${esc(name)}</span>` : ""}` +
          (cc.show_state === false ? "" : `<span class="item">${esc(txt)}</span>`);
        node.classList.toggle("act", !!st && ACTIVE.has(st.state));
        if (node._html !== html) {
          node.innerHTML = html;
          node._html = html;
          node.style.display = "";
        }
        continue;
      }
      if (cc.icon) parts.push(`<ha-icon icon="${esc(cc.icon)}"></ha-icon>`);
      if (cc.label) parts.push(`<span>${esc(cc.label)}</span>`);
      if (cc.climate) {
        const st = h.states[cc.climate];
        if (st) {
          const cur = st.attributes.current_temperature;
          parts.push(
            `<span class="item"><ha-icon icon="mdi:thermostat"></ha-icon>${cur != null ? Math.round(cur) + "°" : "–"}</span>`,
          );
          const lo = st.attributes.target_temp_low,
            hi = st.attributes.target_temp_high,
            tt = st.attributes.temperature;
          const tgt =
            tt != null ? `${Math.round(tt)}°` : lo != null && hi != null ? `${Math.round(lo)}–${Math.round(hi)}°` : "";
          if (tgt) parts.push(`<span class="item" style="opacity:.75">${tgt}</span>`);
        }
      }
      const tv = cc.temperature && this._fmt(cc.temperature, cc.temp_digits ?? 0);
      if (tv && tv !== "–") parts.push(`<span class="item"><ha-icon icon="mdi:thermometer"></ha-icon>${tv}°</span>`);
      const hv = cc.humidity && this._fmt(cc.humidity, 0);
      if (hv && hv !== "–") parts.push(`<span class="item"><ha-icon icon="mdi:water-percent"></ha-icon>${hv}%</span>`);
      if (cc.media && h.states[cc.media]?.state === "playing")
        parts.push(`<span class="item occ"><ha-icon icon="mdi:television-play"></ha-icon></span>`);
      if (cc.occupancy && h.states[cc.occupancy]?.state === "on")
        parts.push(`<span class="item occ"><ha-icon icon="mdi:account"></ha-icon></span>`);
      const html = parts.join("");
      if (node._html !== html) {
        node.innerHTML = html;
        node._html = html;
        node.style.display = html ? "" : "none";
      }
    }
  }

  /** door and window badges: open or shut */
  _updateDoorBadges(this: Home3DCard, h: Hass) {
    for (const { cfg: dc, node } of this._doors) {
      const open = h.states[dc.entity]?.state === "on",
        icon = open ? dc.icon_open || "mdi:door-open" : dc.icon_closed || "mdi:door-closed";
      if (node._icon === icon) continue;
      node._icon = icon;
      node.className = "door " + (open ? "open" : "closed");
      node.querySelector<HTMLElement>("ha-icon").setAttribute("icon", icon);
    }
  }

  /** the weather corner */
  _updateWeather(this: Home3DCard, h: Hass, cfg: CardConfig) {
    if (this._weather) {
      const st = h.states[cfg.weather];
      if (st) {
        const a = st.attributes,
          w = this._weather;
        const outside = cfg.outdoor_temperature ? this._fmt(cfg.outdoor_temperature, 0) : Math.round(a.temperature);
        const wind = a.wind_speed != null ? ` · ${Math.round(a.wind_speed)} ${a.wind_speed_unit || ""}` : "";
        const icon = WEATHER_ICON3[st.state] || "mdi:weather-partly-cloudy",
          t = `${outside}${a.temperature_unit || "°"}`,
          sub = `${a.humidity ?? "–"}% humidity${wind}`;
        if (w._sig !== icon + t + sub) {
          w._sig = icon + t + sub;
          w.querySelector<HTMLElement>("ha-icon").setAttribute("icon", icon);
          w.querySelector<HTMLElement>(".t").textContent = t;
          w.querySelector<HTMLElement>(".s").textContent = sub;
        }
      }
    }
  }
}
