/* The scan view's UI, as Preact components drawn from the view's state (SplatView, view.ts). The view calls
 * renderUi(view) whenever something changed; the components call the view's methods. The pins' chips are drawn here too
 * (into .pins); the view moves them every frame with a transform, which Preact leaves alone.
 */
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { SplatPin } from "../types";
import { ACTIVE, entIcon } from "../core/entities";
import { SCAN_TARGET } from "../core/capture";
import { pinGlow, pinTap, splatFormat } from "../core/splat";
import { helperFile, newScanId } from "./api";
import { canFilm, PhotoTaker } from "./capture";
import { pickFile } from "./files";
import type { SplatView } from "./view";

type V = { v: SplatView };

export function renderUi(v: SplatView) {
  render(<App v={v} />, v._uiEl!);
  render(<Pins v={v} />, v._pinsEl!);
}

/* ----- pins ----- */

function Pins({ v }: V) {
  const pins = v._cfg()?.pins ?? [];
  if (v._load?.phase !== "done" || v._scanning) return null;
  return (
    <>
      {pins.map((pin, i) => (
        <PinChip key={i} v={v} pin={pin} i={i} />
      ))}
    </>
  );
}

function PinChip({ v, pin, i }: V & { pin: SplatPin; i: number }) {
  const st = v._hass?.states[pin.entity];
  const name = pin.name || st?.attributes.friendly_name || pin.entity;
  const value = st ? (v._hass!.formatEntityState?.(st) ?? stateText(st.state, st.attributes.unit_of_measurement)) : "?";
  const cls = ["pin", st && ACTIVE.has(st.state) ? "act" : "", v._edit?.sel === i ? "sel" : ""].join(" ");
  return (
    <div
      class={cls}
      data-i={i}
      data-entity={pin.entity}
      title={`${name}: ${value}`}
      onPointerDown={(e) => v._pinDown(e, i)}
      onPointerMove={(e) => v._pinMove(e)}
      onPointerUp={() => v._pinUp()}
      onPointerCancel={() => v._pinUp()}
    >
      <span class="dot">
        <ha-icon icon={pin.icon || entIcon(st, pin.entity)} />
      </span>
      <span>{value}</span>
      {v._edit && <span class="nm">{name}</span>}
    </div>
  );
}

const stateText = (s: string, unit?: string) => (unit ? `${s} ${unit}` : s.replace(/_/g, " "));

/* ----- the page ----- */

function App({ v }: V) {
  const cfg = v._cfg();
  const admin = v._isAdmin();
  const ed = v._edit;
  if (v._scanning) return <ScanScreen v={v} />;
  return (
    <>
      {!cfg?.src && !ed && <Start v={v} />}
      {cfg?.src && <Loading v={v} />}
      {admin && cfg?.src && <Bar v={v} />}
      {ed?.tool && <ToolHint v={v} />}
      {ed && ed.sel >= 0 && !ed.tool && <Inspector v={v} />}
      {v._adding && <AddEntity v={v} />}
      {v._helpersOpen && <Helpers v={v} />}
      {v._job && cfg?.src && !v._helpersOpen && <JobBanner v={v} />}
      {!ed && admin && cfg?.src && !cfg.align && v._load?.phase === "done" && !v._job && (
        <div class="banner level-tip">
          <span>This scan isn't level yet, so it may look tilted or upside down.</span>
          <div class="row">
            <span />
            <button
              class="btn primary"
              onClick={() => {
                v._enterEdit();
                v._startLevel();
              }}
            >
              Level the floor
            </button>
          </div>
        </div>
      )}
      <Corner v={v} />
      {v._toastMsg && <div class="toast">{v._toastMsg}</div>}
    </>
  );
}

