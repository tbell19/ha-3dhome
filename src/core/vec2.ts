/* 2D vector maths on floor plan points ([x, y] pairs). Small and allocation-light; Three.js covers everything in 3D.
 */
import type { Pt } from "../types";

export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Pt, by: number): Pt => [a[0] * by, a[1] * by];
export const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
/** the z of the 3D cross product: zero when a and b are parallel, its sign says which way b turns from a */
export const cross = (a: Pt, b: Pt) => a[0] * b[1] - a[1] * b[0];
export const length = (a: Pt) => Math.hypot(a[0], a[1]);
export const distance = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** a turned 90° anticlockwise */
export const perp = (a: Pt): Pt => [-a[1], a[0]];
/** the point `t` of the way from a to b */
export const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
