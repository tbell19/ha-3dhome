/* Add to map panel: a box, a label or a 3D model, and every Home Assistant entity, searchable and filtered by
 * domain. With a mouse or pen you drag an entity onto the map; on touch a tap adds it in the middle of the view (a
 * finger scrolls the list instead of dragging).
 */
import { useState } from "preact/hooks";
import type { Editor } from "./editor";
import { closeSidePanel } from "./side-panels";
import { ACTIVE, entIcon } from "./shared.js";

/** the domain filters: [domain, label]; "" is everything, "*" what the others don't cover */
const DOMAINS: [string, string][] = [
  ["", "All"],
  ["light", "Lights"],
  ["switch", "Switches"],
  ["sensor", "Sensors"],
  ["binary_sensor", "Binary"],
  ["climate", "Climate"],
  ["media_player", "Media"],
  ["cover", "Covers"],
  ["fan", "Fans"],
  ["lock", "Locks"],
  ["camera", "Cameras"],
  ["*", "Other"],
];
const LISTED = new Set(DOMAINS.map(([d]) => d).filter((d) => d && d !== "*"));
const MAX_ROWS = 250;

export function AddPanel({ editor }: { editor: Editor }) {
  const [search, setSearch] = useState("");
  const [domain, setDomain] = useState("");
  const [touch, setTouch] = useState(false); // the last press in the list was a finger

  const placed = editor._placedEntities();
  const words = search.trim().toLowerCase();
  const rows = Object.entries(editor.card._hass?.states || {})
    .map(([id, state]) => ({ id, state, name: String(state.attributes?.friendly_name || id) }))
    .filter(({ id, name }) => {
      const d = id.split(".")[0];
      if (domain === "*" ? LISTED.has(d) : domain && d !== domain) return false;
      return !words || id.toLowerCase().includes(words) || name.toLowerCase().includes(words);
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_ROWS);

  const addShape = (kind: "box" | "label") => {
    const [x, y] = editor._target();
    editor._mutate(() => [
      kind === "box"
        ? editor._push("b", { b: [x - 10, x + 10, y - 10, y + 10, 10, "cream", 0] })
        : editor._push("c", { label: "Label", x, y, z: 50 }),
    ]);
  };

  const press = (id: string, ev: PointerEvent) => {
    setTouch(ev.pointerType === "touch");
    if (ev.button > 0 || ev.pointerType === "touch") return;
    ev.preventDefault();
    editor._dragEntity(id, ev);
  };

  const tap = (id: string) => {
    if (!touch) return;
    const [x, y] = editor._target();
    editor._placeEntity(id, x, y);
    closeSidePanel(editor, "ents"); // out of the way, so the new item can be dragged into place
  };

  return (
    <>
      <header>
        <span class="ttl">Add to map</span>
        <button title="Close" onClick={() => closeSidePanel(editor, "ents")}>
          <ha-icon icon="mdi:close" />
        </button>
      </header>
      <div class="quick">
        <button onClick={() => addShape("box")}>
          <ha-icon icon="mdi:cube-outline" />
          Box
        </button>
        <button onClick={() => addShape("label")}>
          <ha-icon icon="mdi:label-outline" />
          Label
        </button>
        <button title="Browse 3D model libraries" onClick={() => editor._openLibrary()}>
          <ha-icon icon="mdi:sofa-outline" />
          Model
        </button>
      </div>
      <input
        type="search"
        placeholder="Search entities…"
        value={search}
        onInput={(ev) => setSearch(ev.currentTarget.value)}
      />
      <div class="doms">
        {DOMAINS.map(([d, label]) => (
          <button class={d === domain ? "on" : ""} onClick={() => setDomain(d)}>
            {label}
          </button>
        ))}
      </div>
      <div class="hint">
        {editor._coarse
          ? "Tap an entity to add it in the middle of the view, then drag it into place."
          : "Drag an entity onto the floor plan (or click to drop it in the middle of the view)."}
      </div>
      <div class="list">
        {rows.map(({ id, state, name }) => (
          <div
            key={id}
            class={ACTIVE.has(state.state) ? "erow act" : "erow"}
            data-e={id}
            onPointerDown={(ev) => press(id, ev)}
            onClick={() => tap(id)}
          >
            <ha-icon icon={entIcon(state, id)} />
            <div style="min-width:0">
              <div class="n">{name}</div>
              <div class="id">
                {id} · {state.state}
              </div>
            </div>
            <span class="ok">
              {placed.has(id) && (
                <>
                  <ha-icon icon="mdi:check" />
                  On map
                </>
              )}
            </span>
          </div>
        ))}
        {!rows.length && <div class="hint">No matching entities.</div>}
      </div>
    </>
  );
}
