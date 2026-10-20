# Configuration reference

The same keys work on the card (`type: custom:ha-3dhome-card`) and inside the strategy (`strategy: {type: custom:ha-3dhome, …}`). All positions are **plan units** (see ARCHITECTURE.md → Coordinate system).

## Strategy-only options

| Key | Default | Meaning |
|---|---|---|
| `title` | `"Home"` | Title of the generated view |
| `path` | `"3d"` | URL path of the generated view (`/<dashboard>/3d`) |
| `icon` | `mdi:floor-plan` | View icon |
| `extra_views` | – | Array of ordinary Lovelace views appended after the map |

## Card options

| Key | Default | Meaning |
|---|---|---|
| `scene` | – | The building and furniture (see Scene below) |
| `lights`, `hotspots`, `chips`, `doors` | – | Entities placed on the map (see below) |
| `weather` | – | Weather entity shown top-left |
| `outdoor_temperature` | – | Sensor that overrides the weather temperature |
| `sun_entity` | `sun.sun` | Its `azimuth` and `elevation` attributes place the sun and set the daylight level (see Sun below) |
| `night_mode` | auto | `"always"` or `"never"` to force a look |
| `fill` | `false` (`true` via strategy) | Fill viewport height instead of using an aspect ratio |
| `aspect_ratio` | `"16 / 10"` | Card aspect when not `fill` |
| `view_size` | `375` | Plan units across the view (bigger = more zoomed out) |
| `pan_bounds` | `[-340,340,-240,240]` | Clamp for the camera target (Three.js X/Z) |
| `room_menu` | auto | `false` hides it; or an array `[{name, label?, floors?:[…], rect?:[x1,x2,y1,y2]}]` |
| `room_cards` | – | Lovelace cards shown top right per room: `{home: [card, …], <room name>: [card, …]}` (see below) |
| `room_fade` | `0.15` | When a room is framed, walls and furniture of other rooms in front of it fade to this opacity (0–1). `false` turns it off |
| `room_menu_exclude` | `["rug","shower_tub"]` | Floor names left out of the automatic room menu |
| `shadows` | `true` | Enable shadow maps |
| `max_shadow_lights` | `8` | How many lights cast shadows |
| `shadow_map_size` | `512` | Per-light shadow map resolution |
| `light_strength` | `1` | Global light multiplier |
| `window_light` | `1` | Daylight through windows, glass doors and glass walls into roofed rooms, scaled by how bright it is outside. `0` turns it off |
| `max_window_lights` | `10` | How many windows get daylight (widest first) |
| `ambient` | `0.35` | Room fill: the flat daytime light on every surface, 0 to 1. Lower lets window light and shadows show. Night levels don't change. Set with the Look panel's Room fill slider |
| `look` | on | Render looks, each a strength from `0` (off) to `1`. A look left out uses its default strength, and `look: false` turns them all off. Set from the editor's ✨ Look panel. See below |
| `idle_view` | off | `{room, after}`: after `after` seconds with no touch, click, scroll or key on the map, fly back to `room` (a room name from the room menu; left out = whole home). Off while editing. Set from the ✨ Look panel's "When left alone" menus |
| `max_pixel_ratio` | `2` | Cap on devicePixelRatio |
| `dashboard` | from URL | Dashboard url_path the editor saves to |
| `card_id` | – | Disambiguates the card when a dashboard has several |
| `three_url`, `orbit_url`, `jszip_url` | jsDelivr | Override CDN module URLs |
| `rooms` | – | Legacy 2D clipping rectangles; unused by 3D |

### Looks (`look`)

| Key | `true` means | What it does | Cost |
|---|---|---|---|
| `light` | `1` | Sky/ground gradient lighting, a cool front fill and soft (VSM) shadows, so each wall face gets its own shade | No extra passes |
| `ao` | `1` | Ambient occlusion (GTAO): darkens corners and creases | Post-processing pass |
| `stage` | `1` | Soft drop shadow under the house, baked from the room outlines, and a spotlit backdrop | One textured plane |
| `bloom` | `0.5` | Glow around lit lamps. Night only; by day it is off | Post-processing pass |

