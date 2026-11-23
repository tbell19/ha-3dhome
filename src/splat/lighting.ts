/* Live lighting on a 3D scan. The splat renderer's material is a ShaderMaterial; this adds a few uniforms and lines to
 * its vertex shader so every splat's colour is scaled by the scan's ambient level and lit by the lights that are on
 * (scanLighting() in src/core/splat.ts works out which and how much). The lighting is per splat, in the scan's own
 * coordinates (where the pins are), with a smooth falloff to each light's reach.
 *
 * The patch looks for two lines of @mkkellogg/gaussian-splats-3d 0.4.7's shader. If a new version changes them, the
 * scan still shows, just without live lighting (patchSplatMaterial returns false and the tests say so).
 */
import type { ShaderMaterial } from "three";
import { MAX_SCAN_LIGHTS, type ScanLighting } from "../core/splat";

const DECLARE = "varying vec4 vColor;";
const COLOUR = "vColor = uintToRGBAVec(sampledCenterColor.r);";

const UNIFORMS = `
uniform float ha3dAmbient;
uniform int ha3dCount;
uniform vec4 ha3dLight[${MAX_SCAN_LIGHTS}];
uniform vec3 ha3dColour[${MAX_SCAN_LIGHTS}];
`;

const LIGHTING = `
{
  vec3 lit = vec3(ha3dAmbient);
  for (int i = 0; i < ${MAX_SCAN_LIGHTS}; i++) {
    if (i >= ha3dCount) break;
    float d = length(splatCenter - ha3dLight[i].xyz) / ha3dLight[i].w;
    lit += ha3dColour[i] * smoothstep(1.0, 0.0, d) * 1.2;
  }
  vColor.rgb = min(vColor.rgb * lit, vec3(1.0));
}
`;

/** add the lighting to the splat material; false when its shader isn't the one this was written for */
export function patchSplatMaterial(m: ShaderMaterial): boolean {
  if (m.userData.ha3dLit) return true;
  const vs = m.vertexShader;
  if (!vs.includes(DECLARE) || !vs.includes(COLOUR)) return false;
  m.vertexShader = vs.replace(DECLARE, DECLARE + UNIFORMS).replace(COLOUR, COLOUR + LIGHTING);
  m.uniforms.ha3dAmbient = { value: 1 };
  m.uniforms.ha3dCount = { value: 0 };
  m.uniforms.ha3dLight = { value: Array.from({ length: MAX_SCAN_LIGHTS }, () => [0, 0, 0, 1]).flat() };
  m.uniforms.ha3dColour = { value: Array.from({ length: MAX_SCAN_LIGHTS }, () => [0, 0, 0]).flat() };
  m.userData.ha3dLit = true;
  m.needsUpdate = true;
  return true;
}

/** set the lighting's uniforms */
export function setLighting(m: ShaderMaterial, l: ScanLighting) {
  if (!m.userData.ha3dLit) return;
  const pos = m.uniforms.ha3dLight.value as number[];
  const col = m.uniforms.ha3dColour.value as number[];
  l.lights.forEach((L, i) => {
    pos.splice(i * 4, 4, L.p[0], L.p[1], L.p[2], L.r);
    col.splice(i * 3, 3, ...L.c);
  });
  m.uniforms.ha3dCount.value = l.lights.length;
  m.uniforms.ha3dAmbient.value = l.ambient;
}
