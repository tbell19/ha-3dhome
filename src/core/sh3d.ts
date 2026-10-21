/* Sweet Home 3D libraries: catalog parsing, zip lookups and the per-device model cache.
 */
import type JSZip from "jszip";

/** parse a Java .properties file (the furniture catalog) into key → value */
export function parseProps(text: string) {
  const unesc = (s: string) =>
    s.replace(/\\(u([0-9a-fA-F]{4})|.)/g, (_m, a: string, u: string) =>
      u
        ? String.fromCharCode(parseInt(u, 16))
        : (({ t: "\t", n: "\n", r: "\r", f: "\f" } as Record<string, string>)[a] ?? a),
    );
  const out: Record<string, string> = {};
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
/** a file in a zip by path, forgiving URL-encoding and letter case */
export function zipFind(zip: JSZip, p: string | undefined) {
  if (!p) return null;
  const a = p.replace(/^\/+/, "");
  let f = zip.file(a);
  if (!f) {
    try {
      f = zip.file(decodeURIComponent(a));
    } catch {
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
export const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
/* ---------- small IndexedDB cache (per device) for extracted model files ---------- */
export const IDB = {
  _db: null as Promise<IDBDatabase> | null,
  db(): Promise<IDBDatabase> {
    return (this._db ||= new Promise((res, rej) => {
      const r = indexedDB.open("ha-3dhome", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("models");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async get(k: string): Promise<any> {
    try {
      const db = await this.db();
      return await new Promise<any>((res) => {
        const q = db.transaction("models").objectStore("models").get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => res(null);
      });
    } catch {
      return null;
    }
  },
  async put(k: string, v: unknown) {
    try {
      const db = await this.db();
      db.transaction("models", "readwrite").objectStore("models").put(v, k);
    } catch {
      /* cache is optional */
    }
  },
};
export const LIBCACHE = new Map<string, Promise<any>>(); // file -> Promise<{sh3fs, items}>
export const MODELCACHE = new Map<string, Promise<any>>(); // key  -> Promise<{node, size, center, min}>
