/* Finding 3D Home maps on Lovelace dashboards, so an empty panel can offer to copy one in. Before v6, 3D Home was a card
 * and a dashboard strategy; their configs are read here, never written.
 */
import type { CardConfig, Hass, SceneItem } from "../types";

/** the strategy and card types 3D Home used on dashboards, including the names from before v5 (ha-iso-home) */
const STRATEGY_TYPES = ["custom:ha-3dhome", "custom:iso-home"];
const CARD_TYPES = ["custom:ha-3dhome-card", "custom:iso-home-3d-card"];
/** the strategy's own options, which aren't part of the map */
const STRATEGY_ONLY = ["type", "title", "path", "icon", "extra_views"];

/** object types from the first, hand-made maps that 3D Home no longer draws */
const RETIRED_TYPES = new Set([
  "railing",
  "cornerglass",
  "glasswall",
  "frontwalls",
  "doorpanel",
  "plantwall",
  "track",
  "line",
  "bulbs",
]);

/** A map as older versions saved it, brought up to date: string lights marked `kind: "string"` become string-light
 * fixtures, and retired object types (and the plant wall's light) are left out. */
function upToDate(map: CardConfig): CardConfig {
  const out: CardConfig = JSON.parse(JSON.stringify(map));
  const keep = (list?: SceneItem[]) => list?.filter((o) => !RETIRED_TYPES.has(o.type));
  if (out.scene) {
    out.scene.objects = keep(out.scene.objects);
    out.scene.overlays = keep(out.scene.overlays);
  }
  out.lights = out.lights
    ?.filter((light) => light.kind !== "niche")
    .map(({ kind, ...light }) => (kind === "string" ? { ...light, fixture: "string" } : light));
  return out;
}

/** A dashboard's raw config, as lovelace/config returns it. */
interface LovelaceConfig {
  strategy?: CardConfig & { type?: string };
  views?: unknown[];
}

/** the first 3D Home card in a list of views, looking inside cards, sections and wrappers such as conditional cards */
function findCard(list: unknown): CardConfig | null {
  if (!Array.isArray(list)) return null;
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    if (CARD_TYPES.includes(c.type)) return c;
    const inner =
      findCard(c.cards) || findCard(c.sections) || findCard(c.views) || (c.card ? findCard([c.card]) : null);
    if (inner) return inner;
  }
  return null;
}

/** the 3D Home map held by a dashboard: its strategy config, or the first 3D Home card on it */
export function homeConfigIn(lc: LovelaceConfig | null | undefined): CardConfig | null {
  if (!lc) return null;
  if (lc.strategy && STRATEGY_TYPES.includes(lc.strategy.type!)) {
    const map: CardConfig = { ...lc.strategy };
    for (const k of STRATEGY_ONLY) delete map[k];
    return upToDate(map);
  }
  const card = findCard(lc.views);
  return card && upToDate(card);
}

/** A dashboard that holds a 3D Home map. */
export interface DashboardWithHome {
  url_path: string | null; // null is the default dashboard
  title: string;
  config: CardConfig;
}

/** Every dashboard with a 3D Home map in it. Dashboards that fail to load are skipped. */
export async function dashboardsWithHome(hass: Hass): Promise<DashboardWithHome[]> {
  const list: { url_path: string; title?: string }[] =
    (await hass.callWS({ type: "lovelace/dashboards/list" }).catch(() => null)) || [];
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
