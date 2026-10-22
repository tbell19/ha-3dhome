/* <ha-3dhome-panel>: the 3D Home page in Home Assistant's sidebar, added by the ha_3dhome integration
 * (custom_components/ha_3dhome).
 *
 * The panel shows one <ha-3dhome-map> filling the page. Its config lives in the integration's storage. The panel
 * follows it over the websocket (ha_3dhome/config/subscribe), so a save on one device shows up on every other one, and
 * hands the map a LayoutStore so Save writes there (ha_3dhome/config/save). A save keeps the map's WebGL scene and only
 * rebuilds what it shows.
 */
import type { CardConfig, Hass, LayoutStore } from "../types";
import { esc } from "../core/util";
import { dashboardsWithHome, type DashboardWithHome } from "../core/lovelace";
import { panelStyles } from "./styles";

/** What Home Assistant passes in `panel` (the integration sets `config`). */
interface PanelInfo {
  url_path: string;
  config: { entry_id: string };
}

/** What the integration sends on every save: the card config and its revision. */
interface Saved {
  config: CardConfig;
  rev: number;
}

/** What the panel uses of its <ha-3dhome-map>. */
interface MapCard extends HTMLElement {
  hass: Hass;
  layoutStore: LayoutStore | null;
  setConfig(config: CardConfig): void;
  readonly _edit: object | null; // set while someone is editing
}

/** A page's card and what it shows. It outlives the panel element, so if Home Assistant makes a new element for the
 * same page, the map moves over with its scene instead of starting again. */
interface PageView {
  card: MapCard;
  rev: number; // the revision the card shows (-1: nothing yet)
  waiting: Saved | null; // a save from elsewhere that arrived while someone was editing here
}
const VIEWS = new Map<string, PageView>(); // by config entry id

/** the parts of a card config the panel decides itself, so they aren't stored */
const PANEL_OWNED = ["type", "fill", "aspect_ratio", "dashboard", "card_id"] as const; // all but `type` were card options before v6

export class Home3DPanel extends HTMLElement {
  private _hass: Hass | null = null;
  private _panel: PanelInfo | null = null;
  private _view: PageView | null = null;
  private _menu: (HTMLElement & { hass?: Hass; narrow?: boolean }) | null = null;
  private _unsub: Promise<() => Promise<void>> | null = null;
  private _imports: Promise<DashboardWithHome[]> | null = null;

  set hass(hass: Hass) {
    this._hass = hass;
    if (this._view) this._view.card.hass = hass;
    if (this._menu) this._menu.hass = hass;
    this._start();
  }

  set panel(panel: PanelInfo) {
    if (this._panel && this._panel.config.entry_id !== panel.config.entry_id) this._stop();
    this._panel = panel;
    this._start();
  }

  /** narrow: Home Assistant hides the sidebar, so the panel shows the button that opens it */
  set narrow(narrow: boolean) {
    this.toggleAttribute("narrow", narrow);
    if (this._menu) this._menu.narrow = narrow;
  }

  connectedCallback() {
    this._start();
  }

  disconnectedCallback() {
    this._stop(); // the card parks itself, and tears down if the page doesn't come back within 30 s
  }

  /** once connected with hass and the panel info: show the page's card and follow its config */
  private _start() {
    if (!this._hass || !this._panel || !this.isConnected) return;
    if (!this.shadowRoot) this._render();
    if (!this._view) this._attach(this._panel.config.entry_id);
    this._follow();
  }

  private _stop() {
    this._unsub?.then((unsub) => unsub()).catch(() => {});
    this._unsub = null;
    this._view?.card.removeEventListener("ha-3dhome-editing", this._editing);
    this._view = null;
  }

