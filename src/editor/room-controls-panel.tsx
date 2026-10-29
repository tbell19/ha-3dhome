/* Room controls panel: the Home Assistant cards a room shows in the top right corner while it is in view
 * (`room_cards`). Tiles for single entities, all of the room's own devices in one go, or any card as YAML or JSON
 * (pasted from another dashboard's card code editor). Each change is one undo step and needs no 3D rebuild.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { LovelaceCardConfig } from "../types";
import type { Editor } from "./editor";
import { closeSidePanel } from "./side-panels";
import { loadYaml as importYaml, actionChoice, actionChoices, choiceAction } from "./shared.js";
import type { ActionChoice } from "../core/card-actions";

/** js-yaml, loaded the first time it's needed (null when it can't be loaded) */
const loadYaml = () => importYaml().catch(() => null);

export function RoomControlsPanel({ editor }: { editor: Editor }) {
  const card = editor.card;
  const rooms = card._rooms();
  const room = rooms.some((r) => r.name === card._rcRoom) ? card._rcRoom : "home";
  const cards = card._work.room_cards?.[room] || [];
  const states = card._hass?.states || {};
  const [entity, setEntity] = useState("");
  const [code, setCode] = useState<string | null>(null); // the code editor's text while it is open

  const pickRoom = (name: string) => {
    card._rcRoom = name;
    setCode(null);
    editor._syncBar(); // draws this panel again for the new room
    card._focusRoom(rooms.find((r) => r.name === name) || null);
  };

  const setCards = (list: LovelaceCardConfig[]) => editor.setRoomCards(room, list);

  const move = (i: number, by: number) => {
    const list = [...cards];
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setCards(list);
  };

  /* what a tap or a hold on card i does; on a tile, a tap on its icon does the same as a tap anywhere on it */
  const setAction = (i: number, which: "tap" | "hold", choice: ActionChoice) => {
    const c: LovelaceCardConfig = { ...cards[i] };
    const keys =
      which === "hold" ? ["hold_action"] : c.type === "tile" ? ["tap_action", "icon_tap_action"] : ["tap_action"];
    const a = choiceAction(choice);
    for (const k of keys)
      if (a) c[k] = a;
      else delete c[k];
    setCards(cards.map((old, j) => (j === i ? c : old)));
  };

  const addTile = () => {
    const id = entity.trim();
    if (!id) return;
    if (!states[id]) return card._toast("No entity called " + id);
    setCards([...cards, { type: "tile", entity: id }]);
    setEntity("");
  };

  const addRoomDevices = () => {
    const have = new Set(cards.map((c) => c.entity).filter(Boolean));
    const add = editor._roomEntities(room).filter((id) => !have.has(id));
    if (!add.length) return card._toast(room === "home" ? "Pick a room first" : "No more devices placed in this room");
    setCards([...cards, ...add.map((id) => ({ type: "tile", entity: id }))]);
    card._toast(`Added ${add.length} ${add.length === 1 ? "tile" : "tiles"}`);
  };

  const toggleCode = async () => {
    if (code != null) return setCode(null);
    const yaml = await loadYaml();
    setCode(!cards.length ? "" : yaml ? yaml.dump(cards, { lineWidth: -1 }) : JSON.stringify(cards, null, 2));
  };

  const applyCode = async () => {
    const text = (code || "").trim();
    let value;
    try {
      if (!text) value = [];
      else if (/^[[{]/.test(text)) value = JSON.parse(text);
      else {
        const yaml = await loadYaml();
        if (!yaml) throw new Error("couldn't load the YAML reader, use JSON");
        value = yaml.load(text);
      }
    } catch (e: any) {
      return card._toast("That code doesn't read right: " + (e.reason || e.message || e), 5000);
    }
    if (value && !Array.isArray(value) && Array.isArray(value.cards) && !value.type) value = value.cards; // a pasted view or stack
    const list: LovelaceCardConfig[] = Array.isArray(value) ? value : value ? [value] : [];
    if (list.some((c) => !c || typeof c !== "object" || !c.type))
      return card._toast("Every card needs a type, like type: tile", 5000);
    setCards(list);
    setCode(null);
  };

  return (
    <>
      <header>
        <span class="ttl">Room controls</span>
        <button title="Close" onClick={() => closeSidePanel(editor, "rcp")}>
          <ha-icon icon="mdi:close" />
        </button>
      </header>
      <div class="rcb">
        <select data-room value={room} onChange={(ev) => pickRoom(ev.currentTarget.value)}>
          <option value="home">Whole home</option>
          {rooms.map((r) => (
            <option value={r.name}>{r.label}</option>
          ))}
        </select>
        <div class="hint">
          These cards show in the top right corner while this room is in view. Any Home Assistant card works.
        </div>

        <div class="rcl">
          {cards.map((c, i) => (
            <CardRow
              card={c}
              states={states}
              first={i === 0}
              last={i === cards.length - 1}
              onUp={() => move(i, -1)}
              onDown={() => move(i, 1)}
              onRemove={() => setCards(cards.filter((_, j) => j !== i))}
              onAction={(which, choice) => setAction(i, which, choice)}
            />
          ))}
          {!cards.length && <div class="hint">No controls for this room yet.</div>}
        </div>

        <div class="rcadd">
          <input
            data-ent
            list="rc-ents"
            placeholder="Entity, e.g. light.lamp"
            value={entity}
            onInput={(ev) => setEntity(ev.currentTarget.value)}
            onKeyDown={(ev) => ev.key === "Enter" && addTile()}
          />
          <button data-add onClick={addTile}>
            <ha-icon icon="mdi:plus" />
            Tile
          </button>
        </div>
        <datalist id="rc-ents">
          {Object.entries(states).map(([id, st]) => (
            <option value={id}>{st.attributes?.friendly_name || ""}</option>
          ))}
        </datalist>
        <div class="rcadd">
          <button data-auto onClick={addRoomDevices}>
            <ha-icon icon="mdi:plus" />
            This room's devices
          </button>
          <button data-code onClick={toggleCode}>
            <ha-icon icon="mdi:code-braces" />
            Code
          </button>
        </div>

        {code != null && (
          <div class="rccode">
            <textarea
              spellcheck={false}
              value={code}
              onInput={(ev) => setCode(ev.currentTarget.value)}
              ref={(el) => el?.focus()}
            />
            <div class="hint">
              YAML or JSON: one card, or a list of cards. You can paste a card's code from another dashboard (edit the
              card, then Show code editor).
            </div>
            <div class="rcadd">
              <button data-apply class="primary" onClick={applyCode}>
                Apply
              </button>
              <button data-codex onClick={() => setCode(null)}>
                Close
              </button>
            </div>
          </div>
        )}

        <div class="hint">Preview</div>
        <Preview editor={editor} cards={cards} />
      </div>
    </>
  );
}

/** One card in the room's list: what it shows, its type, and buttons to reorder or remove it. */
function CardRow(props: {
  card: LovelaceCardConfig;
  states: Record<string, { attributes?: Record<string, any> }>;
  first: boolean;
  last: boolean;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
  onAction: (which: "tap" | "hold", choice: ActionChoice) => void;
}) {
  const c = props.card;
  const type = String(c.type)
    .replace(/^custom:/, "")
    .replace(/-/g, " ");
  const firstEntity = c.entity || (typeof c.entities?.[0] === "string" ? c.entities[0] : c.entities?.[0]?.entity);
  const shows =
    c.name || c.title || (firstEntity && (props.states[firstEntity]?.attributes?.friendly_name || firstEntity)) || "";
  const what =
    (c.entities && c.entities.length > 1 ? `${shows} +${c.entities.length - 1}` : shows) ||
    (c.cards ? `${c.cards.length} cards` : "");
  return (
    <div class="rcrow">
      <div style="min-width:0">
        <div class="n">{what || type}</div>
        <div class="id">{type}</div>
      </div>
      <span>
        <button title="Move up" disabled={props.first} onClick={props.onUp}>
          <ha-icon icon="mdi:arrow-up" />
        </button>
        <button title="Move down" disabled={props.last} onClick={props.onDown}>
          <ha-icon icon="mdi:arrow-down" />
        </button>
        <button title="Remove" onClick={props.onRemove}>
          <ha-icon icon="mdi:close" />
        </button>
      </span>
      {typeof c.entity === "string" && (
        <div class="rcact">
          <ActionPick label="Tap" entity={c.entity} value={c.tap_action} onPick={(v) => props.onAction("tap", v)} />
          <ActionPick label="Hold" entity={c.entity} value={c.hold_action} onPick={(v) => props.onAction("hold", v)} />
        </div>
      )}
    </div>
  );
}

/** A menu of what a tap or a hold does. An action set in the card's code that isn't one of these shows as "From code". */
function ActionPick(props: { label: string; entity: string; value: unknown; onPick: (v: ActionChoice) => void }) {
  const now = actionChoice(props.value);
  return (
    <label>
      {props.label}
      <select
        data-act={props.label.toLowerCase()}
        value={now}
        onChange={(ev) => props.onPick(ev.currentTarget.value as ActionChoice)}
      >
        {actionChoices(props.entity).map((o) => (
          <option value={o.value}>{o.label}</option>
        ))}
        {now === "custom" && (
          <option value="custom" disabled>
            From code
          </option>
        )}
      </select>
    </label>
  );
}

/** The room's cards as Home Assistant draws them. They are real card elements, built again only when the list changes. */
function Preview({ editor, cards }: { editor: Editor; cards: LovelaceCardConfig[] }) {
  const box = useRef<HTMLDivElement>(null);
  const shows = JSON.stringify(cards);
  useEffect(() => {
    let current = true;
    box.current!.replaceChildren();
    editor.card._makeCards(cards).then((els) => {
      if (current) box.current?.replaceChildren(...els);
    });
    return () => {
      current = false;
    };
  }, [shows]);
  return <div class="rcprev" ref={box} />;
}
