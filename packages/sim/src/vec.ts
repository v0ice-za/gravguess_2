// Determinism contract: this module (and everything in the sim path) may only use
// + - * / and Math.sqrt — the IEEE 754 operations that are bit-identical across
// JS engines. No Math.sin/cos/pow/exp, no Math.random, no Date.

export interface Vec2 {
  x: number;
  y: number;
}

export function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function distSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}
