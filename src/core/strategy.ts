/* The dashboard strategy (`custom:ha-3dhome`), which wraps the card in a full-screen dashboard.
 */
import type { CardConfig, StrategyConfig } from "../types";

/* ---------- dashboard strategy: `strategy: { type: custom:ha-3dhome, scene, lights, ... }` ----------
 * Generates a full-screen dashboard around the 3D map. Options besides the card config:
 *   title / path / icon  – the generated view (defaults "Home", "3d", mdi:floor-plan)
 *   extra_views          – ordinary Lovelace views appended after the map
 */
export class Home3DStrategy extends HTMLElement {
  static async generate(config: StrategyConfig | undefined) {
    const { title, path, icon, extra_views } = config || {};
    return {
      title: title || "Home Map",
      views: [
        {
          title: title || "Home",
          path: path || "3d",
          icon: icon || "mdi:floor-plan",
          type: "panel",
          cards: [Home3DStrategy.cardConfig(config)],
        },
        ...(Array.isArray(extra_views) ? extra_views : []),
      ],
    };
  }
  /** the card config inside the strategy config: everything but the dashboard options */
  static cardConfig(config: StrategyConfig | undefined): CardConfig {
    const { type: _type, title: _title, path: _path, icon: _icon, extra_views: _extra, ...card } = config || {};
    return { fill: true, ...card, type: "custom:ha-3dhome-card" };
  }
  /** older Home Assistant versions call this instead of generate() */
  static async generateDashboard(info: { config?: StrategyConfig & { strategy?: StrategyConfig } } | undefined) {
    return Home3DStrategy.generate(info?.config?.strategy || info?.config || {});
  }
}
