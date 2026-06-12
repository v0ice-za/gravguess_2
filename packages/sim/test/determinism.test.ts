import { describe, expect, it } from "vitest";
import { createRun, simulate, step, runDigest } from "../src/sim.ts";
import { firstLight } from "../src/maps/first-light.ts";
import { prngFromSeed } from "../src/prng.ts";

describe("determinism", () => {
  it("produces an identical digest on repeated runs", () => {
    const a = simulate(firstLight);
    const b = simulate(firstLight);
    const c = simulate(firstLight);
    expect(a.digest).toBe(b.digest);
    expect(b.digest).toBe(c.digest);
    expect(a.ticks).toBe(b.ticks);
    expect(a.landing).toEqual(b.landing);
  });

  it("incremental stepping matches one-shot simulate", () => {
    const oneShot = simulate(firstLight);
    const s = createRun(firstLight);
    while (!s.done) step(s);
    expect(runDigest(s)).toBe(oneShot.digest);
    expect(s.tick).toBe(oneShot.ticks);
  });

  it("perturbed spawns change the digest", () => {
    const base = simulate(firstLight);
    const shifted = simulate(firstLight, { x: firstLight.spawn.x + 2, y: firstLight.spawn.y });
    expect(shifted.digest).not.toBe(base.digest);
  });

  it("prng is reproducible per seed and differs across seeds", () => {
    const a1 = prngFromSeed("2026-06-12");
    const a2 = prngFromSeed("2026-06-12");
    const b = prngFromSeed("2026-06-13");
    const seqA1 = [a1(), a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2(), a2()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);
    for (const v of seqA1) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