Example: `look: { light: 1, ao: 0.8, stage: 1, bloom: 0.3 }`. The post-processing modules load from the CDN the first time `ao` or `bloom` is above 0.

## Scene

```jsonc
"scene": {
  "wall_height": 60, "lintel": 8, "wall_thickness": 4, "low": 8,
  "wall_colors": ["#e9dcc8", "#cdbba2", "#a8957c"],
  "wall_texture": "plaster",              // optional default texture for every wall (see Textures)
  "model_scale": [2.1, 4],                // cm per plan unit [horizontal, vertical]
  "palette": { "cream": ["#e9e3d8", "#c9c1b3", "#d8d1c4"] },   // [top, left, right] — 3D uses [0]
  "floors": [ { "name": "kitchen", "pts": [[400,230],[560,230],[560,420],[400,420]], "fill": "#cfcabf", "texture": "tile" } ],
  "wall_segs": [ { "a": [30,230], "b": [560,230], "note": "back" }, { "a": [30,550], "b": [300,550], "h": 8, "low": true } ],
  "openings": [ { "kind": "door", "x": 300, "y": 490, "w": 40, "d": 6, "h": 52, "z": 0, "rot": 90 } ],
  "blueprints": [ { "src": "/api/image/serve/<id>/original", "x": 295, "y": 390, "w": 600, "h": 360, "opacity": 0.6, "locked": true } ],
  "north": 0,                             // optional: degrees north is turned clockwise from the top of the plan (back wall side)
  "roof": true,                           // optional: false lets the sun light every room from above again
  "units": "imperial",                    // optional: "imperial" | "metric" for editor lengths (default: HA's unit system)
  "boxes": [ … ], "objects": [ … ], "overlays": [ … ]
}
```

**Sun.** The sun light is placed from `sun_entity`'s `azimuth` and `elevation`, turned by `scene.north`. If those attributes are missing, the position is computed from Home Assistant's home latitude/longitude and the current time; with neither, a fixed daytime sun is used. Daylight fades between −6° and +4° elevation, and the sun turns orange near the horizon. An invisible roof over the rooms, plus walls raised to roof height wherever they are lower, means sunlight only gets in through windows and doors. Rooms whose name contains balcony, patio, deck, porch, terrace, garden or yard get no roof; set `roof: true` or `roof: false` on a room to override.

**Floors (rooms).** `name` is used by the room menu and double-click focus, which frame the room by the bounding box of `pts`. A floor named `rug` is drawn slightly raised and never focused. `menu: false` hides a room from the menu. `texture` is optional (see Textures). Edit them in floor plan mode (▱ Room, corner handles).

**Walls (`wall_segs`).** Each wall is a centre line from `a` to `b` in plan units, at any angle.
- Optional: `t` thickness (default `wall_thickness`), `h` height (default `wall_height`), `low: true` (a cut-away wall, `h` = `low`), `color`, `texture` (overrides `wall_texture`; `"none"` forces plain), `note`.
- Wall ends that meet another wall end at an angle are extended by half its thickness, so corners close.

**Textures.** Floors: `wood`, `tile`, `stone`, `carpet`, `concrete`. Walls: `plaster`, `brick`, `boards` (wood panelling), `tile`, `concrete`. (Any of them renders anywhere; the editor only offers the ones that fit.) A texture is a light greyscale pattern multiplied by the colour (normalised so the surface keeps the same average brightness), drawn procedurally at its real size using `model_scale`. Leave it out for a flat colour.

**Openings (`openings`)** are "negative boxes": every wall the box overlaps by at least half its thickness gets a hole.
- `x, y` is the centre, `w` the width along the wall, `d` the depth through the wall, `z` the bottom, `h` the height, `rot` degrees (clockwise from above, like everything else).
- `kind`: `door`, `window` (adds a glass pane) or `cut` (a plain hole).
- Doors can also have a 3D door in the hole:
  - `style`: `panel` (solid), `glass`, `double`, `sliding` (glass slider), `barn` (slides along the wall face) or `garage` (lifts up). Leave it out for an empty doorway.
  - `color` (defaults per style), `hinge: "right"` (the hinge jamb, or which way a sliding/barn door moves), `flip: true` (swing to, or hang on, the other side).
  - `entity`: a sensor that opens and shuts it. `on`, `open` and `opening` count as open, so door/window binary sensors, covers (garage doors) and input booleans all work. Without one, `open: true` shows it open.

