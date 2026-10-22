/* The floor plan inspector: setting the blueprint's scale, tips for the drawing tool in use, and the fields of a
 * selected wall, door or window, room or blueprint. Changes go through the editor's _planField.
 */
import type { ComponentType } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { Opening, Pt, WallSeg } from "../types";
import type { GenericItem } from "../core/items";
import type { Editor } from "./editor";
import { AdvancedJson, Choice, Field, Icon, Sun, Title } from "./inspector-panel";
import { DOOR_STYLES, R1, SURFACES, polyArea, segDir } from "./shared";

type Props = { editor: Editor; itemKey: string; item: GenericItem };

/** sets a plan field from an input (a checkbox gives whether it is ticked) */
const setter = (editor: Editor, key: string, name: string) => (ev: Event) => {
  const input = ev.currentTarget as HTMLInputElement;
  editor._planField(key, name, input.type === "checkbox" ? input.checked : input.value);
};

function PlanButton(props: { editor: Editor; itemKey?: string; name: string; icon?: string; children: string }) {
  return (
    <button data-pb={props.name} onClick={() => props.editor._planField(props.itemKey ?? "", props.name)}>
      {props.icon && <Icon name={props.icon} />}
      {props.children}
    </button>
  );
}

function Checkbox(props: {
  label: string;
  checked: boolean;
  onChange: (ev: Event) => void;
  attrs: Record<string, string>;
}) {
  return (
    <label class="chk">
      <input type="checkbox" {...props.attrs} checked={props.checked} onChange={props.onChange} /> {props.label}
    </label>
  );
}

export function PlanInspector({ editor }: { editor: Editor }) {
  const card = editor.card;
  const edit = card._edit;
  if (card._tool === "measure") return <Measure editor={editor} />;
  if (!edit.sel.size) return <PlanStart editor={editor} />;
  const key = edit.primary;
  const kind = key[0];
  const item = editor.item(key);
  const count = edit.sel.size;
  const Body = BODIES[kind];
  const inline = kind === "p" && String(item.src).startsWith("data:"); // a picked file, too long to show
  const applyJson = (text: string) => {
    if (inline)
      try {
        const value = JSON.parse(text);
        if (value.src === "(inline image)") value.src = item.src;
        text = JSON.stringify(value);
      } catch {
        /* applyJson reports it */
      }
    editor.applyJson(key, text);
  };
  return (
    <>
      <Title editor={editor}>{editor._label(key)}</Title>
      <div class="sub">{count > 1 ? `${count} items selected — drag moves all` : summary(editor, kind, item)}</div>
      {Body && <Body editor={editor} itemKey={key} item={item} />}
      <AdvancedJson value={inline ? { ...item, src: "(inline image)" } : item} onApply={applyJson} />
    </>
  );
}

/** the fields for each kind of plan item: walls, openings (doors and windows), rooms and blueprints */
const BODIES: Record<string, ComponentType<Props>> = {
  w: (p) => <Wall {...p} />,
  n: (p) => <OpeningFields {...p} />,
  r: (p) => <Room {...p} />,
  p: (p) => <Blueprint {...p} />,
};

/** the line under the title for one selected item */
function summary(editor: Editor, kind: string, item: GenericItem) {
  const card = editor.card;
  if (kind === "w") return `${card._fmtLen(segDir(item as WallSeg)[2])} long`;
  if (kind === "n") return "A box cut out of the walls it overlaps";
  if (kind === "r") {
    const xs = item.pts.map((p: Pt) => p[0]),
      ys = item.pts.map((p: Pt) => p[1]);
    const width = Math.max(...xs) - Math.min(...xs),
      depth = Math.max(...ys) - Math.min(...ys);
    return `${card._fmtArea(polyArea(item.pts))} · ${card._fmtLen(width)} × ${card._fmtLen(depth)}`;
  }
  if (kind === "p") return `${card._fmtLen(item.w)} × ${card._fmtLen(item.h)}`;
  return "";
}

