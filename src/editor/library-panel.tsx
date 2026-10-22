/* The Sweet Home 3D library browser: the list of libraries (downloading them through Home Assistant's Downloader
 * integration), then one library's models, searchable and by category. Picking a model places it mid-view.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Library, LibItem } from "../core/sh3d";
import type { Editor } from "./editor";
import { LIBS, LIB_DIR } from "./shared";

const MAX_MODELS = 180; // shown at once; the search narrows it down

/** Draws the library browser into `host`, or with `show` false unmounts it and removes the host. */
export function showLibrary(editor: Editor, host: HTMLElement, show = true) {
  render(show ? <LibraryPanel editor={editor} /> : null, host);
  if (!show) host.remove();
}

export function LibraryPanel({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState<string | null>(null); // the library being browsed (its file)
  return open ? (
    <LibraryModels editor={editor} file={open} onBack={() => setOpen(null)} />
  ) : (
    <LibraryList editor={editor} onOpen={setOpen} />
  );
}

function Header({ editor, title, onBack }: { editor: Editor; title: string; onBack?: () => void }) {
  return (
    <header>
      {onBack && (
        <button data-back onClick={onBack}>
          <ha-icon icon="mdi:chevron-left" />
          Libraries
        </button>
      )}
      <span class="ttl">{title}</span>
      <button title="Close" onClick={() => editor.closeLibrary()}>
        <ha-icon icon="mdi:close" />
      </button>
    </header>
  );
}

function LibraryList({ editor, onOpen }: { editor: Editor; onOpen: (file: string) => void }) {
  return (
    <>
      <Header editor={editor} title="Sweet Home 3D model libraries" />
      <div class="body">
        <div class="note">
          Libraries are downloaded once into <code>/config/www/sh3d/</code> by Home Assistant's Downloader integration,
          then opened here. Pick the ones you want — big libraries take a minute to download. Each device caches the
          models it has displayed.
        </div>
        <div class="libs">
          {LIBS.map((lib) => (
            <LibraryRow key={lib.file} editor={editor} lib={lib} onOpen={() => onOpen(lib.file)} />
          ))}
        </div>
        <div class="note">
          Models © their authors — see sweethome3d.com/free-3d-models for credits. CC-BY models need attribution if
          you share renders.
        </div>
      </div>
    </>
  );
}

/** One library: whether it is on the server yet, and the button to download or open it. */
function LibraryRow({ editor, lib, onOpen }: { editor: Editor; lib: (typeof LIBS)[number]; onOpen: () => void }) {
  // "checking", "missing", "ready", "downloading", or what went wrong
  const [status, setStatus] = useState("checking");

  const check = async () => {
    const ok = await fetch(LIB_DIR + encodeURIComponent(lib.file), { method: "HEAD", cache: "no-store" })
      .then((r) => r.ok)
      .catch(() => false); // offline
    setStatus(ok ? "ready" : "missing");
  };
  const download = async (running = editor.downloadLibrary(lib.file)) => {
    setStatus("downloading");
    const problem = await running;
    if (problem) setStatus(problem);
    else check();
  };
  useEffect(() => {
    const running = editor._downloads?.[lib.file]; // started before the panel was last closed
    if (running) download(running);
    else check();
  }, []);

  const label = { checking: "…", downloading: "…", ready: "Open", missing: "Download" }[status] ?? "Retry";
  const shown = { checking: "checking…", downloading: "downloading…", ready: "downloaded", missing: "" }[status] ?? status;
  return (
    <div class="librow" data-f={lib.file}>
      <div>
        <b>{lib.title}</b>
        <div class="meta">
          {lib.n} models · {lib.size} · {lib.lic}
        </div>
      </div>
      <span class="st meta">{shown}</span>
      <button class={status === "ready" ? "act primary" : "act"} disabled={status === "checking" || status === "downloading"}
        onClick={() => (status === "ready" ? onOpen() : download())}>
        {label}
      </button>
    </div>
  );
}

function LibraryModels({ editor, file, onBack }: { editor: Editor; file: string; onBack: () => void }) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  useEffect(() => {
    editor.card._openLib(file).then(setLibrary, (e) => setProblem(e.message || String(e)));
  }, [file]);

  const title = LIBS.find((l) => l.file === file)?.title || file;
  let body;
  if (problem)
    body = (
      <div class="note">
        Couldn't open this library: {problem}. If it was still downloading, wait and try again; otherwise
        re-download it.
      </div>
    );
  else if (!library) body = <div class="note">Opening library…</div>;
  else {
    const words = search.trim().toLowerCase();
    const categories = [...new Set(library.items.map((i) => i.cat))].sort();
    const models = library.items
      .filter((i) => !category || i.cat === category)
      .filter((i) => !words || i.name.toLowerCase().includes(words) || i.cat.toLowerCase().includes(words))
      .slice(0, MAX_MODELS);
    body = (
      <>
        <div class="tools">
          <input type="search" placeholder={`Search ${library.items.length} models…`} value={search}
            onInput={(ev) => setSearch(ev.currentTarget.value)} />
          <select value={category} onChange={(ev) => setCategory(ev.currentTarget.value)}>
            <option value="">All categories</option>
            {categories.map((c) => (
              <option>{c}</option>
            ))}
          </select>
        </div>
        <div class="items">
          {models.map((model) => (
            <Model key={model.sh3f + model.model} editor={editor} library={library} model={model} />
          ))}
        </div>
      </>
    );
  }
  return (
    <>
      <Header editor={editor} title={title} onBack={onBack} />
      <div class="body">{body}</div>
    </>
  );
}

function Model({ editor, library, model }: { editor: Editor; library: Library; model: LibItem }) {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => {
    editor.libraryIcon(library, model).then(setIcon);
  }, [model]);
  return (
    <div class="it" title={`${model.name} · ${model.creator}`} onClick={() => editor._placeModel(model)}>
      <img alt="" src={icon ?? undefined} />
      <div class="n">{model.name}</div>
      <div class="meta" style="opacity:.6">
        {Math.round(model.w)}×{Math.round(model.d)}×{Math.round(model.h)} cm
      </div>
    </div>
  );
}
