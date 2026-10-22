/* Versions, names and URLs the card depends on (its third-party modules are in libs.ts), plus the plan-to-scene offset and the render-look defaults.
 */
import type { CardConfig, LayoutKey, Looks } from "../types";

export const VERSION3D = "6.2.5";
export const CX = 296;
export const CY = 391;
/* render looks, each a strength 0..1 under `look:`. A missing key or true uses the default strength, 0 or false turns it off, and `look: false` turns them all off. */
export const LOOKS: Looks = { light: 1, ao: 1, stage: 1, bloom: 0.5 };
export const AMBIENT = 0.35; // default `ambient`: how much flat daytime fill lights every surface
export const lookOf = (cfg: CardConfig | undefined): Looks =>
  Object.fromEntries(
    Object.entries(LOOKS).map(([k, d]) => {
      const v = cfg?.look === false ? 0 : cfg?.look?.[k as keyof Looks];
      return [k, v === true || v == null ? d : Math.max(0, Math.min(1, +v || 0))];
    }),
  ) as Looks;
export const OUTDOOR = /balcony|patio|deck|porch|terrace|garden|yard/i; // rooms left without a roof (set `roof: true/false` on a room to override)
export const SF = "https://downloads.sourceforge.net/project/sweethome3d/SweetHome3D-models/3DModels-1.9.3/";
export interface LibraryInfo {
  file: string;
  title: string;
  size: string;
  n: number;
  lic: string;
}
export const LIBS: LibraryInfo[] = [
  {
    file: "3DModels-LucaPresidente-1.9.3.zip",
    title: "Luca Presidente",
    size: "3.7 MB",
    n: 64,
    lic: "Free Art License",
  },
  { file: "3DModels-Trees-1.9.3.zip", title: "Trees", size: "6.7 MB", n: 10, lic: "Free Art License" },
  { file: "3DModels-KatorLegaz-1.9.3.zip", title: "Kator Legaz", size: "8.9 MB", n: 90, lic: "CC-BY" },
  { file: "3DModels-Reallusion-1.9.3.zip", title: "Reallusion", size: "10.7 MB", n: 25, lic: "CC-BY" },
  {
    file: "3DModels-BlendSwap-CC-0-1.9.3.zip",
    title: "BlendSwap CC-0",
    size: "23.8 MB",
    n: 175,
    lic: "Public domain (CC0)",
  },
  { file: "3DModels-BlendSwap-CC-BY-1.9.3.zip", title: "BlendSwap CC-BY", size: "23.9 MB", n: 135, lic: "CC-BY" },
  { file: "3DModels-Contributions-1.9.3.zip", title: "Contributions", size: "29 MB", n: 511, lic: "Free Art License" },
  { file: "3DModels-Scopia-1.9.3.zip", title: "Scopia", size: "69.5 MB", n: 500, lic: "CC-BY" },
];
export const LIB_DIR = "/local/sh3d/";

/** what the editor changes and Save writes back; a missing one is removed */
export const LAYOUT_KEYS: readonly LayoutKey[] = [
  "scene",
  "lights",
  "hotspots",
  "chips",
  "doors",
  "look",
  "ambient",
  "idle_view",
  "room_cards",
];
