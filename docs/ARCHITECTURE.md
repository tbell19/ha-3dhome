# Architecture

The viewer and the strategy live in `src/ha-3dhome.js`; everything behind ✎ Edit lives in `src/ha-3dhome-editor.js`, which the core loads from its own folder. This doc walks through them top to bottom.

## Module layout

| Section | What it does |
|---|---|
| Constants | CDN URLs (pinned `three@0.160.0`, `jszip@3.10.1`), plan centre `CX=296, CY=391`, the Sweet Home 3D library list `LIBS`, icon maps |
| Pure helpers | `itemCenter`, `shiftItem`, `mapPts`, `rotPt`, `parseProps` (Java .properties), `zipFind`, the `IDB` cache |
| `class Home3DCard` | Lifecycle, camera, scene build, lights, picking, overlays, live update, editor, model library |
| `class Home3DStrategy` | The dashboard strategy (`generate(config)` → `{views:[panel view with the card]}`) |

## Lifecycle

1. **`setConfig(config)`** stores the config and tears down any existing renderer. If `hass` is already set, it re-inits.
2. **`set hass(hass)`**
   - First call: `_init()`. This dynamically imports Three.js and OrbitControls, builds the shadow DOM, and creates the renderer, camera and controls. It then runs `_rebuild()` and `_bindPicking()` and starts a `ResizeObserver`.
   - Every call: `_update()` applies entity states to lights, chips, doors, weather and screens.
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
   - **Legacy walls** (`walls` / `front_walls`, only in configs not yet saved by v4.7+): boxes per span plus lintels. Tagged `userData.wall`.
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
     - `kind:"string"` → a point light plus emissive bulb spheres;
     - `kind:"niche"` → a point light plus the emissive niche panel;
     - lights with an aim point `gx/gy` more than 12 units away → `SpotLight`; otherwise `PointLight`. Each gets an additive glow sprite.
   - The first `max_shadow_lights` (default 8) cast shadows, largest radius first.
   - Fixtures within 6 units of a light become its emissive "bulb" meshes.
3. **`_buildTargets()`**
   - **View mode:** invisible hit spheres for lights and hotspots, plus screen meshes, collected in `this._targets`.
   - **Edit mode:** visible coloured markers for lights (yellow), hotspots (blue), chips (green) and doors (red).
4. **`_buildOverlays()`:** HTML chips, door dots and weather in `.ov`, each with a 3D anchor point that is projected every frame.
5. **`_loadModels()`:** async load of Sweet Home 3D models (see below), replacing the translucent placeholder boxes.

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
- **`_enterEdit()` runs `_migrateWalls()`** (legacy `walls` → `wall_segs` + `openings`) before the first undo snapshot, so every snapshot uses one format.

**Rotatable items** (`b`, `o`, `v`)
- `itemCenter(k, it)` gives the centre `[x, y, z]`.
- `shiftItem(k, it, dx, dy, dz)` translates every coordinate field for that item type.
- Rotation stores `rot` (boxes are converted to object form by `_setBoxObj`).
- Rotating a multi-selection moves each centre around the pivot and adds to its `rot`.

**Rotatable items** also include openings (`n`) and blueprints (`p`): centre `x/y` plus `rot`.

**Point items** (`l`, `h`, `c`, `d`, `w`)
- `mapPts(it, f)` maps every plan point: `x/y`, aim `gx/gy`, hit `hx/hy`, string-light `points`, niche `rect`, wall ends `a/b`.

**Floor plan mode** (`this._plan`, `this._tool` ∈ `select | wall | door | window | measure`)
- `pickKey()` only returns `w/n/p` keys in plan mode (skipping locked blueprints) and never returns them in furniture mode.
- Handles are picked first (`pickHandle`: room corners, then edge midpoints, then wall joints). A midpoint drag inserts a corner, then drags it. Clicking a corner without dragging sets `this._vsel` (Delete removes it).
- `pickKeys()` returns every plan item under the pointer. A click without dragging cycles through that list when the current primary is in it (`clickPick`). Rooms only arm a drag when already selected. No TransformControls gizmo in plan mode.
- Joints Dragging one writes the snapped point into every member end and calls `_rebuildPlan()`. Pointer up pushes one undo snapshot and does a full `_commit()`.
- Tools act on a click (pointer up without movement): `_toolClick()`. Mouse hover draws the preview wall, snap dot and length tip (`_toolHover()`).
- `_snapPoint()` priority: an existing corner (10 px), then onto a wall line, then (with Snap) a 15° angle and whole-unit length from the previous point, else whole units.
- `_applyPlanVis()` hides non-plan item groups (except structural overlays) while in plan mode. `_update()` forces day lighting.
- Units: `_imperial()` (from `scene.units` or `hass.config.unit_system.length`), `_fmtLen()`, `_toReal()` / `_fromReal()` using `model_scale`.
- **Blueprint upload:** `hass.fetchWithAuth('/api/image/upload')` with a JPEG of at most 2400 px; served unauthenticated at `/api/image/serve/<id>/original`. The fallback is an inline 1400 px JPEG data URL.

**Selection**
- `_expand(key)` adds:
  - every item sharing the same `group`;
  - **attachments** (`_attached`): lights and hotspots inside a fixture's footprint (pendant, lamps, fan radius, track segment, plant wall, string bulbs).
- `Alt` skips expansion.

**Undo/redo:** stacks of JSON snapshots of `_work`.

**Save:** `_save()` calls `lovelace/config` for the current dashboard:
- if `config.strategy.type === "custom:ha-3dhome"`, it writes the five layout keys into the strategy;
- otherwise it finds the card (by `card_id` if set, else the first `custom:ha-3dhome-card`) in views, sections or nested cards.

It then calls `lovelace/config/save`.

## Add-entity panel

- `_toggleEntityPanel()` lists `hass.states` with search and domain filters.
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

## Dashboard strategy

`Home3DStrategy.generate(config)` strips `type/title/path/icon/extra_views` and returns:

```js
{ title, views: [ { type: "panel", path, title, icon,
                    cards: [{ fill: true, ...card, type: "custom:ha-3dhome-card" }] },
                  ...extra_views ] }
```

`fill: true` makes the card fill the viewport height (`100vh − header`).

The core also pushes `{type: "ha-3dhome", strategyType: "dashboard", name, description, documentationURL}` onto `window.customStrategies`. Home Assistant 2026.5 and later read that list for the *Community dashboards* section of Settings → Dashboards → Add dashboard, as long as the resource is loaded (HACS does that). A dashboard made there holds only `{strategy: {type: "custom:ha-3dhome"}}`; with no walls, floors, boxes, objects or lights the card shows an empty-map hint (`_showEmpty()`, called from `_rebuild()`, hidden while editing). Save fills the strategy in as usual.

The old names (`iso-home-3d-card`, `ll-strategy-dashboard-iso-home`) are defined by `claimOldNames()` a moment after load. It asks Home Assistant for the resource list and leaves the names alone when the old ha-iso-home card is registered too, so load order can't decide which code an old dashboard runs.
