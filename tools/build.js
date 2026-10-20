/* Minifies the two modules into dist/ (what HACS and the releases ship):
 *   src/ha-3dhome.js        -> dist/ha-3dhome.js          (core: viewer, strategy, plan rendering; loads the editor)
 *   src/ha-3dhome-editor.js -> dist/ha-3dhome-editor.js   (everything behind ✎ Edit)
 *   npm run build
 */
const fs = require("fs"), path = require("path");
const { minify } = require("terser");
const ROOT = path.join(__dirname, "..");
const kb = (n) => (n / 1024).toFixed(1) + " KB";
(async () => {
  fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
  for (const f of ["ha-3dhome.js", "ha-3dhome-editor.js"]) {
    const code = fs.readFileSync(path.join(ROOT, "src", f), "utf8");
    const res = await minify(code, { module: true, compress: { passes: 2 }, mangle: true, format: { comments: false, ascii_only: true, max_line_len: 3000 } });
    fs.writeFileSync(path.join(ROOT, "dist", f), res.code);
    console.log(`${f.padEnd(20)} source ${kb(Buffer.byteLength(code)).padStart(9)}   minified ${kb(Buffer.byteLength(res.code)).padStart(9)} -> dist/${f}`);
  }
})();
