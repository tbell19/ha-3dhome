/* The inspector: the box on the left that edits what is selected. With nothing selected it shows tips and the
 * north / sun settings; in floor plan mode the plan inspector (plan-inspector.tsx) takes over. It is drawn from the
 * editor's state again after every change (renderInspector), so it holds no state of its own.
 */
import { render, type ComponentChildren, type JSX } from "preact";
import { useRef } from "preact/hooks";
import type { BoxEntry } from "../types";
import type { GenericItem } from "../core/items";
import type { Editor } from "./editor";
import { PlanInspector } from "./plan-inspector";
import { FIXTURES, KINDS, R1, ROTATABLE, bArr, hm, stringCount, stringLen } from "./shared";

/** Draws the inspector into its box (the `.insp` element of the editor layer). */
export function showInspector(editor: Editor, box: HTMLElement) {
  box.classList.toggle("min", !!editor._inspMin);
  render(<Inspector editor={editor} />, box);
}

function Inspector({ editor }: { editor: Editor }) {
  const edit = editor.card._edit;
  if (editor.card._plan) return <PlanInspector editor={editor} />;
  if (!edit.sel.size) return <Start editor={editor} />;
  return <ItemInspector key={edit.primary} editor={editor} />; // a fresh one per item, so folded sections reset
}

export const Icon = ({ name }: { name: string }) => <ha-icon icon={"mdi:" + name} />;

/** The inspector's title; tapping it folds the inspector to just this line. */
export function Title({ editor, children }: { editor: Editor; children: ComponentChildren }) {
  return (
    <h4 onClick={() => editor.toggleInspector()}>
      {children}
      <span class="tw">
        <Icon name="chevron-down" />
      </span>
    </h4>
  );
}

/** A labelled input; every other attribute goes to the input (type defaults to number). */
export function Field({
  label,
  labelStyle,
  ...input
}: { label: ComponentChildren; labelStyle?: string } & JSX.HTMLAttributes<HTMLInputElement>) {
  return (
    <label style={labelStyle}>
      {label}
      <input type="number" {...input} />
    </label>
  );
}

/** A labelled drop-down from [value, label] pairs. */
export function Choice(props: {
  label: ComponentChildren;
  options: [string, string][];
  value: string;
  onChange: (value: string) => void;
  attrs?: Record<string, string>; // e.g. a data- attribute the tests find it by
  style?: string;
}) {
  return (
    <label style={props.style}>
      {props.label}
      <select {...props.attrs} value={props.value} onChange={(ev) => props.onChange(ev.currentTarget.value)}>
        {props.options.map(([value, label]) => (
          <option value={value}>{label}</option>
        ))}
      </select>
    </label>
  );
}

/** The item as JSON, editable for anything the fields don't cover. */
export function AdvancedJson({ value, onApply }: { value: unknown; onApply: (text: string) => void }) {
  const text = useRef<HTMLTextAreaElement>(null);
  return (
    <details style="margin-top:8px">
      <summary style="cursor:pointer;opacity:.8">Advanced (JSON)</summary>
      <textarea data-json value={JSON.stringify(value, null, 1)} ref={text} />
      <div class="row">
        <button data-b="json" onClick={() => onApply(text.current!.value)}>
          Apply JSON
        </button>
      </div>
    </details>
  );
}

