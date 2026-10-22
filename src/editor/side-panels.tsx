/* The editor's side panels (Look, Room controls, Add to map) are Preact components. Each one draws from the editor's
 * state (mostly card._work), so after any change the editor simply draws the open ones again (refreshSidePanels) and
 * Preact updates what changed. A panel keeps its own small UI state, such as a search box, between redraws.
 */
import { render, type ComponentType } from "preact";
import type { Editor } from "./editor";
import { LookPanel } from "./look-panel";
import { RoomControlsPanel } from "./room-controls-panel";
import { AddPanel } from "./add-panel";

/** The side panels, by the class their box gets (the stylesheet in card/styles.ts styles them by it). */
const PANELS = {
  lookp: { component: LookPanel, button: "look" },
  rcp: { component: RoomControlsPanel, button: "controls" },
  ents: { component: AddPanel, button: "add" },
} satisfies Record<string, { component: ComponentType<{ editor: Editor }>; button: string }>;

export type SidePanel = keyof typeof PANELS;

/** Only one of these shows at a time: they share the right-hand side. */
const EXCLUSIVE: SidePanel[] = ["lookp", "rcp", "ents"];

const hostOf = (editor: Editor, name: SidePanel) =>
  editor.card._editorLayer?.querySelector<HTMLElement>(":scope > ." + name);

export const isOpen = (editor: Editor, name: SidePanel) => !!hostOf(editor, name);

/** Opens a side panel (closing the others), or closes it when it is already open. */
export function toggleSidePanel(editor: Editor, name: SidePanel, open = !isOpen(editor, name)) {
  if (!open) return closeSidePanel(editor, name);
  if (isOpen(editor, name)) return;
  for (const other of EXCLUSIVE) if (other !== name) closeSidePanel(editor, other);
  const host = document.createElement("div");
  host.className = name;
  editor.card._editorLayer.append(host);
  draw(editor, name, host);
  editor._syncBar();
}

export function closeSidePanel(editor: Editor, name: SidePanel) {
  const host = hostOf(editor, name);
  if (!host) return;
  render(null, host); // unmounts it, so its effects clean up
  host.remove();
  editor._syncBar();
}

/** Closes whichever side panel is open. */
export function closeSidePanels(editor: Editor) {
  for (const name of Object.keys(PANELS) as SidePanel[]) closeSidePanel(editor, name);
}

/** Draws every open side panel again from the editor's current state. */
export function refreshSidePanels(editor: Editor) {
  for (const name of Object.keys(PANELS) as SidePanel[]) {
    const host = hostOf(editor, name);
    if (host) draw(editor, name, host);
  }
}

/** the toolbar button that shows whether a panel is open */
export const panelButtons = Object.fromEntries(
  Object.entries(PANELS).map(([name, p]) => [p.button, name as SidePanel]),
) as Record<string, SidePanel>;

function draw(editor: Editor, name: SidePanel, host: HTMLElement) {
  const Panel = PANELS[name].component;
  render(<Panel editor={editor} />, host);
}
