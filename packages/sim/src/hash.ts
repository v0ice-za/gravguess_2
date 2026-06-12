// Tick-state hashing for golden-replay tests. Integer-only mixing over the raw
// IEEE 754 bit patterns of the ball state, so any cross-platform divergence —
// even in the last mantissa bit — changes the digest.

const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

export interface HashState {
  a: number;
  b: number;
}

export function createHash(): HashState {
  return { a: 0x9e3779b9, b: 0x85ebca6b };
}

function mixWord(h: number, w: number): number {
  h = (h ^ w) >>> 0;
  h = Math.imul(h, 0x9e3779b1) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return h;
}

export function mixFloat(h: HashState, value: number): void {
  f64[0] = value;
  const lo = u32[0]!;
  const hi = u32[1]!;
  h.a = mixWord(h.a, lo);
  h.a = mixWord(h.a, hi);
  h.b = mixWord(h.b, hi ^ 0xdeadbeef);
  h.b = mixWord(h.b, lo ^ 0x41c64e6d);
}

export function digest(h: HashState): string {
  const pad = (n: number) => n.toString(16).padStart(8, "0");
  return pad(h.a) + pad(h.b);
}