/** Nothing selected: what the current tool does, the blueprint, and north. */
function PlanStart({ editor }: { editor: Editor }) {
  const card = editor.card;
  const drawing = editor._draw;
  const corners = drawing?.pts?.length || 0;
  const tips: Record<string, string> = {
    select:
      "Drag a corner dot to reshape walls (every wall meeting there follows). Drag a wall, door or window to move it. Tap one to edit its size.",
    wall: drawing?.start
      ? "Click to place the next corner. Click the last corner again, or press Enter, to finish."
      : "Click where the wall starts, then where it ends. Keep clicking to chain walls. Ends snap to corners and to other walls.",
    door: "Click a wall to cut a door into it.",
    window: "Click a wall to cut a window into it.",
    room: corners
      ? `${corners} corner${corners > 1 ? "s" : ""} so far. Click the first corner (or press Enter) to close the room.`
      : "Click each corner of the room in turn. Corners snap to walls and to other rooms' corners.",
  };
  return (
    <>
      <Title editor={editor}>Floor plan</Title>
      <div class="sub">{tips[card._tool] || ""}</div>
      <div class="row">
        {editor._list("p").length ? (
          <PlanButton editor={editor} name="bpsel" icon="image-outline">
            Blueprint settings
          </PlanButton>
        ) : (
          <PlanButton editor={editor} name="bpadd" icon="image-plus">
            Add a blueprint image…
          </PlanButton>
        )}
      </div>
      <details class="tips">
        <summary>Tips</summary>
        Snap lines walls up on corners, other walls and 15° angles; turn it off to trace odd angles. Doors and windows
        are boxes cut out of whatever wall they overlap, so you can also stretch one across a corner. Lengths are shown
        in {card._imperial() ? "feet and inches" : "metric"}.
      </details>
      <Sun editor={editor} preview={false} />
    </>
  );
}

/** Set scale: measure a line on the blueprint, then say how long it really is. */
function Measure({ editor }: { editor: Editor }) {
  const measured = editor._measure.pts?.length >= 2;
  return (
    <>
      <Title editor={editor}>Set blueprint scale</Title>
      {measured ? (
        <MeasureLength editor={editor} />
      ) : (
        <>
          <div class="sub">
            Click one end of something whose real length you know (a dimension line or a wall), then the other end.
          </div>
          <div class="row">
            <PlanButton editor={editor} name="mcancel">
              Cancel
            </PlanButton>
          </div>
        </>
      )}
    </>
  );
}

const CM_PER = { cm: 1, m: 100, in: 2.54, ft: 30.48 };

function MeasureLength({ editor }: { editor: Editor }) {
  const imperial = editor.card._imperial();
  const length = useRef<HTMLInputElement>(null);
  const unit = useRef<HTMLSelectElement>(null);
  useEffect(() => length.current?.focus(), []);
  const units = imperial ? ["ft", "in", "m", "cm"] : ["cm", "m", "ft", "in"];
  const apply = () =>
    editor._applyScale(Number(length.current!.value) * CM_PER[unit.current!.value as keyof typeof CM_PER]);
  return (
    <>
      <div class="sub">How long is that line in real life?</div>
      <div class="grid" style="grid-template-columns:2fr 1fr">
        <label>
          Length
          <input data-m="len" type="number" step={0.1} placeholder={imperial ? "12.5" : "350"} ref={length} />
        </label>
        <label>
          Unit
          <select data-m="unit" ref={unit}>
            {units.map((u) => (
              <option>{u}</option>
            ))}
          </select>
        </label>
      </div>
      <div class="sub">{imperial ? "12′ 6″ is 12.5 ft." : ""}</div>
      <div class="row">
        <button data-m="apply" class="primary" onClick={apply}>
          Apply
        </button>
        <PlanButton editor={editor} name="mredo">
          Measure again
        </PlanButton>
        <PlanButton editor={editor} name="mcancel">
          Cancel
        </PlanButton>
      </div>
    </>
  );
}

/** The texture drop-down: the surfaces that suit a wall ("w") or a floor ("f"), plus whatever is set now. */
function Texture({ editor, itemKey, value, use }: { editor: Editor; itemKey: string; value?: string; use: string }) {
  const options: [string, string][] = [
    ["none", "Plain"],
    ...Object.entries(SURFACES)
      .filter(([name, [, , fits]]) => fits.includes(use) || name === value)
      .map(([name, [label]]): [string, string] => [name, label]),
  ];
  return (
    <Choice
      label="Texture"
      attrs={{ "data-p": "texture" }}
      options={options}
      value={value && SURFACES[value] ? value : "none"}
      onChange={(texture) => editor._planField(itemKey, "texture", texture)}
    />
  );
}

