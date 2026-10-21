# CLAUDE.md: working notes for AI-assisted sessions

Read this first. It is the hand-off between sessions: what lives where, how to change things safely, and the gotchas we already hit.

## What this is

3D Home (`ha-3dhome`, formerly ha-iso-home) is a Home Assistant integration with a frontend, published through HACS (category integration). Its main face is a sidebar page (a custom panel); the same code also works as a Lovelace card and a dashboard strategy. The frontend is small TypeScript modules that esbuild bundles into two JavaScript files in `custom_components/ha_3dhome/frontend/` (`npm run build`, `tools/bundle.js`). Module map and how the parts fit: docs/ARCHITECTURE.md.

- `custom_components/ha_3dhome/` (Python): serves the two files at `/ha_3dhome/…?v=<version>`, loads the core on every page (`add_extra_js_url`, so the card needs no resource), adds one sidebar page per config entry (`panel_custom`, element `ha-3dhome-panel`) and keeps each page's card config plus a revision in `.storage` (`store.py`), followed and saved over the websocket (`websocket.py`: `ha_3dhome/config/subscribe`, `ha_3dhome/config/save`, which refuses a save from an older revision). Tests: `tests/` (`npm run test:py`).
- `src/ha-3dhome.ts` (core entry → `ha-3dhome.js`): registers the card, the panel and the strategy, publishes shared helpers on `window.__ha3dhome` (`src/editor-api.ts`) and tells `src/card/editor-loader.ts` where the editor lives (next to itself).
  - `src/panel/`: `<ha-3dhome-panel>`. It shows one card, follows the stored config, gives the card a `LayoutStore` (`card.layoutStore`) so Save goes to the integration, holds pushed configs while someone edits, and offers to copy a map from a dashboard into an empty page (`src/core/lovelace.ts`).
  - `src/types.ts`: the config schema as types. `src/core/`: constants and pure helpers (items, plan geometry, surfaces, fixtures, sun, entities, Sweet Home 3D parsing) plus the strategy.
  - `src/card/`: the card. `card.ts` declares every field and holds the lifecycle; one part class per topic (`startup`, `camera`, `rooms`, `scene`, `models`, `lights`, `picking`, `live`, `plan`) is copied onto its prototype. Part methods take `this: Home3DCard`, and an interface merge in `card.ts` types them all as one class. `styles.ts` is the shadow DOM's CSS and markup.
- `src/ha-3dhome-editor.ts` (editor entry → `ha-3dhome-editor.js`): loaded the first time ✎ Edit is pressed (`_openEditor` → `loadEditor()`). It registers the `Editor` class (`src/editor/editor.ts`, its parts in `src/editor/`) with the core, which makes one per card (`card._editor`). The editor reaches the card only as `this.card.…` through `EditorHost`, and the card calls it only through `CardEditor` (both in `src/editor-contract.ts`): add a new crossing there. The parts read the core's helpers through `src/editor/shared.ts`.
- Tests bundle `src/` on the fly (`tools/bundle.js`), so there's no build step before `npm test`; `--dist` tests the committed build. The tests inline the editor, so it's there before Edit is pressed; `npm run test:demo` covers loading it on demand from real files.
- **Types:** `npm run typecheck`. `src/types.ts`, `src/core/` and `src/panel/` are fully strict (`tsconfig.strict.json`); the card and editor are strict except null checks (`tsconfig.json`), because their fields fill in during `_init` and while editing (turning null checks on there reports about 700 errors, mostly `querySelector` results and fields that are null only after teardown). The panel talks to the card through its own small `MapCard` interface so it stays in the strict set. Unused locals fail the check. Add a field to `card.ts` with `declare` and a comment, never as a class field (that would be runtime code).

They define:

