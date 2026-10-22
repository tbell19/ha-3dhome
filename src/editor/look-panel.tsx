/* Look panel: a strength slider per render look, and where the map goes when nobody touches it.
 * The values live in card._work; the editor's setLook and setIdleView change them, one undo step each.
 */
import type { Editor } from "./editor";
import { closeSidePanel } from "./side-panels";
import { AMBIENT, IDLE_AFTER, lookOf } from "./shared.js";

export type LookName = "ambient" | "light" | "ao" | "stage" | "bloom";

const LOOKS: { name: LookName; title: string; hint: string }[] = [
  { name: "ambient", title: "Room fill", hint: "Even daylight on every surface" },
  { name: "light", title: "Soft lighting", hint: "Gradient sky light, soft shadows" },
  { name: "ao", title: "Corner shading", hint: "Darkens corners and creases" },
  { name: "stage", title: "Drop shadow", hint: "Lifts the home off the background" },
  { name: "bloom", title: "Lamp glow", hint: "Glow around lit lamps, at night" },
];

const asPercent = (strength: number) => (strength ? `${Math.round(strength * 100)}%` : "Off");

export function LookPanel({ editor }: { editor: Editor }) {
  const layout = editor.card._work;
  const strength = { ...lookOf(layout), ambient: layout.ambient ?? AMBIENT };
  const idleSeconds = Number(layout.idle_view?.after) || 0;
  const idleRoom = layout.idle_view?.room ?? "";
  const idleChoices = IDLE_AFTER.some(([seconds]) => seconds === idleSeconds)
    ? IDLE_AFTER
    : [...IDLE_AFTER, [idleSeconds, `${idleSeconds} seconds`] as const]; // a value set by hand in the config

  return (
    <>
      <header>
        <span class="ttl">Look</span>
        <button title="Close" onClick={() => closeSidePanel(editor, "lookp")}>
          <ha-icon icon="mdi:close" />
        </button>
      </header>

      {LOOKS.map(({ name, title, hint }) => (
        <label key={name}>
          <span class="n">{title}</span>
          <output data-o={name}>{asPercent(strength[name])}</output>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            data-k={name}
            value={Math.round(strength[name] * 100)}
            onInput={(ev) => editor.setLook(name, ev.currentTarget.valueAsNumber / 100)}
            onChange={() => editor.finishLookDrag()}
          />
          <span class="d">{hint}</span>
        </label>
      ))}

      <div class="idle">
        <span class="n">When left alone</span>
        <span class="d">Go back to a view after nobody has touched the map for a while</span>
        <select
          data-i="after"
          aria-label="Idle time"
          value={idleSeconds}
          onChange={(ev) => editor.setIdleView(Number(ev.currentTarget.value), idleRoom)}
        >
          {idleChoices.map(([seconds, label]) => (
            <option value={seconds}>{label}</option>
          ))}
        </select>
        <select
          data-i="room"
          aria-label="View to return to"
          value={idleRoom}
          disabled={!idleSeconds}
          onChange={(ev) => editor.setIdleView(idleSeconds, ev.currentTarget.value)}
        >
          <option value="">Whole home</option>
          {editor.card._rooms().map((room) => (
            <option value={room.name}>{room.label}</option>
          ))}
        </select>
      </div>
    </>
  );
}