/** Which way is north, and (in 3D) a slider to preview the sun at another time of day. */
export function Sun({ editor, preview }: { editor: Editor; preview: boolean }) {
  const card = editor.card;
  const north = Number(card._work.scene?.north) || 0;
  const config = card._hass?.config || {};
  const located = config.latitude != null && config.longitude != null;
  const hour = card._sunPreview;
  const now = new Date();
  return (
    <div class="sun" style="margin-top:8px">
      <div class="grid" style="grid-template-columns:1fr 1fr">
        <Field
          label="North °"
          data-sun="north"
          step={5}
          value={north}
          onChange={(ev) => editor.setNorth(Number(ev.currentTarget.value))}
        />
        <div class="row" style="align-items:end">
          <button data-sun="nl" title="Turn north left" onClick={() => editor.setNorth(north - 15)}>
            <Icon name="rotate-left" />
            15°
          </button>
          <button data-sun="nr" title="Turn north right" onClick={() => editor.setNorth(north + 15)}>
            <Icon name="rotate-right" />
            15°
          </button>
        </div>
      </div>
      <div class="sub">
        How far north is turned clockwise from the top of the floor plan. The red arrow points north; the sun follows
        Home Assistant's sun position.
      </div>
      {preview && located && (
        <>
          <label style="margin-top:6px">
            {"Preview the sun at "}
            <b data-sun="t">{hour == null ? "now" : hm(hour)}</b>
            <input
              data-sun="hour"
              type="range"
              min={0}
              max={24}
              step={0.25}
              value={hour ?? now.getHours() + now.getMinutes() / 60}
              onInput={(ev) => editor.previewSun(ev.currentTarget.valueAsNumber)}
            />
          </label>
          {hour != null && (
            <div class="row">
              <button data-sun="live" onClick={() => editor.previewSun(null)}>
                Back to now
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Nothing selected: how the editor works. */
function Start({ editor }: { editor: Editor }) {
  return (
    <>
      <Title editor={editor}>Edit layout</Title>
      <div class="sub">
        Tap something to select it, then drag it to move.
        <details class="tips">
          <summary>Tips</summary>
          On touch, one finger only moves things that are already selected — otherwise it pans; two fingers zoom and
          rotate. With a mouse, drag anything to move it; drag empty floor to pan, right-drag to orbit. W / E / R pick
          the move, rotate and scale gizmo (X switches its axes between the world and the item). Arrow keys nudge, [ / ]
          turn 15°. Shift-click multi-selects, Alt-click picks one piece of a group. Markers:{" "}
          <span style="color:#ffd166">●</span> light <span style="color:#5aa9ff">●</span> hotspot{" "}
          <span style="color:#6fd39a">●</span> chip <span style="color:#ef6b5b">●</span> door.
        </details>
      </div>
      <Sun editor={editor} preview />
    </>
  );
}

const SHOW_AS: [string, string][] = [
  ["badge", "Badge (icon + live state)"],
  ["light", "Light glow"],
  ["door", "Door / window marker"],
  ["hotspot", "Invisible tap spot"],
];

/** One or more selected items; the fields edit the highlighted one (`primary`), the transform all of them. */
function ItemInspector({ editor }: { editor: Editor }) {
  const card = editor.card;
  const count = card._edit.sel.size;
  const key = card._edit.primary;
  const kind = key[0];
  const item = editor.item(key);
  const unit = card._imperial() ? "in" : "cm";
  const fixture = FIXTURES[item.fixture] ? item.fixture : "none";
  const angle = editor._itemAngle(kind, item);
  /** sets a field from an input */
  const set = (name: string) => (ev: Event) => editor._field(key, name, (ev.currentTarget as HTMLInputElement).value);
  const press = (name: string) => () => editor._field(key, name);

  let size = null;
  if (!ROTATABLE.has(kind) && count === 1) {
    if (kind === "h")
      size = (
        <Field
          label={`Tap radius (${unit})`}
          data-f="hit"
          value={editor._toReal(item.hit ?? 12)}
          onChange={set("hit")}
        />
      );
    else if (kind !== "l" || fixture !== "none")
      size = (
        <Field
          label="Size %"
          data-f="size"
          step={5}
          value={Math.round((item.size ?? 1) * 100)}
          onChange={set("size")}
        />
      );
  }

  const entity = (!ROTATABLE.has(kind) || item.type === "screen") && (item.entity || item.climate);
  const shownAs =
    item.type === "screen"
      ? "screen"
      : kind === "l"
        ? "light"
        : kind === "d"
          ? "door"
          : kind === "h"
            ? "hotspot"
            : "badge";
  const showAs: [string, string][] = /^(media_player|camera)\./.test(entity)
    ? [["screen", "Screen (16:9 with media preview)"], ...SHOW_AS]
    : SHOW_AS;

  return (
    <>
      <Title editor={editor}>{editor._label(key)}</Title>
      <div class="sub">
        {count > 1
          ? `${count} items selected. Position, rotation and size change them all together; other fields edit the highlighted one.`
          : KINDS[kind]}
      </div>
      <Transform editor={editor} itemKey={key} item={item} count={count} />
      {size && <div class="grid">{size}</div>}

      {kind === "l" && <LightTune editor={editor} itemKey={key} item={item} />}
      {kind === "l" && (
        <Choice
          label="Fixture"
          style="margin-bottom:8px"
          attrs={{ "data-fx": "" }}
          options={Object.entries(FIXTURES)}
          value={fixture}
          onChange={(value) => editor._setFixture(key, value)}
        />
      )}
      {kind === "l" && fixture === "string" && item.points?.length > 0 && (
        <StringLight editor={editor} itemKey={key} item={item} />
      )}

      {kind === "b" && (
        <div class="grid">
          <Field label="Colour" type="color" data-f="color" value={boxColour(editor, item)} onChange={set("color")} />
        </div>
      )}

      {"lhdc".includes(kind) && (kind !== "c" || item.entity != null || !item.label) && (
        <>
          <Field
            label="Entity"
            type="text"
            data-f="entity"
            list="ents"
            value={item.entity || ""}
            placeholder="light.kitchen"
            labelStyle="margin-bottom:8px"
            onChange={set("entity")}
          />
          <datalist id="ents">
            {Object.keys(card._hass?.states || {})
              .filter((id) => kind !== "l" || /^(light|switch)\./.test(id))
              .sort()
              .map((id) => (
                <option value={id} />
              ))}
          </datalist>
        </>
      )}
      {entity && (
        <Choice
          label="Show as"
          style="margin-bottom:8px"
          attrs={{ "data-as": "" }}
          options={showAs}
          value={shownAs}
          onChange={(value) => editor._convertEntity(key, value)}
        />
      )}

      {(angle != null || count > 1) && (
        <div class="row" style="margin:0 0 8px">
          <button data-b="rotl" title="Turn left" onClick={press("rotl")}>
            <Icon name="rotate-left" />
            90°
          </button>
          <button data-b="rotr" title="Turn right" onClick={press("rotr")}>
            <Icon name="rotate-right" />
            90°
          </button>
          {(ROTATABLE.has(kind) || count > 1) && (
            <button data-b="level" onClick={press("level")}>
              Level
            </button>
          )}
        </div>
      )}
      {item.type === "screen" && (
        <div class="row" style="margin:0 0 8px">
          <button data-b="stand" onClick={press("stand")}>
            {item.stand ? "Remove stand" : "Add stand"}
          </button>
        </div>
      )}
      {item.type === "model" && (
        <>
          <div class="row">
            <button data-b="mirror" onClick={press("mirror")}>
              <Icon name="flip-horizontal" />
              Mirror
            </button>
            <button data-b="resetsize" onClick={press("resetsize")}>
              Reset size
            </button>
          </div>
          {card._modelErr?.[key] && (
            <div class="credit" style="color:#ef8b7b">
              Couldn't load: {card._modelErr[key]}
            </div>
          )}
          <div class="credit">
            {item.name || ""} — {item.creator || "unknown author"} · {item.lic || ""} · Sweet Home 3D library
          </div>
        </>
      )}
      <AdvancedJson value={item} onApply={(text) => editor.applyJson(key, text)} />
    </>
  );
}

/** a box's main colour, as a colour input wants it */
function boxColour(editor: Editor, item: GenericItem) {
  const colour = bArr(item as BoxEntry)[5];
  const palette = editor.card._work.scene?.palette || {};
  return typeof colour === "string" ? (palette[colour] || ["#888888"])[0] : colour[0];
}

/* The Transform rows, laid out like Unity / Godot: X across, Y up, Z front to back (the gizmo's red, green and blue).
 * Position and Size are in cm or inches; Rotation in degrees (Y turns, X and Z tilt); Scale in % (applied, then back
 * to 100). */
function Transform({
  editor,
  itemKey,
  item,
  count,
}: {
  editor: Editor;
  itemKey: string;
  item: GenericItem;
  count: number;
}) {
  const card = editor.card;
  const kind = itemKey[0];
  const unit = card._imperial() ? "in" : "cm";
  const position = editor._selPos();
  const rotatable = ROTATABLE.has(kind);
  const angle = editor._itemAngle(kind, item);
  const tilts = rotatable && !Array.isArray(item);
  const lock = card._edit.lock || count > 1;

  const cell = (axis: "x" | "y" | "z", name: string, value: number | string, step = 1, disabled = false) => (
    <label class={"ax-" + axis}>
      <i>{axis.toUpperCase()}</i>
      <input
        data-f={name}
        type="number"
        step={step}
        value={value}
        disabled={disabled}
        onChange={(ev) => editor._field(itemKey, name, ev.currentTarget.value)}
      />
    </label>
  );
  const row = (label: ComponentChildren, cells: ComponentChildren) => (
    <div class="xf">
      <b>{label}</b>
      {cells}
    </div>
  );
  const inUnits = (title: string) => (
    <>
      {title + " "}
      <span style="opacity:.6;font-weight:400">{unit}</span>
    </>
  );
  const size = rotatable || count > 1 ? (count > 1 ? editor._selDims() : editor._dims(itemKey)) : null;
  /** a size along one axis, blank and locked when the item can't stretch that way */
  const sizeCell = (axis: "x" | "y" | "z", name: string, plan: number, vertical = false) =>
    cell(axis, name, plan > 0 ? editor._toReal(plan, vertical) : "", 0.5, !(plan > 0));

  return (
    <>
      {row(
        inUnits("Position"),
        <>
          {cell("x", "px", editor._toReal(position[0]))}
          {cell("y", "py", position[2] == null ? "" : editor._toReal(position[2], true), 1, position[2] == null)}
          {cell("z", "pz", editor._toReal(position[1]))}
        </>,
      )}
      {(rotatable || count > 1 || angle != null) &&
        row(
          "Rotation °",
          <>
            {cell("x", "rx", tilts ? item.rx || 0 : 0, 15, !tilts)}
            {cell("y", "ry", angle ?? 0, 15)}
            {cell("z", "rz", tilts ? item.rz || 0 : 0, 15, !tilts)}
          </>,
        )}
      {(rotatable || count > 1) &&
        row(
          <>
            {"Scale % "}
            {count === 1 && (
              <button data-lock title="Keep proportions" onClick={() => editor.toggleScaleLock()}>
                <Icon name={lock ? "link-variant" : "link-variant-off"} />
              </button>
            )}
          </>,
          <>
            {cell("x", "sx", 100, 5)}
            {cell("y", "sy", 100, 5)}
            {cell("z", "sz", 100, 5)}
          </>,
        )}
      {size &&
        row(
          inUnits("Size"),
          <>
            {sizeCell("x", "wx", size[0])}
            {sizeCell("y", "wy", size[2], true)}
            {sizeCell("z", "wz", size[1])}
          </>,
        )}
    </>
  );
}

/** Per-light tuning: what this light looks like at the bulb's full brightness and colour. The live state from Home
 * Assistant still scales it; these set the top end (see _tuneLight in the core). */
function LightTune({ editor, itemKey, item }: { editor: Editor; itemKey: string; item: GenericItem }) {
  const rows = editor._lightTuneRows(item);
  return (
    <details class="ltune" open={!!editor._ltuneOpen} onToggle={(ev) => (editor._ltuneOpen = ev.currentTarget.open)}>
      <summary>Light settings</summary>
      {rows.map(({ field, label, min, max, step, normal, format, hint }) => (
        <label key={field}>
          <span class="n">{label}</span>
          <output data-lo={field}>{format(item[field] ?? normal)}</output>
          <input
            type="range"
            data-lt={field}
            min={min}
            max={max}
            step={step}
            value={item[field] ?? normal}
            onInput={(ev) => editor.tuneLight(itemKey, field, ev.currentTarget.valueAsNumber)}
            onChange={() => editor.finishLightTune()}
          />
          {hint && <span class="d">{hint}</span>}
        </label>
      ))}
      {rows.some(({ field }) => item[field] != null) && (
        <div class="row">
          <button data-lreset onClick={() => editor.resetLightTune(itemKey)}>
            Reset light settings
          </button>
        </div>
      )}
    </details>
  );
}

/** A string light's length, bulbs and sag. */
function StringLight({ editor, itemKey, item }: { editor: Editor; itemKey: string; item: GenericItem }) {
  const card = editor.card;
  const unit = card._imperial() ? "in" : "cm";
  const length = stringLen(item.points);
  const sag = R1(item.sag ?? Math.min(8, (length / Math.max(1, item.points.length - 1)) * 0.05));
  const set = (name: string) => (ev: Event) =>
    editor._field(itemKey, name, (ev.currentTarget as HTMLInputElement).value);
  return (
    <>
      <div class="grid">
        <Field label={`Length (${unit})`} data-f="len" value={editor._toReal(length)} onChange={set("len")} />
        <Field label="Bulbs (0 = auto)" data-f="count" value={item.count || 0} onChange={set("count")} />
        <Field label="Sag" data-f="sag" step={0.5} value={sag} onChange={set("sag")} />
      </div>
      <div class="sub" style="margin:4px 0 8px">
        {stringCount(item)} bulbs{item.count ? "" : ", about one every " + card._fmtLen(item.spacing || 14)}. Drag the
        yellow dots to stretch it, or a white dot to bend it.
      </div>
      {item.points.length > 2 && (
        <div class="row" style="margin:0 0 8px">
          <button data-b="straighten" onClick={() => editor._field(itemKey, "straighten")}>
            Straighten
          </button>
        </div>
      )}
    </>
  );
}
