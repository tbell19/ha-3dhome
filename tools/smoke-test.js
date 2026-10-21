/* Headless smoke test for ha-3dhome-card.
 *
 * Loads the card exactly the way Home Assistant does on a strategy dashboard — through the
 * `custom:ha-3dhome` dashboard strategy, using the sample home in tools/fixtures/test-home.json —
 * with a fake `hass` object, Three.js served from node_modules (no network), and a mock Sweet Home 3D
 * library. Then it drives the editor and checks the results.
 *
 *   npm test                 desktop checks (mouse)
 *   npm test -- --mobile     phone viewport + touch checks
 *   npm test -- --dist       test the minified build (run `npm run build` first)
 *
 * Screenshots go to tools/out/. Exit code is non-zero if any check fails.
 * Rendering uses SwiftShader (software WebGL), so it is slow — allow a couple of minutes.
 */
const { chromium } = require("playwright");
const fs = require("fs"),
  path = require("path");
const { build: buildMockLib } = require("./mock/build-mock-lib");

const ROOT = path.join(__dirname, "..");
const MOBILE = process.argv.includes("--mobile");
const CODE = require("./bundle").bundle({ dist: process.argv.includes("--dist") }); // { core, editor }
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

const on = (rgb, bri = 255, extra = {}) => ({ state: "on", attributes: { brightness: bri, rgb_color: rgb, ...extra } });
const STATES = {
  "sun.sun": { state: "below_horizon", attributes: {} },
  "weather.home": {
    state: "partlycloudy",
    attributes: { temperature: 61, temperature_unit: "°F", humidity: 48, wind_speed: 6, wind_speed_unit: "mph" },
  },
  "sensor.outside_temperature": { state: "61", attributes: { unit_of_measurement: "°F" } },
  "light.study_fan_a": on([255, 193, 142]),
  "light.study_fan_b": on([255, 193, 142]),
  "light.dining_pendant": on([255, 200, 150]),
  "light.lounge_lamp": on([255, 200, 150]),
  "light.lounge_ceiling": on([255, 180, 110], 200),
  "light.hall": on([255, 180, 110], 200),
  "light.kitchen_downlights": on([255, 180, 110], 200),
  "light.reading_lamp": on([255, 190, 120], 180),
  "light.porch": on([255, 168, 90]),
  "light.deck_spots": on([255, 225, 190]),
  "climate.heat_pump": {
    state: "heat_cool",
    attributes: { current_temperature: 71, target_temp_low: 68, target_temp_high: 74, friendly_name: "Heat pump" },
  },
  "binary_sensor.front_door": { state: "off", attributes: { device_class: "door" } },
  "binary_sensor.deck_door": { state: "on", attributes: { device_class: "door" } },
  "sensor.test_temperature": {
    state: "71.2",
    attributes: { friendly_name: "Test Temperature", unit_of_measurement: "°F", device_class: "temperature" },
  },
  "media_player.test_tv": {
    state: "playing",
    attributes: {
      friendly_name: "Test TV",
      entity_picture: "/api/media_player_proxy/media_player.test_tv?token=x",
      media_title: "Midnight City",
      media_artist: "M83",
    },
  },
  "media_player.lounge_tv": {
    state: "playing",
    attributes: {
      friendly_name: "Lounge TV",
      device_class: "tv",
      entity_picture: "/api/media_player_proxy/media_player.lounge_tv?token=y",
      media_title: "The Bear",
      media_series_title: "S3 · E2",
    },
  },
};

const js = (body) => ({ body, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } });
const esm = (rel) =>
  fs
    .readFileSync(path.join(ROOT, "node_modules/three/examples/jsm", rel), "utf8")
    .replace(/from 'three'/g, "from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm'");