**Blueprints (`blueprints`)** are an image underlay for tracing walls, shown only in floor-plan mode unless `show: true`.
- `x, y` is the centre, `w × h` the size in plan units, `rot` degrees, `opacity`, `locked` (clicks pass through it).
- `src` is normally an image in Home Assistant's image store (`/api/image/serve/<id>/original`), or any URL. If the upload isn't available, it is a small inline `data:` JPEG.

**`room_menu`** (optional, card or strategy level) replaces the automatic room list: `[{name, label?, floors?: [names], rect?: [x1, x2, y1, y2]}]`. A `rect` overrides the outline-derived framing. Leave it out to follow the floors.

**`room_cards`** (optional, card or strategy level) holds ordinary Lovelace card configs per room, keyed by the room menu's `name` (the floor name for automatic rooms). Picking a room from the menu, or double-clicking it, shows that room's cards in the top right corner; `home` is for the ⌂ Home view. Cards are built with Home Assistant's own card helpers, so any built-in or custom card works (tiles, entities, thermostat, stacks…). The header folds them away. Edit them in the editor's 🎛 Controls panel.

```yaml
room_cards:
  lounge:
    - type: tile
      entity: light.lounge_lamp
      features: [{ type: light-brightness }]
    - type: thermostat
      entity: climate.heat_pump
```

**Legacy walls.** Older configs use `walls: [{axis, at, spans, doors}]` and `front_walls`. They still render. Opening the editor converts them to `wall_segs` + door `openings`, with no visual change, and Save stores the new form.

**Boxes**, simple furniture, in either form:
- array: `[x1, x2, y1, y2, height, colour, z]`
- object: `{ "b": [same array], "rot": 90, "group": "sofa" }`

`colour` is a palette key or a `[top, left, right]` array. `group` makes pieces move together.

Boxes, objects and overlays also take `rx` and `rz` (v4.13): tilt in degrees about the item's own X (across) and Z (front to back) axes, applied after `rot` and about the middle of the item. Together they are Unity's rotation order (turn, then tilt).

### Objects (`scene.objects`)

All objects accept `rot` (degrees) and `group`.

| `type` | Fields |
|---|---|
| `doorpanel` | `axis`, `at`, `span:[a,b]`, `fill?` |
| `shelf` | `box:[x1,x2,y1,y2,h]`, `shelves:[z…]`, `colors?` |
| `table` | `x, y, r, z` (top height) |
| `floorlamp` | `x, y, z` (height) |
| `tablelamp` | `x, y, z` (base height) |
| `plant` | `x, y, z?` |
| `plantwall` | `x1, x2, y, z1, z2` (recessed lit niche) |
| `model` | `name, lib, sh3f, model, mr?` (modelRotation), `x, y, z, w, d, h, cm:[w,d,h]` (original cm), `mirror?, creator?, lic?` |
| `screen` | `entity` (media_player or camera), `x, y, z` (bottom), `w` (width; height is w·9/16), `stand?`, `tap?` |

### Overlays (`scene.overlays`)

Fixtures that never cast shadows. All accept `rot` and `group`.

| `type` | Fields |
|---|---|
| `pendant` | `x, y, z, top` (ceiling) |
| `track` | `a:[x,y], b:[x,y], z, heads?:[0..1…]` |
| `fan` | `x, y, z, r?, ceiling?` |
| `sink` | `rect:[x1,x2,y1,y2], z, faucet?:[x,y]` |
| `burners` | `pts:[[x,y]…], z` |
| `line` | `a:[x,y,z], b:[x,y,z], stroke, w` |
| `glasswall` | `x, y1, y2, posts:[y…], handle?, h?` |
| `cornerglass` | `x1, x2, y` |
| `railing` | `x, y1, y2, x_end, h` |
| `bulbs` | `pts:[[x,y]…], z` (string-light bulbs) |
| `frontwalls` | marker only (2D legacy) |

