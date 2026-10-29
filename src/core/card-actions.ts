/* Tap and hold actions for room controls (`room_cards`). The cards are Home Assistant's own, so they take its
 * `tap_action` / `hold_action` configs. One action of our own rides on HA's `fire-dom-event`: "options" shows a select
 * helper's list right on the map. HA fires it as an `ll-custom` event from the card, which the map catches.
 */
import type { LovelaceCardConfig } from "../types";
import { TOGGLE_DOMAINS } from "./entities";

/** helpers whose state is one of a list of options: a tap shows the list in place */
export const SELECT_DOMAINS = new Set(["select", "input_select"]);

export const isSelect = (entity: string | undefined) => !!entity && SELECT_DOMAINS.has(entity.split(".")[0]);

/** what an action config carries; HA's own actions use more fields (navigation_path, perform_action, …) */
export interface CardAction {
  action: string;
  ha_3dhome?: string; // "options" on our own fire-dom-event action
  entity?: string; // the select helper, when the card holding the action isn't for it (a tile inside a stack)
  [k: string]: unknown;
}

/** the action that shows a select helper's options in place */
export const optionsAction = (entity?: string): CardAction => ({
  action: "fire-dom-event",
  ha_3dhome: "options",
  ...(entity ? { entity } : {}),
});

export const isOptionsAction = (a: unknown): a is CardAction =>
  !!a && typeof a === "object" && (a as CardAction).ha_3dhome === "options";

/** The choices the editor offers. "" leaves the card's default; "custom" is anything else set in the card's code. */
export type ActionChoice = "" | "toggle" | "more-info" | "options" | "none" | "custom";

export const actionChoice = (a: unknown): ActionChoice => {
  if (!a) return "";
  if (isOptionsAction(a)) return "options";
  const name = (a as CardAction).action;
  return name === "toggle" || name === "more-info" || name === "none" ? name : "custom";
};

/** the config for a choice (undefined = leave the card's default) */
export const choiceAction = (choice: ActionChoice): CardAction | undefined =>
  choice === "options" ? optionsAction() : choice && choice !== "custom" ? { action: choice } : undefined;

/** the choices that make sense for an entity, in the order the editor lists them */
export const actionChoices = (entity: string) => {
  const d = entity.split(".")[0];
  const out: { value: ActionChoice; label: string }[] = [{ value: "", label: "Default" }];
  if (SELECT_DOMAINS.has(d)) out.push({ value: "options", label: "Show the options" });
  if (TOGGLE_DOMAINS.has(d) || ["cover", "climate", "media_player"].includes(d))
    out.push({ value: "toggle", label: "Toggle" });
  out.push({ value: "more-info", label: "Open details" }, { value: "none", label: "Nothing" });
  return out;
};

/** The card config as it is built on the map: a select helper's card that doesn't say what a tap does shows its options
 * on a tap (on a tile, a tap on the icon too). Stacks get the same for the cards inside them. */
export const withRoomCardDefaults = (conf: LovelaceCardConfig, nested = false): LovelaceCardConfig => {
  let out = conf;
  if (Array.isArray(conf.cards)) out = { ...conf, cards: conf.cards.map((c) => withRoomCardDefaults(c, true)) };
  if (isSelect(conf.entity) && !conf.tap_action) {
    const tap = optionsAction(nested ? conf.entity : undefined);
    out = { ...out, tap_action: tap };
    if (conf.type === "tile" && !conf.icon_tap_action) out.icon_tap_action = tap;
  }
  return out;
};
