/* Bundles and minifies the two modules into the integration's frontend folder (what HACS and the releases ship):
 *   src/ha-3dhome.ts        -> ha-3dhome.js          (core: the panel and the 3D map; loads the editor on Edit)
 *   src/ha-3dhome-editor.ts -> ha-3dhome-editor.js   (everything behind ✎ Edit)
 *   lib/*.js                                          (what either loads when first needed: Three.js and its add-ons,
 *                                                      JSZip, js-yaml, the editor itself; see tools/bundle.js)
 *   npm run build
 * Every file also gets a gzipped copy next to it (<file>.gz), which Home Assistant sends to browsers that accept gzip,
 * so Three.js crosses the network at about a quarter of its size. The old lib/ files are removed first, and
 * lib/LICENSES.txt collects the bundled libraries' licences.
 * It also checks that the integration's manifest carries the same version as the card.
 */
const fs = require("fs"),
  path = require("path");
const { minify } = require("terser");
const zlib = require("zlib");
const { bundle, ENTRIES, LIB, OUT } = require("./bundle");

const ROOT = path.join(__dirname, "..");
/** the third-party packages bundled into the files, and their licence files */
const LICENCES = { three: "LICENSE", jszip: "LICENSE.markdown", "js-yaml": "LICENSE", preact: "LICENSE" };
const kb = (n) => (n / 1024).toFixed(1) + " KB";
(async () => {
  const version = require("../package.json").version,
    manifest = require("../custom_components/ha_3dhome/manifest.json").version;
  if (manifest !== version) throw new Error(`manifest.json says ${manifest} but package.json says ${version}`);
  fs.rmSync(path.join(ROOT, OUT, LIB), { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, OUT, LIB), { recursive: true });
  for (const f of Object.values(ENTRIES)) fs.rmSync(path.join(ROOT, OUT, f + ".gz"), { force: true });
  const code = bundle();
  const total = { min: 0, gz: 0 };
  const entries = Object.values(ENTRIES);
  const rank = (f) => (entries.includes(f) ? entries.indexOf(f) : entries.length);
  const files = Object.keys(code).sort((a, b) => rank(a) - rank(b) || code[b].length - code[a].length); // entries first, then the largest
  for (const f of files) {
    const res = await minify(code[f], {
      module: true,
      compress: { passes: 2 },
      mangle: true,
      format: { comments: false, ascii_only: true, max_line_len: 3000 },
    });
    const gz = zlib.gzipSync(res.code, { level: 9 });
    fs.writeFileSync(path.join(ROOT, OUT, f), res.code);
    fs.writeFileSync(path.join(ROOT, OUT, f + ".gz"), gz);
    const min = Buffer.byteLength(res.code);
    total.min += min;
    total.gz += gz.length;
    console.log(`${f.padEnd(36)} minified ${kb(min).padStart(9)}   gzipped ${kb(gz.length).padStart(8)}`);
  }
  // the bundled libraries' licences, which ask to travel with their code
  const licences = Object.entries(LICENCES).map(([pkg, file]) => {
    const { version } = require(`../node_modules/${pkg}/package.json`);
    return `${pkg}@${version}\n\n${fs.readFileSync(path.join(ROOT, "node_modules", pkg, file), "utf8").trim()}\n`;
  });
  fs.writeFileSync(path.join(ROOT, OUT, LIB, "LICENSES.txt"), licences.join("\n" + "-".repeat(78) + "\n\n"));
  console.log(
    `${"all files".padEnd(36)} minified ${kb(total.min).padStart(9)}   gzipped ${kb(total.gz).padStart(8)} -> ${OUT}/`,
  );
})();
