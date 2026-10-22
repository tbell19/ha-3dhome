/* The editor: everything behind the ✎ Edit button, as one object the card owns while it lives (card._editor).
 *
 * It reaches the card only through EditorHost and the card calls it only through CardEditor (both in
 * src/editor-contract.ts), so what crosses between the two modules is written down in one place. Its methods are split
 * by topic into the parts below and copied onto Editor's prototype, the same way the card's own parts are.
 */
import type * as THREE from "three";
import type { Pt } from "../types";
import type { CardEditor, EditorHost } from "../editor-contract";
import { EditorSession } from "./session";
import { EditorSelection } from "./selection";
import { EditorPanels } from "./panels";
import { EditorInspector } from "./inspector";
import { EditorPlan } from "./plan";
import { EditorSave } from "./save";
import { EditorLibrary } from "./library";

export interface Editor
  extends EditorSession,
    EditorSelection,
    EditorPanels,
    EditorInspector,
    EditorPlan,
    EditorSave,
    EditorLibrary {}

export class Editor implements CardEditor {
  /* `declare` adds types only: no field is created, so nothing changes at runtime. */

  // the toolbar and panels
  declare _coarse: boolean; // touch-first device: no gizmo, drag selected items directly
  declare _inspMin: boolean; // the inspector folded to its title bar
  declare _ltuneOpen: boolean; // the light tuning panel is open
  declare _ltDrag: boolean;
  declare _lookDrag: boolean;
  declare _downloads: Record<string, Promise<string | null>>; // library downloads in progress, by file

  // selection
  declare _pivotC: Pt; // the plan point the selection turns about

  // the floor plan tools
  declare _draw: Record<string, any> | null; // the wall or room being drawn
  declare _measure: any;
  declare _planHinted: boolean;
  declare _planTopped: boolean; // the view went top-down when the plan opened
  declare _prevMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null; // drawing preview
  declare _prevDot: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null; // snap marker
  declare _prevLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | null; // room outline preview

  constructor(readonly card: EditorHost) {}
}

for (const part of [
  EditorSession,
  EditorSelection,
  EditorPanels,
  EditorInspector,
  EditorPlan,
  EditorSave,
  EditorLibrary,
])
  for (const k of Object.getOwnPropertyNames(part.prototype))
    if (k !== "constructor")
      Object.defineProperty(Editor.prototype, k, Object.getOwnPropertyDescriptor(part.prototype, k)!);
