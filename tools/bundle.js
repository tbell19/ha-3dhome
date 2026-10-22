/* Bundles the two entry modules (src/ha-3dhome.ts and src/ha-3dhome-editor.ts) with everything they import, Three.js and
 * the other third-party modules included, so the map needs nothing from the internet. HACS registers only ha-3dhome.js,
 * and the core loads the editor from next to it when Edit is first pressed. Every dynamic import() (Three.js, its add-ons,
 * JSZip, js-yaml, the editor's own modules) becomes its own file under lib/, named by a hash of its content, so it loads
 * only when needed and a new version never meets a stale cached copy. esbuild strips the TypeScript types;
 * `npm run typecheck` checks them.
 *
 *   bundle()            -> { "ha-3dhome.js": code, "ha-3dhome-editor.js": code, "lib/three.module-XXXX.js": code, ... }
 *                          readable bundles of src/, used by the tests
 *   bundle({ dist })    -> the same, read from the committed build (custom_components/ha_3dhome/frontend/)
 */
const fs = require("fs"),
  path = require("path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const ENTRIES = { core: "ha-3dhome.js", editor: "ha-3dhome-editor.js" }; // the entry files, built from src/<name>.ts
const LIB = "lib"; // the lazily loaded files, next to the entries
const OUT = "custom_components/ha_3dhome/frontend"; // where the build goes: the integration serves the files from there

/** the built files in `dir`, by their path relative to it (without the pre-compressed .gz copies) */
function readDir(dir, sub = "") {
  const out = {};
  for (const f of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
    const rel = sub ? sub + "/" + f.name : f.name;
    if (f.isDirectory()) Object.assign(out, readDir(dir, rel));
    else if (f.name.endsWith(".js")) out[rel] = fs.readFileSync(path.join(dir, rel), "utf8");
  }
  return out;
}

function bundle({ dist = false } = {}) {
  if (dist) return readDir(path.join(ROOT, OUT));
  const res = esbuild.buildSync({
    entryPoints: Object.values(ENTRIES).map((f) => path.join(ROOT, "src", f.replace(/\.js$/, ".ts"))),
    bundle: true,
    splitting: true,
    format: "esm",
    target: "es2022",
    outdir: path.join(ROOT, OUT),
    entryNames: "[name]",
    chunkNames: LIB + "/[name]-[hash]",
    write: false,
    legalComments: "none",
    logLevel: "warning",
  });
  const out = {};
  for (const f of res.outputFiles) out[path.relative(path.join(ROOT, OUT), f.path).split(path.sep).join("/")] = f.text;
  return out;
}

module.exports = { bundle, ENTRIES, LIB, OUT };
