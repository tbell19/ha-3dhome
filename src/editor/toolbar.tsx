/* The editor's toolbar: a top row (Furniture / Floor plan, undo and redo, Cancel, Save) and a row of tools for what
 * is selected. Item tools show only with a selection and scene tools only without one; the rest sit in the Draw and
 * More menus. On a phone the rows stack and only `.ico` buttons drop their label. It is drawn again from the
 * editor's state on every _syncBar, and each button calls editor.toolbarAction.
 */
import { render, type ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import type { Editor } from "./editor";
import { Icon } from "./inspector-panel";
import { isOpen, panelButtons } from "./side-panels";

export function showToolbar(editor: Editor, host: HTMLElement) {
  render(<Toolbar editor={editor} />, host);
}

/** the floor plan's drawing tools: [icon, label] */
const DRAW_TOOLS: Record<string, [string, string]> = {
  wall: ["wall", "Walls"],
  door: ["door", "Door"],
  window: ["window-closed-variant", "Window"],
  room: ["vector-polygon", "Room"],
};

interface ButtonProps {
  editor: Editor;
  action: string;
  icon: string;
  label: string;
  title?: string;
  /** `ico`: only the icon on a phone */
  compact?: boolean;
  on?: unknown;
  disabled?: unknown;
  hidden?: unknown;
}

function Toolbar({ editor }: { editor: Editor }) {
  const card = editor.card;
  const edit = card._edit;
  const plan = !!card._plan;
  const count = edit.sel.size;
  const selecting = !plan || card._tool === "select";

  /** an item tool (shown with a selection) or a scene tool (shown without one) */
  const forItems = { hidden: !count };
  const forScene = { hidden: !!count };
  const drawing = DRAW_TOOLS[card._tool];

  return (
    <>
      <div class="bar">
        <div class="top">
          <span class="seg modes">
            <Button
              editor={editor}
              action="m-furn"
              icon="sofa-outline"
              label="Furniture"
              title="Edit furniture and devices"
              on={!plan}
            />
            <Button
              editor={editor}
              action="m-plan"
              icon="floor-plan"
              label="Floor plan"
              title="Edit walls, doors, windows and the blueprint"
              on={plan}
            />
          </span>
          <span class="acts">
            <Button
              editor={editor}
              action="undo"
              icon="undo"
              label="Undo"
              title="Undo (Ctrl+Z)"
              compact
              disabled={!edit.undo.length}
            />
            <Button
              editor={editor}
              action="redo"
              icon="redo"
              label="Redo"
              title="Redo (Ctrl+Shift+Z)"
              compact
              disabled={!edit.redo.length}
            />
            <button data-a="cancel" onClick={() => editor.toolbarAction("cancel")}>
              Cancel
            </button>
            <button data-a="save" class="primary" onClick={() => editor.toolbarAction("save")}>
              {edit.dirty ? "Save •" : "Save"}
            </button>
          </span>
        </div>
        <div class="tools">
          {plan ? (
            <>
              <Button
                editor={editor}
                action="t-select"
                icon="cursor-default-outline"
                label="Select"
                title="Select and move (V)"
                on={selecting && edit.mode !== "rotate"}
              />
              <Button
                editor={editor}
                action="rotate"
                icon="rotate-right"
                label="Rotate"
                title="Rotate (R)"
                on={selecting && edit.mode === "rotate"}
                {...forItems}
              />
              <MenuButton
                editor={editor}
                name="draw"
                icon={drawing?.[0] || "pencil-ruler"}
                label={drawing?.[1] || "Draw"}
                title="Draw walls, doors, windows and rooms"
                on={!!drawing}
              />
              <Button
                editor={editor}
                action="bp"
                icon="image-outline"
                label="Blueprint"
                title="Blueprint image to trace over"
                on={edit.primary?.[0] === "p" && count}
                {...forScene}
              />
              <Button
                editor={editor}
                action="del"
                icon="delete-outline"
                label="Delete"
                title="Delete (Del)"
                compact
                {...forItems}
              />
              <MenuButton editor={editor} name="more" icon="dots-horizontal" label="More" title="More options" />
            </>
          ) : (
            <>
              {(
                [
                  ["add", "plus", "Add", "Add entities, boxes or models"],
                  ["look", "palette-outline", "Look", "Lighting, effects and idle view"],
                  ["controls", "tune-variant", "Controls", "Cards shown for each room"],
                ] as const
              ).map(([action, icon, label, title]) => (
                <Button
                  editor={editor}
                  action={action}
                  icon={icon}
                  label={label}
                  title={title}
                  on={isOpen(editor, panelButtons[action])}
                  {...forScene}
                />
              ))}
              <Button
                editor={editor}
                action="translate"
                icon="cursor-move"
                label="Move"
                title="Move (W)"
                on={edit.mode === "translate"}
                {...forItems}
              />
              <Button
                editor={editor}
                action="rotate"
                icon="rotate-right"
                label="Rotate"
                title="Rotate (E)"
                on={selecting && edit.mode === "rotate"}
                {...forItems}
              />
              <Button
                editor={editor}
                action="scale"
                icon="resize"
                label="Scale"
                title="Scale (R)"
                on={edit.mode === "scale"}
                {...forItems}
              />
              <Button
                editor={editor}
                action="del"
                icon="delete-outline"
                label="Delete"
                title="Delete (Del)"
                compact
                {...forItems}
              />
              <MenuButton
                editor={editor}
                name="more"
                icon="dots-horizontal"
                label="More"
                title="More options"
                hidden={!count}
              />
            </>
          )}
        </div>
      </div>

      {plan ? (
        <>
          <Menu editor={editor} name="draw">
            {Object.entries(DRAW_TOOLS).map(([tool, [icon, label]]) => (
              <Button
                editor={editor}
                action={"t-" + tool}
                icon={icon}
                label={label}
                on={card._tool === tool}
                title={DRAW_TITLES[tool]}
              />
            ))}
          </Menu>
          <Menu editor={editor} name="more">
            <Button
              editor={editor}
              action="furnvis"
              icon="eye-outline"
              label="Show furniture"
              title="Show furniture while editing the plan"
              on={edit.showFurn}
            />
            <Button
              editor={editor}
              action="snap"
              icon="magnet"
              label="Snap to corners and angles"
              title="Snap to grid, corners and 15° angles"
              on={edit.snap}
            />
          </Menu>
        </>
      ) : (
        <Menu editor={editor} name="more">
          <Button
            editor={editor}
            action="dup"
            icon="content-copy"
            label="Duplicate"
            title="Duplicate (Ctrl+D)"
            disabled={!count}
          />
          <Button
            editor={editor}
            action="group"
            icon="group"
            label="Group"
            title="Group the selected items"
            disabled={count < 2}
          />
          <Button editor={editor} action="ungroup" icon="ungroup" label="Ungroup" title="Ungroup" disabled={!count} />
          <Button
            editor={editor}
            action="space"
            icon={edit.space === "local" ? "compass-outline" : "earth"}
            label={edit.space === "local" ? "Own axes" : "Global axes"}
            title="Gizmo axes: the world's, or the selected item's own (X)"
            on={edit.space === "local"}
          />
          <Button
            editor={editor}
            action="snap"
            icon="magnet"
            label="Snap to grid"
            title="Snap to grid / 15° / 5%"
            on={edit.snap}
          />
        </Menu>
      )}
    </>
  );
}

function Button({ editor, action, icon, label, title, compact, on, disabled, hidden }: ButtonProps) {
  return (
    <button
      data-a={action}
      class={[compact && "ico", on && "on", hidden && "hide"].filter(Boolean).join(" ") || undefined}
      title={title}
      disabled={!!disabled}
      onClick={() => editor.toolbarAction(action)}
    >
      <Icon name={icon} />
      <span class="lbl">{label}</span>
    </button>
  );
}

/** a button that opens the Draw or More menu */
function MenuButton(props: {
  editor: Editor;
  name: string;
  icon: string;
  label: string;
  title: string;
  on?: boolean;
  hidden?: boolean;
}) {
  const open = props.editor._menu?.name === props.name;
  return (
    <button
      data-m={props.name}
      class={[open && "open", props.on && "on", props.hidden && "hide"].filter(Boolean).join(" ") || undefined}
      title={props.title}
      onClick={(ev) => props.editor.toggleMenu(props.name, ev.currentTarget)}
    >
      <Icon name={props.icon} />
      <span class="lbl">{props.label}</span>
      <Icon name="menu-down" />
    </button>
  );
}

const DRAW_TITLES: Record<string, string> = {
  wall: "Draw walls (W)",
  door: "Add a door to a wall (D)",
  window: "Add a window to a wall",
  room: "Draw a room outline",
};

/** The Draw or More menu, under its button while open. */
function Menu({ editor, name, children }: { editor: Editor; name: string; children: ComponentChildren }) {
  const box = useRef<HTMLDivElement>(null);
  const open = editor._menu?.name === name;
  useLayoutEffect(() => {
    const button = editor._menu?.button;
    if (!open || !button || !box.current) return;
    const wrap = editor.card._wrap.getBoundingClientRect();
    const at = button.getBoundingClientRect();
    const bar = editor.card._editorLayer.querySelector<HTMLElement>(".bar")!.getBoundingClientRect();
    box.current.style.top = bar.bottom - wrap.top + 6 + "px";
    box.current.style.left =
      Math.max(8, Math.min(at.left - wrap.left, wrap.width - box.current.offsetWidth - 8)) + "px";
  }, [open]);
  return (
    <div class={open ? "menu pop" : "menu pop hide"} data-pop={name} ref={box}>
      {children}
    </div>
  );
}
