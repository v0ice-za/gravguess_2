// sfc32 PRNG — integer-only operations, fully deterministic across JS engines.

export type Prng = () => number;

/** FNV-1a style string hash to derive four 32-bit seed words from a string seed. */
export function seedFromString(seed: string): [number, number, number, number] {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x01000193);
    h3 = Math.imul(h3 ^ c, 0x01000193);
    h4 = Math.imul(h4 ^ c, 0x01000193);
  }
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32: returns a function producing floats in [0, 1). */
export function sfc32(a: number, b: number, c: number, d: number): Prng {
  return () => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function prngFromSeed(seed: string): Prng {
  const [a, b, c, d] = seedFromString(seed);
  const rng = sfc32(a, b, c, d);
  // Warm up: discard the first few outputs, which correlate with the raw seed.
  for (let i = 0; i < 12; i++) rng();
  return rng;
}
