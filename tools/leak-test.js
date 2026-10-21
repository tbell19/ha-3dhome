/* Leak test: drives the card the way a long-running dashboard does and reports resource growth.
 *
 *   node tools/leak-test.js [--dist] [--look]     --look turns every render look on (post-processing included)
 *
 * Phases:
 *   1. 3000 hass state updates (lights dimming, media track changes)  -> GPU objects / JS heap must stay flat
 *   2. 30 editor mutations + exit, then 60 floor-plan layer rebuilds + 10 wall edits                                       -> geometries / textures must return to baseline
 *   2c. edit / floor plan / tools / look panel / room focus, cycled x8 -> GPU objects, shaders and global listeners back to baseline
 *   2d. idle map renders nothing; a 200-change burst is applied once; changes to unshown entities skip the scene update
 *   3. setConfig() with an identical config x5 (HA re-renders)         -> must NOT rebuild (same renderer)
 *   4. setConfig() with a changed config x5, and detach/reattach        -> old WebGL contexts must be released
 * Exit code is non-zero if a phase leaks.
 */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const CODE = require("./bundle").bundle({ dist: process.argv.includes("--dist") });   // { core, editor }
const js = (body) => ({ body, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } });
const LOOK = process.argv.includes("--look");
const JSM = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/";
const esm = (rel) => fs.readFileSync(path.join(ROOT, "node_modules/three/examples/jsm", rel), "utf8").replace(/from 'three'/g, "from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm'")
  .replace(/from '(\.{1,2}\/[^']+)'/g, (_, r) => `from '${new URL(r, JSM + rel).href}/+esm'`);
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

