/* The standalone demo in site/ (a fictional home, fake hass, no Home Assistant).
 *   npm run demo                 serve it at http://localhost:8080 (needs `npm run build` first)
 *   node tools/demo.js --out D   copy the finished site into D (what the GitHub Pages workflow publishes)
 * The page expects the built card in ./card/ and the layout at ./sample-home.json; both come from this repo.
 */
const fs = require("fs"), path = require("path"), http = require("http");
const ROOT = path.join(__dirname, "..");
const FILES = {   // published path -> source
  "card/ha-3dhome.js": "dist/ha-3dhome.js",
  "card/ha-3dhome-editor.js": "dist/ha-3dhome-editor.js",
  "sample-home.json": "examples/sample-home.json",
};
for (const f of fs.readdirSync(path.join(ROOT, "site"))) FILES[f] = "site/" + f;
const out = process.argv.indexOf("--out");
if (out > 0) {
  const dir = path.resolve(process.argv[out + 1]);
  for (const [to, from] of Object.entries(FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, from), path.join(dir, to));
  }
  console.log(`demo site written to ${dir}`);
} else {
  const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
  const port = +process.env.PORT || 8080;
  http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const src = FILES[p];
    if (!src || !fs.existsSync(path.join(ROOT, src))) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
    fs.createReadStream(path.join(ROOT, src)).pipe(res);
  }).listen(port, () => console.log(`demo at http://localhost:${port}/`));
}
