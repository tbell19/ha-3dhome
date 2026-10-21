/* Bundles the two entry modules (src/ha-3dhome.js and src/ha-3dhome-editor.js) with everything they import, so each ships
 * as one file: HACS registers only ha-3dhome.js, and the core loads the editor from next to it.
 *
 *   bundle()            -> { core, editor }  readable bundles of src/, used by the tests
 *   bundle({ dist })    -> the same, read from the committed dist/ build
 */
const fs = require("fs"), path = require("path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const ENTRIES = { core: "ha-3dhome.js", editor: "ha-3dhome-editor.js" };

function bundle({ dist = false } = {}) {
  const out = {};
  for (const [key, file] of Object.entries(ENTRIES)) {
    if (dist) { out[key] = fs.readFileSync(path.join(ROOT, "dist", file), "utf8"); continue; }
    const res = esbuild.buildSync({
      entryPoints: [path.join(ROOT, "src", file)], bundle: true, format: "esm", target: "es2022",
      write: false, legalComments: "none", logLevel: "warning",
    });
    out[key] = res.outputFiles[0].text;
  }
  return out;
}

module.exports = { bundle, ENTRIES };
