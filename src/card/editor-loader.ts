/* The editor module (dist/ha-3dhome-editor.js) loads only when someone presses Edit, so people who only view the map
 * never download it. The entry module tells this file where the editor lives (next to itself, with the same ?v=).
 */
let editorUrl: string | null = null;
let loading: Promise<void> | null = null;

const loaded = () => !!(customElements.get("ha-3dhome-card")?.prototype as { _enterEdit?: unknown })?._enterEdit;

export function setEditorUrl(url: string) {
  editorUrl = url;
}

/** the editor is here already (inlined, or registered as its own resource) or can be fetched */
export const editorAvailable = () => loaded() || !!editorUrl;

/** load the editor once; a failed load (offline, say) can be retried */
export function loadEditor(): Promise<void> {
  if (loaded()) return Promise.resolve();
  if (!editorUrl) return Promise.reject(new Error("The editor isn't installed next to the card"));
  return (loading ||= import(/* @vite-ignore */ editorUrl).then(
    () => {},
    (e) => {
      loading = null;
      throw e;
    },
  ));
}
