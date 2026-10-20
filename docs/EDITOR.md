# Using the editor

Only admins see **✎ Edit**, at the bottom right next to the camera buttons.

## Camera (always)

| | Mouse | Touch |
|---|---|---|
| Pan | drag empty floor | one finger |
| Orbit | right-drag, or Shift/Ctrl + drag | two-finger twist |
| Zoom | wheel (toward the cursor) | pinch |
| Buttons | ⟲ ⟳ rotate 90°, ⊤ top-down plan, − + zoom, ⌂ whole home | same |

Room buttons along the bottom fly to and frame a room. Double-clicking a floor does the same.

## Selecting and moving

| | Mouse / desktop | Phone / touch |
|---|---|---|
| Select | click | tap |
| Move | drag any piece or marker (it slides along the floor) | **tap to select first, then drag it**. One-finger drags on unselected things pan the camera |
| Rotate | **⟳ Rotate** mode, then drag around the piece, or use the ring gizmo | **⟳ Rotate** mode, then drag around the selected piece |
| Precise | W / E / R gizmo (move, rotate, scale on all three axes), X local / global axes, arrows nudge 1 (Shift ×10), [ / ] turn 15° (Shift 90°; Q / E on the floor plan) | numeric fields in the panel, ⟲ 90° / ⟳ 90° |
| Multi-select | Shift-click | – |
| One piece of a group | Alt-click / Alt-drag | Ungroup first |
| Cancel a drag | Esc deselects | put a second finger down; the piece snaps back and you're zooming |

**Snap** (⌗) is on by default: 2-unit grid and 15° steps.

**Groups.** Furniture made of several boxes (sofa, bed, desks, each dining chair, kitchen runs) is grouped, so clicking any part selects the whole thing.
- Make your own: select several pieces, then **▣ Group**. **▢ Ungroup** splits them again.

**Attachments.** Moving a fan, pendant, track or lamp brings its lights and tap spots with it.

## The side panel

- **Contents:** position (X/Y), elevation or height, rotation, size (boxes, models, screens) and colour (boxes).
- **Entity items** also have:
  - **Entity:** an autocomplete field for which entity it controls;
  - **Show as:** Badge (icon + live state), Light glow, Door/window marker, Invisible tap spot, and for media players and cameras **Screen**.
