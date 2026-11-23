/* Taking the photos for a 3D scan, in the browser: from the device's camera while someone walks through the room, or
 * from a video they already filmed. Each sampled frame goes through a FramePicker (src/core/capture.ts); a kept one is
 * saved as a JPEG and uploaded to the integration straight away, so finishing only has to wait for the last few.
 */
import { FramePicker, greyscale, SCAN_TARGET, type FrameVerdict } from "../core/capture";
import type { IntegrationApi } from "./api";

/** the long side of the photos sent for the build: enough detail for the trainer, small enough to upload quickly */
const PHOTO_SIZE = 1600;
/** the long side of the image the picker looks at */
const PICK_SIZE = 160;
/** how often the camera is sampled (ms) and how far a video is stepped (s) */
const CAMERA_EVERY = 150;
const VIDEO_STEP = 0.25;

/** whether this page may film with the camera itself: browsers allow it only on https pages (and localhost) */
export const canFilm = () => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;

export interface CaptureState {
  source: "camera" | "video" | null;
  running: boolean;
  kept: number;
  uploaded: number;
  failed: number;
  /** why the last frames weren't kept: "blurry" (slow down), "same" (move on), or "keep" */
  verdict: FrameVerdict;
  /** reading a video: how far through, 0–1 */
  videoDone?: number;
  error?: string;
}

export class PhotoTaker {
  readonly picker = new FramePicker();
  readonly state: CaptureState = { source: null, running: false, kept: 0, uploaded: 0, failed: 0, verdict: "soon" };
  private stream: MediaStream | null = null;
  private timer = 0;
  private stopVideo = false;
  private small = document.createElement("canvas");
  private big = document.createElement("canvas");
  private pending = new Set<Promise<unknown>>();

  constructor(
    private readonly api: IntegrationApi,
    readonly scanId: string,
    private readonly changed: () => void,
  ) {}

  /** start the camera into `video` (the back camera on phones) */
  async openCamera(video: HTMLVideoElement) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the camera here.");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    this.state.source = "camera";
    this.changed();
  }

  /** take photos from the camera until pause() */
  record(video: HTMLVideoElement) {
    if (this.state.running) return;
    this.state.running = true;
    this.changed();
    const tick = () => {
      if (!this.state.running) return;
      if (video.readyState >= 2) this.offer(video, video.videoWidth, video.videoHeight, performance.now());
      this.timer = window.setTimeout(tick, CAMERA_EVERY);
    };
    tick();
  }

  pause() {
    this.state.running = false;
    clearTimeout(this.timer);
    this.stopVideo = true;
    this.changed();
  }

  /** read a video file frame by frame */
  async readVideo(file: File) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const url = URL.createObjectURL(file);
    video.src = url;
    this.state.source = "video";
    this.state.running = true;
    this.stopVideo = false;
    this.changed();
    try {
      await new Promise<void>((ok, fail) => {
        video.onloadeddata = () => ok();
        video.onerror = () => fail(new Error("This video can't be read here. Try an MP4 or MOV file."));
      });
      const seek = (t: number) =>
        new Promise<void>((ok) => {
          video.onseeked = () => ok();
          video.currentTime = t;
        });
      const duration = video.duration;
      for (let t = 0; t < duration && !this.stopVideo; t += VIDEO_STEP) {
        await seek(t);
        this.offer(video, video.videoWidth, video.videoHeight, t * 1000);
        this.state.videoDone = Math.min(1, t / duration);
        this.changed();
      }
      this.state.videoDone = 1;
    } finally {
      URL.revokeObjectURL(url);
      this.state.running = false;
      this.changed();
    }
  }

  /** look at one frame; keep and upload it if the picker wants it */
  private offer(src: CanvasImageSource, w: number, h: number, at: number) {
    if (!w || !h || this.state.kept >= SCAN_TARGET.max) return;
    const k = PICK_SIZE / Math.max(w, h);
    const sw = Math.round(w * k);
    const sh = Math.round(h * k);
    this.small.width = sw;
    this.small.height = sh;
    const ctx = this.small.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, sw, sh);
    const g = greyscale(ctx.getImageData(0, 0, sw, sh).data, sw, sh);
    const verdict = this.picker.offer(g, sw, sh, at);
    if (verdict !== "soon") this.state.verdict = verdict;
    if (verdict === "keep") this.keep(src, w, h);
    this.changed();
  }

  private keep(src: CanvasImageSource, w: number, h: number) {
    const n = ++this.state.kept;
    const k = Math.min(1, PHOTO_SIZE / Math.max(w, h));
    this.big.width = Math.round(w * k);
    this.big.height = Math.round(h * k);
    this.big.getContext("2d")!.drawImage(src, 0, 0, this.big.width, this.big.height);
    const job = new Promise<Blob | null>((ok) => this.big.toBlob(ok, "image/jpeg", 0.9))
      .then((blob) => {
        if (!blob) throw new Error("no photo");
        return this.api.uploadPhoto(this.scanId, n, blob);
      })
      .then(
        () => this.state.uploaded++,
        (e) => {
          this.state.failed++;
          this.state.error = e instanceof Error ? e.message : String(e);
        },
      )
      .finally(() => {
        this.pending.delete(job);
        this.changed();
      });
    this.pending.add(job);
  }

  /** wait for every photo to be uploaded */
  async flush() {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  /** stop everything and let go of the camera */
  close() {
    this.pause();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
