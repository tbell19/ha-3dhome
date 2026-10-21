/* Bundles and minifies the two modules into the integration's frontend folder (what HACS and the releases ship):
 *   src/ha-3dhome.ts        -> ha-3dhome.js          (core: viewer, panel, strategy, plan rendering; loads the editor on Edit)
 *   src/ha-3dhome-editor.ts -> ha-3dhome-editor.js   (everything behind ✎ Edit)
 *   npm run build
 * It also checks that the integration's manifest carries the same version as the card.
 */
const fs = require("fs"),
  path = require("path");
const { minify } = require("terser");
const { bundle, ENTRIES, OUT } = require("./bundle");

const ROOT = path.join(__dirname, "..");
const kb = (n) => (n / 1024).toFixed(1) + " KB";
(async () => {
  const version = require("../package.json").version,
    manifest = require("../custom_components/ha_3dhome/manifest.json").version;
  if (manifest !== version) throw new Error(`manifest.json says ${manifest} but package.json says ${version}`);
  fs.mkdirSync(path.join(ROOT, OUT), { recursive: true });
  const code = bundle();
  for (const [key, f] of Object.entries(ENTRIES)) {
    const res = await minify(code[key], {
      module: true,
      compress: { passes: 2 },
      mangle: true,
      format: { comments: false, ascii_only: true, max_line_len: 3000 },
    });
    fs.writeFileSync(path.join(ROOT, OUT, f), res.code);
    console.log(
      `${f.padEnd(20)} bundled ${kb(Buffer.byteLength(code[key])).padStart(9)}   minified ${kb(Buffer.byteLength(res.code)).padStart(9)} -> ${OUT}/${f}`,
    );
  }
})();