- `ha-3dhome-panel`: the sidebar page the integration adds.
- `ha-3dhome-card`: a Lovelace custom card (Three.js 3D floor plan, live lights, chips, the editor).
- `ll-strategy-dashboard-ha-3dhome` (plus `ll-strategy-ha-3dhome`): a dashboard strategy, `custom:ha-3dhome`, that generates a full-screen panel view around the card.
- The old names `iso-home-3d-card` and `custom:iso-home` stay registered as aliases, and Save writes into either. Don't remove them: existing dashboards use them.

This repo is public. Never commit anyone's real home layout, entity ids, Home Assistant ids or screenshots of a real home. Use the fictional sample home (`examples/sample-home.json`) for examples, tests and screenshots.

## Releasing

HACS installs GitHub releases, so a version tag is what ships and `main` is the working branch. Full steps: docs/RELEASING.md.

1. Edit `src/`, then bump `VERSION3D` (`src/core/constants.ts`), `EDITOR_VERSION` (`src/ha-3dhome-editor.ts`), `version` in package.json and `version` in `custom_components/ha_3dhome/manifest.json` together. The editor refuses to attach to a core of another version, and the build refuses a manifest that disagrees.
2. Run `npm run typecheck`, `npm test`, `npm run test:mobile`, `npm run test:plan` (and `-- --mobile`), `npm run test:panel` and `npm run test:demo`; all must pass. Run `npm run test:py` when you touch `custom_components/` (it needs `pip install -r requirements_test.txt`; `PYTHON=` picks the interpreter). Also run `npm run test:leaks` if you touched lifecycle, rebuild or disposal code (add `-- --look` when you touched the render looks). Then `npm run build` and commit `custom_components/ha_3dhome/frontend/`. `npm run test:all` runs the type check and every suite with one line each; `npm run format` applies Prettier.
3. Only the maintainer decides when to tag a release. Don't push tags or submit to the HACS default list unless asked.

## Floor plan data (v4.7)

- Walls are `scene.wall_segs` (`{a, b, t?, h?, low?, color?, texture?}`), doors and windows are `scene.openings` (negative boxes), the tracing image is `scene.blueprints`, and rooms are `scene.floors` (`{name, pts, fill, texture?, menu?}`, editable in plan mode since v4.8, keys `r:i`). Schema: docs/CONFIG.md.
- An older dashboard may still hold legacy `walls` / `front_walls` until the user saves once from the editor. `_enterEdit()` converts them (`legacyWalls()`), and both formats render.
- Textures (v4.9): `SURFACES` + `paintSurface()` draw tileable greyscale canvases; `_surfMat(colour, texture)` caches the material and `_planUV()` gives box walls plan-unit UVs. `scene.wall_texture` is the wall default. Each `SURFACES` entry says where it fits (`"f"`, `"w"`).
- Doors (v4.9.2): a door opening with `style` gets a 3D door from `_buildDoorLeaf()` (pivot groups with a turn or slide), and `_setDoors()` in `_update()` animates them towards their `entity`.
- Light fixtures (v4.9.3): `L.fixture` → `_buildFixture()` builds the model into the light's group and returns the glowing meshes. String lights (`fixture: "string"`, `points`) use the pure `stringBulbs`/`stringCount`; dragging their handles calls `_refreshFixture()` for a cheap in-place rebuild.
- Geometry helpers are pure, module-level functions: `segDir`, `wallExtensions`, `wallPieces`, `planJoints` and `legacyWalls`. Test them in `tools/plan-test.js`.

## Coordinate system (memorise this)

- **Plan units:** `x` runs left→right, `y` back→front, `z` is height. Walls are 60 tall. The camera is framed for roughly 0 → 600 by 220 → 560; the sample home spans 30 → 560 by 230 → 550.
- **Three.js mapping:** `X = x − 296`, `Y = z`, `Z = y − 391` (constants `CX`, `CY`).
- **Model scale:** `scene.model_scale = [2.1, 4]` means 2.1 cm per plan unit horizontally and 4 cm vertically. Heights are deliberately squashed for the stylised look.
- **Rotation:** `rot` is in degrees about the item centre, positive = clockwise seen from above. `outer.rotation.y = -rot`.

