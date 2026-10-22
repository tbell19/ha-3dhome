/* Baked corner shading: outside the editor nothing in the house moves but doors, so the ambient occlusion is worked out
 * once instead of every frame (the GTAO pass draws the scene a second time and blurs the screen, about a third of a
 * frame). A camera straight above draws the height of the topmost surface at every point of the plan; a second pass
 * turns that height map into shading (how much of the sky around each point the walls and furniture hide); and every
 * lit material looks the result up by its world position. Floors darken along walls and under furniture, and walls and
 * furniture darken towards the floor. The editor keeps the GTAO pass, since there everything moves.
 */
import type * as THREE from "three";
import type { Home3DCard } from "./card";

const TEXEL = 0.6; // plan units per texel of the baked map
const MAX_SIZE = 1024; // longest side of the map, in texels
const PAD = 24; // plan units of ground around the house
const HANG = 12; // what starts higher than this above the floor (hanging lamps, wall cabinets) casts no baked shade

/** shared by every patched material of a card: the baked map, where it lies, and how strong it shows */
export interface BakedAOUniforms {
  uAoTex: { value: THREE.Texture | null };
  uAoRect: { value: THREE.Vector4 }; // x0, z0, 1/width, 1/depth (Three.js units)
  uAoRange: { value: THREE.Vector4 }; // the height map's lowest height and span, and the map's size in texels
  uAoStrength: { value: number }; // 0 = off (the editor, or the look turned off)
}

const VERT_HEAD = "varying vec3 vAoWorld;\nvarying vec3 vAoNormal;\n";
const VERT_BODY = `#include <project_vertex>
  vAoWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vAoNormal = normalize(mat3(modelMatrix) * objectNormal);`;
const FRAG_HEAD = `uniform sampler2D uAoTex;
uniform vec4 uAoRect;
uniform vec4 uAoRange;
uniform float uAoStrength;
varying vec3 vAoWorld;
varying vec3 vAoNormal;
float bakedAO() {
  if (uAoStrength <= 0.0) return 1.0;
  vec3 n = normalize(vAoNormal) * (gl_FrontFacing ? 1.0 : -1.0);
  vec2 q = vAoWorld.xz + n.xz * 1.2; // a wall's face reads the floor just in front of it
  vec2 uv = (q - uAoRect.xy) * uAoRect.zw;
  float a = texture2D(uAoTex, uv).r;
  // the height of one texel, read at its centre: a blend of a wall's top and the floor beside it would put a ledge
  // halfway up the wall
  vec2 cell = (floor(uv * uAoRange.zw) + 0.5) / uAoRange.zw;
  float top = uAoRange.x + texture2D(uAoTex, cell).g * uAoRange.y; // the topmost surface there
  float above = top - vAoWorld.y;
  if (n.y > 0.5) {
    if (above > 1.5) a = min(a, 1.0 - 0.55 * exp(-above / 10.0)); // a floor under a table or a shelf
  } else if (n.y > -0.5) {
    // a wall or a cupboard's side: a little dark where it meets the floor, and up its whole height in a corner (the
    // floor in front of a straight wall reads about 0.75, in a corner well under 0.6)
    float corner = 1.0 - 0.3 * smoothstep(0.62, 0.42, a);
    a = mix(mix(a, 1.0, 0.4), corner, smoothstep(0.0, 8.0, -above));
  }
  return mix(1.0, a, uAoStrength);
}
`;
const FRAG_BODY = `outgoingLight = (outgoingLight - totalEmissiveRadiance) * bakedAO() + totalEmissiveRadiance;
#include <opaque_fragment>`;

