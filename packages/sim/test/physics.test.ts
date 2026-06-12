import { describe, expect, it } from "vitest";
import { simulate } from "../src/sim.ts";
import type { MapDef } from "../src/types.ts";

const flatWorld = (over: Partial<MapDef> = {}): MapDef => ({
  id: "test-world",
  spawn: { x: 640, y: 100 },
  ballRadius: 10,
  surfaces: [
    { id: "ground", a: { x: 0, y: 400 }, b: { x: 1280, y: 400 }, restitution: 0.2, friction: 1.5, kind: "basin" },
  ],
  bumpers: [],
  ...over,
});

describe("physics sanity", () => {
  it("a dropped ball settles on a flat floor near its drop x", () => {
    const r = simulate(flatWorld());
    expect(r.settled).toBe(true);
    expect(r.landing.x).toBeCloseTo(640, 0);
    expect(r.landing.y).toBeCloseTo(390, 0); // floor minus ball radius
  });

  it("a ball on a tilted ramp rolls downhill and off", () => {
    const r = simulate(
      flatWorld({
        spawn: { x: 200, y: 80 },
        surfaces: [
          // ~0.2 rad ramp down to the right, then a floor below its end
          { id: "ramp", a: { x: 100, y: 100 }, b: { x: 700, y: 220 }, restitution: 0.2, friction: 0.3, kind: "ramp" },
          { id: "ground", a: { x: 0, y: 500 }, b: { x: 1280, y: 500 }, restitution: 0.1, friction: 2.0, kind: "basin" },
        ],
      }),
    );
    expect(r.settled).toBe(true);
    // Must have rolled down the ramp, off its right end, and landed on the ground.
    expect(r.landing.x).toBeGreaterThan(700);
    expect(r.landing.y).toBeCloseTo(490, 0);
  });

  it("a bumper hit kicks the ball away to the ground", () => {
    const r = simulate(
      flatWorld({
        // Slightly off-center so the kick has a horizontal component.
        spawn: { x: 620, y: 100 },
        surfaces: [
          { id: "ground", a: { x: 0, y: 600 }, b: { x: 1280, y: 600 }, restitution: 0.1, friction: 2.0, kind: "basin" },
        ],
        bumpers: [{ id: "b", pos: { x: 640, y: 300 }, radius: 26, kick: 800, maxHits: 3 }],
      }),
    );
    const hit = r.events.find((e) => e.type === "bumper");
    expect(hit).toBeDefined();
    expect(hit && hit.type === "bumper" && hit.live).toBe(true);
    expect(r.settled).toBe(true);
    // Kicked left, off the bumper, settles on the ground.
    expect(r.landing.x).toBeLessThan(614);
    expect(r.landing.y).toBeCloseTo(590, 0);
  });

  it("a bumper goes inert after maxHits", () => {
    // Drop the ball into a V so it keeps returning to the bumper.
    const r = simulate(
      flatWorld({
        spawn: { x: 640, y: 80 },
        surfaces: [
          { id: "v-left", a: { x: 340, y: 200 }, b: { x: 640, y: 560 }, restitution: 0.3, friction: 0.5, kind: "ramp" },
          { id: "v-right", a: { x: 640, y: 560 }, b: { x: 940, y: 200 }, restitution: 0.3, friction: 0.5, kind: "ramp" },
        ],
        bumpers: [{ id: "b", pos: { x: 640, y: 520 }, radius: 24, kick: 700, maxHits: 3 }],
      }),
    );
    const hits = r.events.filter((e) => e.type === "bumper");
    const liveHits = hits.filter((e) => e.type === "bumper" && e.live);
    expect(liveHits.length).toBeLessThanOrEqual(3);
    expect(r.settled).toBe(true);
  });

  it("never times out on the hand-built map family (no infinite jitter)", () => {
    const r = simulate(flatWorld());
    expect(r.events[r.events.length - 1]?.type).toBe("settle");
  });
});
