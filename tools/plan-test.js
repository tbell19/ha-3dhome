/* Floor-plan editor test: wall migration, wall drawing, joints, doors/windows (negative boxes), blueprint + scale.
 *
 *   node tools/plan-test.js [--dist]          (npm run test:plan)
 *
 * Same harness as smoke-test.js: the real dashboard layout, a fake hass, Three.js from node_modules, SwiftShader.
 * Screenshots go to tools/out/plan-*.png. Exit code is non-zero if any check fails.
 */
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const { build: buildMockLib } = require("./mock/build-mock-lib");

const ROOT = path.join(__dirname, "..");
const MOBILE = process.argv.includes("--mobile");
const CARD = process.argv.includes("--dist") ? path.join(ROOT, "dist/ha-3dhome.js") : path.join(ROOT, "src/ha-3dhome.js");
const EDITOR = process.argv.includes("--dist") ? path.join(ROOT, "dist/ha-3dhome-editor.js") : path.join(ROOT, "src/ha-3dhome-editor.js");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };
const js = (body) => ({ body, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } });
const esm = (rel) => fs.readFileSync(path.join(ROOT, "node_modules/three/examples/jsm", rel), "utf8").replace(/from 'three'/g, "from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm'");

(async () => {
  const libZip = await buildMockLib();
  const dash = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/fixtures/test-home.json"), "utf8"));
  const legacyDoors = dash.strategy.scene.walls.reduce((n, w) => n + (w.doors || []).length, 0), legacyRuns = dash.strategy.scene.walls.length + dash.strategy.scene.front_walls.length;
  const exe = process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const p = await browser.newPage(MOBILE ? { viewport: { width: 390, height: 800 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }
    : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const errors = [];
  p.on("pageerror", (e) => { errors.push(e.message); console.log("pageerror:", e.message); });
  await p.route("https://cdn.jsdelivr.net/**", (r) => {
    const u = r.request().url();
    for (const [k, f] of [["OrbitControls", "controls/OrbitControls.js"], ["TransformControls", "controls/TransformControls.js"], ["OBJLoader", "loaders/OBJLoader.js"], ["MTLLoader", "loaders/MTLLoader.js"]])
      if (u.includes(k)) return r.fulfill(js(esm(f)));
    return r.fulfill(js(fs.readFileSync(path.join(ROOT, "node_modules/three/build/three.module.js"), "utf8")));
  });
  const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width, initial-scale=1"><body style="margin:0;background:#111"><div id=host></div>
<script>customElements.define('ha-card',class extends HTMLElement{connectedCallback(){this.style.display='block'}});customElements.define('ha-icon',class extends HTMLElement{});</script>
<script type=module>${fs.readFileSync(EDITOR, "utf8")}</script>
<script type=module>${fs.readFileSync(CARD, "utf8")}
const __dash=${JSON.stringify(dash)};
window.saved=null; window.uploads=0;
const __gen=await customElements.get('ll-strategy-dashboard-ha-3dhome').generate(__dash.strategy);
window.genCfg=__gen.views[0].cards[0];
const __card=document.createElement('ha-3dhome-card'); __card.setConfig(genCfg); document.getElementById('host').append(__card);
__card.hass={states:{'sun.sun':{state:'above_horizon',attributes:{}}},user:{is_admin:true},config:{unit_system:{length:'mi'}},
  callService:async()=>{},connection:{subscribeEvents:async()=>()=>{}},
  fetchWithAuth:async(url,init)=>{ if(url==='/api/image/upload'&&init.body.get('file')){uploads++;return new Response(JSON.stringify({id:'bp1'}),{status:200})} return new Response('',{status:404}) },
  callWS:async(m)=>{if(m.type==='lovelace/config')return JSON.parse(JSON.stringify(__dash));if(m.type==='lovelace/config/save'){window.saved=m.config;return null}}};
window.card=__card;
window.imgDiff=async(a,b)=>{const ld=(s)=>new Promise(r=>{const i=new Image();i.onload=()=>r(i);i.src='data:image/png;base64,'+s});
  const [A,B]=await Promise.all([ld(a),ld(b)]);const c=document.createElement('canvas');c.width=A.width;c.height=A.height;const g=c.getContext('2d');
  g.drawImage(A,0,0);const da=g.getImageData(0,0,c.width,c.height).data;g.drawImage(B,0,0);const db=g.getImageData(0,0,c.width,c.height).data;
  let n=0;for(let i=0;i<da.length;i+=4){if(Math.abs(da[i]-db[i])+Math.abs(da[i+1]-db[i+1])+Math.abs(da[i+2]-db[i+2])>60)n++}return n/(da.length/4)};
</script>`;
  await p.route("http://ha.test/**", (r) => {
    const u = r.request().url();
    if (u.includes("/api/image/serve/bp1/original")) return r.fulfill({ body: fs.readFileSync(path.join(path.dirname(libZip), "art_wide.png")), contentType: "image/png" });
    return r.fulfill({ body: html, contentType: "text/html" });
  });
  const ev = (s) => p.evaluate(s);
  const wait = (ms) => p.waitForTimeout(ms);
  const screen = (x, y, z = 0) => ev(`(()=>{const v=new card.T.Vector3(${x}-296,${z},${y}-391).project(card._cam);
    const r=card._renderer.domElement.getBoundingClientRect();return [r.left+(v.x+1)/2*r.width, r.top+(1-v.y)/2*r.height]})()`);
  const click = async (x, y, z = 0) => { const s = await screen(x, y, z); await p.mouse.click(s[0], s[1]); await wait(350); };
  const btn = (a) => ev(`card.shadowRoot.querySelector('[data-a="${a}"]').click()`);
  const shot = async (name) => { const b = await p.screenshot({ path: path.join(OUT, name) }); return b.toString("base64"); };

  await p.goto("http://ha.test/3d-home/3d");
  await wait(6000);
  if (MOBILE) {   // phone: taps draw walls; toolbar scrolls; toast sits under the bar
    await ev(`card._enterEdit()`); await wait(1200);
    await btn("m-plan"); await wait(2500);
    const n0 = await ev(`card._work.scene.wall_segs.length`);
    await btn("t-wall"); await wait(200);
    for (const [x, y] of [[370, 470], [450, 470]]) { const s = await screen(x, y); await p.touchscreen.tap(s[0], s[1]); await wait(400); }
    await btn("t-select"); await wait(300);
    check("taps draw a wall on a phone", (await ev(`card._work.scene.wall_segs.length`)) === n0 + 1);
    await btn("t-door"); await wait(200);
    { const s = await screen(410, 470, 30); await p.touchscreen.tap(s[0], s[1]); await wait(500); }
    check("tap a wall to add a door on a phone", (await ev(`card._work.scene.openings.at(-1).kind`)) === "door");
    const tb = await ev(`(()=>{const t=card.shadowRoot.querySelector('.toast').getBoundingClientRect(), i=card.shadowRoot.querySelector('.insp').getBoundingClientRect(); return t.bottom < i.top || t.top > i.bottom})()`);
    check("toast doesn't cover the inspector", tb);
    await shot("plan-mobile.png");
    check("no page errors", errors.length === 0, errors.join(" | "));
    await browser.close();
    const failed = results.filter((x) => !x).length;
    console.log(`\n${results.length - failed}/${results.length} floor plan checks passed (mobile).`);
    process.exit(failed ? 1 : 0);
  }
  const before = await shot("plan-0-legacy.png");

  // 1. migration: entering edit converts the old axis walls; saving + reloading looks the same
  await ev(`card._enterEdit()`); await wait(1200);
  const m = await ev(`({segs:card._work.scene.wall_segs.length, opens:card._work.scene.openings.length, legacy:!!card._work.scene.walls})`);
  check("old walls convert to wall segments + door openings", m.segs >= legacyRuns && m.opens === legacyDoors && !m.legacy, JSON.stringify(m));
  await ev(`card._save()`); await wait(800);
  await ev(`card.setConfig({...genCfg, ...window.saved.strategy, type:'custom:ha-3dhome-card', fill:true})`); await wait(5000);
  const migrated = await shot("plan-1-migrated.png");
  const diff = await ev(`imgDiff(${JSON.stringify(before)}, ${JSON.stringify(migrated)})`);
  check("converted walls render (almost) identically", diff < 0.01, `${(diff * 100).toFixed(2)}% of pixels differ`);

  // 2. floor plan mode
  await ev(`card._enterEdit()`); await wait(1200);
  await btn("m-plan"); await wait(2500);
  // the render looks' effect shaders can compile mid-flight in software GL, so give the camera flight time to land
  await p.waitForFunction(() => window.card._plan && window.card._sph().phi < 0.3, null, { timeout: 10000 }).catch(() => {});
  check("floor plan mode switches to the top view", await ev(`card._plan && card._sph().phi < 0.3`));
  check("furniture is hidden in floor plan mode", await ev(`card._items.get('b:14').visible === false && card._items.get('w:0').visible !== false`));
  check("corner handles are shown", (await ev(`card._jointMeshes.length === new Set(card._work.scene.wall_segs.flatMap(w=>[w.a.join(), w.b.join()])).size`)));
  await shot("plan-2-mode.png");

  // 3. draw two walls (a chain) with the wall tool
  const n0 = await ev(`card._work.scene.wall_segs.length`);
  await btn("t-wall"); await wait(200);
  await click(370, 470); await click(450, 470); await click(450, 520);
  await p.keyboard.press("Enter"); await wait(300);
  const drawn = await ev(`card._work.scene.wall_segs.slice(${n0})`);
  check("wall tool draws a chain of walls", drawn.length === 2 && Math.abs(drawn[0].b[0] - drawn[1].a[0]) < 0.01, JSON.stringify(drawn));
  const L0 = Math.hypot(drawn[0].b[0] - drawn[0].a[0], drawn[0].b[1] - drawn[0].a[1]);
  check("walls snap to whole units at 15° steps", Math.abs(L0 - Math.round(L0)) < 0.05 && Math.abs(drawn[0].a[1] - drawn[0].b[1]) < 0.05, `L=${L0}`);

  // 4. door tool: cut a door into the first new wall → wall splits into 3 pieces around it
  await btn("t-door"); await wait(200);
  await click(410, 470, 30);
  const door = await ev(`card._work.scene.openings.at(-1)`);
  check("door tool adds an opening centred on the wall", door.kind === "door" && Math.abs(door.y - 470) < 0.5 && !door.rot, JSON.stringify(door));
  const pieces = await ev(`(()=>{let n=0;card._items.get('w:${n0}').traverse(o=>{if(o.isMesh&&o.userData.wall)n++});return n})()`);
  check("plan view cuts the door out of the wall (two sides + lintel)", pieces === 3, `${pieces} pieces`);
  const tall = await ev(`(()=>{const b=new card.T.Box3().setFromObject(card._items.get('w:0'));return [b.max.y, card._work.scene.wall_segs[0].h ?? card._work.scene.wall_height ?? 46]})()`);
  check("plan view shows walls at their real height", Math.abs(tall[0] - tall[1]) < 0.5, JSON.stringify(tall));
  await btn("t-select"); await wait(200); await ev(`card._select([])`);
  await click(410, 470, 60);
  const picked = await ev(`card._edit.primary`), nDoor = await ev(`'n:'+(card._work.scene.openings.length-1)`);
  check("a click on a door picks the door, not the wall above it", picked === nDoor, `${picked} (door is ${nDoor})`);
  await ev(`card._select([])`);
  await btn("t-window"); await wait(200);
  await click(450, 495, 30);
  const win = await ev(`card._work.scene.openings.at(-1)`);
  check("window tool cuts a raised opening into the second wall", win.kind === "window" && win.z > 5 && Math.abs(win.rot - 90) < 0.5, JSON.stringify(win));
  const wp = await ev(`(()=>{let n=0;card._items.get('w:${n0 + 1}').traverse(o=>{if(o.isMesh&&o.userData.wall)n++});return n})()`);
  check("plan view cuts the window out of the wall (below, above and sides)", wp === 4, `${wp} pieces`);
  await shot("plan-3-drawn.png");

  // 5. drag the shared corner: both walls follow
  await btn("t-select"); await ev(`card._select([])`); await wait(200);
  const j = await screen(450, 470, 60);
  await p.mouse.move(j[0], j[1]); await p.mouse.down(); await p.mouse.move(j[0] + 10, j[1] - 10, { steps: 4 }); await p.mouse.move(j[0] + 30, j[1] - 30, { steps: 6 }); await p.mouse.up(); await wait(500);
  const moved = await ev(`card._work.scene.wall_segs.slice(${n0})`);
  check("dragging a corner moves every wall end there", moved[0].b[0] > 451 && moved[0].b[0] === moved[1].a[0] && moved[0].b[1] === moved[1].a[1], JSON.stringify(moved));
  await ev(`card._undo()`); await wait(300);
  check("undo puts the corner back", await ev(`card._work.scene.wall_segs[${n0}].b[0] === 450`));

  // 6. inspector: wall length in feet/inches (HA unit system = imperial)
  await ev(`card._select(['w:${n0}'])`); await wait(200);
  const sub = await ev(`card.shadowRoot.querySelector('.insp .sub').textContent`);
  check("wall inspector shows imperial lengths", /′/.test(sub), sub);
  await ev(`(()=>{const i=card.shadowRoot.querySelector('.insp input[data-p=len]'); i.value=120; i.dispatchEvent(new Event('change'))})()`); await wait(300);
  const L1 = await ev(`(()=>{const s=card._work.scene.wall_segs[${n0}];return Math.hypot(s.b[0]-s.a[0],s.b[1]-s.a[1])*2.1/2.54})()`);
  check("typing a length (inches) resizes the wall", Math.abs(L1 - 120) < 0.5, `${L1.toFixed(1)} in`);

  // 7. blueprint: upload → HA image store, then calibrate scale with two clicks
  await ev(`(async()=>{const c=document.createElement('canvas');c.width=800;c.height=400;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,800,400);g.strokeStyle='#000';g.lineWidth=8;g.strokeRect(40,40,720,320);
    const b=await new Promise(r=>c.toBlob(r,'image/png'));await card._addBlueprint(new File([b],'plan.png',{type:'image/png'}))})()`); await wait(1500);
  const bp = await ev(`card._work.scene.blueprints?.[0]`);
  check("blueprint uploads to the HA image store", bp?.src === "/api/image/serve/bp1/original" && (await ev(`uploads`)) === 1 && Math.abs(bp.w / bp.h - 2) < 0.01, JSON.stringify(bp));
  await shot("plan-4-blueprint.png");
  await ev(`card._select(['p:0'])`); await wait(200);
  await ev(`card.shadowRoot.querySelector('[data-pb=scale]').click()`); await wait(200);
  await click(160, 330); await click(260, 330);
  const meas = await ev(`card._measure.pts`); if (!meas?.[1]) console.log('measure', JSON.stringify(await ev(`[card._measure, card._work.scene.blueprints[0], card._edit.tool]`)));
  const mlen = Math.hypot(meas[1][0] - meas[0][0], meas[1][1] - meas[0][1]);
  await ev(`(()=>{const b=card.shadowRoot.querySelector('.insp');b.querySelector('[data-m=len]').value=String(${(2 * mlen * 2.1) / 100});b.querySelector('[data-m=unit]').value='m';b.querySelector('[data-m=apply]').click()})()`); await wait(400);
  const bp2 = await ev(`card._work.scene.blueprints[0]`);
  check("set scale resizes the blueprint to the real length", Math.abs(bp2.w / bp.w - 2) < 0.01, `${bp.w} -> ${bp2.w}`);
  await ev(`(()=>{const i=card.shadowRoot.querySelector('.insp input[data-p=locked]'); i.checked=true; i.dispatchEvent(new Event('change'))})()`); await wait(300);
  await ev(`card._select([])`);
  await click(bp2.x + bp2.w * 0.3, bp2.y + bp2.h * 0.3);
  check("a locked blueprint can't be grabbed by clicks", (await ev(`card._edit.sel.size`)) === 0 || !(await ev(`card._edit.sel.has('p:0')`)));

  // 7b. rooms: select by clicking the floor, reshape with corner / midpoint handles, draw a new one, rename it
  await ev(`card._select([])`); await wait(200);
  const RI = await ev(`card._work.scene.floors.findIndex(f=>f.name==='lounge')`);
  await click(185, 440);
  check("clicking a floor selects that room", await ev(`card._edit.primary === 'r:${RI}'`), await ev(`card._edit.primary`));
  check("a selected room shows corner and midpoint handles", (await ev(`card._vertMeshes.length`)) === 4 && (await ev(`card._midMeshes.length`)) === 4);
  check("room names are labelled on the plan", (await ev(`card._roomLabels.length >= card._work.scene.floors.length - 1`)));
  const drag = async (from, to) => { const a = await screen(...from, 1.5), b = await screen(...to, 1.5);
    await p.mouse.move(a[0], a[1]); await p.mouse.down(); await p.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 }); await p.mouse.move(b[0], b[1], { steps: 4 }); await p.mouse.up(); await wait(500); };
  const k0 = await ev(`card._work.scene.floors[${RI}].pts.map(q=>q.slice())`);
  await drag(k0[1], [k0[1][0] + 14, k0[1][1] - 9]);
  const k1 = await ev(`card._work.scene.floors[${RI}].pts`);
  check("dragging a corner reshapes the room", (k1[1][0] !== k0[1][0] || k1[1][1] !== k0[1][1]) && k1.length === 4, JSON.stringify(k1));
  await drag([(k1[1][0] + k1[2][0]) / 2, (k1[1][1] + k1[2][1]) / 2], [(k1[1][0] + k1[2][0]) / 2 + 12, (k1[1][1] + k1[2][1]) / 2]);
  const k2 = await ev(`card._work.scene.floors[${RI}].pts`);
  check("dragging an edge midpoint adds a corner", k2.length === 5, JSON.stringify(k2));
  await click(k2[2][0], k2[2][1], 1.5); await p.keyboard.press("Delete"); await wait(400);
  check("Delete removes the tapped corner", (await ev(`card._work.scene.floors[${RI}].pts.length`)) === 4);
  const nf = await ev(`card._work.scene.floors.length`);
  await btn("t-room"); await wait(200);
  for (const q of [[620, 250], [660, 250], [660, 300], [620, 300], [620, 250]]) await click(...q);
  const added = await ev(`card._work.scene.floors[${nf - 1}]`);
  check("room tool draws a new room (kept under the rug)", (await ev(`card._work.scene.floors.length`)) === nf + 1 && added.pts.length === 4 && (await ev(`card._work.scene.floors.at(-1).name`)) === "rug", JSON.stringify(added));
  await ev(`(()=>{const i=card.shadowRoot.querySelector('.insp input[data-p=name]'); i.value='Study'; i.dispatchEvent(new Event('change'))})()`); await wait(300);
  check("rooms can be renamed", (await ev(`card._work.scene.floors[${nf - 1}].name`)) === "study");
  await ev(`(()=>{const i=card.shadowRoot.querySelector('.insp select[data-p=texture]'); i.value='wood'; i.dispatchEvent(new Event('change'))})()`); await wait(300);
  check("rooms take a texture", await ev(`card._work.scene.floors[${nf - 1}].texture === 'wood' && card._floorMeshes.some(m=>m.userData.room==='study' && m.material.map)`));
  await ev(`card._select(['w:0'])`); await wait(300);
  await ev(`(()=>{const i=card.shadowRoot.querySelector('.insp select[data-p=texture]'); i.value='brick'; i.dispatchEvent(new Event('change'))})()`); await wait(300);
  const wt = await ev(`(()=>{let n=0,t=0;card._items.get('w:0').traverse(o=>{if(o.isMesh&&o.userData.wall){n++;if(o.material.map)t++}});return [card._work.scene.wall_segs[0].texture,n,t]})()`);
  const opts = await ev(`[...card.shadowRoot.querySelectorAll('.insp select[data-p=texture] option')].map(o=>o.value)`);
  check("walls only offer wall textures", opts.includes("brick") && opts.includes("boards") && !opts.includes("carpet") && !opts.includes("wood"), opts.join());
  check("walls take a texture", wt[0] === "brick" && wt[1] > 0 && wt[1] === wt[2], JSON.stringify(wt));
  await ev(`card.shadowRoot.querySelector('.insp button[data-pb=allwalls]').click()`); await wait(300);
  check("'Use on all walls' makes it the default", await ev(`card._work.scene.wall_texture === 'brick' && card._work.scene.wall_segs.every(w=>!w.texture) && card._items.get('w:1') && (()=>{let ok=true;card._items.get('w:1').traverse(o=>{if(o.isMesh&&o.userData.wall&&!o.material.map)ok=false});return ok})()`));
  await shot("plan-7-textures.png");
  await shot("plan-6-rooms.png");

  // 7c. overlapping walls: clicking the same spot again picks the one underneath
  const nw = await ev(`card._work.scene.wall_segs.length`);
  await ev(`card._mutate(()=>[card._push('w',{a:[600,420],b:[660,420]}), card._push('w',{a:[610,420],b:[650,420]})])`); await ev(`card._select([])`); await wait(300);
  await click(630, 420, 20); const c1 = await ev(`card._edit.primary`);
  await click(630, 420, 20); const c2 = await ev(`card._edit.primary`);
  check("repeat clicks cycle through overlapping walls", c1 !== c2 && [c1, c2].every((k) => k === "w:" + nw || k === "w:" + (nw + 1)), `${c1} -> ${c2}`);
  await ev(`card._select(['w:${nw}','w:${nw + 1}']); card._delete()`); await wait(300);

  // 8. back to furniture mode, save, reload
  await btn("m-furn"); await wait(900);
  check("furniture mode shows furniture again", await ev(`card._items.get('b:14').visible !== false && !card._jointMeshes.length`));
  await ev(`card._save()`); await wait(800);
  const st = await ev(`({segs:saved.strategy.scene.wall_segs.length, opens:saved.strategy.scene.openings.length, bp:saved.strategy.scene.blueprints.length, legacy:!!saved.strategy.scene.walls})`);
  check("save stores walls, openings and the blueprint in the strategy", st.segs === n0 + 2 && st.opens === legacyDoors + 2 && st.bp === 1 && !st.legacy, JSON.stringify(st));
  await ev(`card.setConfig({...genCfg, ...window.saved.strategy, type:'custom:ha-3dhome-card', fill:true})`); await wait(5000);
  await shot("plan-5-saved.png");
  check("renamed room appears in the room menu", await ev(`[...card.shadowRoot.querySelectorAll('.rooms button')].some(b=>b.textContent==='Study')`));
  check("blueprint is hidden outside edit mode", await ev(`!card._items.has('p:0')`));
  const full = await ev(`[0,1].map(d=>{let n=0;card._items.get('w:'+(${n0}+d)).traverse(o=>{if(o.isMesh&&o.userData.wall)n++});return n})`);
  check("in 3D the door keeps its lintel and the window has wall above and below", full[0] === 3 && full[1] === 4, JSON.stringify(full));

  // 6. sun: computed position, north rotation, live sun.sun azimuth/elevation, editor north field
  const sp = await ev(`(()=>{const f=window.__ha3dhome.solarPosition;
    return {noon:f(new Date('2024-06-21T12:00:00Z'),51.48,0), dusk:f(new Date('2024-06-21T21:00:00Z'),51.48,0), syd:f(new Date('2024-12-21T02:00:00Z'),-33.87,151.21)}})()`);
  check("solar position: Greenwich midsummer noon is due south, ~62° up", Math.abs(sp.noon.azimuth - 180) < 2 && Math.abs(sp.noon.elevation - 62) < 1, JSON.stringify(sp.noon));
  check("solar position: below the horizon late evening, sun north at Sydney noon", sp.dusk.elevation < 0 && (sp.syd.azimuth < 30 || sp.syd.azimuth > 330) && sp.syd.elevation > 70, JSON.stringify([sp.dusk, sp.syd]));
  const sv = await ev(`(()=>{const v=window.__ha3dhome.sunVector;return [v(0,0,0),v(90,0,0),v(0,0,90),v(180,90,0)].map(a=>a.map(n=>Math.round(n*100)/100))})()`);
  check("sun vector: north is up the plan, east is right, north 90° turns north to the right",
    JSON.stringify(sv.slice(0, 3)) === JSON.stringify([[0, 0, -1], [1, 0, 0], [1, 0, 0]]) && sv[3][1] === 1, JSON.stringify(sv));
  const applied = () => p.waitForFunction(() => !window.card._hassRaf, null, { timeout: 10000 });   // hass is applied on the next frame
  const setSun = (az, el, extra = "") => ev(`card.hass={...card._hass,states:{...card._hass.states,'sun.sun':{state:${el} > 0 ? 'above_horizon' : 'below_horizon',attributes:{azimuth:${az},elevation:${el}}}}${extra}}`);
  const roof = () => ev(`(()=>{let n=0;card._world.traverse(o=>{if(o.userData.roof)n++});return n})()`);
  check("an invisible roof (and raised cut-away walls) shade the rooms outside edit mode", (await roof()) > 5, String(await roof()));
  check("the roof can't be clicked", await ev(`(()=>{const r=new card.T.Raycaster(new card.T.Vector3(0,500,0),new card.T.Vector3(0,-1,0));r.camera=card._cam;return !r.intersectObject(card._world,true).some(h=>h.object.userData.roof)})()`));
  await setSun(90, 30); await applied(); await wait(300);
  const east = await ev(`(()=>{const p=card._sun.position;return {x:p.x,y:p.y,z:p.z,i:card._sun.intensity}})()`);
  check("sun comes from sun.sun's azimuth (east = +x)", east.x > 400 && Math.abs(east.z) < 1 && east.y > 200 && east.i > 1, JSON.stringify(east));
  await setSun(90, -12); await applied(); await wait(300);
  check("sun below the horizon goes dark", await ev(`card._sun.intensity === 0 && card._amb.intensity < 0.3`));
  await ev(`card.hass={...card._hass,states:{}}`); await applied(); await wait(300);
  check("no sun entity: falls back to a fixed daylight sun", await ev(`card._sun.intensity > 1 && card._sun.position.x === -260`));
  await setSun(90, 30, `,config:{...card._hass.config,latitude:51.48,longitude:0}`); await wait(300);
  await ev(`card._enterEdit()`); await wait(1200);
  await btn("m-plan"); await wait(2000);
  check("no roof in floor plan mode", (await roof()) === 0);
  await btn("m-furn"); await wait(2000);
  const ni = await ev(`!!card.shadowRoot.querySelector('.insp [data-sun="north"]') && !!card.shadowRoot.querySelector('.insp [data-sun="hour"]')`);
  check("editor shows north and sun preview with nothing selected", ni);
  await ev(`(()=>{const i=card.shadowRoot.querySelector('.insp [data-sun="north"]');i.value='90';i.dispatchEvent(new Event('change'))})()`); await wait(800);
  const rot = await ev(`({n:card._work.scene.north, z:card._sun.position.z})`);
  check("north 90° is saved and turns the sun (east now faces the front)", rot.n === 90 && rot.z > 400, JSON.stringify(rot));
  await ev(`(()=>{const i=card.shadowRoot.querySelector('.insp [data-sun="hour"]');i.value='0';i.dispatchEvent(new Event('input'))})()`); await wait(300);
  check("sun preview at midnight is dark", await ev(`card._sun.intensity === 0`));
  await shot("plan-6-north.png");
  await ev(`card._exitEdit(false)`); await wait(800);
  check("leaving the editor ends the preview", await ev(`card._sunPreview == null && card._sun.intensity > 1`));
  // 9. light fixtures: a table lamp, and a string light whose bulbs follow its length
  await ev(`card._enterEdit()`); await wait(1200);
  await ev(`card._select(['l:2']); card._setFixture('l:2','tablelamp')`); await wait(800);
  const lamp = await ev(`(()=>{const g=card._lightGroups.find(g=>g.keys.includes('l:2'));return [g.fixtures.length, g.group.children.some(c=>c.userData.fixture), card._work.lights[2].z]})()`);
  check("a light can be given a table lamp", lamp[0] >= 1 && lamp[1] && lamp[2] === 25, JSON.stringify(lamp));
  await ev(`card._select(['l:8']); card._setFixture('l:8','string')`); await wait(800);
  const bulbs = () => ev(`card._lightGroups.find(g=>g.keys.includes('l:8')).bulbs.length`);
  const b0 = await bulbs(), S0 = await ev(`card._work.lights[8]`);
  check("a light becomes a string light along two points", S0.kind === "string" && S0.points.length === 2 && S0.x == null && b0 >= 4, JSON.stringify({ b0, S0 }));
  check("a selected string light shows end and middle handles", (await ev(`[card._sptMeshes.length, card._smidMeshes.length].join()`)) === "2,1");
  await ev(`card._field('l:8','len', String(card._toReal(120)))`); await wait(600);
  const b1 = await bulbs();
  check("a longer string gets more bulbs", b1 > b0 + 2, `${b0} -> ${b1}`);
  await ev(`card._field('l:8','count','5')`); await wait(600);
  check("the bulb count can be set", (await bulbs()) === 5);
  await ev(`card._field('l:8','count','0')`); await wait(600);
  { const L = await ev(`card._work.lights[8]`), e = L.points.at(-1), s0 = await screen(e[0], e[1], L.z), s1 = await screen(e[0] + 60, e[1], L.z);
    await p.mouse.move(s0[0], s0[1]); await p.mouse.down(); for (let k = 1; k <= 6; k++) { await p.mouse.move(s0[0] + (s1[0] - s0[0]) * k / 6, s0[1] + (s1[1] - s0[1]) * k / 6); await wait(60); } await p.mouse.up(); await wait(800);
    const L2 = await ev(`card._work.lights[8]`), b2 = await bulbs();
    check("dragging a string's end stretches it and adds bulbs", L2.points.at(-1)[0] > e[0] + 40 && b2 > b1, JSON.stringify({ end: L2.points.at(-1), b1, b2 }));
    await ev(`card._undo()`); await wait(600);
    check("undo puts the string's end back", (await ev(`card._work.lights[8].points.at(-1)[0]`)) === e[0]); }
  await shot("plan-9-fixtures.png");
  await ev(`card._exitEdit(true)`); await wait(1500);

  // 9. door leaves follow a sensor
  const di = await ev(`window.saved.strategy.scene.openings.findIndex(o=>o.style==='panel')`);
  check("new doors get a solid door", di >= 0);
  await ev(`(()=>{const st=JSON.parse(JSON.stringify(window.saved.strategy)); st.scene.openings[${di}].entity='binary_sensor.test_door';
    for (const [k, style] of [['sliding',1],['double',2],['barn',3],['garage',4]]) { const o=st.scene.openings.find(o=>o.kind==='door'&&!o.style); if (o) o.style=k; }
    card.setConfig({...genCfg, ...st, type:'custom:ha-3dhome-card', fill:true})})()`); await wait(4000);
  const shut = await ev(`card._doorLeaves.map(d=>d.t)`);
  await ev(`card.hass={...card._hass,states:{...card._hass.states,'binary_sensor.test_door':{state:'on',attributes:{device_class:'door'}}}}`);
  for (let k = 0; k < 30 && !(await ev(`card._doorLeaves.find(d=>d.o.entity==='binary_sensor.test_door').t === 1`)); k++) await wait(500);   // slow software frames
  const open = await ev(`(()=>{const d=card._doorLeaves.find(d=>d.o.entity==='binary_sensor.test_door');return [d.t, Math.abs(d.parts[0].node.rotation.y)]})()`);
  check("a door with a sensor swings open when it reports open", shut.every((t) => t === 0) && open[0] === 1 && Math.abs(open[1] - Math.PI / 2) < 0.01, JSON.stringify({ shut, open }));
  check("door styles build (solid, sliding, double, barn, garage)", (await ev(`new Set(card._doorLeaves.map(d=>d.o.style)).size`)) >= 4, await ev(`card._doorLeaves.map(d=>d.o.style).join()`));
  await shot("plan-8-doors.png");
  check("no page errors", errors.length === 0, errors.join(" | "));

  await browser.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} floor plan checks passed. Screenshots in tools/out/plan-*.png`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
