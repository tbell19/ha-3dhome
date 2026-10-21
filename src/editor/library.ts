/* The Sweet Home 3D library browser: downloading libraries and placing models.
 */
import type { GenericItem } from "../core/items";
import type { Home3DCard } from "../card/card";
import { LIBS, LIB_DIR, R1, SF, esc, ic, zipFind } from "./shared";
import type { Library } from "../core/sh3d";

export class EditorLibrary {
  /* ----- model library ----- */
  _openLibrary(this: Home3DCard) {
    this._ed.querySelector<HTMLElement>(".lib")?.remove();
    const lib = document.createElement("div");
    lib.className = "lib";
    this._ed.append(lib);
    this._libEl = lib;
    this._libHome();
  }

  _libHome(this: Home3DCard) {
    const lib = this._libEl;
    lib.innerHTML = `<header><span class="ttl">Sweet Home 3D model libraries</span><button data-x title="Close">${ic("close")}</button></header>
      <div class="body"><div class="note">Libraries are downloaded once into <code>/config/www/sh3d/</code> by Home Assistant's Downloader integration,
        then opened here. Pick the ones you want — big libraries take a minute to download. Each device caches the models it has displayed.</div>
        <div class="libs">${LIBS.map(
          (l) => `<div class="librow" data-f="${l.file}"><div><b>${esc(l.title)}</b>
          <div class="meta">${l.n} models · ${l.size} · ${esc(l.lic)}</div></div><span class="st meta">checking…</span><button class="act" disabled>…</button></div>`,
        ).join("")}</div>
        <div class="note">Models © their authors — see sweethome3d.com/free-3d-models for credits. CC-BY models need attribution if you share renders.</div></div>`;
    lib.querySelector<HTMLElement>("[data-x]").addEventListener("click", () => lib.remove());
    for (const row of lib.querySelectorAll<HTMLElement>(".librow")) this._libRow(row);
  }

  async _libRow(this: Home3DCard, row: HTMLElement, wait?: boolean) {
    const file = row.dataset.f,
      st = row.querySelector<HTMLElement>(".st"),
      btn = row.querySelector<HTMLButtonElement>(".act");
    let ok = false;
    try {
      ok = (await fetch(LIB_DIR + encodeURIComponent(file), { method: "HEAD", cache: "no-store" })).ok;
    } catch (e: any) {
      /* offline */
    }
    if (this._dl?.[file] && !wait) {
      st.textContent = "downloading…";
      btn.disabled = true;
      btn.textContent = "…";
      return;
    }
    st.textContent = ok ? "downloaded" : "";
    btn.disabled = false;
    btn.className = "act" + (ok ? " primary" : "");
    btn.textContent = ok ? "Open" : "Download";
    btn.onclick = () => (ok ? this._libBrowse(file) : this._download(file, row));
  }

  async _download(this: Home3DCard, file: string, row: HTMLElement) {
    const h = this._hass,
      st = row.querySelector<HTMLElement>(".st"),
      btn = row.querySelector<HTMLButtonElement>(".act");
    if (!h.services?.downloader?.download_file) {
      st.textContent = "Downloader integration isn't set up";
      return;
    }
    btn.disabled = true;
    st.textContent = "downloading…";
    (this._dl ||= {})[file] = true;
    const done = async (ok: boolean, msg?: string) => {
      if (!this._dl?.[file]) return;
      delete this._dl[file];
      for (const u of unsubs) (await u)?.();
      st.textContent = ok ? "downloaded" : msg || "download failed";
      if (ok && row.isConnected) this._libRow(row, true);
      else {
        btn.disabled = false;
        btn.textContent = "Retry";
      }
    };
    const evMatch = (ev: { data?: { filename?: string; url?: string } }) => {
      const d = ev.data || {};
      return String(d.filename || d.url || "").includes(file);
    };
    const unsubs = [
      h.connection.subscribeEvents((ev) => evMatch(ev) && done(true), "downloader_download_completed"),
      h.connection.subscribeEvents(
        (ev) => evMatch(ev) && done(false, "download failed — check the HA log"),
        "downloader_download_failed",
      ),
    ];
    try {
      await h.callService("downloader", "download_file", {
        url: SF + file,
        subdir: "sh3d",
        filename: file,
        overwrite: true,
      });
    } catch (e: any) {
      done(false, "couldn't start: " + (e.message || e));
    }
  }

