// Golden-replay record for the hand-built map. If this test fails, either the
// sim's physics changed (update the golden values deliberately, in their own
// commit) or determinism broke (stop everything and find out why).

import { describe, expect, it } from "vitest";
import { simulate } from "../src/sim.ts";
import { firstLight } from "../src/maps/first-light.ts";

// Updated 2026-06-12: Coulomb impact friction added to the sim (catch-ramp
// re-convergence physics) — trajectory legitimately changed.
// Updated 2026-06-14: stiction added (a slow-rolling ball now grinds to a stop,
// even on ice) — the ball settles ~30 ticks sooner; same landing.
export const GOLDEN = {
  mapId: "first-light-v1",
  digest: "d71af03787446eef",
  ticks: 575,
  landingX: 270.0,
  landingY: 622.0,
};

describe("golden replay: first-light", () => {
  const result = simulate(firstLight);

  it("settles (does not time out)", () => {
    expect(result.settled).toBe(true);
  });

  it("matches the golden digest exactly", () => {
    expect(result.digest).toBe(GOLDEN.digest);
    expect(result.ticks).toBe(GOLDEN.ticks);
  });

  it("lands in the basin where the golden run landed", () => {
    expect(result.landing.x).toBeCloseTo(GOLDEN.landingX, 1);
    expect(result.landing.y).toBeCloseTo(GOLDEN.landingY, 1);
  });

  it("tells the intended story: bumper kick, reversal, basin settle", () => {
    const types = result.events.map((e) => e.type);
    expect(types).toContain("bumper");
    expect(types.filter((t) => t === "reversal").length).toBeGreaterThanOrEqual(1);
    const surfaces = new Set(
      result.events.flatMap((e) => (e.type === "collide" ? [e.surfaceId] : [])),
    );
    expect(surfaces).toContain("ramp-a");
    expect(surfaces).toContain("ramp-b");
    expect(surfaces).toContain("ramp-c");
    // Settles inside the basin (between the lips).
    expect(result.landing.x).toBeGreaterThan(260);
    expect(result.landing.x).toBeLessThan(478);
  });
});
