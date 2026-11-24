# 3D Home Scan Builder

Turns the photos you take in the 3D Home panel ("Scan with this device" or "Use a video") into a 3D scan of the room:
a Gaussian splat. [COLMAP](https://colmap.github.io/) works out where each photo was taken, then
[OpenSplat](https://github.com/pierotofy/OpenSplat) trains the splat.

## Before you install it

**Prefer the 3D Home helper on a computer with a graphics card** (3D Home page → Build on another computer): it is
much faster and doesn't load Home Assistant's machine.

This app builds on the processor of the machine it runs on, and needs **8 GB of memory or more**, both to build its
image and to train. On a smaller Home Assistant machine it runs out of memory, and the system stops other apps to
make room.

To use it, install and start it, then set **Scan builder address** in **Settings → Devices & services → 3D Home →
Configure** to `http://<that machine>:8099`.

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