**`size`** (v4.12): objects with a fixed shape (`plant`, `floorlamp`, `tablelamp`, `pendant`, `fan`, `burners`, `bulbs`, `sink`) have no size fields of their own, so resizing one stores a multiplier: a number, or `[x, y, z]` along the object's own axes. It applies about the point the object stands on or hangs from (a fan stays on the ceiling). Everything else is resized by changing its own fields (`w/d/h`, `box`, `r`, end points…).

## Lights

```jsonc
{ "entity": "light.deck_spots", "name": "Deck spots",
  "x": 554, "y": 430, "z": 40,           // where the light is
  "gx": 440, "gy": 500, "gz": 0,          // aim point → spotlight when > 12 units away
  "r": 70,                                // beam reach / strength
  "halo": 6,                              // glow sprite size
  "hit": 0,                               // tap target radius (0 = not tappable; use a hotspot)
  "hx": 0, "hy": 0, "hz": 0,              // optional separate tap position
  "tap": "toggle",                        // or "more-info"
  "color": [255,200,150],                 // force a colour instead of the entity's
  "intensity": 1, "shadow": true }
```

- **Light settings** (editor: select a light → Light settings). The bulb's live brightness and colour from Home Assistant still drive the light; these set what it looks like at full brightness and full colour. Co-located bulbs share them.
  - `intensity` (default `1`, up to `4`): brightness at the bulb's full brightness.
  - `saturation` (default `1`, `0` to `2`): how strongly the bulb's colour shows; `0` is white.
  - `r` (default `40`): reach. The light fades out at about `r × 2.6` (`× 3.2` for spot lights). For string lights and the niche it scales their default reach (40 = 100%).
  - `decay` (default `1.1`, strings and niche `1.2`): falloff. Low lights evenly to the edge of the reach, high gives a bright centre that fades fast.
  - `angle` (degrees, spot lights only; default 43, 52 for cans) and `soft` (default `0.8`): beam width and how soft its edge is.
  - `halo` (default `9`): the glow drawn around the bulb.

- Lights with the same rounded `x:y:z` merge into one physical light; this is how two-bulb fans work.
- `fixture` gives the light its own model, which glows with the light: `can` (also aims straight down), `ceiling`, `pendant` (cord up to `wall_height`), `bulb`, `floorlamp` (stands on the floor, shade at `z`), `tablelamp` (shade at `z`, set it on a table) or `string`. Leave it out for a bare glow, e.g. when a fan or pendant overlay is the fixture. `trim` / `shade` override the metal and shade colours.
- `fixture: "string"` (with `kind: "string"`) runs along `points:[[x,y]…]` at height `z`. Bulbs: `count`, or one every `spacing` (default 14 units, about 30 cm), so longer strings get more bulbs. Each span sags by `sag` (default 5% of its length).
- `kind: "string"` without a fixture: the older form, `points` plus the `bulbs` overlay.
- `size` (v4.12, default `1`): scales the fixture model about the bulb; cords still reach the ceiling.
- `kind: "niche"`: uses `rect:[x1,x2,z1,z2,y]` to light the plant-wall panel.

## Hotspots

Invisible tap targets: `{ "entity", "x", "y", "z", "hit": 12 (tap radius), "tap": "toggle" | "more-info", "name" }`. Use one on a light group over a two-bulb fan (`light.study_fan` in the sample home), so one tap toggles both bulbs.

## Chips

HTML pills anchored in 3D at `x, y, z`. `size` (v4.12, default `1`) scales the pill. Two flavours:

**Generic badge**
- Fields: `{ "entity", "label"?, "show_name"?, "show_state"?: true, "icon"?, "tap"? }`.
- It shows the icon plus HA's formatted state.
- Tap behaviour by domain:
  - lights, switches, fans, input_booleans: toggle;
  - scripts and scenes: run;
  - buttons: press;
  - anything else: more-info.
- Hold always opens more-info.

**Composite chip**
- Combines any of `label`, `icon`, `temperature`, `temp_digits`, `humidity`, `climate`, `occupancy`, `media`, `tap_entity`.

## Doors

`{ "entity": "binary_sensor.…_contact", "name", "x", "y", "z", "size"?, "icon_open"?, "icon_closed"? }`. The dot is red when open and green when closed.