- **Screens:** Width plus **Add stand / Remove stand**.
- **Models:** Mirror, Reset size, and the author and licence.
- **Advanced (JSON):** edit the raw item; Apply to commit.
- **With nothing selected:** **North °** (with ⟲/⟳ 15° buttons) sets which way north points; a red arrow beside the house shows it. In furniture mode, **Preview the sun at** is a time slider that shows the sun for that hour today (it isn't saved; **Back to now** or leaving the editor ends it). It needs the home location set in Home Assistant.
- **Folding:** tap the panel's title to fold or unfold it. On phones it starts folded.

## Adding things (＋ Add)

- **Entities:** the panel lists every Home Assistant entity, with search and domain filters ("✓ on map" marks ones already placed).
  - Drag a row onto the floor, or tap it to drop it in the middle of the view.
  - Defaults: lights become glows, door and window sensors become door dots, TVs become screens, thermostats become climate chips, and everything else becomes a live badge.
- **Quick adds:** ▭ Box (simple furniture), 🏷 Label, and 🛋 3D model….

## Room controls (🎛 Controls)

- Pick a room (or ⌂ Whole home) and build the list of cards that shows top right while that room is in view. Saved as `room_cards`.
- **＋ Tile** adds a tile card for an entity. **＋ This room's devices** adds a tile for every light, badge, door and object with an entity placed inside the room's outline.
- **{ } Code** edits the room's cards as YAML or JSON. Paste one card or a list, for example a card's code copied from another dashboard (edit the card, then Show code editor).
- Rows can be moved up and down or removed, the preview shows the real cards, and every change is one undo step.

## Sweet Home 3D models (🛋 Models)

1. Pick a library and press **Download**. Home Assistant's Downloader fetches it into `/config/www/sh3d/`; big libraries take a minute.
2. **Open** it to browse by category or search.
3. Click a model to place it at the centre of the view, then drag it into place.

| Library | Models | Size | Licence |
|---|---|---|---|
| Luca Presidente | 64 | 3.7 MB | Free Art License |
| Trees | 10 | 6.7 MB | Free Art License |
| Kator Legaz | 90 | 8.9 MB | CC-BY |
| Reallusion | 25 | 10.7 MB | CC-BY |
| BlendSwap CC-0 | 175 | 23.8 MB | Public domain |
| BlendSwap CC-BY | 135 | 23.9 MB | CC-BY |
| Contributions | 511 | 29 MB | Free Art License |
| Scopia | 500 | 69.5 MB | CC-BY |

- **First view on a device:** the first time a device shows a model, it downloads that model's whole library, then caches the extracted model in the browser.
- **Unsupported models:** a model that can't be loaded shows as a red box, and the panel says why.

## Floor plan mode (📐)

The **🛋 Furniture / 📐 Floor plan** switch at the left of the toolbar changes what you edit. Floor plan mode:
- flies to the top view;
- hides furniture (toggle with **👁 Furniture**);
- lights everything evenly;
- shows walls at their real height, with doors (orange) and windows (blue) drawn on top; a click on a door picks the door, not the wall above it;
- shows a dot on every corner.

| Tool | How |
|---|---|
| ✥ **Select** (V) | Click a wall, door, window or the blueprint to select it, then drag to move it. **Drag a corner dot** to reshape walls; every wall end at that corner follows. On touch, select a wall first, then drag its dots |
| ✏ **Walls** (W) | Click where a wall starts, then where it ends; keep clicking to chain walls. Clicking the last point again, pressing Enter or closing the loop finishes. Ends snap to corners (green) and onto other walls (blue). The bubble shows the length |
| 🚪 **Door** (D) / 🪟 **Window** | Click a wall: a door (80 cm × full height under the lintel) or window (100 × 120 cm, 90 cm sill) is cut into it, lined up with the wall |
| ▱ **Room** | Click each corner of a room in turn; click the first corner again, or press Enter, to close it. Corners snap to walls and to other rooms' corners. Name it in the panel |
| 🗺 **Blueprint** | Pick an image of your floor plan. It is uploaded to Home Assistant and laid under the walls |

**Selecting what's underneath.** Click the same spot again to step through everything there, for example two overlapping walls, or a wall, the blueprint and the room under it. There is no move gizmo in floor plan mode; drag things directly.

**Light fixtures.** A light's panel has **Fixture**: glow only, can light, ceiling light, pendant, bare bulb, floor lamp, table lamp or string lights. Picking one moves the light to a sensible height (ceiling, table, floor lamp), which **Height** then fine-tunes.
- **String lights** show yellow dots on their points and white dots mid-span. Drag a yellow dot to stretch or move the string; drag a white dot to bend it there. Bulbs are added as it gets longer, or set **Bulbs** to a fixed number (0 = automatic). **Length** and **Sag** are in the panel too, and **Straighten** removes the bends.

**Rooms** are the coloured floors. Each room's name and area are labelled in floor plan mode.
- Click empty floor to select a room. Its outline turns green, with a green dot on each corner and a white dot halfway along each edge.
- **Drag a green corner** to reshape the room. **Drag a white dot** to add a corner there. **Tap a corner, then press Delete** (or ✕ Remove corner) to remove it.
- A selected room can be dragged as a whole. An unselected one never drags, so dragging on a floor still pans.
- The panel has **Name**, **Colour**, **Texture** and **Show in the room menu**, plus the area and overall size.
- The room menu and double-click focus frame each room by its outline, so reshaping a room also fixes where the camera flies.

**Snap** (⌗) in floor plan mode means corners, other walls, whole units and 15° angles. Turn it off to trace odd angles freely.

**Doors and windows are boxes cut out of walls.** Drag one along its wall; on release it re-centres on the wall and turns to match. To cut across a corner, stretch one so it goes through both walls. In the panel:
- **Type:** door, window with glass, or plain cut-out;
- width, height, sill / bottom and depth, in **inches or cm** (following Home Assistant's unit system);
- **Fit to wall**;
- for doors, **Door**: opening only, solid, glass, double, sliding glass, barn or garage, plus colour, hinge / slide direction, which side it swings to, and a **Sensor**. With a sensor (a door contact, a garage cover…) the door swings, slides or lifts open and shut live; without one, **Show it open** poses it. New doors start as solid doors.

**The wall panel** has Length, Thickness, Height and Angle (real units), Colour, **Texture**, **✂ Split** (into two walls at the middle), **▼ Cut-away (low)** (a short wall, like the ones on the camera side), and **🚪 Add door**. **🎨 Use on all walls** makes this wall's colour and texture the default and clears per-wall overrides.

**Textures** are subtle patterns laid over the colour. Floors offer wood planks, tiles, stone slabs, carpet and concrete; walls offer plaster, brick, wood panelling, tiles and concrete (or Plain). They keep their real-world size whatever the shape. Colour and texture changes apply to every selected wall or room at once.

**Blueprint and scale**
1. **🗺 Blueprint** → choose the image. It appears centred on your current walls.
2. **📏 Set scale…**: click both ends of something whose real length you know (a dimension line or a wall). Type that length and unit (ft, in, m or cm) and press **Apply**. The blueprint is resized around the first point.
3. Drag it into line with your walls, or use Rotate / ⟲ 90°. Lower the **Opacity** if the colours fight.
4. **Lock in place** so clicks and drags go through it to the walls. Reopen its settings with the 🗺 button or the panel.
5. Trace walls with ✏ Walls, then add doors and windows.

The blueprint is only visible in floor plan mode, unless you tick **Also show it outside edit mode**.

## Saving

- **Save** (pinned at the right of the toolbar on phones) writes the layout into the dashboard and leaves edit mode.
- **Cancel** discards changes; it asks first if you made any.
- **Undo/redo:** ↶ ↷, or Ctrl+Z / Ctrl+Shift+Z.