(async () => {
  const libZip = await buildMockLib();
  const dash = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/fixtures/test-home.json"), "utf8"));
  // CHROMIUM_PATH lets you point at a system Chromium when the bundled Playwright browser isn't installed
  const exe =
    process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch({
    executablePath: exe,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const ctx = await browser.newContext(
    MOBILE
      ? { viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  );
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("pageerror:", e.message);
  });

  // CDN modules -> local node_modules
  await ctx.route("https://cdn.jsdelivr.net/**", (r) => {
    const u = r.request().url();
    if (u.includes("js-yaml"))
      return r.fulfill(js("export default { dump: (v) => JSON.stringify(v, null, 2), load: (t) => JSON.parse(t) };"));
    if (u.includes("jszip"))
      return r.fulfill(
        js(
          "var module={exports:{}};var exports=module.exports;" +
            fs.readFileSync(path.join(ROOT, "node_modules/jszip/dist/jszip.min.js"), "utf8") +
            "\nexport default module.exports;",
        ),
      );
    for (const [k, f] of [
      ["OrbitControls", "controls/OrbitControls.js"],
      ["TransformControls", "controls/TransformControls.js"],
      ["OBJLoader", "loaders/OBJLoader.js"],
      ["MTLLoader", "loaders/MTLLoader.js"],
    ])
      if (u.includes(k)) return r.fulfill(js(esm(f)));
    return r.fulfill(js(fs.readFileSync(path.join(ROOT, "node_modules/three/build/three.module.js"), "utf8")));
  });
  // fake HA origin: the page, /local/sh3d/ libraries and media artwork
  const html = `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#111"><div id=host></div>
<script>customElements.define('ha-card',class extends HTMLElement{connectedCallback(){this.style.display='block'}});
customElements.define('ha-icon',class extends HTMLElement{});
customElements.define('hui-tile-card',class extends HTMLElement{setConfig(c){this.c=c} set hass(h){this.h=h;this.textContent=this.c.entity+': '+h.states[this.c.entity]?.state}});
window.loadCardHelpers=async()=>({createCardElement:(c)=>{const e=document.createElement('hui-'+c.type+'-card');e.setConfig(c);return e}});</script>
<script type=module>${CODE.editor}</script>
<script type=module>${CODE.core}
const __dash=${JSON.stringify(dash)};
window.saved=null; window.calls=[];
const __gen=await customElements.get('ll-strategy-dashboard-ha-3dhome').generate(__dash.strategy);
window.gen=__gen;
const __card=document.createElement('ha-3dhome-card'); __card.setConfig(__gen.views[0].cards[0]); document.getElementById('host').append(__card);
__card.hass={states:${JSON.stringify(STATES)},user:{is_admin:true},services:{downloader:{download_file:{}}},
  callService:async(...a)=>{calls.push(a)},connection:{subscribeEvents:async()=>()=>{}},
  callWS:async(m)=>{calls.push(m.type);if(m.type==='lovelace/config')return JSON.parse(JSON.stringify(__dash));if(m.type==='lovelace/config/save'){window.saved=m.config;return null}}};
window.card=__card;</script></body></html>`;
  await p.route("http://ha.test/**", (r) => {
    const u = r.request().url();
    if (u.includes("/local/sh3d/3DModels-LucaPresidente"))
      return r.fulfill({ body: fs.readFileSync(libZip), contentType: "application/zip" });
    if (u.includes("/local/")) return r.fulfill({ status: 404, body: "not found" });
    if (u.includes("media_player_proxy"))
      return r.fulfill({
        body: fs.readFileSync(
          path.join(path.dirname(libZip), u.includes("test_tv") ? "art_square.png" : "art_wide.png"),
        ),
        contentType: "image/png",
      });
    return r.fulfill({ body: html, contentType: "text/html" });
  });

  const ev = (s) => p.evaluate(s);
  const wait = (ms) => p.waitForTimeout(ms);
  const screen = (planX, planY, z = 4) =>
    ev(`(()=>{const v=new card.T.Vector3(${planX}-296,${z},${planY}-391).project(card._cam);
    const r=card._renderer.domElement.getBoundingClientRect();return [r.left+(v.x+1)/2*r.width, r.top+(1-v.y)/2*r.height]})()`);
  const boxCenter = (i) =>
    ev(
      `(()=>{const b=card._work.scene.boxes[${i}];const a=Array.isArray(b)?b:b.b;return [(a[0]+a[1])/2,(a[2]+a[3])/2]})()`,
    );

  await p.goto("http://ha.test/3d-home/3d");
  await wait(6000);
  check(
    "strategy generates one panel view",
    await ev(`gen.views.length===1 && gen.views[0].type==='panel' && gen.views[0].cards[0].fill===true`),
  );
  check(
    "old names still work (iso-home-3d-card, custom:iso-home)",
    await ev(
      `(async()=>!!customElements.get('iso-home-3d-card') && (await customElements.get('ll-strategy-dashboard-iso-home').generate({})).views[0].cards[0].type==='custom:ha-3dhome-card')()`,
    ),
  );
  check(
    "listed in Add dashboard (window.customStrategies)",
    await ev(
      `window.customStrategies.filter(s=>s.type==='ha-3dhome'&&s.strategyType==='dashboard'&&s.name).length===1`,
    ),
  );
  check("card renders without page errors", errors.length === 0, errors.join(" | "));
  check("room menu built from floors", (await ev(`card.shadowRoot.querySelectorAll('.rooms button').length`)) >= 8);
  check(
    "edit button visible for admins",
    await ev(`getComputedStyle(card.shadowRoot.querySelector('.edbtn')).display!=='none'`),
  );
  await p.screenshot({ path: path.join(OUT, `${MOBILE ? "mobile" : "desktop"}-home.png`) });

  await ev(`[...card.shadowRoot.querySelectorAll('.rooms button')].find(b=>b.textContent==='Kitchen').click()`);
  await wait(1500);
  check("room button flies camera", (await ev(`card._cam.zoom`)) > 1.3);
  await ev(`card._focusRoom(card._rooms().find(r=>r.name==='bath'))`);
  await wait(1200);
  const fade = await ev(
    `(()=>{const f=[...(card._faded||[])];return {n:f.length,see:f.every(m=>[].concat(m.material).every(x=>x.transparent&&x.opacity<0.5))}})()`,
  );
  check("framing a room fades what stands in front of it", fade.n > 0 && fade.see, JSON.stringify(fade));
  await p.screenshot({ path: path.join(OUT, `${MOBILE ? "mobile" : "desktop"}-room-fade.png`) });
  await ev(`card._focusRoom(null)`);
  await wait(1200);
  check(
    "going home makes everything solid again",
    await ev(
      `!card._faded && (()=>{let ok=true;card._world.traverse(m=>{if(m.userData.fadeOrig)ok=false});return ok})()`,
    ),
  );

  // string lights toggle from a tap anywhere along the string, not just its first point
  await ev(
    `(()=>{card._config.lights.push({entity:'light.test_string',fixture:'string',kind:'string',z:37,points:[[200,400],[320,400],[380,460]]});card._rebuild()})()`,
  );
  await wait(800);
  for (const [px, py, label] of [
    [260, 400, "mid-span"],
    [350, 430, "second span"],
  ]) {
    const [tx, ty] = await screen(px, py, 33);
    await ev(`calls.length=0`);
    if (MOBILE) await p.touchscreen.tap(tx, ty);
    else await p.mouse.click(tx, ty);
    await wait(300);
    check(
      `tapping a string light ${label} toggles it`,
      await ev(`calls.some(c=>c[1]==='toggle'&&c[2]?.entity_id==='light.test_string')`),
      JSON.stringify(await ev(`calls`)),
    );
  }
  await ev(`(()=>{card._config.lights.pop();card._rebuild()})()`);
  await wait(1500);

  // connection loss: a short blip shows nothing, a real drop greys the map under a pill and blocks taps, reconnecting
  // re-applies every entity and redraws
  await ev(`(()=>{card._upN=0;card._frN=0;const u=card._update,f=card._placeOverlays;card._update=function(){card._upN++;return u.apply(this,arguments)};
    card._placeOverlays=function(){card._frN++;return f.apply(this,arguments)}})()`);
  await ev(`card.hass={...card._hass,connected:false}`);
  await wait(400);
  await ev(`card.hass={...card._hass,connected:true}`);
  await wait(2800);
  check(
    "a short connection blip shows no offline pill",
    await ev(`card.shadowRoot.querySelector('.conn').classList.contains('hide') && !card._offSince`),
  );
  await ev(`card.hass={...card._hass,connected:false}`);
  await wait(800);
  check(
    "no offline pill during the grace period",
    await ev(`card.shadowRoot.querySelector('.conn').classList.contains('hide')`),
  );
  await wait(2200);
  check(
    "a dropped connection shows the offline pill and greys the map",
    await ev(
      `!card.shadowRoot.querySelector('.conn').classList.contains('hide') && card._wrap.classList.contains('offline')`,
    ),
  );
  await ev(`calls.length=0; card._entityAction('light.test_string')`);
  check("taps don't call services while offline", (await ev(`calls.length`)) === 0);
  await ev(`card._upN=0;card._frN=0;card.hass={...card._hass,connected:true}`);
  await wait(400);
  check(
    "reconnecting hides the pill, re-applies the states and redraws",
    await ev(
      `card.shadowRoot.querySelector('.conn').classList.contains('hide') && !card._wrap.classList.contains('offline') && card._upN>0 && card._frN>0`,
    ),
    JSON.stringify(await ev(`[card._upN,card._frN]`)),
  );
  await ev(`card._entityAction('light.test_string')`);
  check("taps call services again once reconnected", await ev(`calls.some(c=>c[1]==='toggle')`));
  // a lost WebGL context (phones do this to background pages): redraw when it comes back, rebuild when it doesn't
  await ev(
    `card._frN=0;window.__lc=card._renderer.getContext().getExtension('WEBGL_lose_context');window.__r0=card._renderer;__lc.loseContext()`,
  );
  await wait(400);
  await ev(`__lc.restoreContext()`);
  await wait(800);
  check(
    "a restored WebGL context redraws the map",
    await ev(`card._frN>0 && card._renderer===__r0 && !card._ctxLost`),
    String(await ev(`card._frN`)),
  );
  await ev(
    `(()=>{card._camZ=card._cam.zoom;card._renderer.getContext().getExtension('WEBGL_lose_context').loseContext()})()`,
  );
  await wait(5000);
  check(
    "a WebGL context that never comes back rebuilds the map and keeps the view",
    await ev(
      `card._ready && card._renderer && card._renderer!==__r0 && !card._renderer.getContext().isContextLost() && Math.abs(card._cam.zoom-card._camZ)<1e-6 && card._wrap.isConnected`,
    ),
  );
  await ev(`delete card._update; delete card._placeOverlays`);

  await ev(`card.shadowRoot.querySelector('.edbtn').click()`);
  await wait(1500);
  check("edit mode opens", await ev(`!!card._edit && !!card.shadowRoot.querySelector('.bar')`));
  const SOFA = await ev(`card._work.scene.boxes.findIndex(b=>b.group==='sofa')`),
    FAN = await ev(`'v:'+card._work.scene.overlays.findIndex(o=>o.type==='fan')`);
  await ev(`card._editor.clickSelect('b:${SOFA}')`);
  check("clicking a grouped piece selects the whole group", (await ev(`card._edit.sel.size`)) === 4);
  const fanSel = await ev(`(card._editor.clickSelect('${FAN}'), [...card._edit.sel].filter(k=>k[0]==='l').length)`);
  check("selecting a fan brings its lights along", fanSel >= 2);
  await ev(`card._editor._select([])`);

  if (!MOBILE) {
    const before = await boxCenter(SOFA),
      [sx, sy] = await screen(...before);
    await p.mouse.move(sx, sy);
    await p.mouse.down();
    await p.mouse.move(sx + 30, sy + 8, { steps: 6 });
    await p.mouse.move(sx + 60, sy + 16, { steps: 6 });
    await p.mouse.up();
    await wait(500);
    const after = await boxCenter(SOFA);
    check(
      "mouse drag moves furniture",
      Math.hypot(after[0] - before[0], after[1] - before[1]) > 4,
      `${before} -> ${after}`,
    );
    await ev(`card._editor._undo()`);
    await wait(300);
    check("undo restores", JSON.stringify(await boxCenter(SOFA)) === JSON.stringify(before));

    // transform fields: in cm (model_scale), and a group moves, turns and scales as one
    const setF = (name, v) =>
      ev(
        `(()=>{const i=card.shadowRoot.querySelector('.insp input[data-f="${name}"]'); i.value='${v}'; i.dispatchEvent(new Event('change'))})()`,
      );
    const grp = () =>
      ev(
        `[...card._edit.sel].filter(k=>k[0]==='b').map(k=>{const b=__ha3dhome.bArr(card._editor.item(k));return [(b[0]+b[1])/2,(b[2]+b[3])/2,b[1]-b[0],b[3]-b[2],b[4]]})`,
      );
    await ev(`card._editor.clickSelect('b:${SOFA}')`);
    const g0 = await grp(),
      x0 = await ev(`+card.shadowRoot.querySelector('.insp input[data-f="px"]').value`);
    check(
      "position is shown in cm",
      /Position cm/.test(await ev(`card.shadowRoot.querySelector('.insp .xf').textContent`)) &&
        Math.abs(x0 - (await ev(`card._editor._pivotC[0]*2.1`))) < 0.2,
      String(x0),
    );
    await setF("px", x0 + 210);
    await wait(300);
    const g1 = await grp();
    check(
      "moving a group in cm moves every piece the same plan distance",
      g1.every((b, i) => Math.abs(b[0] - g0[i][0] - 100) < 0.2 && Math.abs(b[1] - g0[i][1]) < 0.2),
      JSON.stringify(g1.map((b) => b[0])),
    );
    await ev(`card._editor._undo()`);
    await wait(300);
    await setF("sx", 50);
    await wait(300);
    const g2 = await grp(),
      pc = await ev(`card._editor._pivotC`);
    check(
      "scaling a group shrinks the pieces and pulls them together",
      g2.every((b, i) => Math.abs(b[2] - g0[i][2] / 2) < 0.2 && Math.abs(b[4] - g0[i][4] / 2) < 0.2) &&
        Math.hypot(g2[0][0] - g2[1][0], g2[0][1] - g2[1][1]) <
          Math.hypot(g0[0][0] - g0[1][0], g0[0][1] - g0[1][1]) * 0.6,
      JSON.stringify(g2),
    );
    await ev(`card._editor._undo()`);
    await wait(300);
    await setF("ry", 90);
    await wait(300);
    const g3 = await grp(),
      rots = await ev(`[...card._edit.sel].filter(k=>k[0]==='b').map(k=>card._editor.item(k).rot||0)`);
    const d0 = [g0[1][0] - g0[0][0], g0[1][1] - g0[0][1]],
      d3 = [g3[1][0] - g3[0][0], g3[1][1] - g3[0][1]];
    check(
      "rotating a group turns every piece and swings them round the group's centre",
      rots.every((r) => r % 90 === 0 && r !== 0) && Math.abs(d3[0] + d0[1]) < 0.3 && Math.abs(d3[1] - d0[0]) < 0.3,
      JSON.stringify({ rots, d0, d3 }),
    );
    await ev(`card._editor._undo()`);
    await wait(300);
    await ev(`card._editor._select(['${FAN}'])`);
    const fanDims = await ev(`card._editor._dims('${FAN}')`);
    await ev(`card._edit.lock = true`);
    await setF("sx", 200);
    await wait(300);
    await ev(`card._edit.lock = false`);
    const fanDims2 = await ev(`card._editor._dims('${FAN}')`);
    check(
      "a fixed-shape fixture (fan) scales",
      (await ev(`card._editor.item('${FAN}').size`)) === 2 && Math.abs(fanDims2[0] / fanDims[0] - 2) < 0.05,
      JSON.stringify([fanDims, fanDims2]),
    );
    await ev(`card._editor._undo()`);
    await ev(`card._editor._select([])`);
    await wait(300);

    // three axes, Unity / Godot style: W / E / R pick the gizmo, every axis shows, tilt (X / Z) works for one item and for a group
    await ev(`card._editor.clickSelect('b:${SOFA}', false, true)`);
    await ev(`card._editor._onKey(new KeyboardEvent('keydown',{key:'r'}))`);
    check(
      "R picks the scale gizmo with all three axes",
      await ev(
        `card._edit.mode==='scale' && card._tc.mode==='scale' && card._tc.showX && card._tc.showY && card._tc.showZ`,
      ),
    );
    const w0 = await ev(`card._editor._dims('b:${SOFA}')`);
    await ev(`(()=>{card._editor.dragStart('scale'); card._pivot.scale.set(1, 2, 1.5); card._editor.dragEnd()})()`);
    await wait(300);
    const w1 = await ev(`card._editor._dims('b:${SOFA}')`);
    check(
      "the scale gizmo stretches one item along each axis",
      Math.abs(w1[0] - w0[0]) < 0.2 && Math.abs(w1[1] / w0[1] - 1.5) < 0.02 && Math.abs(w1[2] / w0[2] - 2) < 0.05,
      JSON.stringify([w0, w1]),
    );
    await ev(`card._editor._undo()`);
    await wait(300);
    await ev(`card._editor._onKey(new KeyboardEvent('keydown',{key:'e'}))`);
    check(
      "E picks the rotate gizmo with all three rings",
      await ev(`card._edit.mode==='rotate' && card._tc.showX && card._tc.showY && card._tc.showZ`),
    );
    await setF("rx", 30);
    await wait(300);
    check(
      "one item tilts about X",
      (await ev(`card._editor.item('b:${SOFA}').rx`)) === 30 &&
        Math.abs((await ev(`card._items.get('b:${SOFA}').children[0].rotation.x`)) - Math.PI / 6) < 1e-3,
    );
    await p.screenshot({ path: path.join(OUT, "desktop-transform.png") });
    await ev(`card._editor._undo()`);
    await wait(300);
    await ev(`card._editor.clickSelect('b:${SOFA}')`);
    const z0s = await ev(`[...card._edit.sel].map(k=>__ha3dhome.bArr(card._editor.item(k))[6]||0)`);
    await setF("rz", 90);
    await wait(300);
    const tilted = await ev(
      `[...card._edit.sel].map(k=>{const o=card._editor.item(k);return [o.rz, __ha3dhome.bArr(o)[6]||0]})`,
    );
    check(
      "a group tilts about Z as one piece (pieces swing up)",
      tilted.every(([rz]) => rz === 90) && tilted.some(([, z], i) => Math.abs(z - z0s[i]) > 5),
      JSON.stringify(tilted),
    );
    await ev(`card._editor._undo()`);
    await ev(`card._editor._onKey(new KeyboardEvent('keydown',{key:'w'}))`);
    await ev(`card._editor._select([])`);
    await wait(300);

    // entity panel: drag an entity onto the floor
    await ev(`card.shadowRoot.querySelector('[data-a=add]').click()`);
    await wait(300);
    await ev(
      `(()=>{const i=card.shadowRoot.querySelector('.ents input'); i.value='Test Temperature'; i.dispatchEvent(new Event('input'))})()`,
    );
    const row = await ev(
      `(()=>{const b=card.shadowRoot.querySelector('.ents .erow').getBoundingClientRect();return [b.left+40,b.top+12]})()`,
    );
    const drop = await screen(300, 470);
    const chips0 = await ev(`card._work.chips.length`);
    await p.mouse.move(...row);
    await p.mouse.down();
    await p.mouse.move(row[0] - 80, row[1] + 20, { steps: 4 });
    await p.mouse.move(...drop, { steps: 8 });
    await p.mouse.up();
    await wait(500);
    check(
      "dragging an entity from the panel adds a badge",
      (await ev(`card._work.chips.length`)) === chips0 + 1 &&
        (await ev(`card._work.chips.at(-1).entity`)) === "sensor.test_temperature",
    );

    // show-as: convert a media player badge into a screen
    await ev(
      `(()=>{const i=card.shadowRoot.querySelector('.ents input'); i.value='Test TV'; i.dispatchEvent(new Event('input'))})()`,
    );
    await ev(
      `card.shadowRoot.querySelector('.ents .erow').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:1,clientY:1}))`,
    );
    await ev(`window.dispatchEvent(new PointerEvent('pointerup',{clientX:1,clientY:1}))`);
    await wait(400);
    await ev(
      `(()=>{const s=card.shadowRoot.querySelector('select[data-as]'); s.value='screen'; s.dispatchEvent(new Event('change'))})()`,
    );
    await wait(1200);
    check("media player can be shown as a screen", (await ev(`card._work.scene.objects.at(-1).type`)) === "screen");
    await ev(`card._editor._toggleEntityPanel()`);

    // model library (mock)
    await ev(`card._editor._openLibrary()`);
    await wait(800);
    await ev(`card.shadowRoot.querySelector('.librow .act').click()`);
    await wait(1500);
    const items = await ev(`card.shadowRoot.querySelectorAll('.lib .it').length`);
    check("mock Sweet Home 3D library opens and lists models", items === 2);
    await ev(`[...card.shadowRoot.querySelectorAll('.lib .it')].find(e=>e.textContent.includes('Arm chair')).click()`);
    await wait(2500);
    const last = await ev(`'o:'+(card._work.scene.objects.length-1)`);
    check(
      "placed model loads without error",
      await ev(`card._work.scene.objects.at(-1).type==='model' && !(card._modelErr||{})['${last}']`),
    );
    await setF("wx", 105);
    await wait(300);
    check(
      "a model's width is set in cm",
      Math.abs((await ev(`card._work.scene.objects.at(-1).w`)) - 50) < 0.1,
      String(await ev(`card._work.scene.objects.at(-1).w`)),
    );
    await setF("py", 40);
    await wait(300);
    check(
      "a model's elevation is set in cm (vertical scale)",
      Math.abs((await ev(`card._work.scene.objects.at(-1).z`)) - 10) < 0.1,
    );
    await ev(`card._editor._select(['c:'+(card._work.chips.length-1)])`);
    await setF("size", 150);
    await wait(300);
    check(
      "a badge can be resized",
      (await ev(`card._work.chips.at(-1).size`)) === 1.5 &&
        (await ev(`card._chips.at(-1).node.style.fontSize`)).includes("13.5px"),
    );
    await p.screenshot({ path: path.join(OUT, "desktop-edit.png") });

    await ev(`card._editor._toggleLookPanel()`);
    await wait(200);
    await ev(
      `(()=>{const q=(k)=>card.shadowRoot.querySelector('.lookp [data-i="'+k+'"]'); q('after').value='120'; q('after').dispatchEvent(new Event('change',{bubbles:true})); const r=q('room'); r.value=r.options[1].value; r.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
    check(
      "the Look panel sets the idle view (room + timeout)",
      await ev(`card._work.idle_view?.after===120 && card._work.idle_view.room===card._rooms()[0].name`),
      JSON.stringify(await ev(`card._work.idle_view`)),
    );
    await ev(`card._editor._toggleLookPanel()`);
    // room controls: Lovelace cards per room
    await ev(`card.shadowRoot.querySelector('[data-a="controls"]').click()`);
    await wait(300);
    check("controls panel opens", await ev(`!!card.shadowRoot.querySelector('.rcp')`));
    const rcRoom = await ev(`card._rooms().map(r=>r.name).find(n=>card._editor._roomEntities(n).length)`);
    await ev(
      `(()=>{const s=card.shadowRoot.querySelector('.rcp [data-room]'); s.value='${rcRoom}'; s.dispatchEvent(new Event('change'))})()`,
    );
    await wait(900);
    await ev(`card.shadowRoot.querySelector('.rcp [data-auto]').click()`);
    await wait(300);
    const nAuto = await ev(`card._work.room_cards['${rcRoom}'].length`);
    check(
      "room's own devices become tiles",
      nAuto > 0 && nAuto === (await ev(`card._editor._roomEntities('${rcRoom}').length`)),
      String(nAuto),
    );
    await ev(
      `(()=>{const p=card.shadowRoot.querySelector('.rcp'); p.querySelector('[data-ent]').value='light.porch'; p.querySelector('[data-add]').click()})()`,
    );
    await wait(300);
    check(
      "a tile can be added by entity",
      (await ev(`card._work.room_cards['${rcRoom}'].at(-1).entity`)) === "light.porch",
    );
    await ev(`(async()=>{const p=card.shadowRoot.querySelector('.rcp'); p.querySelector('[data-code]').click(); await new Promise(r=>setTimeout(r,200));
      p.querySelector('textarea').value='{"type":"tile","entity":"climate.heat_pump"}'; p.querySelector('[data-apply]').click()})()`);
    await wait(500);
    check(
      "pasted card code replaces the room's cards",
      await ev(`JSON.stringify(card._work.room_cards['${rcRoom}'])==='[{"type":"tile","entity":"climate.heat_pump"}]'`),
    );
    await p.screenshot({ path: path.join(OUT, "desktop-controls-edit.png") });
    check(
      "controls preview renders the card",
      (await ev(`card.shadowRoot.querySelector('.rcp .rcprev').textContent`)).includes("heat_cool"),
    );
    await ev(`card._editor._undo(false)`);
    await wait(300);
    check("undo restores the room's cards", (await ev(`card._work.room_cards['${rcRoom}'].length`)) === nAuto + 1);
    await ev(`card._editor._undo(true)`);
    await wait(300);

    await ev(`card._editor._save()`);
    await wait(800);
    check("save keeps the idle view", await ev(`saved.strategy.idle_view?.after===120`));
    check(
      "save writes layout into the strategy config",
      await ev(
        `!!saved && saved.strategy.type==='custom:ha-3dhome' && saved.strategy.scene.objects.length===card._config.scene.objects.length`,
      ),
    );
    check("save leaves edit mode", await ev(`!card._edit`));
    check(
      "save writes room controls",
      await ev(`saved.strategy.room_cards?.['${rcRoom}']?.[0]?.entity==='climate.heat_pump'`),
    );
    check(
      "room controls stay hidden in the whole-home view",
      await ev(`card._focusRoom(null), card.shadowRoot.querySelector('.rcards').classList.contains('hide')`),
    );
    await ev(`card._focusRoom(card._rooms().find(r=>r.name==='${rcRoom}'))`);
    await wait(400);
    check(
      "room controls show top right for that room",
      (
        (await ev(
          `(()=>{const b=card.shadowRoot.querySelector('.rcards');return !b.classList.contains('hide') && b.querySelector('.rcbody').textContent})()`,
        )) || ""
      ).includes("heat_cool"),
    );
    await ev(`card.hass={...card._hass,states:{...card._hass.states,'climate.heat_pump':{state:'off',attributes:{}}}}`);
    await p.waitForFunction(() => !window.card._hassRaf, null, { timeout: 10000 });
    await wait(200); // hass is applied on the next frame
    check(
      "room controls get state updates",
      (await ev(`card.shadowRoot.querySelector('.rcards .rcbody').textContent`)).includes("off"),
    );
    check(
      "room controls ignore a light theme's colours",
      await ev(`(card.style.setProperty('--primary-text-color','#212121'), card.style.setProperty('--ha-card-background','#fff'),
      (()=>{const c=getComputedStyle(card.shadowRoot.querySelector('.rcards .rcbody > *'));return c.getPropertyValue('--primary-text-color').trim()==='#f2ebe0' && c.getPropertyValue('--ha-card-background').includes('28,26,23')})())`),
    );
    await p.screenshot({ path: path.join(OUT, "desktop-room-controls.png") });
    await ev(`card._focusRoom(null)`);
    await wait(1500);
    // HA regenerates the strategy after a save and swaps in a new card element: it should adopt this one, not start over
    await ev(`(async()=>{window.__r0=card._renderer; window.__zoom0=card._cam.zoom;
      const cfg=(await customElements.get('ll-strategy-dashboard-ha-3dhome').generate(saved.strategy)).views[0].cards[0];
      const n=document.createElement('ha-3dhome-card'); n.setConfig(cfg); n.hass=card._hass;
      card.replaceWith(n); window.card2=n;})()`);
    await wait(600);
    check(
      "after a save the new card adopts the old scene (no reload, camera kept)",
      await ev(
        `card2._inner===card && card._renderer===__r0 && card._ready && card._cam.zoom===__zoom0 && card.isConnected`,
      ),
    );
    await ev(`window.__h={...card._hass}; card2.hass=__h`);
    await wait(200);
    check("the adopted card still gets state updates", await ev(`card._hass===__h`));
    await ev(
      `card._config={...card._config, idle_view:{room:card._rooms()[0].name, after:0.4}}; card._focusRoom(null)`,
    );
    await wait(900);
    await ev(`card._wrap.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
    await wait(1600);
    check(
      "after the idle timeout the view returns to the chosen room",
      await ev(
        `(()=>{const r=card._rooms()[0].rect, t=card._controls.target; return Math.abs(t.x-((r[0]+r[1])/2-296))<1 && Math.abs(t.z-((r[2]+r[3])/2-391))<1})()`,
      ),
    );
  } else {
    const cdp = await ctx.newCDPSession(p);
    const touch = (type, pts) =>
      cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((q, i) => ({ x: q[0], y: q[1], id: i })) });
    const tdrag = async (x, y, dx, dy) => {
      await touch("touchStart", [[x, y]]);
      for (let k = 1; k <= 8; k++) {
        await touch("touchMove", [[x + (dx * k) / 8, y + (dy * k) / 8]]);
        await wait(16);
      }
      await touch("touchEnd", []);
      await wait(400);
    };
    check(
      "inspector starts folded on phones",
      await ev(`card.shadowRoot.querySelector('.insp').classList.contains('min')`),
    );
    check("no transform gizmo on touch devices", await ev(`card._editor._coarse === true`));
    let c = await screen(...(await boxCenter(SOFA)));
    const u0 = await ev(`card._edit.undo.length`);
    await tdrag(c[0], c[1], 40, 10);
    check(
      "one-finger drag on unselected furniture pans instead of moving it",
      (await ev(`card._edit.undo.length`)) === u0,
    );
    c = await screen(...(await boxCenter(SOFA)));
    await p.touchscreen.tap(c[0], c[1]);
    await wait(400);
    check("tap selects", await ev(`card._edit.sel.has('b:${SOFA}')`));
    const b0 = await boxCenter(SOFA);
    await tdrag(c[0], c[1], 30, 0);
    const b1 = await boxCenter(SOFA);
    check("one-finger drag moves selected furniture", Math.hypot(b1[0] - b0[0], b1[1] - b0[1]) > 3, `${b0} -> ${b1}`);
    c = await screen(...b1);
    await touch("touchStart", [[c[0], c[1]]]);
    for (let k = 1; k <= 4; k++) {
      await touch("touchMove", [[c[0] + k * 8, c[1]]]);
      await wait(16);
    }
    await touch("touchStart", [
      [c[0] + 32, c[1]],
      [c[0] + 32, c[1] + 120],
    ]);
    for (let k = 1; k <= 6; k++) {
      await touch("touchMove", [
        [c[0] + 32, c[1] - k * 6],
        [c[0] + 32, c[1] + 120 + k * 6],
      ]);
      await wait(16);
    }
    await touch("touchEnd", []);
    await wait(500);
    check(
      "second finger cancels the drag and pinches the camera",
      JSON.stringify(await boxCenter(SOFA)) === JSON.stringify(b1) && (await ev(`card._cam.zoom`)) > 1.1,
    );
    await p.screenshot({ path: path.join(OUT, "mobile-edit.png") });
  }

  // a dashboard made from Settings → Dashboards → Add has no layout yet: it should render and say how to start
  check("full map shows no empty hint", await ev(`!card.shadowRoot.querySelector('.empty')`));
  await ev(`(async()=>{card.remove();const g=await customElements.get('ll-strategy-dashboard-ha-3dhome').generate({type:'custom:ha-3dhome'});
    const c=document.createElement('ha-3dhome-card');c.setConfig({...g.views[0].cards[0],dashboard:'new'});document.getElementById('host').append(c);c.hass=card._hass;window.card2=c})()`);
  await wait(3000);
  check(
    "new empty dashboard renders with a how-to-start hint",
    errors.length === 0 &&
      (await ev(`!!card2._ready && /Edit/.test(card2.shadowRoot.querySelector('.empty')?.textContent||'')`)),
    errors.join(" | "),
  );
  await p.screenshot({ path: path.join(OUT, `${MOBILE ? "mobile" : "desktop"}-empty.png`) });
  await ev(`card2._openEditor()`);
  await wait(800);
  check(
    "the hint goes away in the editor",
    errors.length === 0 && (await ev(`!!card2._edit && !card2.shadowRoot.querySelector('.empty')`)),
    errors.join(" | "),
  );

  // with the old ha-iso-home card also installed, the old names must stay with it (otherwise load order decides)
  for (const old of [true, false]) {
    const q = await ctx.newPage();
    await q.route("http://ha.test/**", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: `<!doctype html><body><home-assistant></home-assistant>
<script>document.querySelector('home-assistant').hass={connection:{},callWS:async(m)=>m.type==='lovelace/resources'?[{url:'/hacsfiles/ha-3dhome/ha-3dhome.js'}${old ? ",{url:'/local/iso-home/iso-home-3d-card.min.js?v=4.20.0'}" : ""}]:null}</script>
<script type=module>${CODE.core}</script></body>`,
      }),
    );
    await q.goto("http://ha.test/two");
    await q.waitForTimeout(1500);
    const got = await q.evaluate(
      `!!customElements.get('iso-home-3d-card') && !!customElements.get('ll-strategy-dashboard-iso-home')`,
    );
    check(
      old
        ? "old names stay with the old card when it is installed too"
        : "old names are claimed when the old card is not installed",
      got === !old,
    );
    await q.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots in tools/out/`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
