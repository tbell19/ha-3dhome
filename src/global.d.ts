/* What the card adds to, or expects on, the page's globals. */
import type { EditorApi } from "./editor-api";
import type { LovelaceCardConfig } from "./types";

declare global {
  interface Window {
    /** the core's helpers for the editor module (src/editor-api.ts) */
    __ha3dhome?: EditorApi;
    /** dashboard strategies listed under Settings → Dashboards → Add dashboard (HA 2026.5+) */
    customStrategies?: {
      type: string;
      strategyType: string;
      name: string;
      description: string;
      documentationURL: string;
    }[];
    /** custom cards listed in the card picker */
    customCards?: { type: string; name: string; description: string }[];
    /** Home Assistant's helpers for building Lovelace cards */
    loadCardHelpers?(): Promise<{ createCardElement(config: LovelaceCardConfig): LovelaceCardElement }>;
  }
}

/** A Lovelace card element: it takes a config and follows hass. */
export interface LovelaceCardElement extends HTMLElement {
  setConfig?(config: LovelaceCardConfig): void;
  hass?: unknown;
}
