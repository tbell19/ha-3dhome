/* What crosses between the card (the core module) and the editor (the editor module, loaded when Edit is first pressed).
 *
 *   EditorHost  the part of the card the editor may use
 *   CardEditor  what the card calls on its editor
 *   EditorModule what the editor module hands the core when it loads
 *
 * Both modules are bundled separately, so this file holds types only.
 */
import type * as THREE from "three";
import type { Pt } from "./types";
import type { GenericItem } from "./core/items";
import type { Home3DCard } from "./card/card";
import type { SnapOptions } from "./editor/plan";

/** The card's methods take `this: Home3DCard` (they live in its parts); called on the card they need no such note. */
type Bound<T> = { [K in keyof T]: OmitThisParameter<T[K]> };

/** The card as the editor sees it. */
export type EditorHost = Bound<
  Pick<
    Home3DCard,
    // the element and Home Assistant
    | "isConnected"
    | "dispatchEvent"
    | "_hass"
    | "_offSince"
    | "_gen"
    // config: as given, and the copy being edited
    | "_config"
    | "_cfgJSON"
    | "_cfg"
    | "_work"
    | "_edit"
    | "_layoutStore"
    // DOM
    | "_wrap"
    | "_editorLayer"
    | "_edBtn"
    | "_keys"
    | "_toast"
    // Three.js, the camera and the world
    | "T"
    | "_renderer"
    | "_scene"
    | "_cam"
    | "_controls"
    | "_sph"
    | "_toggleTop"
    | "_screenDir"
    | "_upp"
    | "_world"
    | "_items"
    | "_mats"
    | "_helpers"
    | "_rebuild"
    | "_applyLayout"
    | "_update"
    | "_requestRender"
    | "_disposeTree"
    | "_modelErr"
    | "_modelScale"
    | "_openLib"
    // the transform gizmo and drags
    | "_tc"
    | "_tcDragging"
    | "_tcUsed"
    | "_pivot"
    | "_drag"
    // the floor plan layer
    | "_plan"
    | "_tool"
    | "_vsel"
    | "_buildPlanLayer"
    | "_wallG"
    | "_jointMeshes"
    | "_midMeshes"
    | "_roomHG"
    | "_vertMeshes"
    | "_strHG"
    | "_sptMeshes"
    | "_smidMeshes"
    | "_scaleHandles"
    | "_doorTarget"
    | "_imperial"
    | "_fmtLen"
    | "_fmtArea"
    // lights, rooms and room controls
    | "_lightGroups"
    | "_tuneLight"
    | "_sunPreview"
    | "_rooms"
    | "_focusRoom"
    | "_rcRoom"
    | "_makeCards"
  >
>;

/** The editor as the card sees it. The card makes one when Edit is first pressed and drops it in _teardown. */
export interface CardEditor {
  /** start editing: copy the config into card._work, add the gizmo and the toolbar */
  enter(): Promise<void>;
  /** the config item behind an item key ("b:3") in the copy being edited */
  item(key: string): GenericItem;

  // selection and drags, driven by the card's pointer handling
  clickSelect(key: string | null, additive?: boolean, alone?: boolean): void;
  dragStart(kind: string): void;
  dragPreview(): void;
  dragEnd(): void;
  /** push the edited config through a rebuild, keeping the selection */
  commit(keys?: string[]): void;
  renderInspector(): void;

  // the floor plan tools
  toolHover(ev: PointerEvent, p: Pt | null): void;
  toolClick(p: Pt, key: string | null, ev: PointerEvent): void;
  snapPoint(p: Pt, opts?: SnapOptions): { p: Pt; kind: string };
  rebuildPlan(): void;
  applyPlanVis(): void;
  jointMat(sel: boolean): THREE.Material;
  paintJoints(): void;
  buildRoomHandles(): void;
  buildStringHandles(): void;

  // drawing previews and the measuring tip
  showMarker(p: Pt, kind: string): void;
  scalePreview(unitsPerPixel: number): void;
  hidePreview(keepLine?: boolean): void;
  disposePreview(): void;
  showTip(ev: MouseEvent, text: string): void;
  hideTip(): void;
}

/** What the editor module registers with the core when it loads (editorApi.provideEditor). */
export interface EditorModule {
  version: string;
  create(card: EditorHost): CardEditor;
}
