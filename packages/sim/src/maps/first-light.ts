// Hand-built slice-1 map: "First Light".
// Intended journey: drop onto ramp A, roll right and launch off its edge, fly the
// gap onto ramp B, roll right into the bumper, get kicked back left, land on the
// long return ramp C, roll left and settle in the floor basin.
// Design laws honored: every traversal surface tilted >= 0.15 rad, only the basin
// floor is flat; the bumper sits where ramp C re-converges its chaos.

import type { MapDef } from "../types.ts";

export const firstLight: MapDef = {
  id: "first-light-v1",
  spawn: { x: 140, y: 40 },
  ballRadius: 10,
  surfaces: [
    // Outer bounds (safety, mostly out of play)
    { id: "wall-left", a: { x: 12, y: 0 }, b: { x: 12, y: 640 }, restitution: 0.4, friction: 0.1, kind: "wall" },
    { id: "wall-right", a: { x: 1268, y: 0 }, b: { x: 1268, y: 640 }, restitution: 0.4, friction: 0.1, kind: "wall" },
    { id: "floor", a: { x: 0, y: 632 }, b: { x: 1280, y: 632 }, restitution: 0.15, friction: 2.0, kind: "basin" },

    // Ramp A: opening sweep, down to the right (~0.32 rad)
    { id: "ramp-a", a: { x: 60, y: 120 }, b: { x: 540, y: 280 }, restitution: 0.25, friction: 0.3, kind: "ramp" },

    // Ramp B: catches the flight off ramp A, continues right (~0.28 rad)
    { id: "ramp-b", a: { x: 620, y: 330 }, b: { x: 1120, y: 470 }, restitution: 0.25, friction: 0.3, kind: "ramp" },

    // Ramp C: long return leg, down to the left (~0.17 rad). Its right end sits just
    // under the bumper so the kicked ball lands on it and re-converges immediately.
    { id: "ramp-c", a: { x: 480, y: 610 }, b: { x: 1140, y: 500 }, restitution: 0.25, friction: 0.3, kind: "ramp" },

    // Basin: a floor section between two lips. The ball rolls in off ramp C's end
    // (clearing the low right curb) and the tall left lip + floor friction stop it.
    { id: "basin-lip-left", a: { x: 260, y: 632 }, b: { x: 260, y: 560 }, restitution: 0.3, friction: 0.2, kind: "lip" },
    { id: "basin-lip-right", a: { x: 478, y: 632 }, b: { x: 478, y: 618 }, restitution: 0.3, friction: 0.2, kind: "lip" },
  ],
  bumpers: [
    // End of ramp B, at ball height so the kick reflects horizontally onto ramp C below
    { id: "bumper-1", pos: { x: 1180, y: 460 }, radius: 26, kick: 900, maxHits: 3 },
  ],
};