/** the first screen: how to get a 3D scan in */
function Start({ v }: V) {
  const admin = v._isAdmin();
  return (
    <div class="card start">
      <h2>Show your home as a 3D scan</h2>
      {!admin && <p>An administrator can add a 3D scan of the home here.</p>}
      {admin && v._job && <JobStatus v={v} />}
      {admin && !busy(v) && (
        <>
          <p>Film the room with your phone and Home Assistant turns it into a 3D scan you can place your devices in.</p>
          <button class="choice scan-camera" onClick={() => v._openScan(null)}>
            <ha-icon icon="mdi:camera" />
            <b>Scan with this device</b>
            <span>
              Walk slowly through the room filming everything. Takes a few minutes.
              {!canFilm() && " Your phone's camera app opens to film it."}
            </span>
          </button>
          <button class="choice scan-video" onClick={() => pickFile("video/*", (f) => v._openScan(f))}>
            <ha-icon icon="mdi:filmstrip" />
            <b>Use a video</b>
            <span>A video of the room you already filmed.</span>
          </button>
          <button class="choice upload" onClick={() => pickSplat(v)}>
            <ha-icon icon="mdi:upload" />
            <b>Upload a scan</b>
            <span>A .ply, .splat, .ksplat or .spz file, for example from Scaniverse, Polycam or Luma.</span>
          </button>
          {v._uploadPct != null && <Progress f={v._uploadPct} label="Uploading" />}
          <p class="note">
            Scans are built on a computer with a graphics card.{" "}
            <button class="link helpers-open" onClick={() => v._openHelpers()}>
              {v._helpers.length ? `Connected: ${v._helpers.map((h) => h.name).join(", ")}` : "Set one up"}
            </button>
          </p>
          <button class="link plan" onClick={() => v._usePlan()}>
            Draw a floor plan instead
          </button>
        </>
      )}
    </div>
  );
}

const busy = (v: SplatView) => !!v._job && ["uploading", "queued", "building"].includes(v._job.state);

function Progress({ f, label }: { f: number; label: string }) {
  return (
    <div>
      <div class="progress">
        <i style={{ width: `${Math.round(f * 100)}%` }} />
      </div>
      <small>
        {label} {Math.round(f * 100)}%
      </small>
    </div>
  );
}

/** the scan job, in words */
function JobStatus({ v }: V) {
  const job = v._job!;
  const what = {
    uploading: "Waiting for the photos",
    queued: "Waiting to start building the 3D scan",
    building: "Building the 3D scan",
    done: "The 3D scan is ready",
    failed: "The 3D scan couldn't be built",
    cancelled: "The 3D scan was stopped",
  }[job.state];
  return (
    <div class="job" data-state={job.state}>
      <b>{what}</b>
      {job.message && <p>{job.message}</p>}
      {job.state === "building" && <Progress f={job.progress ?? 0} label="" />}
      {busy(v) && <p>You can close this page; it carries on.</p>}
      <div class="row">
        {job.state === "queued" && !v._helpers.length && (
          <button class="btn primary" onClick={() => v._openHelpers()}>
            Set up a computer to build it
          </button>
        )}
        {busy(v) && (
          <button class="btn" onClick={() => v._api!.cancel()}>
            Stop
          </button>
        )}
      </div>
    </div>
  );
}

function JobBanner({ v }: V) {
  if (!busy(v) && v._job!.state !== "failed") return null;
  return (
    <div class="banner">
      <JobStatus v={v} />
    </div>
  );
}

function Loading({ v }: V) {
  const l = v._load;
  if (!l || l.phase === "done") return null;
  if (l.phase === "failed")
    return (
      <div class="card failed">
        <h2>The 3D scan couldn't be shown</h2>
        <p>{l.error}</p>
        <button class="btn" onClick={() => v._apply()}>
          Try again
        </button>
      </div>
    );
  return (
    <div class="card loading">
      <b>{l.phase === "download" ? "Loading the 3D scan" : "Getting the 3D scan ready"}</b>
      <Progress f={l.phase === "download" ? l.pct / 100 : 1} label="" />
    </div>
  );
}

