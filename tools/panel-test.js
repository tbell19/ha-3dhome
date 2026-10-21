/* Panel test: the 3D Home sidebar page (<ha-3dhome-panel>) the way the ha_3dhome integration shows it.
 *
 * A fake hass plays the integration's side in the page: ha_3dhome/config/subscribe pushes the stored config and every
 * later save, ha_3dhome/config/save checks the revision it started from. The sample home sits on a dashboard, ready to
 * be imported.
 *
 *   npm run test:panel [-- --dist]
 *
 * Checks: an empty panel offers the dashboard's map and copies it in, Save writes to the integration and not to a
 * dashboard, a save from another device appears without a new WebGL context, edits in progress aren't pulled away and
 * their Save reports the clash, the sidebar button on narrow screens, nothing offered to non-admins.
 */
const { chromium } = require("playwright");
const fs = require("fs"),
  path = require("path");
const ROOT = path.join(__dirname, "..");
const CODE = require("./bundle").bundle({ dist: process.argv.includes("--dist") }); // { core, editor }
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const js = (body) => ({ body, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } });
const esm = (rel) =>
  fs
    .readFileSync(path.join(ROOT, "node_modules/three/examples/jsm", rel), "utf8")
    .replace(/from 'three'/g, "from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm'");
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

(async () => {
  const dash = JSON.parse(fs.readFileSync(path.join(ROOT, "tools/fixtures/test-home.json"), "utf8"));
  const exe =
    process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch({
    executablePath: exe,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
  });
  const p = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  const errors = [];
  p.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("pageerror:", e.message);
  });
  await p.route("https://cdn.jsdelivr.net/**", (r) => {
    const u = r.request().url();
    for (const [k, f] of [
      ["OrbitControls", "controls/OrbitControls.js"],
      ["TransformControls", "controls/TransformControls.js"],
      ["OBJLoader", "loaders/OBJLoader.js"],
      ["MTLLoader", "loaders/MTLLoader.js"],
    ])
      if (u.includes(k)) return r.fulfill(js(esm(f)));
    return r.fulfill(js(fs.readFileSync(path.join(ROOT, "node_modules/three/build/three.module.js"), "utf8")));
  });
  const html = `<!doctype html><meta charset=utf-8><body style="margin:0"><div id=host></div>
<script>customElements.define('ha-card',class extends HTMLElement{connectedCallback(){this.style.display='block'}});
customElements.define('ha-icon',class extends HTMLElement{});
customElements.define('ha-menu-button',class extends HTMLElement{connectedCallback(){this.textContent='☰'}});
window.__ctx=0; const _gc=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(t,...a){const c=_gc.call(this,t,...a); if(c&&/webgl/.test(t)&&!this.__counted){this.__counted=1;__ctx++} return c};
// the integration's side: one stored config per panel, pushed to followers on every save
window.server={E1:{config:{},rev:0,subs:[]},E2:{config:{},rev:0,subs:[]},saves:[],calls:[],
  push(id){const s=this[id];for(const cb of s.subs)cb(JSON.parse(JSON.stringify({config:s.config,rev:s.rev})))},
  saveFrom(id,config){const s=this[id];s.config=config;s.rev++;this.push(id)}};
const __dash=${JSON.stringify(dash)};
window.makeHass=(admin)=>({states:{},user:{is_admin:admin},services:{},callService:async()=>{},
  connection:{subscribeEvents:async()=>()=>{},
    subscribeMessage:async(cb,m)=>{const s=server[m.entry_id];s.subs.push(cb);setTimeout(()=>server.push(m.entry_id),0);return async()=>{s.subs.splice(s.subs.indexOf(cb),1)}}},
  callWS:async(m)=>{server.calls.push(m.type);
    if(m.type==='ha_3dhome/config/save'){const s=server[m.entry_id];server.saves.push(m);
      if(m.rev!==s.rev)throw {code:'conflict',message:'The map was saved from another device meanwhile. Cancel to see it, then edit again.'};
      s.config=m.config;s.rev++;server.push(m.entry_id);return {rev:s.rev}}
    if(m.type==='lovelace/dashboards/list')return [{url_path:'juniper',title:'Juniper House',mode:'storage'},{url_path:'energy-plus',title:'Energy'}];
    if(m.type==='lovelace/config')return m.url_path==='juniper'?JSON.parse(JSON.stringify(__dash)):{views:[{cards:[]}]};
    throw new Error('unexpected '+m.type)}});
</script>
<script type=module>${CODE.editor}</script>
<script type=module>${CODE.core}
const __panel=document.createElement('ha-3dhome-panel');
__panel.hass=makeHass(true); __panel.narrow=false; __panel.panel={url_path:'3d-home',config:{entry_id:'E1'}};
document.getElementById('host').append(__panel);
window.panel=__panel; window.card=__panel.shadowRoot.querySelector('ha-3dhome-card');</script>`;
  await p.route("http://ha.test/**", (r) => r.fulfill({ body: html, contentType: "text/html" }));

  const ev = (s) => p.evaluate(s);
  const wait = (ms) => p.waitForTimeout(ms);
  const until = async (expr, ms = 15000) => {
    for (const t = Date.now(); Date.now() - t < ms; await wait(100)) if (await ev(expr)) return true;
    return false;
  };
  const rooms = () => ev(`[...card.shadowRoot.querySelectorAll('.rooms button')].map(b=>b.textContent)`);
  const importBox = `panel.shadowRoot.querySelector('.import')`;

  await p.goto("http://ha.test/3d-home");
  check("the panel element is registered", await ev(`!!customElements.get('ha-3dhome-panel')`));
  check("an empty panel shows the card's how-to-start hint", await until(`!!card.shadowRoot?.querySelector('.empty')`));
  check(
    "the hint says Save keeps the map here",
    await ev(`card.shadowRoot.querySelector('.empty').textContent.includes('Save keeps them here')`),
  );
  check(
    "it offers the map found on a dashboard",
    await until(`!${importBox}.classList.contains('hide')`),
    await ev(`${importBox}.textContent`),
  );
  check(
    "only dashboards that have a map are offered",
    (await ev(`[...${importBox}.querySelectorAll('button')].map(b=>b.textContent).join()`)) ===
      "Copy from Juniper House",
  );
  await p.screenshot({ path: path.join(OUT, "panel-empty.png") });
  await ev(`${importBox}.querySelector('button').click()`);
  check("copying stores the map in the integration", await until(`server.E1.rev===1 && !!server.E1.config.scene`));
  check(
    "the stored config leaves out what the panel sets itself",
    await ev(`!('type' in server.E1.config) && !('fill' in server.E1.config) && !('dashboard' in server.E1.config)`),
  );
  check(
    "the copied map shows",
    await until(`card.shadowRoot.querySelectorAll('.rooms button').length>=8`),
    (await rooms()).join(),
  );
  check("it says where the map came from", await ev(`${importBox}.textContent.includes('Juniper House')`));
  await ev(`${importBox}.querySelector('button').click()`);
  check("the note can be closed", await ev(`${importBox}.classList.contains('hide')`));
  await wait(500);
  await p.screenshot({ path: path.join(OUT, "panel-map.png") });

  // edit and save: to the integration, not a dashboard, and without restarting the scene
  await ev(`window.__r=card._renderer`);
  const ctx0 = await ev(`__ctx`); // WebGL contexts made so far
  await ev(`card._openEditor()`);
  check("Edit works in the panel", await until(`!!card._edit`));
  await ev(`card._editor._mutate(()=>{card._work.scene.floors[0].name='snug';return []})`);
  await ev(`card._editor._save()`);
  check("Save writes to the integration", await until(`server.E1.rev===2 && !card._edit`));
  check("Save started from the revision shown", await ev(`server.saves.at(-1).rev===1`));
  check("Save doesn't touch any dashboard", await ev(`!server.calls.includes('lovelace/config/save')`));
  check("the scene is kept (same renderer)", await ev(`card._renderer===__r`));
  check(
    "the saved map shows",
    (await rooms()).some((r) => /snug/i.test(r)),
    (await rooms()).join(),
  );
  check("the toast says Saved", await ev(`(card.shadowRoot.querySelector('.toast')?.textContent||'Saved')==='Saved'`));

  // a save on another device
  await ev(
    `(()=>{const c=JSON.parse(JSON.stringify(server.E1.config));c.scene.floors[0].name='den';server.saveFrom('E1',c)})()`,
  );
  check(
    "a save on another device shows up",
    await until(`[...card.shadowRoot.querySelectorAll('.rooms button')].some(b=>/den/i.test(b.textContent))`),
  );
  check("…in the running scene (same renderer, no new context)", await ev(`card._renderer===__r && __ctx===${ctx0}`));

  // another device saves while editing here
  await ev(`card._openEditor()`);
  await until(`!!card._edit`);
  await ev(`card._editor._mutate(()=>{card._work.scene.floors[0].name='library';return []})`);
  await ev(
    `(()=>{const c=JSON.parse(JSON.stringify(server.E1.config));c.scene.floors[0].name='parlour';server.saveFrom('E1',c)})()`,
  );
  await wait(300);
  check(
    "edits in progress aren't pulled away",
    await ev(`!!card._edit && card._work.scene.floors[0].name==='library'`),
  );
  await ev(`card._editor._save()`);
  await wait(300);
  check(
    "their Save reports the clash and keeps editing",
    await ev(`!!card._edit && /another device/.test(card.shadowRoot.querySelector('.toast')?.textContent||'')`),
    await ev(`card.shadowRoot.querySelector('.toast')?.textContent`),
  );
  check("nothing was overwritten", await ev(`server.E1.config.scene.floors[0].name==='parlour'`));
  await ev(`card._editor._exitEdit(false)`);
  check(
    "leaving the editor shows the other device's map",
    await until(`[...card.shadowRoot.querySelectorAll('.rooms button')].some(b=>/parlour/i.test(b.textContent))`),
    (await rooms()).join(),
  );

  // narrow screens: the sidebar button
  check(
    "no sidebar button on a wide screen",
    await ev(`getComputedStyle(panel.shadowRoot.querySelector('.menu')).display==='none'`),
  );
  await ev(`panel.narrow=true`);
  check(
    "narrow screens get the sidebar button",
    await ev(
      `getComputedStyle(panel.shadowRoot.querySelector('.menu')).display!=='none' && panel.shadowRoot.querySelector('.menu').narrow===true`,
    ),
  );
  await p.screenshot({ path: path.join(OUT, "panel-narrow.png") });

  // Home Assistant may make a new panel element for the same page: the map moves over, scene and all
  await ev(`(()=>{const q=document.createElement('ha-3dhome-panel');panel.remove();q.hass=makeHass(true);q.panel={url_path:'3d-home',config:{entry_id:'E1'}};
    document.getElementById('host').append(q);window.panel=q})()`);
  await wait(500);
  check(
    "a new panel element for the same page keeps the map's scene",
    await ev(`panel.shadowRoot.querySelector('ha-3dhome-card')===card && card._renderer===__r && __ctx===${ctx0}`),
  );
  check("…and still follows saves", await ev(`server.E1.subs.length===1`));

  // someone who isn't an administrator, on another empty panel
  await ev(`(()=>{const q=document.createElement('ha-3dhome-panel');q.hass=makeHass(false);q.panel={url_path:'other',config:{entry_id:'E2'}};
    q.style.cssText='position:fixed;left:0;top:0;width:400px;height:300px';document.body.append(q);window.panel2=q})()`);
  await wait(1500);
  check(
    "non-admins get no import offer",
    await ev(`panel2.shadowRoot.querySelector('.import').classList.contains('hide')`),
  );
  check(
    "…and no Edit button",
    await ev(
      `(()=>{const b=panel2.shadowRoot.querySelector('ha-3dhome-card').shadowRoot?.querySelector('.edbtn');return !b||b.style.display==='none'})()`,
    ),
  );

  check("no page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(
    failed
      ? `\n${failed} of ${results.length} panel checks FAILED`
      : `\n${results.length}/${results.length} panel checks passed.`,
  );
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
