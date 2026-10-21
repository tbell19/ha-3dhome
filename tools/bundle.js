/* Bundles the two entry modules (src/ha-3dhome.ts and src/ha-3dhome-editor.ts) with everything they import, so each ships
 * as one JavaScript file: HACS registers only ha-3dhome.js, and the core loads the editor from next to it when Edit is
 * first pressed. esbuild strips the TypeScript types; `npm run typecheck` checks them.
 *
 *   bundle()            -> { core, editor }  readable bundles of src/, used by the tests
 *   bundle({ dist })    -> the same, read from the committed dist/ build
 */
const fs = require("fs"),
  path = require("path");
const esbuild = require("esbuild");

const ROOT = path.join(__dirname, "..");
const ENTRIES = { core: "ha-3dhome.js", editor: "ha-3dhome-editor.js" }; // the shipped files, built from src/<name>.ts

function bundle({ dist = false } = {}) {
  const out = {};
  for (const [key, file] of Object.entries(ENTRIES)) {
    if (dist) {
      out[key] = fs.readFileSync(path.join(ROOT, "dist", file), "utf8");
      continue;
    }
    const res = esbuild.buildSync({
      entryPoints: [path.join(ROOT, "src", file.replace(/\.js$/, ".ts"))],
      bundle: true,
      format: "esm",
      target: "es2022",
      write: false,
      legalComments: "none",
      logLevel: "warning",
    });
    out[key] = res.outputFiles[0].text;
  }
  return out;
}

module.exports = { bundle, ENTRIES };
