import type { Vec2 } from "./vec.ts";

/** Fixed logical resolution. Gameplay must never derive from screen size. */
export const LOGICAL_WIDTH = 1280;
export const LOGICAL_HEIGHT = 640;

export const TICK_RATE = 120;
export const DT = 1 / TICK_RATE;

export type SurfaceKind =
  | "ramp"
  | "wall"
  | "basin"
  | "lip"
  | "ice" // near-frictionless ramp — the ball slides without slowing
  | "trampoline" // restitution > 1 — springs the ball away
  | "conveyor"; // belt: drives the ball along the surface (see `belt`)

export interface Surface {
  id: string;
  /** Segment endpoints. The ball collides with the segment from any side. */
  a: Vec2;
  b: Vec2;
  /** 0 = dead stop, 1 = perfect bounce. */
  restitution: number;
  /** Tangential damping rate while in contact (per second). */
  friction: number;
  kind: SurfaceKind;
  /**
   * Conveyor belt speed in px/s, signed along the a->b direction. While in
   * contact the ball is accelerated toward this speed (never braked past it).
   */
  belt?: number;
}

export interface BoostPad {
  id: string;
  pos: Vec2;
  radius: number;
  /** One-shot velocity push (px/s), applied once when the ball enters. */
  push: Vec2;
}

export interface Bumper {
  id: string;
  pos: Vec2;
  radius: number;
  /** Minimum exit speed after a live hit (px/s). Reflects velocity — preserves flow direction. */
  kick: number;
  /** Hits after which the bumper goes inert (plain low-bounce circle). */
  maxHits: number;
}

export interface TurboRing {
  id: string;
  pos: Vec2;
  radius: number;
  /** One-shot speed multiplier on entry (preserves direction). e.g. 1.6 */
  mult: number;
}

export interface Teleporter {
  id: string;
  /** Entrance disc. */
  a: Vec2;
  /** Exit point — the ball reappears here with velocity preserved. */
  b: Vec2;
  radius: number;
}

export type ForceFieldKind = "fan" | "lift" | "magnet";

export interface ForceField {
  id: string;
  kind: ForceFieldKind;
  /** Region center. For "magnet" this is also the pull target. */
  pos: Vec2;
  /** Half-extents of the rectangular region of influence. */
  halfW: number;
  halfH: number;
  /** Acceleration magnitude (px/s^2). */
  strength: number;
  /** Unit direction for "fan" (sideways push). Ignored for lift/magnet. */
  dir?: Vec2;
}

export interface MapDef {
  id: string;
  /** Ball spawn point (drop origin). Part of the map — same for every player. */
  spawn: Vec2;
  ballRadius: number;
  surfaces: Surface[];
  bumpers: Bumper[];
  pads?: BoostPad[];
  turbos?: TurboRing[];
  teleporters?: Teleporter[];
  fields?: ForceField[];
  /** Global horizontal wind acceleration (px/s^2), +x is rightward. Small (<=5% g). */
  wind?: number;
}

export type SimEvent =
  | { tick: number; type: "touch"; id: string; kind: "surface" | "bumper" | "pad" }
  | { tick: number; type: "pad"; padId: string }
  | { tick: number; type: "turbo"; turboId: string }
  | { tick: number; type: "teleport"; teleporterId: string }
  | { tick: number; type: "collide"; surfaceId: string; speed: number; normalSpeed: number }
  | { tick: number; type: "bumper"; bumperId: string; hit: number; live: boolean }
  | { tick: number; type: "reversal"; dir: 1 | -1 }
  | { tick: number; type: "air"; ticks: number }
  | { tick: number; type: "settle"; pos: Vec2 }
  | { tick: number; type: "timeout"; pos: Vec2 };

export interface RunResult {
  settled: boolean;
  landing: Vec2;
  ticks: number;
  digest: string;
  events: SimEvent[];
}
