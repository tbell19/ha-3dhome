/* Loads the standalone demo (site/, via tools/demo.js) in headless Chromium and checks it works without Home Assistant:
 * the map renders, the editor loads on its own from next to the core (as under HACS), a tap toggles a pretend light,
 * and Save keeps the layout in localStorage. Writes tools/out/demo*.png.   npm run build && npm run test:demo [-- --mobile]
 * Icons are stand-in dots unless MDI_SVG points at a folder of Material Design Icons SVGs (the svg/ folder of @mdi/svg).
 */
const { chromium } = require("playwright");
const fs = require("fs"),
  path = require("path"),
  { spawn } = require("child_process");
const ROOT = path.join(__dirname, ".."),
  OUT = path.join(__dirname, "out");
const MOBILE = process.argv.includes("--mobile");
fs.mkdirSync(OUT, { recursive: true });
const js = (body) => ({ body, contentType: "application/javascript", headers: { "access-control-allow-origin": "*" } });
const JSM = "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/";
const esm = (rel) =>
  fs
    .readFileSync(path.join(ROOT, "node_modules/three/examples/jsm", rel), "utf8")
    .replace(/from 'three'/g, "from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm'")
    .replace(/from '(\.{1,2}\/[^']+)'/g, (_, r) => `from '${new URL(r, JSM + rel).href}/+esm'`);
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};

(async () => {
  const port = 8000 + Math.floor(Math.random() * 900);
  const server = spawn(process.execPath, [path.join(__dirname, "demo.js")], {
    env: { ...process.env, PORT: port },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 600));
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
  await ctx.route("https://cdn.jsdelivr.net/**", (r) => {
    const u = r.request().url();
    if (u.includes("/examples/jsm/")) return r.fulfill(js(esm(u.split("/examples/jsm/")[1].replace(/\/\+esm$/, ""))));
    for (const [k, f] of [
      ["OrbitControls", "controls/OrbitControls.js"],
      ["TransformControls", "controls/TransformControls.js"],
    ])
      if (u.includes(k)) return r.fulfill(js(esm(f)));
    return r.fulfill(js(fs.readFileSync(path.join(ROOT, "node_modules/three/build/three.module.js"), "utf8")));
  });
  await ctx.route("https://api.iconify.design/**", (r) => {
    const f = process.env.MDI_SVG && path.join(process.env.MDI_SVG, path.basename(new URL(r.request().url()).pathname));
    r.fulfill({
      body:
        f && fs.existsSync(f)
          ? fs.readFileSync(f)
          : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
      contentType: "image/svg+xml",
    });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  try {
    await p.goto(`http://localhost:${port}/`);
    await p.waitForFunction(() => document.querySelector("ha-3dhome-card")?._ready, null, { timeout: 30000 });
    await p.waitForTimeout(3000);
    const card = "document.querySelector('ha-3dhome-card')";
    check(
      "map renders the sample home",
      await p.evaluate(`${card}._world?.children.length > 10 && !!${card}.shadowRoot.querySelector('canvas')`),
    );
    check(
      "Edit shows, but the editor waits until it is pressed",
      await p.evaluate(`typeof ${card}._enterEdit !== 'function' && ${card}._edBtn.style.display !== 'none'`),
    );
    const before = await p.evaluate(`${card}._hass.states['light.foyer'].state`);
    await p.evaluate(`${card}._hass.callService('homeassistant','toggle',{entity_id:'light.foyer'})`);
    await p.waitForTimeout(500);
    const after = await p.evaluate(`${card}._hass.states['light.foyer'].state`);
    check("toggling a pretend light changes its state", before === "off" && after === "on", `${before} -> ${after}`);
    await p.screenshot({ path: path.join(OUT, `demo${MOBILE ? "-mobile" : ""}.png`) });
    await p.click("#day");
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(OUT, `demo${MOBILE ? "-mobile" : ""}-day.png`) });
    await p.evaluate(`${card}._edBtn.click()`);
    await p.waitForTimeout(1500);
    check("edit mode opens", await p.evaluate(`!!${card}._edit`));
    await p.evaluate(`${card}._mutate(() => { ${card}._work.scene.floors[0].fill = '#123456'; return []; })`);
    await p.evaluate(`${card}._save()`);
    await p.waitForTimeout(1000);
    const saved = await p.evaluate(
      `JSON.parse(localStorage.getItem('ha-3dhome-demo-layout'))?.scene?.floors?.[0]?.fill`,
    );
    check("Save keeps the layout in this browser", saved === "#123456", String(saved));
    check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) {
    check("demo run", false, e.message);
  }
  await browser.close();
  server.kill();
  const failed = results.filter((x) => !x).length;
  console.log(failed ? `${failed} FAILED` : "all passed");
  process.exit(failed ? 1 : 0);
})();
