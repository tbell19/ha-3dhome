/* Saving: the edited layout goes to the map's layout store, which the panel hands it (the integration's storage).
 */
import type { CardConfig, Layout } from "../types";
import type { Editor } from "./editor";
import { LAYOUT_KEYS, stableJSON } from "./shared";

/** the layout part of a config; a key that is missing stays in as undefined, so saving removes it */
export function layoutOf(config: CardConfig): Layout {
  const out: Record<string, unknown> = {};
  for (const k of LAYOUT_KEYS) out[k] = config[k];
  return out as Layout;
}

export class EditorSave {
  async _save(this: Editor) {
    const card = this.card,
      btn = card._ed.querySelector<HTMLButtonElement>('[data-a="save"]');
    if (card._offSince)
      return card._toast("Not connected to Home Assistant. Your changes are kept: save again once it's back", 5000);
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      const store = card._layoutStore;
      const config = await store.save(layoutOf(card._work), card._config);
      card._edit.dirty = false;
      // remember the config about to come back from the integration, so it isn't seen as a change
      card._config = config;
      card._cfgJSON = stableJSON(config);
      card._toast(store.savedMessage);
      this._exitEdit(false);
    } catch (e: any) {
      console.error(e);
      card._toast("Save failed: " + (e.message || e.code || e), 5000);
      btn.disabled = false;
      this._syncBar();
    }
  }
}