(async () => {
  const dash = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/fixtures/test-home.json"), "utf8"));
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--js-flags=--expose-gc", "--enable-precise-memory-info"] });
  const p = await browser.newPage({ viewport: { width: 480, height: 300 } });
  p.on("pageerror", (e) => console.log("pageerror:", e.message));
  await p.route("https://cdn.jsdelivr.net/**", (r) => {
    const u = r.request().url();
    if (u.includes("/examples/jsm/postprocessing/") || u.includes("/examples/jsm/shaders/") || u.includes("/examples/jsm/math/"))
      return r.fulfill(js(esm(u.split("/examples/jsm/")[1].replace(/\/\+esm$/, ""))));
    for (const [k, f] of [["OrbitControls", "controls/OrbitControls.js"], ["TransformControls", "controls/TransformControls.js"], ["OBJLoader", "loaders/OBJLoader.js"], ["MTLLoader", "loaders/MTLLoader.js"]])
      if (u.includes(k)) return r.fulfill(js(esm(f)));
    if (u.includes("jszip")) return r.fulfill(js("var module={exports:{}};var exports=module.exports;" + fs.readFileSync(path.join(ROOT, "node_modules/jszip/dist/jszip.min.js"), "utf8") + "\nexport default module.exports;"));
    return r.fulfill(js(fs.readFileSync(path.join(ROOT, "node_modules/three/build/three.module.js"), "utf8")));
  });
  const html = `<!doctype html><meta charset=utf-8><body style="margin:0"><div id=host></div>
<script>customElements.define('ha-card',class extends HTMLElement{connectedCallback(){this.style.display='block'}});customElements.define('ha-icon',class extends HTMLElement{});
// count WebGL contexts that are created and never lost
window.__ctx=[]; const _gc=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(t,...a){const c=_gc.call(this,t,...a); if(c&&/webgl/.test(t)&&!__ctx.includes(c))__ctx.push(c); return c};
// count listeners left on window / document (they outlive the card)
window.__lst=[]; const _ae=EventTarget.prototype.addEventListener, _re=EventTarget.prototype.removeEventListener;
const _cap=(o)=>!!(o===true||(o&&o.capture));
EventTarget.prototype.addEventListener=function(t,f,o){ if((this===window||this===document)&&!__lst.some(l=>l[0]===this&&l[1]===t&&l[2]===f&&l[3]===_cap(o))) __lst.push([this,t,f,_cap(o)]); return _ae.call(this,t,f,o); };
EventTarget.prototype.removeEventListener=function(t,f,o){ const i=__lst.findIndex(l=>l[0]===this&&l[1]===t&&l[2]===f&&l[3]===_cap(o)); if(i>=0)__lst.splice(i,1); return _re.call(this,t,f,o); };
</script>
<script type=module>${CODE.editor}</script>
<script type=module>${CODE.core}
const __dash=${JSON.stringify(dash)};
const __gen=await customElements.get('ll-strategy-dashboard-ha-3dhome').generate(__dash.strategy);
window.__cfg=${LOOK ? `{...__gen.views[0].cards[0], night_mode:"always", look:{light:true,ao:true,stage:true,bloom:true}}` : "__gen.views[0].cards[0]"};
const __card=document.createElement('ha-3dhome-card'); __card.setConfig(__cfg); document.getElementById('host').append(__card);
const __st0={'sun.sun':{state:'below_horizon',attributes:{}},'weather.home':{state:'sunny',attributes:{temperature:60}}};
for(const L of __cfg.lights) __st0[L.entity]={state:'on',attributes:{brightness:200,rgb_color:[255,190,130]}};
__st0['media_player.lounge_tv']={state:'playing',attributes:{media_title:'Track 0',media_artist:'Artist'}};
window.__states=__st0;
__card.hass={states:__st0,user:{is_admin:true},callService:async()=>{},callWS:async()=>({}),connection:{subscribeEvents:async()=>()=>{}}};
window.card=__card;</script>`;
  await p.route("http://ha.test/**", (r) => r.fulfill({ body: html, contentType: "text/html" }));
  await p.goto("http://ha.test/3d-home/3d");
  await p.waitForTimeout(5000);
  { await p.waitForFunction(() => !!window.card._composer, null, { timeout: 30000 }); await p.waitForTimeout(1500); }   // effects (on by default) load lazily: baseline after them
  const ev = (s) => p.evaluate(s);
  const snap = () => ev(`(async()=>{ for(let i=0;i<3;i++){ window.gc&&gc(); await new Promise(r=>setTimeout(r,50)); }
     card._requestRender(); await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));   // GPU memory counts what has been drawn
     const m=card._renderer?.info.memory||{}; return {geo:m.geometries, tex:m.textures, prog:card._renderer?.info.programs?.length,
     heap:Math.round((performance.memory?.usedJSHeapSize||0)/1024/1024*10)/10, liveCtx:__ctx.filter(c=>!c.isContextLost()).length, lst:__lst.length}; })()`);

  const s0 = await snap(); console.log("baseline", s0);

  // 1. hass churn
  for (let round = 0; round < 30; round++) {
    await ev(`(async()=>{ for(let i=0;i<100;i++){ const s={...__states}; const k=Object.keys(s).filter(x=>x.startsWith('light.'));
      const e=k[i%k.length]; s[e]={state:i%7?'on':'off',attributes:{brightness:(i*37)%255,rgb_color:[255,(i*13)%255,120]}};
      if(i%25===0) s['media_player.lounge_tv']={state:'playing',attributes:{media_title:'Track '+(${round}*100+i),media_artist:'Artist'}};
      window.__states=s; card.hass={...card._hass,states:s}; if(i%10===9) await new Promise(r=>requestAnimationFrame(r)); } })()`);
  }
  const s1 = await snap(); console.log("after 3000 updates", s1);
  check("hass updates: GPU geometries/textures flat", s1.geo <= s0.geo + 2 && s1.tex <= s0.tex + 2, `${s0.geo}/${s0.tex} -> ${s1.geo}/${s1.tex}`);
  check("hass updates: JS heap flat (<8 MB growth)", s1.heap - s0.heap < 8, `${s0.heap} -> ${s1.heap} MB`);

  // 2. editor churn
  await ev(`card._enterEdit()`); await p.waitForTimeout(1500);
  for (let i = 0; i < 30; i++) await ev(`card._mutate(()=>{ const k=card._work.scene.boxes.map((b,j)=>b.group==='sofa'?'b:'+j:null).filter(Boolean); card._applyMove(k, ${i % 2 ? 2 : -2}, 0); return [k[0]]; })`);
  await ev(`card._exitEdit(false)`); await p.waitForTimeout(800);
  const s2 = await snap(); console.log("after 30 edits", s2);
  check("editor rebuilds: geometries/textures back to baseline", s2.geo <= s1.geo + 2 && s2.tex <= s1.tex + 2, `${s1.geo}/${s1.tex} -> ${s2.geo}/${s2.tex}`);

  // 2b. floor-plan churn: corner drags rebuild the plan layer on every pointer move
  await ev(`card._enterEdit()`); await p.waitForTimeout(800);
  await ev(`card._setPlanMode(true)`); await p.waitForTimeout(800);
  await ev(`(async()=>{ const s=card._work.scene.wall_segs[0]; for(let i=0;i<60;i++){ s.b[1]+= i%2?2:-2; card._rebuildPlan(); if(i%10===9) await new Promise(r=>requestAnimationFrame(r)); } })()`);
  for (let i = 0; i < 10; i++) await ev(`card._mutate(()=>{ card._applyMove(['w:0'], ${i % 2 ? 2 : -2}, 0); return ['w:0']; })`);
  await ev(`card._setPlanMode(false); card._exitEdit(false)`); await p.waitForTimeout(800);
  const s2b = await snap(); console.log("after floor-plan churn", s2b);
  check("floor-plan rebuilds: geometries/textures back to baseline", s2b.geo <= s1.geo + 2 && s2b.tex <= s1.tex + 2, `${s1.geo}/${s1.tex} -> ${s2b.geo}/${s2b.tex}`);

  // 2c. switching modes over and over: edit, floor plan, its tools, the look panel, rooms (see-through fade), back out
  const s2c0 = await snap();
  for (let i = 0; i < 8; i++) {
    await ev(`card._enterEdit()`); await p.waitForTimeout(300);
    await ev(`card._setPlanMode(true)`); await p.waitForTimeout(200);
    await ev(`card._setTool('wall'); card._showPreview([100,300],[200,300],'wall'); card._showMarker([100,300],'joint'); card._showRoomPreview([[100,300],[200,300],[200,400]]); card._setTool('select')`);
    await ev(`card._setPlanMode(false)`); await p.waitForTimeout(200);
    await ev(`card._toggleLookPanel(); card._toggleLookPanel(); card._exitEdit(false)`); await p.waitForTimeout(300);
    await ev(`(()=>{ const r=card._rooms(); card._focusRoom(r[${i} % r.length]); })()`); await p.waitForTimeout(900);
    await ev(`card._focusRoom(null)`); await p.waitForTimeout(700);
  }
  const s2c = await snap(); console.log("after 8 mode cycles", s2c);
  check("mode switching: geometries/textures/shaders back to baseline", s2c.geo <= s2c0.geo + 2 && s2c.tex <= s2c0.tex + 2 && s2c.prog <= s2c0.prog + 4, `${s2c0.geo}/${s2c0.tex}/${s2c0.prog} -> ${s2c.geo}/${s2c.tex}/${s2c.prog}`);
  check("mode switching: no window/document listeners left behind", s2c.lst <= s2c0.lst, `${s2c0.lst} -> ${s2c.lst}`);
  check("mode switching: JS heap flat (<6 MB growth)", s2c.heap - s2c0.heap < 6, `${s2c0.heap} -> ${s2c.heap} MB`);

  // 2d. an idle map draws nothing; a burst of state changes is applied once; changes to entities the map doesn't show cost nothing
  await p.waitForTimeout(1500);
  const idle = await ev(`(async()=>{ const f0=card._renderer.info.render.frame; await new Promise(r=>setTimeout(r,2000)); return card._renderer.info.render.frame-f0; })()`);
  check("idle map stops drawing", idle <= 2, `${idle} renders in 2 s`);
  const burst = await ev(`(async()=>{ let n=0; const u=card._update; card._update=function(){ n++; return u.apply(this,arguments); };
    const k=Object.keys(__states).filter(x=>x.startsWith('light.'));
    for(let i=0;i<200;i++){ const s={...card._hass.states}; s[k[i%k.length]]={state:'on',attributes:{brightness:i%255}}; card.hass={...card._hass,states:s}; }
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); const a=n; n=0;
    for(let i=0;i<200;i++){ const s={...card._hass.states}; s['sensor.unrelated_'+(i%20)]={state:String(i),attributes:{}}; card.hass={...card._hass,states:s};
      if(i%20===19) await new Promise(r=>requestAnimationFrame(r)); }
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))); const b=n; card._update=u; return {a,b}; })()`);
  check("200 state changes in a burst are applied once", burst.a <= 2, `${burst.a} scene updates`);
  check("changes to entities the map doesn't show skip the scene update", burst.b === 0, `${burst.b} scene updates for 200 changes`);

  // 3. identical setConfig
  await ev(`window.__r0=card._renderer; for(let i=0;i<5;i++) card.setConfig(JSON.parse(JSON.stringify(__cfg)))`); await p.waitForTimeout(3000);
  check("identical setConfig does not rebuild", await ev(`card._renderer===window.__r0`));

  // 4. changed setConfig + detach/reattach
  for (let i = 0; i < 5; i++) { await ev(`card.setConfig({...__cfg, view_size: ${380 + i}})`); await p.waitForTimeout(2500); }
  await ev(`window.__host=card.parentNode; card.remove()`); await p.waitForTimeout(500); await ev(`__host.append(card)`); await p.waitForTimeout(2500);
  const s4 = await snap(); console.log("after 5 config changes + reattach", s4);
  check("old WebGL contexts are released", s4.liveCtx <= 1, `${s4.liveCtx} live contexts`);
  check("card still renders after all that", await ev(`!!card._renderer && card._ready`));

  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} leak checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