## Architecture in one breath

- `_rebuild()` throws away `this._world` and rebuilds everything from `this._cfg()`. That is `this._work` while editing, otherwise `this._config`.
- **Item groups:** every editable item gets a pivot group keyed by `b:i` (scene.boxes), `o:i` (scene.objects), `v:i` (scene.overlays), `l:i` (lights), `h:i` (hotspots), `c:i` (chips) or `d:i` (doors).
- **Two kinds of item data:**
  - *Rotatable* items (b/o/v) store a centre plus `rot`. Use `itemCenter` and `shiftItem`.
  - *Point* items (l/h/c/d) store raw coordinates. Use `mapPts`.
- **Every mutation** goes through `_mutate` or a drag. Both push an undo snapshot (JSON of `_work`), then `_commit` → `_rebuild` → `_select`.
- See docs/ARCHITECTURE.md for picking, lights, models, screens and the strategy.

## Gotchas we already paid for

- **Lifecycle / memory (v4.6)**
  - HA calls `setConfig()` again whenever it re-renders. Strategy dashboards are regenerated on every entity, device or area registry change.
    - The card ignores identical configs (JSON compare).
    - Before a real rebuild it calls `_teardown()`, which disposes GPU resources, calls `renderer.forceContextLoss()`, and removes document/window listeners.
    - Before v4.6 every regeneration leaked a whole WebGL context, and Firefox slowed down over hours.
  - `_disposeWorld()` must also dispose light shadow maps (`light.shadow.dispose()`) and per-item material textures. Editor rebuilds leaked about 11 textures per edit until this was added.
  - Detached cards tear themselves down after 30 s (unless there are unsaved edits) and re-init on reconnect.
  - Async work (`_init`, model loads, screen paints) must check that it still belongs to the current world or generation (`this._gen`, `world !== this._world`) before touching the renderer.
  - Run `npm run test:leaks` after touching lifecycle, rebuild or disposal code.
- **Rendering is on demand (v4.20)**
  - Nothing draws unless `_requestRender()` is called. Anything that changes the scene (async loads, animations, editor tweaks) must call it. Before v4.20 an OrbitControls bug kept the loop spinning, which hid missing calls.
  - A lost WebGL context (phones do it to background pages) needs a redraw on `webglcontextrestored`, or a rebuild when it never comes back (`_ctxCheck`, v5.1). Connection state lives in `_connState` (`hass.connected` + `navigator.onLine`); reconnecting sets `_seen = null` so every entity is re-applied.
  - `hass` is applied on the next frame (`_applyHass`), and `_update()` runs only when an entity mentioned in the config changed. Tests that set `hass` must wait a frame (`!card._hassRaf`). A new feature that reads an entity from somewhere other than the card config must add it to `watchedEntities`.

- **Lighting and shadows**
  - Fixtures and overlays must not cast shadows (`_noCast`). Otherwise fans and bulbs shadow their own lights and the room goes dark.
  - Shadow maps are static (`shadowMap.autoUpdate=false`). Set `renderer.shadowMap.needsUpdate = true` after geometry changes.
- **Camera and controls**
  - The card's `pointerdown` listener uses `{capture:true}` on purpose. A second finger has to re-enable OrbitControls *before* OrbitControls sees that pointerdown, otherwise pinch-to-zoom dies mid-drag.
  - The TransformControls gizmo is hidden on touch devices (`this._coarse`). It sat on top of the selection and stole the finger.
  - OrbitControls damping keeps moving the camera after you disable it. `camRestore()` flushes it with damping off.
- **Dashboard data quirks**
  - HA `states` objects in tests have no `entity_id` field. Code iterates `Object.entries(states)`.
  - Strategy dashboards: HA's own "Edit dashboard" offers "Take control", which converts back to a plain card. The in-card editor is the only editor.
  - `scene.boxes` entries are either arrays `[x1,x2,y1,y2,h,colour,z]` or objects `{b:[...], rot, group}`. `_setBoxObj` converts on demand.