  private _render() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${panelStyles}</style><div class="import hide"></div>`;
    this._menu = document.createElement("ha-menu-button");
    this._menu.className = "menu";
    this._menu.hass = this._hass ?? undefined;
    this._menu.narrow = this.hasAttribute("narrow");
    root.prepend(this._menu);
  }

  private _attach(entryId: string) {
    let view = VIEWS.get(entryId);
    if (!view) {
      view = { card: document.createElement("ha-3dhome-map") as MapCard, rev: -1, waiting: null };
      VIEWS.set(entryId, view);
    }
    this._view = view;
    view.card.layoutStore = this._store(view);
    view.card.hass = this._hass!;
    view.card.addEventListener("ha-3dhome-editing", this._editing);
    this.shadowRoot!.prepend(view.card);
  }

  /** the editor closed: show a save from elsewhere that was held back meanwhile */
  private _editing = (ev: Event) => {
    const view = this._view;
    if (!view || (ev as CustomEvent<{ editing: boolean }>).detail.editing) return;
    const saved = view.waiting;
    view.waiting = null;
    if (saved && saved.rev > view.rev) this._show(saved);
  };

  /* ----- following the stored config ----- */

  private _follow() {
    if (this._unsub || !this._view) return;
    this._unsub = this._hass!.connection.subscribeMessage<Saved>((saved) => this._received(saved), {
      type: "ha_3dhome/config/subscribe",
      entry_id: this._panel!.config.entry_id,
    });
    this._unsub.catch((e) => {
      this._unsub = null;
      console.error("3D Home: couldn't load the panel's map", e);
    });
  }

  private _received(saved: Saved) {
    const view = this._view;
    if (!view || saved.rev <= view.rev) return; // what's shown already (our own save comes back too)
    if (view.card._edit) {
      view.waiting = saved; // never pull the layout from under someone editing; their Save will say it changed
      return;
    }
    this._show(saved);
  }

  private _show(saved: Saved) {
    const view = this._view!;
    view.rev = saved.rev;
    view.card.setConfig(saved.config); // only the world is rebuilt when just the layout changed
    this._offerImport(saved.config);
  }

  /** the card config as stored: without what the panel sets itself */
  private _stored(config: CardConfig): CardConfig {
    const out: CardConfig = { ...config };
    for (const k of PANEL_OWNED) delete out[k];
    return JSON.parse(JSON.stringify(out)); // drops the keys the editor left undefined
  }

  /** Save, as the card's editor sees it: write to the integration, starting from the revision being shown */
  private _store(view: PageView): LayoutStore {
    return {
      savedMessage: "Saved",
      save: async (layout, config) => {
        const next = this._stored({ ...config, ...layout });
        await this._write(view, next);
        return next;
      },
    };
  }

  private async _write(view: PageView, config: CardConfig) {
    const { rev } = await this._hass!.callWS<{ rev: number }>({
      type: "ha_3dhome/config/save",
      entry_id: this._panel!.config.entry_id,
      config,
      rev: Math.max(view.rev, 0),
    });
    view.rev = Math.max(view.rev, rev);
  }

  /* ----- importing a map from a dashboard ----- */

  /** an empty panel, opened by an administrator: offer the maps found on dashboards */
  private async _offerImport(config: CardConfig) {
    const box = this.shadowRoot!.querySelector<HTMLElement>(".import")!;
    const empty = !Object.keys(config.scene || {}).length && !config.lights?.length;
    if (!empty || !this._hass?.user?.is_admin) return box.classList.add("hide");
    const found = await (this._imports ||= dashboardsWithHome(this._hass));
    if (!found.length || (this._view?.rev ?? 0) > 0) return;
    box.innerHTML = `<b>Bring in your map</b><span>These dashboards have a 3D Home map. Copy one here to keep editing it on this page.</span>`;
    for (const d of found) {
      const btn = document.createElement("button");
      btn.textContent = `Copy from ${d.title}`;
      btn.addEventListener("click", () => this._import(d, btn));
      box.append(btn);
    }
    box.classList.remove("hide");
  }

  private async _import(d: DashboardWithHome, btn: HTMLButtonElement) {
    const box = this.shadowRoot!.querySelector<HTMLElement>(".import")!;
    btn.disabled = true;
    try {
      await this._write(this._view!, this._stored(d.config));
      box.innerHTML = `<b>Copied</b><span>Your map from ${esc(d.title)} is here now. The dashboard is unchanged: delete it in Settings → Dashboards once you don't need it.</span><button>OK</button>`;
      box.querySelector("button")!.addEventListener("click", () => box.classList.add("hide"));
      box.classList.remove("hide");
    } catch (e) {
      console.error(e);
      btn.disabled = false;
      btn.textContent = "Copying failed. Try again";
    }
  }
}
