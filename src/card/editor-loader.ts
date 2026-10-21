/* The editor module (ha-3dhome-editor.js) loads only when someone presses Edit, so people who only view the map never
 * download it. The entry module tells this file where the editor lives (next to itself, with the same ?v=), and the
 * editor module, once it runs, hands its factory back through provideEditor (published on window.__ha3dhome).
 */
import type { EditorModule } from "../editor-contract";
import { VERSION3D } from "../core/constants";

let editorUrl: string | null = null;
let loading: Promise<EditorModule> | null = null;
let provided: EditorModule | null = null;

export function setEditorUrl(url: string) {
  editorUrl = url;
}

/** called by the editor module when it has loaded (it may be registered as its own resource, so it can come first) */
export function provideEditor(mod: EditorModule) {
  if (mod.version !== VERSION3D)
    throw new Error(`3D Home editor ${mod.version} doesn't match the card ${VERSION3D}: refresh, or update both files`);
  provided = mod;
  window.dispatchEvent(new Event("ha-3dhome-editor-ready"));
}

/** the editor is here already (inlined, or registered as its own resource) or can be fetched */
export const editorAvailable = () => !!provided || !!editorUrl;

/** the editor module, loaded once; a failed load (offline, say) can be retried */
export function loadEditor(): Promise<EditorModule> {
  if (provided) return Promise.resolve(provided);
  if (!editorUrl) return Promise.reject(new Error("The editor isn't installed next to the card"));
  return (loading ||= import(/* @vite-ignore */ editorUrl).then(
    () => {
      if (!provided) throw new Error("The editor loaded but didn't register");
      return provided;
    },
    (e) => {
      loading = null;
      throw e;
    },
  ));
}
