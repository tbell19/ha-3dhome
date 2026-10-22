/* Before/after screenshots of the optional render looks (`look:` in the card config).
 *
 * Loads the map the same way as the smoke test (the panel + fake hass + Three.js from node_modules),
 * once per look, by day and by night, and writes PNGs to tools/out/looks/.
 *
 *   node tools/look-shots.js                 every look
 *   node tools/look-shots.js base bloom      just those
 *   node tools/look-shots.js --mobile        phone viewport
 *   node tools/look-shots.js nowindow        window daylight off, to compare with base
 *   node tools/look-shots.js panel           the editor's Look panel, with a slider moved
 */
const fs = require("fs"),
  path = require("path");
const { ROOT, SAMPLE_HOME, launch, panelPage, serve } = require("./harness");

const MOBILE = process.argv.includes("--mobile");
const OUT = path.join(__dirname, "out/looks");
fs.mkdirSync(OUT, { recursive: true });

const LOOKS = {
  base: false,
  ao: { ao: 1, light: 0, bloom: 0, stage: 0 },
  light: { ao: 0, light: 1, bloom: 0, stage: 0 },
  bloom: { ao: 0, light: 0, bloom: 0.5, stage: 0 },
  stage: { ao: 0, light: 0, bloom: 0, stage: 1 },
  all: {},
  nowindow: {},
  panel: { ao: true, light: true, bloom: true, stage: true },
  ltune: {},
};
const pick = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const names = pick.length ? pick : Object.keys(LOOKS);

const on = (rgb, bri = 255) => ({ state: "on", attributes: { brightness: bri, rgb_color: rgb } });
const STATES = {
  "sun.sun": { state: "below_horizon", attributes: {} },
  "weather.home": { state: "partlycloudy", attributes: { temperature: 61, temperature_unit: "°F" } },
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
  "binary_sensor.deck_door": { state: "on", attributes: { device_class: "door" } },
};

(async () => {
  const { browser, ctx } = await launch({ mobile: MOBILE });

  for (const name of names)
    for (const mode of name === "panel" || name === "ltune" ? ["night"] : ["day", "night"]) {
      const panel = name === "panel" || name === "ltune";
      const p = await ctx.newPage();
      const errors = [];
      p.on("pageerror", (e) => errors.push(e.message));
      p.on("console", (m) => m.type() === "error" && !m.text().includes("404") && errors.push(m.text()));
      const html = panelPage({
        config: {
          ...SAMPLE_HOME,
          night_mode: mode === "night" ? "always" : "never",
          look: LOOKS[name],
          ...(name === "nowindow" ? { window_light: 0 } : {}),
        },
        states: STATES,
        admin: panel,
      });
      await serve(p, html, (r, u) => u.includes("/local/") && r.fulfill({ status: 404, body: "" }));
      await p.waitForTimeout(7000);
      if (panel) {
        // open the editor's Look panel and drag the glow slider down to 20%
        await p.evaluate(`card.shadowRoot.querySelector('.edbtn').click()`);
        await p.waitForTimeout(1500);
        await p.evaluate(`card.shadowRoot.querySelector('[data-a=look]').click()`);
        await p.waitForTimeout(300);
        await p.evaluate(
          `(()=>{const i=card.shadowRoot.querySelector('.lookp [data-k=bloom]'); i.value=20; i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true}))})()`,
        );
        await p.waitForTimeout(1500);
        const r = await p.evaluate(`[card._work.look.bloom, card._edit.undo.length, card._bloomPass?.strength]`);
        if (!(r[0] === 0.2 && r[1] === 1 && Math.abs(r[2] - 0.18) < 1e-6))
          errors.push("slider did not apply: " + JSON.stringify(r));
      }
      if (name === "ltune") {
        // select a light, open its settings and turn its brightness up
        await p.evaluate(`card.shadowRoot.querySelector('.edbtn').click()`);
        await p.waitForTimeout(1500);
        const key = await p.evaluate(
          `(()=>{const g=card._lightGroups.find(g=>g.kind==='glow'&&g.members.some(m=>m.entity==='light.kitchen_downlights')); card._editor._select([g.keys[0]]); return g.keys[0]})()`,
        );
        await p.waitForTimeout(500);
        const before = await p.evaluate(`card._lightGroups.find(g=>g.keys.includes('${key}')).light.intensity`),
          u0 = await p.evaluate(`card._edit.undo.length`);
        await p.evaluate(`card.shadowRoot.querySelector('.insp .ltune summary').click()`);
        await p.waitForTimeout(200);
        await p.evaluate(`(()=>{const d=card.shadowRoot.querySelector('.insp .ltune'); const i=d.querySelector('[data-lt=intensity]'); i.value=2.5; i.dispatchEvent(new Event('input',{bubbles:true}));
        const r=d.querySelector('[data-lt=r]'); r.value=90; r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true}))})()`);
        await p.waitForTimeout(1500);
        const r = await p.evaluate(
          `[card._editor.item('${key}').intensity, card._editor.item('${key}').r, card._edit.undo.length, card._lightGroups.find(g=>g.keys.includes('${key}')).light.intensity, !!card.shadowRoot.querySelector('.insp .ltune[open]')]`,
        );
        if (!(r[0] === 2.5 && r[1] === 90 && r[2] === u0 + 1 && r[3] > before * 3 && r[4]))
          errors.push("light settings did not apply: " + JSON.stringify([before, ...r]));
      }
      if (process.argv.includes("--debug"))
        console.log(
          name,
          mode,
          await p.evaluate(
            `JSON.stringify((card._skyLights||[]).map(s=>[s.w,Math.round(s.light.intensity),s.light.position.toArray().map(Math.round),s.light.target.position.toArray().map(Math.round)]))`,
          ),
        );
      const file = path.join(OUT, `${MOBILE ? "mobile-" : ""}${name}-${mode}.png`);
      await p.screenshot({ path: file });
      if (mode === "day") {
        // close-up, where contact shading matters most
        await p.evaluate(
          `[...card.shadowRoot.querySelectorAll('.rooms button')].find(b=>b.textContent==='Kitchen').click()`,
        );
        await p.waitForTimeout(2500);
        await p.screenshot({ path: file.replace("-day", "-kitchen") });
      }
      console.log(
        `${errors.length ? "ERR " : "ok  "} ${path.relative(ROOT, file)}${errors.length ? "  " + errors.join(" | ") : ""}`,
      );
      await p.close();
    }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
