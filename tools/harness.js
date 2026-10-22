/* What the browser tests share: Chromium with software WebGL, the CDN modules served from node_modules (no network),
 * and a page that shows the 3D Home panel the way Home Assistant does, with a fake `hass` and a fake ha_3dhome
 * integration behind it.
 *
 *   const { launch, panelPage, SAMPLE_HOME, check, report } = require("./harness");
 *
 * In the page: `panel` is the <ha-3dhome-panel>, `card` its <ha-3dhome-map>, `server` the integration's side (the stored
 * `config`, its `rev`, and every `saves` call), `calls` the service calls and websocket message types, and
 * `makeHass(extra)` builds a hass object like the one the panel got.
 */
const { chromium } = require("playwright");
const fs = require("fs"),
  path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "out");
fs.mkdirSync(OUT, { recursive: true });
const DIST = process.argv.includes("--dist");
const CODE = require("./bundle").bundle({ dist: DIST }); // { core, editor }
const SAMPLE_HOME = JSON.parse(fs.readFileSync(path.join(ROOT, "examples/sample-home.json"), "utf8"));

const JSM = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/";
const js = (body) => ({ body, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } });
/** a Three.js example module, with its imports pointed at the CDN (which is routed back here) */
const jsm = (rel) =>
  fs
    .readFileSync(path.join(ROOT, "node_modules/three/examples/jsm", rel), "utf8")
    .replace(/from 'three'/g, "from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm'")
    .replace(/from '(\.{1,2}\/[^']+)'/g, (_, r) => `from '${new URL(r, JSM + rel).href}/+esm'`);

/** Serves what the map loads from the CDN out of node_modules. `target` is a page or a browser context. */
async function routeCdn(target) {
  await target.route("https://cdn.jsdelivr.net/**", (r) => {
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
    if (u.includes("/examples/jsm/")) return r.fulfill(js(jsm(u.split("/examples/jsm/")[1].replace(/\/\+esm$/, ""))));
    return r.fulfill(js(fs.readFileSync(path.join(ROOT, "node_modules/three/build/three.module.js"), "utf8")));
  });
}

/** Starts Chromium and opens a page (a phone-sized touch page with `mobile`). */
async function launch({ mobile = false, viewport = null, args = [] } = {}) {
  const exe =
    process.env.CHROMIUM_PATH || (fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
  const browser = await chromium.launch({
    executablePath: exe,
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
      ...args,
    ],
  });
  const ctx = await browser.newContext(
    mobile
      ? { viewport: viewport || { width: 390, height: 800 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }
      : { viewport: viewport || { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  );
  await routeCdn(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => {
    errors.push(e.message);
    console.log("pageerror:", e.stack || e.message);
  });
  const ev = (s) => page.evaluate(s);
  const wait = (ms) => page.waitForTimeout(ms);
  /** waits until `expr` is true in the page (false after `ms`) */
  const until = async (expr, ms = 15000) => {
    for (const t = Date.now(); Date.now() - t < ms; await wait(100)) if (await ev(expr)) return true;
    return false;
  };
  return { browser, ctx, page, errors, ev, wait, until };
}

/**
 * The page: stand-ins for Home Assistant's elements, the editor and the core, then one panel whose stored map is
 * `config`. `states` are the entities, `hass` extra fields for the hass object (JavaScript source, evaluated in the
 * page), `head` a script that runs before anything else, and `admin` whether the user may edit.
 */
function panelPage({ config = SAMPLE_HOME, states = {}, hass = "{}", head = "", admin = true } = {}) {
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width, initial-scale=1"></head>
<body style="margin:0;background:#111"><div id=host style="height:100vh"></div>
<script>${head}</script>
<script>customElements.define('ha-card',class extends HTMLElement{connectedCallback(){this.style.display='block'}});
customElements.define('ha-icon',class extends HTMLElement{});
customElements.define('ha-menu-button',class extends HTMLElement{connectedCallback(){this.textContent='☰'}});
customElements.define('hui-tile-card',class extends HTMLElement{setConfig(c){this.c=c} set hass(h){this.h=h;this.textContent=this.c.entity+': '+h.states[this.c.entity]?.state}});
window.loadCardHelpers=async()=>({createCardElement:(c)=>{const e=document.createElement('hui-'+c.type+'-card');e.setConfig(c);return e}});
window.calls=[];
// the integration's side: the stored map, pushed to the panel on subscribe and after every save
window.server={config:${JSON.stringify(config)},rev:1,subs:[],saves:[],
  push(){for(const cb of this.subs)cb(JSON.parse(JSON.stringify({config:this.config,rev:this.rev})))},
  saveFrom(config){this.config=config;this.rev++;this.push()}};
window.makeHass=(extra={})=>({states:${JSON.stringify(states)},user:{is_admin:${admin}},services:{},
  callService:async(...a)=>{calls.push(a)},
  connection:{subscribeEvents:async()=>()=>{},
    subscribeMessage:async(cb)=>{server.subs.push(cb);setTimeout(()=>server.push(),0);return async()=>{server.subs.splice(server.subs.indexOf(cb),1)}}},
  callWS:async(m)=>{calls.push(m.type);
    if(m.type==='ha_3dhome/config/save'){server.saves.push(m);
      if(m.rev!==server.rev)throw {code:'conflict',message:'The map was saved from another device meanwhile.'};
      server.config=m.config;server.rev++;server.push();return {rev:server.rev}}
    if(window.extraWS)return extraWS(m);
    return null},
  ...extra});</script>
<script type=module>${CODE.editor}</script>
<script type=module>${CODE.core}
const __panel=document.createElement('ha-3dhome-panel');
__panel.hass=makeHass(${hass}); __panel.narrow=false; __panel.panel={url_path:'3d-home',config:{entry_id:'E1'}};
document.getElementById('host').append(__panel);
window.panel=__panel; window.card=__panel.shadowRoot.querySelector('ha-3dhome-map');</script></body></html>`;
}

/** Points the fake Home Assistant origin (http://ha.test/) at `html`; `extra(route, url)` may answer other requests. */
async function serve(page, html, extra) {
  await page.route("http://ha.test/**", (r) => {
    const u = r.request().url();
    return (extra && extra(r, u)) || r.fulfill({ body: html, contentType: "text/html" });
  });
  await page.goto("http://ha.test/3d-home");
}

const results = [];
/** records and prints one check */
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}
/** prints the tally and exits (non-zero when a check failed) */
function report(what = "checks", suffix = "") {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} ${what} passed.${suffix}`);
  process.exit(failed ? 1 : 0);
}

module.exports = { ROOT, OUT, CODE, DIST, SAMPLE_HOME, launch, routeCdn, panelPage, serve, check, report, js, jsm };