- **Sweet Home 3D libraries**
  - They are SourceForge zips, each with a nested `.sh3f` zip holding `PluginFurnitureCatalog.properties` plus OBJ/MTL. They are not CORS-fetchable from the browser, which is why the Downloader integration exists.
  - Each device caches extracted model files in IndexedDB (`ha-3dhome` / `models`).
- **HA replaces card elements** when a strategy dashboard's config changes (every save). A detached card parks in `PARKED` for its 30 s grace period and the new element adopts it (becomes a thin shell forwarding `hass`/`setConfig`), so there's no second WebGL scene. Config equality uses `stableJSON` (key order varies). The panel has none of this: its element stays, and a new config that differs only in `LAYOUT_KEYS` is applied in the running scene (`_applyLayout()`), as is a dashboard save.
- **Panel saves:** the panel's own save comes back over the subscription, often before the save call returns. The panel ignores any config whose revision it already shows, and never applies one while `card._edit` is set; the editor fires `ha-3dhome-editing` on enter and exit.
- **Test harness:** the smoke test must not declare top-level names that collide with the minified bundle (it uses `__card`, `__gen`, `__dash`). Tests find items by property (the sofa group, the fan overlay, the lounge floor), not by a fixed index.

## Testing

`npm test` loads the card through the strategy, using `tools/fixtures/test-home.json` (the sample home, with its walls in the pre-v4.7 format so the migration stays covered):

- It serves Three.js from node_modules and fakes `hass` (admin, a few states, `callWS` for save).
- A mock SH3D library is built by `tools/mock/build-mock-lib.js`.
- Checks: render, room menu, edit mode, group select, fan + light attachment, mouse drag and undo, entity-panel drag-drop, Show as → Screen, library browse and place, save into the strategy.
- `--mobile` checks touch: one-finger pan vs move-selected, tap-select, pinch cancelling a drag.

`npm run test:panel` loads `<ha-3dhome-panel>` with a fake integration in the page (subscribe pushes, save checks the revision): import from a dashboard, Save to the integration, a save from another device in the running scene, an edit clash, the narrow sidebar button, non-admins.

`npm run test:py` runs the integration's tests with `pytest-homeassistant-custom-component` (a real Home Assistant core): config and options flow, the panel registration, subscribe/save/conflict, admin-only saving, removal.

The browser tests use `/opt/pw-browsers/chromium` when present, or `CHROMIUM_PATH`. Never run `playwright install` in the cloud sandbox.

## Conventions

- Keep the module dependency-free apart from the CDN imports (three@0.160.0, jszip@3.10.1). Pin exact versions.
- Keep new UI working at phone width. `.wrap` has `container-type: inline-size`; use `@container (max-width: 640px)`.
- User-facing strings are plain English, with no jargon in toasts.
- Commit messages: imperative, short subject, end with the attribution lines the session provides. Every commit also credits the maintainer with the trailer `Co-authored-by: Trent <43056103+tbell19@users.noreply.github.com>`.

## Home Assistant APIs the integration leans on

`panel_custom.async_register_panel`, `frontend.async_remove_panel`, `frontend.add_extra_js_url`, `hass.http.async_register_static_paths` (2024.7+), `helpers.storage.Store`, `websocket_api` (`websocket_command`, `require_admin`, `connection.subscriptions`) and the dispatcher. The options flow uses the 2024.12+ style (no `config_entry` passed in), hence `hacs.json` → `homeassistant: 2024.12.0`.

## Demo site

`site/` is a standalone demo of the real card on the sample home with a fake `hass`. `npm run demo` serves it, `npm run test:demo` checks it (run it when you touch the strategy, loading or the sample). `.github/workflows/pages.yml` publishes it (manual for now).

## Open items / ideas

See docs/HISTORY.md → "Open items".
