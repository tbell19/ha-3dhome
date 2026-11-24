/* What the scan view asks of the ha_3dhome integration (custom_components/ha_3dhome/splats.py and scans.py):
 *
 *   GET  /api/ha_3dhome/splat/<entry>/<name>         a stored splat file (signed with auth/sign_path, so the renderer
 *                                                    can fetch it itself and report its progress)
 *   POST /api/ha_3dhome/splat/<entry>?name=<file>    upload a splat file (admins); answers {src}
 *   POST /api/ha_3dhome/scan/<entry>/<scan>/<n>      one photo of a scan in progress (admins)
 *   ws   ha_3dhome/scan/subscribe {entry_id}          the panel's scan job, now and on every change
 *   ws   ha_3dhome/scan/build {entry_id, scan_id}     turn the uploaded photos into a splat
 *   ws   ha_3dhome/scan/cancel {entry_id}             stop the job
 *   ws   ha_3dhome/helper/key {entry_id, new?}        the key the helper program connects with
 *   GET  /api/ha_3dhome/helper/files/<name>          the helper program (ha3dhome_helper.py, helper.tar.gz)
 */
import type { Hass } from "../types";

/** The panel's scan job, as the integration reports it. */
export interface ScanJob {
  scan_id: string;
  state: "uploading" | "queued" | "building" | "done" | "failed" | "cancelled";
  /** 0–1 while building */
  progress?: number;
  /** what the builder is doing, or why it failed, in plain words */
  message?: string;
  photos?: number;
  /** the computer building it, when a helper is */
  helper?: string | null;
}

/** A computer running the 3D Home helper program, connected now. */
export interface Helper {
  name: string;
  gpu?: string | null;
  busy: boolean;
}

/** where the helper program is served (no key needed: it holds no secrets) */
export const helperFile = (name: "ha3dhome_helper.py" | "helper.tar.gz") => `/api/ha_3dhome/helper/files/${name}`;

/** a stored splat is a bare file name; anything with a slash or a scheme is a URL */
export const isStoredSplat = (src: string) => !/[/:]/.test(src);

export class IntegrationApi {
  constructor(
    private readonly hass: () => Hass,
    private readonly entryId: string,
  ) {}

  private get base() {
    return `/api/ha_3dhome`;
  }

  /** where the renderer can fetch a splat from: stored files get a short-lived signed URL */
  async splatUrl(src: string): Promise<string> {
    if (!isStoredSplat(src)) return src;
    const path = `${this.base}/splat/${this.entryId}/${encodeURIComponent(src)}`;
    const { path: signed } = await this.hass().callWS<{ path: string }>({ type: "auth/sign_path", path, expires: 300 });
    return signed;
  }

  private async token() {
    const auth = this.hass().auth;
    if (!auth) return null;
    if (auth.expired && auth.refreshAccessToken) await auth.refreshAccessToken();
    return auth.data.access_token;
  }

  /** POST a body with the session's token, reporting upload progress (0–1) */
  private async post<T>(url: string, body: Blob, onProgress?: (f: number) => void): Promise<T> {
    const token = await this.token();
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url);
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("Content-Type", body.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let reply: { message?: string } = {};
        try {
          reply = JSON.parse(xhr.responseText || "{}");
        } catch {
          /* not JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(reply as T);
        else reject(new Error(reply.message || `The upload was refused (${xhr.status}).`));
      };
      xhr.onerror = () => reject(new Error("The upload didn't reach Home Assistant."));
      xhr.send(body);
    });
  }

  /** upload a splat file; resolves to its stored name (the config's `src`) */
  async uploadSplat(file: File, onProgress?: (f: number) => void): Promise<string> {
    const url = `${this.base}/splat/${this.entryId}?name=${encodeURIComponent(file.name)}`;
    const { src } = await this.post<{ src: string }>(url, file, onProgress);
    return src;
  }

  /** upload one photo of a scan */
  uploadPhoto(scanId: string, n: number, photo: Blob) {
    return this.post(`${this.base}/scan/${this.entryId}/${scanId}/${n}`, photo);
  }

  build(scanId: string) {
    return this.hass().callWS<ScanJob>({ type: "ha_3dhome/scan/build", entry_id: this.entryId, scan_id: scanId });
  }

  cancel() {
    return this.hass().callWS({ type: "ha_3dhome/scan/cancel", entry_id: this.entryId });
  }

  /** the key the helper program connects with (new: another one, which disconnects every helper) */
  helperKey(renew = false) {
    return this.hass()
      .callWS<{ key: string }>({ type: "ha_3dhome/helper/key", entry_id: this.entryId, new: renew })
      .then((r) => r.key);
  }

  /** the commands that start the helper on another computer, for this Home Assistant (as the browser reaches it) */
  helperCommands(key: string, origin = location.origin) {
    const args = `--url ${origin} --page ${this.entryId} --key ${key}`;
    return {
      python: `python3 ha3dhome_helper.py ${args}`,
      dockerBuild: `docker build -t ha3dhome-helper ${origin}${helperFile("helper.tar.gz")}`,
      dockerRun: `docker run --rm --gpus all ha3dhome-helper ${args} --name "$(hostname)"`,
    };
  }

  /** follow the panel's scan job (null when there is none) and the helpers connected */
  follow(cb: (job: ScanJob | null, helpers: Helper[]) => void) {
    return this.hass().connection.subscribeMessage<{ job: ScanJob | null; helpers?: Helper[] }>(
      (m) => cb(m.job, m.helpers ?? []),
      {
        type: "ha_3dhome/scan/subscribe",
        entry_id: this.entryId,
      },
    );
  }
}

/** a new scan's id: the time, so the photos of one scan sort together */
export const newScanId = () =>
  new Date().toISOString().replace(/[-:T]/g, "").replace(/\..*/, "") + "-" + Math.random().toString(36).slice(2, 6);
