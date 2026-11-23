/* The part of @mkkellogg/gaussian-splats-3d (0.4.7, which ships no types) that the scan view uses. */
declare module "@mkkellogg/gaussian-splats-3d" {
  import type { Camera, Group, Object3D, Vector3 } from "three";

  export const SceneFormat: { Splat: 0; KSplat: 1; Ply: 2; Spz: 3 };
  export const LogLevel: { None: 0; Error: 1; Warning: 2; Info: 3; Debug: 4 };
  export const SceneRevealMode: { Default: 0; Gradual: 1; Instant: 2 };
  export const SplatRenderMode: { ThreeD: 0; TwoD: 1 };

  export interface AbortablePromise<T> extends Promise<T> {
    abort(reason?: unknown): void;
  }

  export interface SplatHit {
    origin: Vector3;
    normal: Vector3;
    distance: number;
  }

  export interface SplatMesh extends Object3D {
    material: import("three").Material;
    getSplatCount(): number;
    getSplatCenter(index: number, out: Vector3, applySceneTransform?: boolean): void;
    getSplatTree(): unknown;
  }

  export interface Viewer {
    raycaster: {
      setFromCameraAndScreenPosition(
        camera: Camera,
        at: { x: number; y: number },
        size: { x: number; y: number },
      ): void;
      intersectSplatMesh(mesh: SplatMesh, out?: SplatHit[]): SplatHit[] | undefined;
    };
    splatMesh: SplatMesh;
  }

  export interface DropInViewerOptions {
    sharedMemoryForWorkers?: boolean;
    gpuAcceleratedSort?: boolean;
    integerBasedSort?: boolean;
    sphericalHarmonicsDegree?: number;
    dynamicScene?: boolean;
    sceneRevealMode?: number;
    logLevel?: number;
    splatRenderMode?: number;
    antialiased?: boolean;
    halfPrecisionCovariancesOnGPU?: boolean;
    enableSIMDInSort?: boolean;
  }

  export interface AddSceneOptions {
    format?: number;
    showLoadingUI?: boolean;
    progressiveLoad?: boolean;
    splatAlphaRemovalThreshold?: number;
    headers?: Record<string, string>;
    /** percent 0–100, a label such as "12.3 MB", and the loader's state (0 downloading, 1 processing, 2 done) */
    onProgress?(percent: number, label: string, status: number): void;
  }

  export class DropInViewer extends Group {
    constructor(options?: DropInViewerOptions);
    viewer: Viewer;
    splatMesh: SplatMesh | null;
    addSplatScene(path: string, options?: AddSceneOptions): AbortablePromise<void>;
    dispose(): Promise<void>;
  }
}
