/* A preview copy of the integration that installs next to the released 3D Home: the same code under other names, so
 * both run in one Home Assistant without meeting.
 *
 *   npm run build && npm run build:preview   ->  preview/custom_components/ha_3dhome_scan/
 *
 * Renamed: the domain and everything keyed by it (ha_3dhome → ha_3dhome_scan: storage, websocket commands, the
 * /api/ha_3dhome_scan/ endpoints, the files folder), the frontend's URL and files (/ha_3dhome_scan/ha-3dhome-scan.js),
 * its custom elements and events (ha-3dhome-* → ha-3dhome-scan-*) and its page global (__ha3dhome → __ha3dhome_scan).
 * The sidebar entry defaults to "3D Home (scan preview)" at /3d-home-scan. Install it by copying the folder into
 * /config/custom_components/, restart, then add "3D Home (scan preview)" under Settings → Devices & services.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "custom_components", "ha_3dhome");
const OUT = path.join(ROOT, "preview", "custom_components", "ha_3dhome_scan");

/** every name the integration and the frontend share, renamed in one pass */
const REPO = "tbell19/ha-3dhome"; // the GitHub repository keeps its name (the scan builder app comes from it)
const rename = (text) =>
  text
    .split(REPO)
    .map((part) =>
      part
        .replace(/__ha3dhome/g, "__ha3dhome_scan")
        .replace(/ha_3dhome/g, "ha_3dhome_scan")
        .replace(/ha-3dhome/g, "ha-3dhome-scan"),
    )
    .join(REPO);

/** what the preview shows in the sidebar and the integrations list */
const label = (file, text) => {
  if (file === "const.py")
    return text
      .replace('DEFAULT_TITLE: Final = "3D Home"', 'DEFAULT_TITLE: Final = "3D Home (scan preview)"')
      .replace('DEFAULT_ICON: Final = "mdi:floor-plan"', 'DEFAULT_ICON: Final = "mdi:cube-scan"')
      .replace('DEFAULT_URL_PATH: Final = "3d-home"', 'DEFAULT_URL_PATH: Final = "3d-home-scan"');
  if (file === "manifest.json") return text.replace('"name": "3D Home"', '"name": "3D Home (scan preview)"');
  return text;
};

const TEXT = /(\.(py|json|js|txt)|^Dockerfile)$/;
fs.rmSync(path.join(ROOT, "preview"), { recursive: true, force: true });
let files = 0;
(function copy(dir, rel = "") {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === "__pycache__" || f.name.endsWith(".gz")) continue; // .gz copies are made again from the renamed files
    const from = path.join(dir, f.name);
    const to = path.join(OUT, rename(rel), rename(f.name));
    if (f.isDirectory()) {
      copy(from, path.join(rel, f.name));
      continue;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (!TEXT.test(f.name)) {
      fs.copyFileSync(from, to);
      continue;
    }
    const text = label(f.name, rename(fs.readFileSync(from, "utf8")));
    fs.writeFileSync(to, text);
    if (f.name.endsWith(".js")) fs.writeFileSync(to + ".gz", zlib.gzipSync(text, { level: 9 }));
    files++;
  }
})(SRC);

// a sanity check: nothing of the released integration's names is left
const left = [];
(function scan(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) scan(p);
    else if (
      TEXT.test(f.name) &&
      /(ha_3dhome|ha-3dhome|__ha3dhome)(?!_scan|-scan)/.test(fs.readFileSync(p, "utf8").split(REPO).join(""))
    )
      left.push(p);
  }
})(OUT);
if (left.length) throw new Error("names left unrenamed in " + left.join(", "));
console.log(`${files} files -> ${path.relative(ROOT, OUT)}/`);