function Wall({ editor, itemKey, item }: Props) {
  const card = editor.card;
  const scene = card._work.scene || {};
  const unit = card._imperial() ? "in" : "cm";
  const [ux, uy, length] = segDir(item as WallSeg);
  const angle = R1(((((Math.atan2(uy, ux) * 180) / Math.PI) % 360) + 360) % 360);
  const set = (name: string) => setter(editor, itemKey, name);
  const button = (name: string, icon: string, text: string) => (
    <PlanButton editor={editor} itemKey={itemKey} name={name} icon={icon}>
      {text}
    </PlanButton>
  );
  return (
    <>
      <div class="grid">
        <Field label={`Length (${unit})`} data-p="len" value={editor._toReal(length)} onChange={set("len")} />
        <Field
          label={`Thick (${unit})`}
          data-p="t"
          value={editor._toReal(item.t ?? scene.wall_thickness ?? 4)}
          onChange={set("t")}
        />
        <Field
          label={`Height (${unit})`}
          data-p="h"
          value={editor._toReal(item.h ?? scene.wall_height ?? 46, true)}
          onChange={set("h")}
        />
        <Field label="Angle °" data-p="ang" step={15} value={angle} onChange={set("ang")} />
        <Field
          label="Colour"
          type="color"
          data-p="color"
          value={item.color || (scene.wall_colors || ["#e9dcc8"])[0]}
          onChange={set("color")}
        />
        <Texture editor={editor} itemKey={itemKey} value={item.texture ?? scene.wall_texture} use="w" />
      </div>
      <div class="row">
        {button("split", "content-cut", "Split")}
        {item.low
          ? button("low", "arrow-expand-up", "Full height")
          : button("low", "arrow-collapse-down", "Cut-away (low)")}
        {button("door", "door", "Add door")}
        {button("allwalls", "format-paint", "Use on all walls")}
      </div>
    </>
  );
}

/** which jamb a swinging door hangs from, or which way a sliding one moves (its pane starts on the other side) */
const HINGE: Record<string, [string, string, string]> = {
  panel: ["Hinge", "Left", "Right"],
  glass: ["Hinge", "Left", "Right"],
  barn: ["Slides", "Left", "Right"],
  sliding: ["Slides", "Right", "Left"],
};
const SWING: Record<string, string> = { barn: "Hangs on", sliding: "Front pane" };

function OpeningFields({ editor, itemKey, item }: Props) {
  const card = editor.card;
  const unit = card._imperial() ? "in" : "cm";
  const set = (name: string) => setter(editor, itemKey, name);
  const choose = (name: string) => (value: string) => editor._planField(itemKey, name, value);
  const button = (name: string, icon: string, text: string) => (
    <PlanButton editor={editor} itemKey={itemKey} name={name} icon={icon}>
      {text}
    </PlanButton>
  );
  return (
    <>
      <Choice
        label="Type"
        style="margin-bottom:8px"
        attrs={{ "data-p": "kind" }}
        options={[
          ["door", "Door"],
          ["window", "Window (with glass)"],
          ["cut", "Plain cut-out"],
        ]}
        value={item.kind || "cut"}
        onChange={choose("kind")}
      />
      <div class="grid">
        <Field label={`Width (${unit})`} data-p="w" value={editor._toReal(item.w)} onChange={set("w")} />
        <Field label={`Height (${unit})`} data-p="h" value={editor._toReal(item.h, true)} onChange={set("h")} />
        <Field
          label={`${item.kind === "window" ? "Sill" : "Bottom"} (${unit})`}
          data-p="z"
          value={editor._toReal(item.z || 0, true)}
          onChange={set("z")}
        />
        <Field label={`Depth (${unit})`} data-p="d" value={editor._toReal(item.d ?? 6)} onChange={set("d")} />
        <Field label="Rotate °" data-p="rot" step={15} value={item.rot || 0} onChange={set("rot")} />
      </div>
      <div class="row">
        {button("fit", "arrow-expand-horizontal", "Fit to wall")}
        {button("rotl", "rotate-left", "90°")}
        {button("rotr", "rotate-right", "90°")}
      </div>
      {item.kind === "door" && <Door editor={editor} itemKey={itemKey} item={item} />}
    </>
  );
}

