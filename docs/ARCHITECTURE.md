# Architecture

3D Home has two halves:

- **The frontend:** small TypeScript modules under `src/`, bundled by esbuild into `custom_components/ha_3dhome/frontend/`: `ha-3dhome.js` (the sidebar page and the 3D map), `ha-3dhome-editor.js` (everything behind ✎ Edit, which the core fetches from its own folder the first time Edit is pressed) and `lib/`, the files either loads when first needed (Three.js and its add-ons, JSZip, js-yaml, the editor's body). Nothing comes from a CDN, so the map works with no internet. See [Third-party modules](#third-party-modules).
- **The integration** (`custom_components/ha_3dhome/`, Python): it serves those files, adds the sidebar page and keeps each page's map in Home Assistant's storage. See [The panel and the integration](#the-panel-and-the-integration).

This doc walks through them top to bottom.

## Third-party modules

Three.js (`three@0.160.0` and its add-ons), JSZip (`jszip@3.10.1`), js-yaml (`js-yaml@4.1.0`) and Preact are npm dev dependencies with exact versions, and the build bundles them: the map never fetches code from the internet, so it keeps working when the internet is down. Each third-party module is a dynamic `import()` (`src/core/libs.ts` for the core, `loadTransformControls`/`loadYaml` in `src/editor/shared.ts` for the editor). esbuild builds both entries in one pass with code splitting, so every dynamic import becomes its own file in `frontend/lib/` and the core and editor share one copy of Three.js (the gizmo has to use the same Three.js as the map). The lib/ files are named by a hash of their content, because Home Assistant caches the integration's static files for a long time and only the entries carry `?v=`.

What loads when: opening the page fetches `ha-3dhome.js` (about 42 KB gzipped), then Three.js and OrbitControls (about 170 KB). The post-processing passes load when the `ao` or `bloom` look is on, the OBJ/MTL loaders and JSZip when a Sweet Home 3D model is placed or a library opened, and the editor, TransformControls and js-yaml only from ✎ Edit. `npm run build` writes a `.gz` copy next to every file; Home Assistant's static file handler sends it to any browser that accepts gzip.

## Module layout

| Path | What it does |
|---|---|
| `src/ha-3dhome.ts` | Core entry: defines `<ha-3dhome-panel>` and the map inside it, `<ha-3dhome-map>`; publishes `window.__ha3dhome`, tells `editor-loader` where the editor lives |
| `src/types.ts` | The config schema as types: `CardConfig`, `Scene`, `WallSeg`, `Opening`, `SceneItem`, `LightConfig`, `Chip`, `Hass`… |
| `src/global.d.ts` | What the code adds to `window` (`__ha3dhome`, `customCards`, `customStrategies`) |
| `src/core/constants.ts` | Version, names, plan centre `CX=296, CY=391`, the Sweet Home 3D library list `LIBS`, render-look defaults |
| `src/core/libs.ts` | The third-party modules (Three.js, OrbitControls, the OBJ/MTL loaders, post-processing, JSZip), each a lazy `import()` |
| `src/core/util.ts` | Rounding, cloning, escaping, `rotPt`, `inPoly`, `polyArea`, `stableJSON` |
| `src/core/items.ts` | Item kinds and pure item maths: `itemCenter`, `shiftItem`, `itemZ`, `scaleItem`, `mapPts` |
| `src/core/plan-geometry.ts` | `segDir`, `wallExtensions`, `wallPieces`, `planJoints` |
| `src/core/vec2.ts` | 2D vector helpers on plan points (`add`, `sub`, `dot`, `cross`, `perp`, `distance`, `lerp`) |
| `src/core/surfaces.ts`, `fixtures.ts`, `sun.ts`, `entities.ts`, `sh3d.ts` | Textures, fixtures and string lights, sun position, entity icons and states, `parseProps`/`zipFind`/the `IDB` cache |
| `src/core/lovelace.ts` | The panel's import from dashboards: `dashboardsWithHome` finds maps made with the 5.x card or strategy (and the ha-iso-home names) and brings them up to date |
| `src/panel/panel.ts` | `class Home3DPanel` (`<ha-3dhome-panel>`): the sidebar page. Follows its stored config, hands the map a `LayoutStore`, offers to import a dashboard's map |
| `src/card/card.ts` | `class Home3DCard`: every field (typed, with a comment), lifecycle (config, hass, connection, attach/detach, teardown) and `_rebuild()` |
| `src/card/startup.ts` … `plan.ts` | One part per topic: startup (`_init` and its steps), camera, rooms, scene build, models, lights, picking (pointer input), live update and looks, the plan layer |
| `src/card/batch.ts`, `ao-bake.ts` | Outside the editor: the static meshes merged into a few (`_batch`), and the corner shading baked into a map the materials read (`_bakeAO`) |
| `src/card/styles.ts` | The shadow DOM's stylesheet and markup |
| `src/card/editor-loader.ts` | `loadEditor()`: fetches the editor module on the first Edit press; `provideEditor()`: the editor module registers itself |
| `src/editor-contract.ts` | Types only: `EditorHost` (what the editor may use of the card), `CardEditor` (what the card calls on the editor), `EditorModule` |
| `src/editor-api.ts` | The core helpers the editor uses, published as `window.__ha3dhome` |
| `src/ha-3dhome-editor.ts` | Editor entry: checks the version, then registers the `Editor` with the core |
| `src/editor/editor.ts` | `class Editor`: the editor object, its own fields, and its parts copied onto its prototype |
| `src/editor/*.ts` | The editor's logic, one part per topic: `session` (enter/exit, toolbar actions, keys), `selection` (gizmo, drags, undo), `panels` (look, room controls, adding entities), `inspector` (what its fields do), `plan` (floor plan editor), `save`, `library`; `shared.ts` reads the core helpers |
| `src/editor/*.tsx` | The editor's UI as Preact components: `toolbar`, `inspector-panel` and `plan-inspector`, `side-panels` (hosts `look-panel`, `room-controls-panel`, `add-panel`), `library-panel` |
| `custom_components/ha_3dhome/` | The integration: `__init__.py` (serving the files, the panel), `config_flow.py`, `store.py` (a page's config and revision), `websocket.py` (follow and save) |

### How the parts make one class

Each part is a class whose methods take `this: Home3DCard`, for example `class CameraPart { _resize(this: Home3DCard) {…} }`. `card.ts` copies the card parts' methods onto `Home3DCard.prototype`. For the types, `card.ts` merges every part into the card's interface (`interface Home3DCard extends CameraPart, … {}`), so any part can call any other part's method and the type checker knows its signature. Fields are declared once, in `card.ts`, with `declare` (types only, no runtime code).

### The editor is its own object

The editor is not part of the card. It is an `Editor` (`src/editor/editor.ts`), built from its own parts the same way (methods take `this: Editor`), holding the state only the editor uses (drawing previews, panel state, the touch flag). The card makes one the first time Edit is pressed (`_openEditor` → `loadEditor()` → `create(card)`) and keeps it in `card._editor` until `_teardown()`.

Everything that crosses between them is written down in `src/editor-contract.ts`:

- **`EditorHost`** lists the card fields and methods the editor may use. The editor reaches them as `this.card.…`, so a line that touches the card is plain to see, and a new crossing has to be added to the list.
- **`CardEditor`** is what the card calls on the editor: `enter()`, `item(key)`, the drag hooks the card's pointer handling drives (`clickSelect`, `dragStart`, `dragPreview`, `dragEnd`), the floor plan tool hooks (`toolHover`, `toolClick`, `snapPoint`, `rebuildPlan`, …) and the drawing previews. The card calls them only while editing, as `this._editor.…`.
- **`EditorModule`** is what the editor module hands the core when it loads (`window.__ha3dhome.provideEditor({version, create})`). The core checks the version there.

Editing state the card itself reads stays on the card: `_edit` (selection, undo stacks, modes), `_work` (the config being edited), `_plan`, `_tool`, `_drag` and the gizmo.

### Type checking

`npm run typecheck` runs two passes. `tsconfig.strict.json` checks `src/types.ts`, `src/core/` and `src/panel/` with every strict option, including null checks. `tsconfig.json` checks everything else strictly except `strictNullChecks`: the card's fields start empty and fill in during `_init`, and the editor's fields exist only while editing, so null checks there would mean a `!` on nearly every line. Editor items are `GenericItem` (any item's fields) because one key can name a box, a light or a wall; a cast such as `item as WallSeg` marks where the kind is known.

## Lifecycle

1. **`setConfig(config)`** ignores a config identical to the current one. When only the layout changed (a save, here or on another device) it rebuilds the world in the running scene (`_applyLayout()`). Otherwise it tears down any existing renderer and, if `hass` is already set, re-inits.
2. **`set hass(hass)`**
   - First call: `_init()`. This dynamically imports Three.js and OrbitControls, builds the shadow DOM (`styles.ts`), then `_createRenderer()`, `_createCamera()`, `_bindNav()` and `_bindPageListeners()`. It then runs `_rebuild()` and `_bindPicking()` and starts a `ResizeObserver`.
   - Every call: `_update()` applies entity states: `_updateDaylight()`, `_updateLamps()`, screens, `_updateChips()`, `_updateDoorBadges()`, `_setDoors()` and `_updateWeather()`.
3. **Rendering is on demand.** `_requestRender()` coalesces into one `requestAnimationFrame`, and keeps going only while OrbitControls damping is moving.

## Coordinate system

- **Plan units:** `x` runs left→right, `y` back→front, `z` is height (walls = 60). The camera is framed for a plan of roughly 0 to 600 across and 220 to 560 deep; the sample home spans 30 to 560 by 230 to 550.
- **Three.js mapping:** `X = x − CX`, `Y = z`, `Z = y − CY`.
- **Camera:** orthographic. Home pose: position `(330, 360, 330)`, target `(−10, 5, −10)`, which gives azimuth π/4 and tilt ≈ 0.93 rad.
- **View size:** `view_size` (default 375) sets how many plan units fit across. `_resize()` keeps that span for the current aspect ratio.

## Scene build: `_rebuild()`

`_rebuild()` disposes `this._world` (geometries, plus materials that are neither cached nor shared) and builds a fresh one from `this._cfg()`:

1. **`_buildScene(scene)`**
   - **Floors:** `ShapeGeometry` per floor polygon, tagged `userData.floor` and `userData.room`.
   - **`_buildPlanLayer(scene)`:** everything in floor plan mode lives in `this._wallG`, so `_rebuildPlan()` can rebuild just that layer while a corner is dragged.
     - **Walls:** for `wall_segs[i]` (key `w:i`), `wallPieces()` splits the wall into solid blocks around every opening that passes at least halfway through it. It cuts the wall's length at each opening's edges, then for each slice takes the complement of the openings' z-ranges, and merges neighbours. Each block is a rotated `BoxGeometry`. No CSG.
     - **Corners:** `wallExtensions()` pushes ends that meet another wall end at an angle out by half that wall's thickness.
     - **Plan mode extras:** walls are capped at 60% height so openings read as gaps, an invisible wider slab makes thin walls clickable, and a joint sphere (`planJoints()`) sits on every corner. Joints are kept pixel-sized by `_scaleHandles()` each frame.
     - **Openings** (`n:i`): tinted translucent boxes in plan mode; a glass pane for windows otherwise.
     - **Rooms** (`r:i` = `scene.floors[i]`): a `ShapeGeometry` per polygon, built here (not in `_buildScene`) so floors rebuild with the plan layer. In plan mode they get DOM name/area labels (`_buildRoomLabels`, positioned by `_placeOverlays`). The selected room also gets an outline plus corner (`_vertMeshes`) and midpoint (`_midMeshes`) handles (`_buildRoomHandles`, redrawn on every `_select`).
     - **Blueprints** (`p:i`): a textured plane just above the floors. Textures are cached in `this._bpTex` by `src` and are not disposed by rebuilds.
   - **`boxes`, `objects`, `overlays`:** each built inside a keyed pivot group via `_begin(key, center, rot)`:
     - an `outer` group sits at the item centre with `rotation.y = −rot`;
     - an `inner` group is offset by −centre, so builders keep working in absolute plan coordinates;
     - `this._xf` maps fixture positions through the rotation, so lights still find their fixture meshes.
   - **Overlays are built with `_noCast = true`.** Fixtures never block light.
2. **`_buildLights()`**
   - Ambient, hemisphere and sun lights. In edit mode, a flat north arrow beside the house (`_buildCompass`).
   - Before that, `_buildRoof()` adds shadow-only geometry outside plan mode: a slab over each indoor room just above the tallest wall, and every wall raised to the slab top (openings still cut), which fills cut-away walls and keeps wall tops out of the sun. The material has `colorWrite`/`depthWrite` off and `raycast` is a no-op, so it only shows up in shadow maps. Layers can't do this: three r160's shadow pass tests layers against the *view* camera.
   - Config lights are grouped by rounded `x:y:z`, so two bulbs in one fixture become one physical light:
     - `fixture:"string"` → a point light plus emissive bulb spheres along `points`;
     - lights with an aim point `gx/gy` more than 12 units away → `SpotLight`; otherwise `PointLight`. Each gets an additive glow sprite.
   - The first `max_shadow_lights` (default 8) cast shadows, largest radius first.
   - Fixtures within 6 units of a light become its emissive "bulb" meshes.
3. **`_buildTargets()`**
   - **View mode:** invisible hit spheres for lights and hotspots, plus screen meshes, collected in `this._targets`.
   - **Edit mode:** visible coloured markers for lights (yellow), hotspots (blue), chips (green) and doors (red).
4. **`_buildOverlays()`:** HTML chips, door dots and weather in `.ov`, each with a 3D anchor point that is projected every frame.
5. **`_loadModels()`:** async load of Sweet Home 3D models (see below), replacing the translucent placeholder boxes.
6. **`_scheduleBatch()`** (outside the editor, 300 ms after the last rebuild or model load):
   - **`_batch()`** merges every static mesh (not lamps' glowing parts, door leaves, screens, sprites or anything transparent or invisible) into one mesh per material with `mergeGeometries`, baked into world space. Materials that differ only in colour share one white copy with `vertexColors`, the colour moved into the vertices. A mirrored model's triangles are turned back. Each merged mesh keeps its group's shadow flags and `customDepthMaterial` (floors stay out of the shadow maps). The sample home goes from 280 draw calls to 61.
   - The originals stay in the scene, hidden: picking and `_roomAt` raycast them (the raycaster ignores visibility), and the see-through room fades them mesh by mesh, so `_updateFade` shows them while a room is framed (`_showBatch`).
   - **`_bakeAO()`** then bakes the corner shading. A camera straight above draws the height of the topmost surface (hanging things, the roof, glass and glows left out) into a half-float map; a pass turns heights into shading (how high the surroundings rise in 16 directions out to 20 units), and a 5×5 blur softens it. Every lit material is patched once (`_patchAO`, `onBeforeCompile`, one program key) to darken its light by the map at its world position: floors directly, wall and furniture faces from the floor just in front of them, fading with height, and anything under a table or shelf by how close it is overhead. The GTAO pass then stays off outside the editor (`_draw`).

## Live update: `_update()`

- **Sun and day/night:** `_sunPos()` takes the editor's preview hour, else `sun.sun`'s `azimuth`/`elevation`, else `solarPosition()` from `hass.config` latitude/longitude. `sunVector()` turns that (plus `scene.north`) into a direction; `_placeSun()` moves the light and flags a shadow-map update only when the rounded position changes. Elevation sets a 0–1 daylight factor for ambient, hemisphere, sun intensity and colour, and the lamps' `boost`. Plan mode and `night_mode: "never"` raise the elevation so it's always lit; plan mode also puts the sun (nearly) overhead so full-height walls don't shadow the plan.
- **Light groups:** the colour is the brightness-weighted mean of the members' `rgb_color` (or the colour temperature converted to RGB). Intensity scales with brightness, member count and beam radius `r`.
- **Screens:** `_drawScreen()` repaints a 512×288 canvas only when the signature (state, picture, title, subtitle) changes.
- **Chips:** HTML is rebuilt only when it actually changes (`node._html`).

## Picking and input: `_bindPicking()`

All handlers sit on the canvas. **`pointerdown` uses `{capture:true}`** so it runs before OrbitControls.

**View mode**
- Raycast `this._targets`. A tap runs the action (`toggle` → `homeassistant.toggle`, otherwise more-info).
- Holding for 500 ms opens more-info.

**Edit mode**
- `pickKey()` raycasts the whole world. It skips sprites and walls and walks up parents to the first `userData.key`; a floor hit means "nothing".
- **Pointer down on an item** arms a drag:
  - mouse: always;
  - touch: only if the item is already selected. Otherwise the gesture stays a camera pan.
- **Drag start** (past 5 px for mouse, 8 px for touch):
  - disable OrbitControls and roll the camera back to where it was at pointerdown (`camRestore`);
  - select the item's group if needed;
  - `_dragStart()`.
- **During the drag:**
  - Move mode: the delta is ray∩floor-plane at the pivot height (snapped to 2 units).
  - Rotate mode: the angle around the pivot (snapped to 15°).
  - `_dragPreview()` moves the item groups visually.
- **Pointer up:** `_dragEnd()` commits to data.
- **A second pointer** during a drag cancels it (preview reverted) and re-enables OrbitControls, so the gesture becomes a pinch.
- **TransformControls gizmo:** attached to a proxy `_pivot` on mouse devices only. It uses the same `_dragStart/_dragPreview/_dragEnd` path.

## Editor data model

`this._work` is a deep copy of the editable keys (`scene`, `lights`, `hotspots`, `chips`, `doors`) plus the rest of the config.
- **Keys** are `kind:index`, with kind ∈ `b o v l h c d` (furniture mode) or `w n p` (floor plan mode: `scene.wall_segs`, `scene.openings`, `scene.blueprints`).

**Rotatable items** (`b`, `o`, `v`)
- `itemCenter(k, it)` gives the centre `[x, y, z]`.
- `shiftItem(k, it, dx, dy, dz)` translates every coordinate field for that item type.
- Rotation stores `rot` (boxes are converted to object form by `_setBoxObj`).
- Rotating a multi-selection moves each centre around the pivot and adds to its `rot`.

**Rotatable items** also include openings (`n`) and blueprints (`p`): centre `x/y` plus `rot`.

**Point items** (`l`, `h`, `c`, `d`, `w`)
- `mapPts(it, f)` maps every plan point: `x/y`, aim `gx/gy`, hit `hx/hy`, string-light `points`, wall ends `a/b`.

**Floor plan mode** (`this._plan`, `this._tool` ∈ `select | wall | door | window | measure`)
- `pickKey()` only returns `w/n/p` keys in plan mode (skipping locked blueprints) and never returns them in furniture mode.
- Handles are picked first (`pickHandle`: room corners, then edge midpoints, then wall joints). A midpoint drag inserts a corner, then drags it. Clicking a corner without dragging sets `this._vsel` (Delete removes it).
- `pickKeys()` returns every plan item under the pointer. A click without dragging cycles through that list when the current primary is in it (`clickPick`). Rooms only arm a drag when already selected. No TransformControls gizmo in plan mode.
- Joints Dragging one writes the snapped point into every member end and calls `_rebuildPlan()`. Pointer up pushes one undo snapshot and does a full `_commit()`.
- Tools act on a click (pointer up without movement): `_toolClick()`. Mouse hover draws the preview wall, snap dot and length tip (`_toolHover()`).
- `_snapPoint()` priority: an existing corner (10 px), then onto a wall line, then (with Snap) a 15° angle and whole-unit length from the previous point, else whole units.
- `applyPlanVis()` hides non-plan item groups while in plan mode. `_update()` forces day lighting.
- Units: `_imperial()` (from `scene.units` or `hass.config.unit_system.length`), `_fmtLen()`, `_toReal()` / `_fromReal()` using `model_scale`.
- **Blueprint upload:** `hass.fetchWithAuth('/api/image/upload')` with a JPEG of at most 2400 px; served unauthenticated at `/api/image/serve/<id>/original`. The fallback is an inline 1400 px JPEG data URL.

**Selection**
- `_expand(key)` adds:
  - every item sharing the same `group`;
  - **attachments** (`_attached`): lights and hotspots inside a fixture's footprint (pendant, lamps, fan radius, string bulbs).
- `Alt` skips expansion.

**Undo/redo:** stacks of JSON snapshots of `_work`.

**Save:** `_save()` hands the layout (`LAYOUT_KEYS`: scene, lights, hotspots, chips, doors, look, ambient, idle view, room cards) to the card's `LayoutStore` and takes the config it returns as the card's own:
the panel's, which calls `ha_3dhome/config/save` (see below).

## Add-entity panel

- `AddPanel` (`add-panel.tsx`) lists `hass.states` with search and domain filters.
- `_dragEntity()` is a pointer-driven drag that works for mouse and touch. It shows a ghost label; on drop it raycasts the floor plane.
- `_entityItem(id, x, y, as)` picks the representation:

| Entity | Becomes | Stored in |
|---|---|---|
| `light.*` | light glow | `lights` |
| door/window `binary_sensor` | door dot | `doors` |
| `media_player` with `device_class: tv` | screen | `scene.objects`, type `screen` |
| `climate.*` | climate chip | `chips` |
| everything else | live badge | `chips` with `entity` |

- `_convertEntity(key, as)` powers the inspector's **Show as** menu: it removes the item and pushes the new representation at the same spot.

## Screens

- Object type `screen`: a bezel box, a `PlaneGeometry` with a `CanvasTexture` (`MeshBasicMaterial`, `toneMapped:false`), and a `PointLight`.
- **Artwork:** `_drawScreen()` loads `entity_picture_local || entity_picture`, which HA serves same-origin through its media proxy.
  - Square art: the cover on the left with title and artist beside it.
  - Wide art: fills the screen, with a caption over a gradient.
  - The background is a blurred, darkened copy of the art.
- **Glow:** the average art colour (from a 6×6 downsample) tints the point light. It is dimmer when paused and off when the TV is off.

## Sweet Home 3D models

1. **Download:** `_download()` calls `downloader.download_file` with `{url: SourceForge, subdir: "sh3d"}` and listens for `downloader_download_completed/failed`.
2. **Open:** `_openLib(file)` fetches `/local/sh3d/<file>` and runs JSZip:
   - finds the `.sh3f` entries (nested zips);
   - parses `PluginFurnitureCatalog.properties` (`name#N`, `category#N`, `icon#N`, `model#N`, `width/depth/height#N` in cm, `modelRotation#N`, `creator#N`);
   - keeps OBJ or zipped-OBJ models only;
   - caches the result in `LIBCACHE`.
3. **Place:** `_placeModel()` stores `{type:"model", lib, sh3f, model, mr, w, d, h, cm, creator, lic, x, y, z}`. Sizes are converted using `scene.model_scale`.
4. **Load:** `_modelProto()`:
   - pulls the files from the `IDB` cache, or extracts them (OBJ, its `mtllib`, and the textures named in the MTL);
   - parses with OBJLoader/MTLLoader, using a LoadingManager URL modifier that maps texture names to blob URLs;
   - applies `modelRotation`;
   - measures the bounding box and caches the prototype in `MODELCACHE`.
5. **Instance:** each instance is a clone, scaled non-uniformly to `w × h × d` and sat on the floor at `z`.

## The editor's UI

The editor's toolbar, inspector and side panels are [Preact](https://preactjs.com/) components (`.tsx`), bundled into the editor file only, so the map itself loads none of it. Each is drawn from the editor's state (mostly `card._work` and `card._edit`) and drawn again after every change: `_syncBar()` redraws the toolbar and the open side panel, `renderInspector()` the inspector. Preact compares and only touches what changed, so there is no HTML string building and no hand-wired listeners. Components keep only small UI state of their own (a search box, a folded section) and call the editor's methods to change anything (`editor._field`, `editor.setLook`, `editor.toolbarAction`, …), which push an undo step and commit as before. Leaving edit mode unmounts them all (`_clearEditorUI()`).

## The panel and the integration

Up to 5.x the map was also a Lovelace card and a dashboard strategy. A strategy dashboard is regenerated whenever its config or the entity, device or area registries change, so saving the map replaced the card element, and the card had to park its scene so the new element could adopt it. 6.0 keeps only the panel: Home Assistant creates the element for the sidebar page and hands it `hass`, `narrow`, `route` and `panel`, and nothing regenerates it.

**The integration** (`custom_components/ha_3dhome/`):

- `async_setup` serves `frontend/` at `/ha_3dhome` (cached, with `?v=<version>` in the URL so an update fetches new files), and registers the websocket commands.
- Each config entry is one sidebar page: `panel_custom.async_register_panel` with the element `ha-3dhome-panel` and `config: {entry_id}`. The config flow asks for the title, icon, access and address; the options flow changes the first three.
- `store.py` keeps one file per page in `.storage` (`ha_3dhome.<entry_id>`): the card config (the layout plus card options such as `weather` or `room_menu`) and a revision number.
- `websocket.py`:
  - `ha_3dhome/config/subscribe {entry_id}` sends `{config, rev}` now and after every save, to every device following it;
  - `ha_3dhome/config/save {entry_id, config, rev}` (admins) saves when `rev` is still the stored revision and fails with `conflict` otherwise, so two devices editing at once can't overwrite each other.

**The panel element** (`src/panel/panel.ts`):

- It creates one `<ha-3dhome-map>` filling the page, forwards `hass` to it, and sets `card.layoutStore` so Save goes to the integration.
- It subscribes to its config while it is attached. A pushed config the card isn't showing yet goes to `card.setConfig()`. The card compares it with its current config (`sameOptions`): when only the layout differs it calls `_applyLayout()`, which rebuilds the world in the running scene (same renderer, camera kept); a change of card options restarts the card as before.
- A config pushed while someone edits is held until the editor closes (the card fires `ha-3dhome-editing`), and that edit's Save is refused by the revision check with a message saying why.
- The stored config leaves out what the panel sets itself (`type`, `fill`, `dashboard`, `card_id`).
- On narrow screens Home Assistant hides the sidebar, so the panel shows Home Assistant's own `ha-menu-button` over the map's top-left corner (the card moves its weather badge aside through `--ha-3dhome-inset-left`).
- An empty page opened by an admin looks for maps on dashboards (`dashboardsWithHome()`: every dashboard's config, strategy or card) and offers to copy one in, dropping item types the editor can't make (the first mockup's railings, glass and the like) and updating old string lights. The dashboard is left unchanged.
