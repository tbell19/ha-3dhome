/* The dashboard strategy (`custom:ha-3dhome`), which wraps the card in a full-screen dashboard.
 */

/* ---------- dashboard strategy: `strategy: { type: custom:ha-3dhome, scene, lights, ... }` ----------
 * Generates a full-screen dashboard around the 3D map. Options besides the card config:
 *   title / path / icon  – the generated view (defaults "Home", "3d", mdi:floor-plan)
 *   extra_views          – ordinary Lovelace views appended after the map
 */
export class Home3DStrategy extends HTMLElement {
  static async generate(config) {
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
  static cardConfig(config) {
    const { type, title, path, icon, extra_views, ...card } = config || {};
    return { fill: true, ...card, type: "custom:ha-3dhome-card" };
  }
  static async generateDashboard(info) {
    return Home3DStrategy.generate(info?.config?.strategy || info?.config || {});
  } // older HA
}
