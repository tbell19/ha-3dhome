/* What the browser tests share: Chromium with software WebGL, the built files served at the integration's URL, every other host refused (so nothing may need the internet),
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
const CODE = require("./bundle").bundle({ dist: DIST }); // the built files by path: ha-3dhome.js, lib/…
const SAMPLE_HOME = JSON.parse(fs.readFileSync(path.join(ROOT, "examples/sample-home.json"), "utf8"));

const VERSION = require("../package.json").version;
const BASE = "http://ha.test/ha_3dhome/"; // where the integration serves the built files (CODE)
const js = (body) => ({ body, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } });

/* Everything outside the fake Home Assistant is refused and listed here, so the tests prove the map needs no internet;
 * report() fails when anything tried. */
const external = [];
/** Serves the built files at /ha_3dhome/ and refuses every other host. `target` is a page or a browser context. */
async function routeFiles(target) {
  await target.route(
    (u) => u.protocol.startsWith("http") && u.host !== "ha.test",
    (r) => {
      external.push(r.request().url());
      return r.abort("internetdisconnected");
    },
  );
  await target.route(BASE + "**", (r) => {
    const f = new URL(r.request().url()).pathname.slice("/ha_3dhome/".length);
    return CODE[f] ? r.fulfill(js(CODE[f])) : r.fulfill({ status: 404, body: "not found" });
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
  await routeFiles(ctx);
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

/** the editor and the core, loaded from the integration's URL as Home Assistant does (the editor first, so it is there
 * before Edit is pressed) */
const scripts = () =>
  `<script type=module src="${BASE}ha-3dhome-editor.js?v=${VERSION}"></script>
<script type=module src="${BASE}ha-3dhome.js?v=${VERSION}"></script>`;

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
${scripts()}
<script type=module>
const __panel=document.createElement('ha-3dhome-panel');
__panel.hass=makeHass(${hass}); __panel.narrow=false; __panel.panel={url_path:'3d-home',config:{entry_id:'E1'}};
document.getElementById('host').append(__panel);
window.panel=__panel; window.card=__panel.shadowRoot.querySelector('ha-3dhome-map');</script></body></html>`;
}

/** Points the fake Home Assistant origin (http://ha.test/) at `html`; `extra(route, url)` may answer other requests. The
 * built files under /ha_3dhome/ fall through to routeFiles. */
async function serve(page, html, extra) {
  await page.route("http://ha.test/**", (r) => {
    const u = r.request().url();
    if (u.startsWith(BASE)) return r.fallback();
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
  check("nothing was loaded from the internet", !external.length, external.slice(0, 5).join(", "));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} ${what} passed.${suffix}`);
  process.exit(failed ? 1 : 0);
}

module.exports = {
  ROOT,
  OUT,
  CODE,
  DIST,
  SAMPLE_HOME,
  launch,
  routeFiles,
  scripts,
  panelPage,
  serve,
  check,
  report,
  js,
};
