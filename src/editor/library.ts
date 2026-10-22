/* The Sweet Home 3D library browser's logic: opening and closing it, downloading a library through Home Assistant's
 * Downloader integration, model icons, and placing a model. The browser itself is drawn by library-panel.tsx.
 */
import type { Library, LibItem } from "../core/sh3d";
import type { Editor } from "./editor";
import { showLibrary } from "./library-panel";
import { R1, SF, zipFind } from "./shared";

/** each model's icon as an object URL (null when the library has none), made once */
const ICONS = new WeakMap<LibItem, Promise<string | null>>();

export class EditorLibrary {
  _openLibrary(this: Editor) {
    this.closeLibrary();
    const host = document.createElement("div");
    host.className = "lib";
    this.card._ed.append(host);
    showLibrary(this, host);
  }

  closeLibrary(this: Editor) {
    const host = this.card._ed?.querySelector<HTMLElement>(":scope > .lib");
    if (host) showLibrary(this, host, false);
  }

  /** Downloads a library into /config/www/sh3d/. Resolves to what went wrong, or null once it is there. */
  downloadLibrary(this: Editor, file: string): Promise<string | null> {
    this._downloads ||= {};
    return (this._downloads[file] ||= this._download(file).finally(() => delete this._downloads[file]));
  }

  async _download(this: Editor, file: string): Promise<string | null> {
    const hass = this.card._hass;
    if (!hass.services?.downloader?.download_file) return "Downloader integration isn't set up";
    const isThisFile = (ev: { data?: { filename?: string; url?: string } }) =>
      String(ev.data?.filename || ev.data?.url || "").includes(file);
    let finish: (problem: string | null) => void = () => {};
    const finished = new Promise<string | null>((resolve) => (finish = resolve));
    const unsubscribes = [
      hass.connection.subscribeEvents((ev) => isThisFile(ev) && finish(null), "downloader_download_completed"),
      hass.connection.subscribeEvents(
        (ev) => isThisFile(ev) && finish("download failed — check the HA log"),
        "downloader_download_failed",
      ),
    ];
    try {
      await hass.callService("downloader", "download_file", {
        url: SF + file,
        subdir: "sh3d",
        filename: file,
        overwrite: true,
      });
    } catch (e: any) {
      finish("couldn't start: " + (e.message || e));
    }
    const problem = await finished;
    for (const unsubscribe of unsubscribes) (await unsubscribe)?.();
    return problem;
  }

  /** A model's icon from its library, as an object URL (null when it has none). */
  libraryIcon(this: Editor, library: Library, model: LibItem): Promise<string | null> {
    let icon = ICONS.get(model);
    if (!icon) {
      const sh3f = library.sh3fs.find((s) => s.name === model.sh3f) || library.sh3fs[0];
      const file = zipFind(sh3f.zip, model.icon);
      icon = file ? file.async("blob").then((blob) => URL.createObjectURL(blob)) : Promise.resolve(null);
      ICONS.set(model, icon);
    }
    return icon;
  }

  /** Places a library model in the middle of the view, at its real size. */
  _placeModel(this: Editor, model: LibItem) {
    this.closeLibrary();
    const [cmPerUnit, cmPerHeight] = this.card._modelScale(),
      [x, y] = this._target();
    this._mutate(() => [
      this._push("o", {
        type: "model",
        name: model.name,
        lib: model.lib,
        sh3f: model.sh3f,
        model: model.model,
        mr: model.mr || undefined,
        creator: model.creator || undefined,
        lic: model.lic,
        x,
        y,
        z: R1(model.elev / cmPerHeight),
        w: R1(model.w / cmPerUnit),
        d: R1(model.d / cmPerUnit),
        h: R1(model.h / cmPerHeight),
        cm: [model.w, model.d, model.h],
      }),
    ]);
    this.card._toast(`Placed ${model.name} at the centre of the view — drag it into place`);
  }
}
