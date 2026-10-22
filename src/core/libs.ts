/* The third-party modules the map uses. They are bundled into the integration's own files (no CDN), so the map works
 * without internet access. Each one loads the first time it's needed: the build puts every dynamic import below in its
 * own file under frontend/lib/, named by a hash of its content, and the browser fetches it once and caches it.
 * Three.js comes first (the map can't draw without it); the rest wait for the feature that needs them. The editor's own
 * (the transform gizmo and js-yaml) are in src/editor/shared.ts.
 */
export const loadThree = () => import("three");
export const loadOrbitControls = () => import("three/examples/jsm/controls/OrbitControls.js");
/** the OBJ and MTL loaders, for Sweet Home 3D models */
export const loadModelLoaders = () =>
  Promise.all([import("three/examples/jsm/loaders/OBJLoader.js"), import("three/examples/jsm/loaders/MTLLoader.js")]);
/** the post-processing passes behind the corner shading (`ao`) and lamp glow (`bloom`) looks */
export const loadPostProcessing = () =>
  Promise.all([
    import("three/examples/jsm/postprocessing/EffectComposer.js"),
    import("three/examples/jsm/postprocessing/RenderPass.js"),
    import("three/examples/jsm/postprocessing/OutputPass.js"),
    import("three/examples/jsm/postprocessing/GTAOPass.js"),
    import("three/examples/jsm/postprocessing/UnrealBloomPass.js"),
  ]);
/** JSZip, for opening Sweet Home 3D libraries */
export const loadJSZip = () => import("jszip").then((m) => m.default);
