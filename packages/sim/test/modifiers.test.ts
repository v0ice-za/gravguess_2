import { describe, expect, it } from "vitest";
import { simulate } from "../src/sim.ts";
import type { MapDef } from "../src/types.ts";

const base = (over: Partial<MapDef>): MapDef => ({
  id: "mod-test",
  spawn: { x: 200, y: 80 },
  ballRadius: 10,
  surfaces: [
    { id: "ground", a: { x: 0, y: 600 }, b: { x: 1280, y: 600 }, restitution: 0.1, friction: 2.0, kind: "basin" },
  ],
  bumpers: [],
  ...over,
});

describe("modifiers", () => {
  it("ice glides where a normal surface pins (the v1 tilt law, both sides)", () => {
    // Steep entry feeding a near-flat (0.05 rad) runout that ends at x=1100.
    const world = (kind: "ramp" | "ice", friction: number): MapDef =>
      base({
        spawn: { x: 150, y: 60 },
        surfaces: [
          { id: "entry", a: { x: 100, y: 100 }, b: { x: 400, y: 220 }, restitution: 0.2, friction: 0.3, kind: "ramp" },
          { id: "runout", a: { x: 400, y: 220 }, b: { x: 1100, y: 255 }, restitution: 0.2, friction, kind },
          { id: "ground", a: { x: 0, y: 600 }, b: { x: 1280, y: 600 }, restitution: 0.1, friction: 2.0, kind: "basin" },
        ],
      });
    // Normal friction on a sub-0.15-rad tilt pins the ball: it settles ON the runout.
    const normal = simulate(world("ramp", 2.0));
    expect(normal.landing.x).toBeLessThan(1100);
    expect(normal.landing.y).toBeLessThan(300);
    // Ice keeps it moving: off the end and down to the ground.
    const icy = simulate(world("ice", 0.02));
    expect(icy.landing.x).toBeGreaterThan(1100);
    expect(icy.landing.y).toBeCloseTo(590, 0);
  });

  it("a trampoline springs the ball back up", () => {
    const r = simulate(
      base({
        surfaces: [
          { id: "tramp", a: { x: 0, y: 400 }, b: { x: 1280, y: 400 }, restitution: 1.12, friction: 0.1, kind: "trampoline" },
        ],
      }),
    );
    // With restitution > 1 and no other losses the ball must NOT settle quickly;
    // it keeps bouncing until the 40s timeout.
    expect(r.ticks).toBeGreaterThan(1200);
  });

  it("a conveyor drives a resting ball along the surface", () => {
    const r = simulate(
      base({
        spawn: { x: 640, y: 80 },
        surfaces: [
          // Dead-flat belt pushing right (a->b is rightward, belt positive)
          { id: "belt", a: { x: 300, y: 300 }, b: { x: 980, y: 300 }, restitution: 0.1, friction: 2.0, kind: "conveyor", belt: 300 },
          { id: "ground", a: { x: 0, y: 600 }, b: { x: 1280, y: 600 }, restitution: 0.1, friction: 2.0, kind: "basin" },
        ],
      }),
    );
    // The ball lands on the belt center and must be carried off its right end.
    expect(r.landing.x).toBeGreaterThan(980);
    expect(r.landing.y).toBeCloseTo(590, 0);
  });

  it("a boost pad fires exactly once and is recorded as touched", () => {
    const r = simulate(
      base({
        spawn: { x: 640, y: 80 },
        surfaces: [
          { id: "ground", a: { x: 0, y: 600 }, b: { x: 1280, y: 600 }, restitution: 0.1, friction: 2.0, kind: "basin" },
        ],
        pads: [{ id: "pad-1", pos: { x: 640, y: 300 }, radius: 24, push: { x: 400, y: -200 } }],
      }),
    );
    const fires = r.events.filter((e) => e.type === "pad");
    expect(fires.length).toBe(1);
    expect(r.events.some((e) => e.type === "touch" && e.kind === "pad")).toBe(true);
    // Pushed right mid-fall, so it cannot land at the drop x.
    expect(r.landing.x).toBeGreaterThan(700);
  });
});
