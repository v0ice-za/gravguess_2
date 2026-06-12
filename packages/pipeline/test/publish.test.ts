import { describe, expect, it } from "vitest";
import { buildDaily, dailyFingerprint } from "../src/publish.ts";

describe("daily publisher", () => {
  it("is deterministic: same date, identical payload", () => {
    const a = buildDaily("2026-06-12");
    const b = buildDaily("2026-06-12");
    expect(a).not.toBeNull();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("payload is complete and self-consistent", () => {
    const p = buildDaily("2026-06-13");
    expect(p).not.toBeNull();
    expect(p!.map.surfaces.length).toBeGreaterThan(4);
    expect(p!.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(p!.parPx).toBeGreaterThan(0);
    expect(p!.landing.y).toBeGreaterThan(0);
    expect(p!.funScore).toBeGreaterThan(0);
  });

  it("variety check avoids repeating yesterday's fingerprint when possible", () => {
    const yesterday = buildDaily("2026-06-14")!;
    const today = buildDaily("2026-06-15", dailyFingerprint(yesterday))!;
    const yf = dailyFingerprint(yesterday);
    const tf = dailyFingerprint(today);
    const same = yf.archetype === tf.archetype && yf.landingThird === tf.landingThird;
    expect(same).toBe(false);
  });
});
