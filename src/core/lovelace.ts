/* Finding 3D Home in Lovelace dashboard configs: the card's dashboard saving, and the panel's import, both look for it.
 */
import type { CardConfig, Hass, LovelaceCardConfig, StrategyConfig } from "../types";
import { STRATEGY_NAME, OLD_NAMES } from "./constants";
import { Home3DStrategy } from "./strategy";

/** the strategy and card types, current and pre-v5 names */
export const STRATEGY_TYPES = ["custom:" + STRATEGY_NAME, "custom:" + OLD_NAMES.strategy];
export const CARD_TYPES = ["custom:ha-3dhome-card", "custom:" + OLD_NAMES.card];

/** A dashboard's raw config, as lovelace/config returns it. */
export interface LovelaceConfig {
  strategy?: StrategyConfig;
  views?: { cards?: LovelaceCardConfig[]; sections?: { cards?: LovelaceCardConfig[] }[] }[];
}

/** Visits every 3D Home card in a list of views (in cards, sections and wrappers such as conditional cards) and returns
 * the first one `pick` accepts. `pick` may also replace it in place through `replace`. */
export function findCard(
  views: unknown,
  pick: (card: CardConfig, replace: (next: CardConfig) => void) => boolean,
): CardConfig | null {
  let found: CardConfig | null = null;
  const walk = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (let i = 0; i < list.length && !found; i++) {
      const c = list[i];
      if (!c || typeof c !== "object") continue;
      if (CARD_TYPES.includes(c.type) && pick(c, (next) => (list[i] = next))) {
        found = c;
        return;
      }
      walk(c.cards);
      walk(c.sections);
      if (c.card && typeof c.card === "object") {
        const box = [c.card]; // a wrapper's single card (conditional cards and the like)
        walk(box);
        c.card = box[0];
      }
    }
  };
  walk(views);
  return found;
}

/** the 3D Home config held by a dashboard: its strategy config, or the first 3D Home card on it */
export function homeConfigIn(lc: LovelaceConfig | null | undefined): CardConfig | null {
  if (!lc) return null;
  if (lc.strategy && STRATEGY_TYPES.includes(lc.strategy.type!)) return Home3DStrategy.cardConfig(lc.strategy);
  return findCard(lc.views, () => true);
}

/** A dashboard that holds a 3D Home map. */
export interface DashboardWithHome {
  url_path: string | null; // null is the default dashboard
  title: string;
  config: CardConfig;
}

/** Every dashboard with a 3D Home map in it (for importing into the panel). Dashboards that fail to load are skipped. */
export async function dashboardsWithHome(hass: Hass): Promise<DashboardWithHome[]> {
  const list: { url_path: string; title?: string }[] = await hass
    .callWS({ type: "lovelace/dashboards/list" })
    .catch(() => []);
  const all = [{ url_path: null as string | null, title: "Overview" }, ...list];
  const found = await Promise.all(
    all.map(async (d) => {
      const lc: LovelaceConfig | null = await hass
        .callWS({ type: "lovelace/config", url_path: d.url_path, force: true })
        .catch(() => null);
      const config = homeConfigIn(lc);
      return config ? { url_path: d.url_path, title: d.title || d.url_path || "Dashboard", config } : null;
    }),
  );
  return found.filter((d): d is DashboardWithHome => !!d);
}
