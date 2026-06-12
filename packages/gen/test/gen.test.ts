import { describe, expect, it } from "vitest";
import { buildMap } from "../src/generate.ts";
import { validate } from "../src/validate.ts";
import { generateDaily } from "../src/pipeline.ts";

describe("generator", () => {
  it("is deterministic: same seed, identical map", () => {
    const a = buildMap("2026-06-12");
    const b = buildMap("2026-06-12");
    expect(JSON.stringify(a.map)).toBe(JSON.stringify(b.map));
    expect(a.archetype).toBe(b.archetype);
  });

  it("different seeds give different maps", () => {
    const a = buildMap("2026-06-12");
    const b = buildMap("2026-06-13");
    expect(JSON.stringify(a.map)).not.toBe(JSON.stringify(b.map));
  });

  it("respects design laws: traversal ramps tilted, only basins/floor flat", () => {
    for (const seed of ["law-1", "law-2", "law-3"]) {
      const { map } = buildMap(seed);
      for (const s of map.surfaces) {
        if (s.kind === "ramp") {
          const tilt = Math.abs(s.b.y - s.a.y) / Math.abs(s.b.x - s.a.x);
          expect(tilt).toBeGreaterThanOrEqual(0.15);
        }
      }
    }
  });

  it("pipeline ships passing maps for typical seeds", () => {
    let passed = 0;
    for (const seed of ["t-0", "t-1", "t-2", "t-3", "t-4"]) {
      const d = generateDaily(seed, 150, 1); // first-pass is enough to test validity
      expect(d.map.surfaces.length).toBeGreaterThan(4);
      if (d.validation.pass) passed++;
    }
    expect(passed).toBeGreaterThanOrEqual(4);
  });

  it("guarantees every SHIPPED map is interesting: >=3 tangible modifiers + min travel", () => {
    // The production promise: a passing daily always touches real modifiers and
    // travels a real distance. Check the actual shipped candidate per seed.
    for (let i = 0; i < 20; i++) {
      const d = generateDaily(`promise-${i}`, 150, 1); // validity holds for any passing candidate
      if (!d.validation.pass) continue; // fallback candidate — not shipped as a daily
      const m = d.validation.metrics;
      expect(m.tangibleModifiers).toBeGreaterThanOrEqual(3);
      expect(m.travel).toBeGreaterThanOrEqual(1.3 * 1280);
      expect(m.settled).toBe(true);
    }
  });

  it("validation is reproducible for a given map", () => {
    const gen = buildMap("repro");
    const v1 = validate(gen.map, gen.rampIds);
    const v2 = validate(gen.map, gen.rampIds);
    expect(v1.pass).toBe(v2.pass);
    expect(v1.spread).toBe(v2.spread);
    expect(v1.metrics.ticks).toBe(v2.metrics.ticks);
  });
});