/** the height pass: every surface writes its height, scaled into 0..1 */
const HEIGHT_VERT = `uniform vec2 uRange;
varying float vH;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vH = (w.y - uRange.x) / uRange.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const HEIGHT_FRAG = `varying float vH;
void main() { gl_FragColor = vec4(clamp(vH, 0.0, 1.0), 0.0, 0.0, 1.0); }`;

/** the shading pass: for each texel, how far the surroundings rise above it, in 16 directions out to 20 units */
const AO_VERT = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const AO_FRAG = `uniform sampler2D tH;
uniform vec2 uStep; // one plan unit in texture space
uniform vec2 uRange;
varying vec2 vUv;
float H(vec2 uv) { return uRange.x + texture2D(tH, uv).r * uRange.y; }
void main() {
  float h0 = H(vUv);
  float occ = 0.0;
  for (int i = 0; i < 16; i++) {
    float t = float(i) * 0.39269908; // 2 pi / 16
    vec2 d = vec2(cos(t), sin(t)) * uStep;
    float m = 0.0;
    for (int j = 0; j < 6; j++) {
      float r = 1.2 * pow(1.6, float(j) + fract(float(i) * 0.618)); // 1.2 .. 20 units, staggered so no rings show
      float dh = H(vUv + d * r) - h0;
      if (dh > 0.0) m = max(m, dh / sqrt(dh * dh + r * r) * (1.0 - r / 16.0));
    }
    occ += m;
  }
  float ao = clamp(1.0 - 1.15 * occ / 16.0, 0.0, 1.0);
  gl_FragColor = vec4(ao, texture2D(tH, vUv).r, 0.0, 1.0);
}`;
/** a soft 5×5 blur of the shading over texels of about the same height, so a wall's top doesn't take on the dark of
 * the floor beside it (the height stays sharp) */
const BLUR_FRAG = `uniform sampler2D tA;
uniform vec2 uTexel;
uniform float uSpan;
varying vec2 vUv;
void main() {
  float h0 = texture2D(tA, vUv).g;
  float s = 0.0;
  float wsum = 0.0;
  for (int x = -2; x <= 2; x++)
    for (int y = -2; y <= 2; y++) {
      vec4 t = texture2D(tA, vUv + vec2(float(x), float(y)) * uTexel);
      float w = exp(-0.35 * float(x * x + y * y)) * step(abs(t.g - h0) * uSpan, 2.0);
      s += t.r * w;
      wsum += w;
    }
  gl_FragColor = vec4(s / wsum, h0, 0.0, 1.0);
}`;

export class BakePart {
  /** the uniforms every patched material shares (made once per card) */
  _aoUniforms(this: Home3DCard): BakedAOUniforms {
    const T = this.T;
    return (this._aoU ||= {
      uAoTex: { value: null },
      uAoRect: { value: new T.Vector4() },
      uAoRange: { value: new T.Vector4(0, 1, 1, 1) },
      uAoStrength: { value: 0 },
    });
  }

  /** Teaches a lit material to read the baked map. Compiles once per material type (same program key for all). */
  _patchAO(this: Home3DCard, mat: THREE.Material) {
    const m = mat as any;
    if (m.userData.aoPatched || !(m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial)) return;
    const U = this._aoUniforms();
    m.userData.aoPatched = true;
    m.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, U);
      shader.vertexShader = VERT_HEAD + shader.vertexShader.replace("#include <project_vertex>", VERT_BODY);
      shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace("#include <opaque_fragment>", FRAG_BODY);
    };
    m.customProgramCacheKey = () => "ha-3dhome-baked-ao";
    m.needsUpdate = true;
  }

  /** Bakes the map for the world as it stands. Called once the static meshes are merged (outside the editor). */
  _bakeAO(this: Home3DCard) {
    const T = this.T;
    const r = this._renderer;
    const world = this._world;
    if (!r || !world || this._edit || this._plan) return;
    const U = this._aoUniforms();
    // what the map covers: the house's footprint with a margin of ground
    const box = new T.Box3();
    world.traverse((o: any) => {
      if (o.isMesh && o.visible && !noShade(o)) box.expandByObject(o); // not the backdrop, which is far bigger
    });
    if (box.isEmpty()) return;
    const x0 = box.min.x - PAD;
    const z0 = box.min.z - PAD;
    const w = box.max.x - box.min.x + 2 * PAD;
    const d = box.max.z - box.min.z + 2 * PAD;
    const k = Math.min(1 / TEXEL, MAX_SIZE / Math.max(w, d)); // texels per unit
    const tw = Math.max(16, Math.round(w * k));
    const th = Math.max(16, Math.round(d * k));
    const lo = Math.min(0, box.min.y) - 1;
    const span = box.max.y - lo + 1;

    // 1. heights, seen from straight above (north at the top of the texture: z grows downwards)
    const hRT = new T.WebGLRenderTarget(tw, th, {
      type: T.HalfFloatType,
      minFilter: T.NearestFilter,
      magFilter: T.NearestFilter,
    });
    const cam = new T.OrthographicCamera(x0, x0 + w, -z0, -(z0 + d), 1, span + 1000);
    cam.position.set(0, box.max.y + 500, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const heightMat = new T.ShaderMaterial({
      vertexShader: HEIGHT_VERT,
      fragmentShader: HEIGHT_FRAG,
      uniforms: { uRange: { value: new T.Vector2(lo, span) } },
      side: T.DoubleSide,
    });
    // only what can be seen: no roof, glows, glass, tap targets or lights' halos
    const merged = this._batchOn;
    this._showBatch(false); // the meshes one by one: hanging ones are left out
    const hidden: THREE.Object3D[] = [];
    const bb = new T.Box3();
    this._scene.traverse((o: any) => {
      if (!o.visible) return;
      const skip =
        o.isSprite ||
        o.isLine ||
        o.isPoints ||
        (o.isMesh && noShade(o)) ||
        (o.isMesh && bb.setFromObject(o).min.y > HANG); // lamps, cords, fans, wall cabinets: little shade, and rings round a cord
      if (skip) {
        o.visible = false;
        hidden.push(o);
      }
    });
    const bg = this._scene.background;
    const override = this._scene.overrideMaterial;
    const clear = r.getClearColor(new T.Color());
    const clearAlpha = r.getClearAlpha();
    const target = r.getRenderTarget();
    const shadows = r.shadowMap.enabled;
    this._scene.background = null;
    this._scene.overrideMaterial = heightMat;
    r.shadowMap.enabled = false;
    r.setClearColor(new T.Color((0 - lo) / span, 0, 0), 1); // open ground: height 0
    r.setRenderTarget(hRT);
    r.clear();
    r.render(this._scene, cam);
    this._scene.overrideMaterial = override;
    this._scene.background = bg;
    r.shadowMap.enabled = shadows;
    for (const o of hidden) o.visible = true;
    this._showBatch(merged);

    // 2. heights → shading
    const aoRT = (this._aoRT ||= new T.WebGLRenderTarget(tw, th, { depthBuffer: false }));
    aoRT.setSize(tw, th);
    aoRT.texture.minFilter = aoRT.texture.magFilter = T.LinearFilter;
    const rawRT = new T.WebGLRenderTarget(tw, th, { depthBuffer: false });
    const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, out: THREE.WebGLRenderTarget) => {
      const quad = new T.Mesh(
        new T.PlaneGeometry(2, 2),
        new T.ShaderMaterial({ vertexShader: AO_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false }),
      );
      quad.frustumCulled = false;
      r.setRenderTarget(out);
      r.render(quad, cam);
      quad.geometry.dispose();
      quad.material.dispose();
    };
    pass(
      AO_FRAG,
      {
        tH: { value: hRT.texture },
        uStep: { value: new T.Vector2(k / tw, k / th) },
        uRange: { value: new T.Vector2(lo, span) },
      },
      rawRT,
    );
    pass(
      BLUR_FRAG,
      { tA: { value: rawRT.texture }, uTexel: { value: new T.Vector2(1 / tw, 1 / th) }, uSpan: { value: span } },
      aoRT,
    );
    r.setRenderTarget(target);
    r.setClearColor(clear, clearAlpha);
    heightMat.dispose();
    hRT.dispose();
    rawRT.dispose();

    U.uAoTex.value = aoRT.texture;
    U.uAoRect.value.set(x0, z0 + d, 1 / w, -1 / d); // v runs from z0 + d (0) to z0 (1)
    U.uAoRange.value.set(lo, span, tw, th);
    world.traverse((o: any) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) this._patchAO(m);
    });
    this._aoBaked = world;
    this._requestRender();
  }

  /** Forgets the baked map (the world it was made for is gone); the GPU memory is kept for the next bake. */
  _dropBakedAO(this: Home3DCard) {
    this._aoBaked = null;
    if (this._aoU) this._aoU.uAoStrength.value = 0;
  }
}

/** → a reason the mesh casts no baked shade: the roof, or a hidden, see-through or invisible material */
function noShade(o: THREE.Mesh) {
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  return o.userData.roof || mats.some((x) => !x || !x.visible || x.transparent || x.colorWrite === false);
}