/** A door's leaf: its style, colour, which way it opens, and the sensor that opens it. */
function Door({ editor, itemKey, item }: Props) {
  const card = editor.card;
  const style = DOOR_STYLES[item.style] ? item.style : "none";
  const hinge = HINGE[style];
  const choose = (name: string) => (value: string) => editor._planField(itemKey, name, value);
  const sensors = Object.keys(card._hass?.states || {})
    .filter((id) => /^(binary_sensor|cover|input_boolean)\./.test(id))
    .sort();
  return (
    <>
      <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:8px">
        <Choice
          label="Door"
          attrs={{ "data-p": "style" }}
          options={Object.entries(DOOR_STYLES).map(([name, [label]]): [string, string] => [name, label])}
          value={style}
          onChange={choose("style")}
        />
        {style !== "none" && (
          <Field
            label="Colour"
            type="color"
            data-p="color"
            value={item.color || DOOR_STYLES[style][1]}
            onChange={setter(editor, itemKey, "color")}
          />
        )}
        {hinge && (
          <Choice
            label={hinge[0]}
            attrs={{ "data-p": "hinge" }}
            options={[
              ["left", hinge[1]],
              ["right", hinge[2]],
            ]}
            value={item.hinge || "left"}
            onChange={choose("hinge")}
          />
        )}
        {style !== "none" && style !== "garage" && (
          <Choice
            label={SWING[style] || "Swings"}
            attrs={{ "data-p": "flip" }}
            options={[
              ["", "This side"],
              ["1", "Other side"],
            ]}
            value={item.flip ? "1" : ""}
            onChange={choose("flip")}
          />
        )}
      </div>
      {style !== "none" && (
        <>
          <Field
            label="Sensor (open / shut)"
            labelStyle="margin-top:8px"
            type="text"
            data-p="entity"
            list="doorents"
            value={item.entity || ""}
            placeholder="binary_sensor.front_door"
            onChange={setter(editor, itemKey, "entity")}
          />
          <datalist id="doorents">
            {sensors.map((id) => (
              <option value={id} />
            ))}
          </datalist>
          {item.entity ? (
            <div class="sub" style="margin-top:4px">
              {card._hass?.states[item.entity]?.attributes?.friendly_name || "Unknown entity"} · now{" "}
              {card._doorTarget(item as Opening) ? "open" : "shut"}
            </div>
          ) : (
            <Checkbox
              label="Show it open"
              attrs={{ "data-p": "open" }}
              checked={!!item.open}
              onChange={setter(editor, itemKey, "open")}
            />
          )}
        </>
      )}
    </>
  );
}

function Room({ editor, itemKey, item }: Props) {
  const corner = editor.card._vsel?.key === itemKey; // a corner of this room is picked
  const set = (name: string) => setter(editor, itemKey, name);
  return (
    <>
      <div class="grid" style="grid-template-columns:2fr 1fr">
        <Field label="Name" type="text" data-p="name" value={item.name || ""} onChange={set("name")} />
        <Field label="Colour" type="color" data-p="fill" value={item.fill || "#b3a58f"} onChange={set("fill")} />
      </div>
      <div class="grid" style="grid-template-columns:1fr;margin-top:6px">
        <Texture editor={editor} itemKey={itemKey} value={item.texture} use="f" />
      </div>
      <Checkbox
        label="Show in the room menu"
        attrs={{ "data-p": "menu" }}
        checked={item.menu !== false}
        onChange={set("menu")}
      />
      <div class="row">
        {corner && item.pts.length > 3 && (
          <PlanButton editor={editor} itemKey={itemKey} name="delcorner" icon="close">
            Remove corner
          </PlanButton>
        )}
      </div>
      <div class="sub" style="margin-top:6px">
        Drag the green corners to reshape the room; drag a white dot to add a corner. Tap a corner, then Delete, to
        remove it. The room menu frames the room by this outline.
      </div>
    </>
  );
}

function Blueprint({ editor, itemKey, item }: Props) {
  const unit = editor.card._imperial() ? "in" : "cm";
  const set = (name: string) => setter(editor, itemKey, name);
  const src = String(item.src || "");
  return (
    <>
      <Field
        label="Opacity"
        labelStyle="margin-bottom:8px"
        type="range"
        data-p="opacity"
        min={0.1}
        max={1}
        step={0.05}
        value={item.opacity ?? 0.6}
        onChange={set("opacity")}
      />
      <div class="grid">
        <Field label={`Width (${unit})`} data-p="w" value={editor._toReal(item.w)} onChange={set("w")} />
        <Field label="Rotate °" data-p="rot" value={item.rot || 0} onChange={set("rot")} />
      </div>
      <div class="row" style="margin:0 0 8px">
        <button data-pb="scale" class="primary" onClick={() => editor._planField(itemKey, "scale")}>
          <Icon name="ruler" />
          Set scale…
        </button>
        <PlanButton editor={editor} itemKey={itemKey} name="rotl" icon="rotate-left">
          90°
        </PlanButton>
        <PlanButton editor={editor} itemKey={itemKey} name="rotr" icon="rotate-right">
          90°
        </PlanButton>
      </div>
      <Checkbox
        label="Lock in place (clicks go through it)"
        attrs={{ "data-p": "locked" }}
        checked={!!item.locked}
        onChange={set("locked")}
      />
      <Checkbox
        label="Also show it outside edit mode"
        attrs={{ "data-p": "show" }}
        checked={!!item.show}
        onChange={set("show")}
      />
      <Field
        label="Image URL"
        labelStyle="margin-top:8px"
        type="text"
        data-p="url"
        value={src.startsWith("data:") ? "" : src}
        placeholder="/local/plan.png (or pick a file)"
        onChange={set("url")}
      />
      <div class="row">
        <PlanButton editor={editor} itemKey={itemKey} name="bpreplace">
          Replace image…
        </PlanButton>
      </div>
    </>
  );
}