/** the top bar: Edit, or the editing tools */
function Bar({ v }: V) {
  const ed = v._edit;
  if (!ed)
    return (
      <div class="bar top">
        <button class="btn edit" onClick={() => v._enterEdit()}>
          <ha-icon icon="mdi:pencil" />
          <span class="lbl">Edit</span>
        </button>
      </div>
    );
  const ready = v._load?.phase === "done";
  return (
    <div class="bar top">
      <button
        class={`btn add ${v._adding || ed.tool === "place" ? "on" : ""}`}
        disabled={!ready}
        onClick={() => v._toggleAdding()}
      >
        <ha-icon icon="mdi:plus" />
        <span class="lbl">Add device</span>
      </button>
      <button class={`btn level ${ed.tool === "level" ? "on" : ""}`} disabled={!ready} onClick={() => v._startLevel()}>
        <ha-icon icon="mdi:angle-acute" />
        <span class="lbl">Level the floor</span>
      </button>
      {ed.work.align && (
        <>
          <button class="btn spin-l" title="Turn left" onClick={() => v._spin(-15)}>
            ↺
          </button>
          <button class="btn spin-r" title="Turn right" onClick={() => v._spin(15)}>
            ↻
          </button>
        </>
      )}
      <button class="btn start-view" disabled={!ready} onClick={() => v._setStartView()}>
        <ha-icon icon="mdi:camera-marker-outline" />
        <span class="lbl">Open on this view</span>
      </button>
      <button class="btn replace" onClick={() => pickSplat(v)}>
        <ha-icon icon="mdi:upload" />
        <span class="lbl">Replace scan</span>
      </button>
      <button class="btn rescan" onClick={() => v._openScan(null)}>
        <ha-icon icon="mdi:camera" />
        <span class="lbl">Scan again</span>
      </button>
      <span style={{ flex: 1 }} />
      <button class="btn undo" disabled={!ed.undo.length} onClick={() => v._undo()}>
        <ha-icon icon="mdi:undo" />
      </button>
      <button class="btn cancel" onClick={() => (!ed.dirty || confirm("Drop your changes?")) && v._exitEdit()}>
        Cancel
      </button>
      <button class="btn primary save" disabled={ed.saving} onClick={() => v._save()}>
        {ed.saving ? "Saving…" : "Save"}
      </button>
      {v._uploadPct != null && <Progress f={v._uploadPct} label="Uploading" />}
    </div>
  );
}

function ToolHint({ v }: V) {
  const ed = v._edit!;
  const text =
    ed.tool === "place"
      ? `Tap the scan where ${v._hass?.states[ed.placeEntity]?.attributes.friendly_name || ed.placeEntity} is.`
      : `Tap three spots spread over the floor (${ed.levelPts.length} of 3).`;
  return <div class="hint">{text}</div>;
}

/** choose an entity to place */
function AddEntity({ v }: V) {
  const [q, setQ] = useState("");
  const states = v._hass?.states ?? {};
  const ids = Object.keys(states).sort();
  const ok = q in states;
  return (
    <div class="card add-entity">
      <h2>Add a device</h2>
      <p>Choose it, then tap where it is in the scan.</p>
      <input
        list="ha3d-entities"
        placeholder="light.kitchen"
        value={q}
        autoFocus
        onInput={(e) => setQ((e.target as HTMLInputElement).value.trim())}
        onKeyDown={(e) => e.key === "Enter" && ok && v._startPlace(q)}
      />
      <datalist id="ha3d-entities">
        {ids.map((id) => (
          <option value={id}>{states[id].attributes.friendly_name || id}</option>
        ))}
      </datalist>
      <div class="row" style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button class="btn" onClick={() => v._toggleAdding()}>
          Cancel
        </button>
        <button class="btn primary place" disabled={!ok} onClick={() => v._startPlace(q)}>
          Place it
        </button>
      </div>
    </div>
  );
}

/** the selected pin */
function Inspector({ v }: V) {
  const ed = v._edit!;
  const pin = ed.work.pins![ed.sel];
  if (!pin) return null;
  const states = v._hass?.states ?? {};
  const set = (patch: Partial<SplatPin>) =>
    v._mutate((w) => {
      const p = w.pins![ed.sel];
      for (const [k, x] of Object.entries(patch)) {
        if (x === undefined || x === "") delete (p as unknown as Record<string, unknown>)[k];
        else (p as unknown as Record<string, unknown>)[k] = x;
      }
    });
  return (
    <div class="insp">
      <b>{states[pin.entity]?.attributes.friendly_name || pin.entity}</b>
      <label>
        Entity
        <input
          list="ha3d-entities-i"
          value={pin.entity}
          onChange={(e) => {
            const id = (e.target as HTMLInputElement).value.trim();
            if (id in states) set({ entity: id });
          }}
        />
        <datalist id="ha3d-entities-i">
          {Object.keys(states)
            .sort()
            .map((id) => (
              <option value={id} />
            ))}
        </datalist>
      </label>
      <label>
        Label
        <input
          value={pin.name || ""}
          placeholder={states[pin.entity]?.attributes.friendly_name || ""}
          onChange={(e) => set({ name: (e.target as HTMLInputElement).value })}
        />
      </label>
      <label>
        A tap
        <select
          value={pin.tap || ""}
          onChange={(e) => set({ tap: ((e.target as HTMLSelectElement).value || undefined) as SplatPin["tap"] })}
        >
          <option value="">
            Default ({pinTap({ entity: pin.entity, p: pin.p }) === "toggle" ? "toggle" : "open details"})
          </option>
          <option value="toggle">Toggles it</option>
          <option value="more-info">Opens its details</option>
          <option value="none">Does nothing</option>
        </select>
      </label>
      <label>
        Glow when on ({pinGlow(pin).toFixed(1)} m)
        <input
          type="range"
          min="0"
          max="4"
          step="0.1"
          value={pinGlow(pin)}
          onChange={(e) => set({ glow: +(e.target as HTMLInputElement).value })}
        />
      </label>
      <p style={{ margin: 0, opacity: 0.7, fontSize: "12px" }}>Drag the chip to move it.</p>
      <div class="row">
        <button class="btn delete" onClick={() => v._mutate((w) => void w.pins!.splice(ed.sel, 1))}>
          <ha-icon icon="mdi:delete" /> Remove
        </button>
        <button class="btn" onClick={() => ((ed.sel = -1), v._ui())}>
          Done
        </button>
      </div>
    </div>
  );
}

