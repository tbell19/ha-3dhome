# 3D Home Scan Builder

Turns the photos you take in the 3D Home panel ("Scan with this device" or "Use a video") into a 3D scan of the room:
a Gaussian splat. [COLMAP](https://colmap.github.io/) works out where each photo was taken, then
[OpenSplat](https://github.com/pierotofy/OpenSplat) trains the splat.

## Setting up

1. Start this add-on.
2. In Home Assistant go to **Settings → Devices & services → 3D Home → Configure**, and set **Scan builder address** to
   `http://<your Home Assistant's address>:8099`.
3. Open the 3D Home page and choose **Scan with this device**.

## How long it takes

It runs on the processor (no graphics card needed), so it is slow: expect an hour or more for a room on a fast mini PC,
and much longer on a Raspberry Pi. You can close the page meanwhile; the panel shows the progress when you come
back. Lower **steps** for a faster, blurrier scan.

The same container runs on any computer with Docker (`docker run -p 8099:8099 …`); point 3D Home at that computer's
address instead.

## Options

- **token**: a key 3D Home must send (set the same one as **Scan builder key** in 3D Home's options). Leave it empty on a
  home network you trust.
- **steps**: training steps, 500 to 30000 (default 7000).

## Tips for a good scan

- Good, even light. Turn the lights on.
- Walk slowly; keep every wall in view for a while, and film the room from a few heights.
- Things that move (people, pets, curtains in a draught) come out blurry.
