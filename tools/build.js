/* Bundles and minifies the two modules into dist/ (what HACS and the releases ship):
 *   src/ha-3dhome.ts        -> dist/ha-3dhome.js          (core: viewer, strategy, plan rendering; loads the editor on Edit)
 *   src/ha-3dhome-editor.ts -> dist/ha-3dhome-editor.js   (everything behind ✎ Edit)
 *   npm run build
 */
const fs = require("fs"),
  path = require("path");
const { minify } = require("terser");
const { bundle, ENTRIES } = require("./bundle");

const ROOT = path.join(__dirname, "..");
const kb = (n) => (n / 1024).toFixed(1) + " KB";
(async () => {
  fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
  const code = bundle();
  for (const [key, f] of Object.entries(ENTRIES)) {
    const res = await minify(code[key], {
      module: true,
      compress: { passes: 2 },
      mangle: true,
      format: { comments: false, ascii_only: true, max_line_len: 3000 },
    });
    fs.writeFileSync(path.join(ROOT, "dist", f), res.code);
    console.log(
      `${f.padEnd(20)} bundled ${kb(Buffer.byteLength(code[key])).padStart(9)}   minified ${kb(Buffer.byteLength(res.code)).padStart(9)} -> dist/${f}`,
    );
  }
})();