  async _libBrowse(this: Home3DCard, file: string) {
    const lib = this._libEl,
      meta = LIBS.find((l) => l.file === file);
    lib.innerHTML = `<header><button data-back>${ic("chevron-left")}Libraries</button><span class="ttl">${esc(meta?.title || file)}</span><button data-x title="Close">${ic("close")}</button></header>
      <div class="body"><div class="note">Opening library…</div></div>`;
    lib.querySelector<HTMLElement>("[data-x]").addEventListener("click", () => lib.remove());
    lib.querySelector<HTMLElement>("[data-back]").addEventListener("click", () => this._libHome());
    let data;
    try {
      data = await this._openLib(file);
    } catch (e: any) {
      lib.querySelector<HTMLElement>(".body").innerHTML =
        `<div class="note">Couldn't open this library: ${esc(e.message || e)}. If it was still downloading, wait and try again; otherwise re-download it.</div>`;
      return;
    }
    const cats = [...new Set(data.items.map((i) => i.cat))].sort();
    const body = lib.querySelector<HTMLElement>(".body");
    body.innerHTML = `<div class="tools"><input type="search" placeholder="Search ${data.items.length} models…"><select><option value="">All categories</option>
      ${cats.map((c) => `<option>${esc(c)}</option>`).join("")}</select></div><div class="items"></div>`;
    const q = body.querySelector<HTMLInputElement>("input"),
      sel = body.querySelector<HTMLSelectElement>("select"),
      grid = body.querySelector<HTMLElement>(".items");
    const render = () => {
      const s = q.value.trim().toLowerCase(),
        c = sel.value;
      const list = data.items
        .filter(
          (i) => (!c || i.cat === c) && (!s || i.name.toLowerCase().includes(s) || i.cat.toLowerCase().includes(s)),
        )
        .slice(0, 180);
      grid.innerHTML = list
        .map(
          (
            it,
            n,
          ) => `<div class="it" data-n="${n}" title="${esc(it.name)} · ${esc(it.creator)}"><img alt=""><div class="n">${esc(it.name)}</div>
        <div class="meta" style="opacity:.6">${Math.round(it.w)}×${Math.round(it.d)}×${Math.round(it.h)} cm</div></div>`,
        )
        .join("");
      grid.querySelectorAll<HTMLElement>(".it").forEach((el) => {
        const it = list[+el.dataset.n];
        el.addEventListener("click", () => this._placeModel(it));
        this._icon(data, it).then((u) => {
          if (u) el.querySelector<HTMLImageElement>("img").src = u;
        });
      });
    };
    q.addEventListener("input", render);
    sel.addEventListener("change", render);
    render();
  }

  async _icon(this: Home3DCard, data: Library, it: GenericItem) {
    if (it._url !== undefined) return it._url;
    const s = data.sh3fs.find((x) => x.name === it.sh3f) || data.sh3fs[0];
    const f = zipFind(s.zip, it.icon);
    it._url = f ? URL.createObjectURL(await f.async("blob")) : null;
    return it._url;
  }

  _placeModel(this: Home3DCard, it: GenericItem) {
    this._libEl?.remove();
    const [sxy, sz] = this._modelScale(),
      [x, y] = this._target();
    this._mutate(() => [
      this._push("o", {
        type: "model",
        name: it.name,
        lib: it.lib,
        sh3f: it.sh3f,
        model: it.model,
        mr: it.mr || undefined,
        creator: it.creator || undefined,
        lic: it.lic,
        x,
        y,
        z: R1(it.elev / sz),
        w: R1(it.w / sxy),
        d: R1(it.d / sxy),
        h: R1(it.h / sz),
        cm: [it.w, it.d, it.h],
      }),
    ]);
    this._toast(`Placed ${it.name} at the centre of the view — drag it into place`);
  }
}
