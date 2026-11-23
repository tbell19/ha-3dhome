# 3D scans (Gaussian splats)

An experiment, on its own branch: instead of drawing the home as a floor plan, film it, let Home Assistant turn the
video into a 3D scan (a [Gaussian splat](https://en.wikipedia.org/wiki/Gaussian_splatting)), and pin your devices into
that scan. The floor plan map is still there: an empty page offers both, and a config without `splat` shows the map as
before.

## Getting a scan in

The empty page offers three ways in, all without leaving Home Assistant:

| Way | What happens |
|---|---|
| **Scan with this device** | The page films with the camera (back camera on phones). It keeps a photo whenever the picture is sharp and shows something new (`src/core/capture.ts`), and uploads each one straight away. With 60 or more photos, **Build the 3D scan** asks the integration to build it. Browsers only let https pages use the camera: on plain http, the phone's own camera app films a video instead, which is then read as below. |
| **Use a video** | A video already filmed: read frame by frame through the same photo picker. |
| **Upload a scan** | A `.ply`, `.splat`, `.ksplat` or `.spz` file made elsewhere, for example by Scaniverse, Polycam or Luma on a phone. Shown straight away. |

### Building: the scan builder

Training a splat takes heavy computing for a long time, which Home Assistant itself must not do. The integration hands
the photos to a **scan builder** and follows it (`custom_components/ha_3dhome/scans.py`):

- `builder/` in this repository is a Home Assistant add-on, "3D Home Scan Builder" (`repository.yaml` makes the repository
  an add-on store). [COLMAP](https://colmap.github.io/) works out where each photo was taken, then
  [OpenSplat](https://github.com/pierotofy/OpenSplat) trains the splat, on the CPU. The same container runs on any
  computer with Docker, which is faster when that computer is.
- Its address (and an optional key) goes in the integration's options: Settings → Devices & services → 3D Home →
  Configure → **Scan builder address**.
- The job survives a restart of Home Assistant. When it's done, the integration fetches the splat into
  `<config>/ha_3dhome/<entry_id>/splats/`, puts it in the panel's config (pins kept, levelling reset) and deletes the
  photos. Every open page shows the progress and then the scan.

The builder's API is in `builder/server.py`'s docstring; `npm run test:builder` runs it with a stand-in for the
pipeline.

## The view

`<ha-3dhome-splat>` (`src/splat/`) replaces `<ha-3dhome-map>` on the page when the config has `splat`, and on an empty
page. The panel loads it the first time it's needed, so the floor plan map never pays for the splat renderer
(`@mkkellogg/gaussian-splats-3d`, bundled like Three.js; it shares the map's Three.js).

- **Pins** are HTML chips at points in the scan, showing the entity's icon and state. A tap toggles lights, switches
  and fans and opens anything else's details; a hold opens details. Pins are kept in the scan's own coordinates, so
  levelling never moves them off what they mark.
- **Editing** (admins): **Add device** (choose an entity, then tap where it is: the tap is ray-cast against the splats),
  drag a chip to move it, **Level the floor** (tap three spots on the floor; ↺ ↻ then turn the room), **Open on this
  view**, **Replace scan**, **Scan again**, undo, Save. Save writes `splat` through the same `LayoutStore` as the map.
- Rendering is on demand, like the map's.

## Lighting

A splat keeps the light it was filmed in: it is coloured blobs, with no materials and no surface normals, so it can't
be relit the way the drawn floor plan is. The view approximates it instead, in the splat renderer's own shader
(`src/splat/lighting.ts`, maths in `scanLighting()` in `src/core/splat.ts`):

- **Day and night:** after dark (`sun.sun`'s elevation, fading through twilight) the whole scan dims to `splat.night`
  (default 0.25).
- **Lights that are on** add their colour, scaled by brightness, to every splat within their reach (3 m × the pin's
  `glow`), fading smoothly to nothing. The 8 brightest count.
- **A halo** (an additive sprite) marks each light that's on.

Without normals, light passes through thin walls and lights the backs of things too. Estimating a normal from each
splat's flattest axis would be the next step.

## Config

```yaml
splat:
  src: scan-20261123-ab12.ply     # a stored file (uploaded or built), or a URL
  format: ply                     # only when src doesn't end in .ply/.splat/.ksplat/.spz
  align: { q: [x, y, z, w], t: [x, y, z] }   # levels the scan: floor at height 0, Y up
  view: { position: [x, y, z], target: [x, y, z] }   # where the page opens, levelled coordinates
  night: 0.25                     # brightness after dark, 0–1 (1: no dimming)
  pins:
    - entity: light.floor_lamp
      p: [1.2, 0.4, -2.1]         # in the scan's own coordinates (metres)
      name: Lamp                  # optional; the entity's name otherwise
      icon: mdi:floor-lamp        # optional
      glow: 1                     # lights: halo radius (m) and a third of the light's reach; 0 = neither
      tap: toggle                 # toggle | more-info | none
```

## The integration's side

| Endpoint | |
|---|---|
| `GET /api/ha_3dhome/splat/<entry>/<name>` | a stored splat (signed in, or a path signed with `auth/sign_path`, so the renderer streams it with progress) |
| `POST /api/ha_3dhome/splat/<entry>?name=<file>` | upload a splat (admins); checked to look like one |
| `POST /api/ha_3dhome/scan/<entry>/<scan>/<n>` | photo n of a scan (admins), a JPEG |
| ws `ha_3dhome/scan/subscribe`, `scan/build`, `scan/cancel` | the panel's scan job (admins) |

Files live under `<config>/ha_3dhome/<entry_id>/` and go when the panel is deleted.

## Trying it next to the released 3D Home

`npm run build && npm run build:preview` writes `preview/custom_components/ha_3dhome_scan/`: the same integration under
other names (domain `ha_3dhome_scan`, its own URLs, elements and storage), so it installs beside the released one. Copy
the folder into `/config/custom_components/`, restart Home Assistant, and add **3D Home (scan preview)**.

## Tests

- `npm run test:unit`: levelling, extent, lighting and the photo picker, in Node.
- `npm run test:splat`: the view in Chromium on a fictional room (`tools/mock/build-sample-splat.js`, tilted like a
  phone scan): the start screen, uploading, levelling from three taps, placing devices by tapping, Save, live pins and
  lighting, the camera (Chromium's fake camera), the build's progress, "Draw a floor plan instead", non-admins.
- `npm run test:py`: uploads, photos, admin checks, and a whole build against a mocked builder (`tests/test_scans.py`).
- `npm run test:builder`: the builder's server with a stand-in pipeline.

Not tested here: the real COLMAP + OpenSplat image (its Dockerfile needs the PyTorch download host and was not built in
the development sandbox), and scans of real rooms.