/** bottom right: back to the start view, and the ⋮ menu */
function Corner({ v }: V) {
  const home = v.homePage;
  const isHome = !!(home && v._hass && home.isHome(v._hass));
  return (
    <>
      <div class="bar corner">
        {v._cfg()?.src && (
          <button class="btn home-view" title="Back to the start view" onClick={() => v._goView()}>
            <ha-icon icon="mdi:home-outline" />
          </button>
        )}
        {home && (
          <button class="btn more" onClick={() => ((v._menu = !v._menu), v._ui())}>
            <ha-icon icon="mdi:dots-vertical" />
          </button>
        )}
      </div>
      {v._menu && home && (
        <div class="menu">
          <button
            onClick={async () => {
              v._menu = false;
              await home.setHome(v._hass!, !isHome).catch(() => v._toast("Couldn't change that."));
              v._ui();
            }}
          >
            {isHome ? "Don't open Home Assistant here" : "Open Home Assistant on this page"}
          </button>
        </div>
      )}
    </>
  );
}

/* ----- building on another computer ----- */

/** How to start the helper program on a computer with a good graphics card, and which computers are connected. */
function Helpers({ v }: V) {
  const [tab, setTab] = useState<"python" | "docker">("docker");
  const key = v._helperKey;
  const cmds = key ? v._api!.helperCommands(key) : null;
  return (
    <div class="card helpers">
      <h2>Build scans on another computer</h2>
      <p>
        A computer with a good graphics card builds a scan in minutes. Open this page on that computer and start the 3D
        Home helper there: it connects to Home Assistant and builds every scan you make, until you stop it.
      </p>
      <div class="connected">
        {v._helpers.length ? (
          v._helpers.map((h) => (
            <div class="helper" data-name={h.name}>
              <span class="dot on" /> <b>{h.name}</b> {h.gpu && <span class="gpu">{h.gpu}</span>}
              {h.busy && <span class="busy"> · building</span>}
            </div>
          ))
        ) : (
          <div class="helper none">
            <span class="dot" /> No computer is connected yet.
          </div>
        )}
      </div>
      <div class="tabs">
        <button class={`btn ${tab === "docker" ? "on" : ""}`} onClick={() => setTab("docker")}>
          Docker (NVIDIA)
        </button>
        <button class={`btn ${tab === "python" ? "on" : ""}`} onClick={() => setTab("python")}>
          Without Docker
        </button>
      </div>
      {!cmds && <p>Getting the key…</p>}
      {cmds && tab === "docker" && (
        <ol>
          <li>
            On Linux with an NVIDIA card, Docker and the NVIDIA Container Toolkit. Build the helper once (it takes a
            while):
            <Command text={cmds.dockerBuild} v={v} />
          </li>
          <li>
            Start it:
            <Command text={cmds.dockerRun} v={v} />
          </li>
        </ol>
      )}
      {cmds && tab === "python" && (
        <ol>
          <li>
            <a class="download" href={helperFile("ha3dhome_helper.py")} download="ha3dhome_helper.py">
              Download the helper
            </a>{" "}
            (Python 3.9 or newer).
          </li>
          <li>
            Install COLMAP (Debian/Ubuntu: <code>sudo apt install colmap</code>) and OpenSplat built for your graphics
            card (github.com/pierotofy/OpenSplat).
          </li>
          <li>
            In the folder you downloaded it to:
            <Command text={cmds.python} v={v} />
          </li>
        </ol>
      )}
      <p class="note">
        The key in these commands only lets the helper fetch this page's photos and send back scans.{" "}
        <button
          class="link new-key"
          onClick={() => confirm("Make a new key? Helpers using the old one disconnect.") && v._openHelpers(true)}
        >
          New key
        </button>
      </p>
      <div class="row" style={{ display: "flex", justifyContent: "flex-end" }}>
        <button class="btn close" onClick={() => ((v._helpersOpen = false), v._ui())}>
          Done
        </button>
      </div>
    </div>
  );
}

