/* Sweet Home 3D libraries: catalog parsing, zip lookups and the per-device model cache.
 */

export function parseProps(text) {
  const unesc = (s) =>
    s.replace(/\\(u([0-9a-fA-F]{4})|.)/g, (m, a, u) =>
      u ? String.fromCharCode(parseInt(u, 16)) : ({ t: "\t", n: "\n", r: "\r", f: "\f" }[a] ?? a),
    );
  const out = {};
  let buf = "";
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/^\s+/, "");
    if (!buf && (!line || line[0] === "#" || line[0] === "!")) continue;
    const tail = line.match(/\\+$/);
    if (tail && tail[0].length % 2 === 1) {
      buf += line.slice(0, -1);
      continue;
    }
    line = buf + line;
    buf = "";
    let i = 0,
      key = "";
    for (; i < line.length; i++) {
      const ch = line[i];
      if (ch === "\\") {
        key += ch + (line[i + 1] || "");
        i++;
        continue;
      }
      if (ch === "=" || ch === ":" || ch === " " || ch === "\t") break;
      key += ch;
    }
    out[unesc(key)] = unesc(line.slice(i).replace(/^\s*[=:]?\s*/, ""));
  }
  return out;
}
export function zipFind(zip, p) {
  if (!p) return null;
  const a = p.replace(/^\/+/, "");
  let f = zip.file(a);
  if (!f) {
    try {
      f = zip.file(decodeURIComponent(a));
    } catch (e) {
      /* ignore */
    }
  }
  if (!f) {
    const low = a.toLowerCase();
    const n = Object.keys(zip.files).find((n) => n.toLowerCase() === low);
    if (n) f = zip.file(n);
  }
  return f;
}
export const dirOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
export const IDB = {
  db() {
    return (this._db ||= new Promise((res, rej) => {
      const r = indexedDB.open("ha-3dhome", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("models");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async get(k) {
    try {
      const db = await this.db();
      return await new Promise((res) => {
        const q = db.transaction("models").objectStore("models").get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => res(null);
      });
    } catch (e) {
      return null;
    }
  },
  async put(k, v) {
    try {
      const db = await this.db();
      db.transaction("models", "readwrite").objectStore("models").put(v, k);
    } catch (e) {
      /* cache is optional */
    }
  },
};
export const LIBCACHE = new Map(); // file -> Promise<{sh3fs, items}>
export const MODELCACHE = new Map(); // key  -> Promise<{node, size, center, min}>