function Command({ text, v }: V & { text: string }) {
  return (
    <div class="cmd">
      <code>{text}</code>
      <button
        class="btn copy"
        onClick={() =>
          navigator.clipboard?.writeText(text).then(
            () => v._toast("Copied."),
            () => v._toast("Couldn't copy: select the text instead."),
          )
        }
      >
        Copy
      </button>
    </div>
  );
}

/* ----- taking photos ----- */

function ScanScreen({ v }: V) {
  const video = useRef<HTMLVideoElement>(null);
  const [, redraw] = useState(0);
  const [taker] = useState(() => new PhotoTaker(v._api!, newScanId(), () => redraw((n) => n + 1)));
  const [error, setError] = useState("");
  const [finishing, setFinishing] = useState(false);
  v._taker = taker;
  useEffect(() => {
    const file = v._scanVideo;
    if (file) taker.readVideo(file).catch((e) => setError(e.message));
    else taker.openCamera(video.current!).catch((e) => setError(cameraError(e)));
    return () => taker.close();
  }, []);
  const s = taker.state;
  const close = () => {
    taker.close();
    v._closeScan();
  };
  const finish = async () => {
    setFinishing(true);
    taker.pause();
    try {
      await taker.flush();
      await v._api!.build(taker.scanId);
      taker.close();
      v._closeScan();
      if (v._helpers.length)
        v._toast(`Your photos are with Home Assistant. ${v._helpers[0].name} will build the 3D scan.`);
      else {
        v._toast("Your photos are with Home Assistant. Now set up a computer to build the 3D scan.");
        v._openHelpers();
      }
    } catch (e) {
      setError((e as { message?: string })?.message || String(e));
      setFinishing(false);
    }
  };
  const tip =
    s.source === "video"
      ? `Reading the video… ${Math.round((s.videoDone ?? 0) * 100)}%`
      : !s.running
        ? "Hold the phone upright and walk slowly round the room, filming every wall, the floor and the furniture from a few angles. Press record to start."
        : s.verdict === "blurry"
          ? "Too blurry: move more slowly."
          : s.verdict === "same"
            ? "Keep moving to show something new."
            : "Good, keep going.";
  const enough = s.kept >= SCAN_TARGET.min;
  return (
    <div class="scan">
      <video ref={video} playsInline muted />
      <div class="over">
        <div class={`tips ${s.running && s.verdict !== "keep" && s.source === "camera" ? "warn" : ""}`}>
          {error || tip}
        </div>
        <span />
        <div class="foot">
          <span class="count">
            {s.kept} photos{s.uploaded < s.kept ? ` (${s.kept - s.uploaded} still uploading)` : ""} · aim for{" "}
            {SCAN_TARGET.good}
          </span>
          <div class="progress" style={{ width: "min(320px, 80vw)" }}>
            <i style={{ width: `${Math.min(100, (s.kept / SCAN_TARGET.good) * 100)}%` }} />
          </div>
          {s.source === "camera" && (
            <button
              class={`rec ${s.running ? "on" : ""}`}
              aria-label={s.running ? "Pause" : "Record"}
              onClick={() => (s.running ? taker.pause() : taker.record(video.current!))}
            />
          )}
          <div class="row">
            <button class="btn" onClick={close}>
              Cancel
            </button>
            <button
              class="btn primary finish"
              disabled={!enough || finishing || (s.source === "video" && s.running)}
              onClick={finish}
            >
              {finishing ? "Sending…" : enough ? "Build the 3D scan" : `At least ${SCAN_TARGET.min} photos`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const cameraError = (e: unknown) => {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError")
    return "The camera wasn't allowed. Allow it in the browser's settings, or use a video instead.";
  if (name === "NotFoundError") return "This device has no camera. Use a video instead.";
  return (e as { message?: string })?.message || "The camera couldn't start.";
};

/* ----- files ----- */

function pickSplat(v: SplatView) {
  pickFile(".ply,.splat,.ksplat,.spz", (f) => {
    if (!splatFormat(f.name)) return v._toast("That isn't a 3D scan file (.ply, .splat, .ksplat or .spz).");
    v._upload(f);
  });
}
