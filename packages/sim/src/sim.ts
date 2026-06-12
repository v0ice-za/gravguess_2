// The deterministic fixed-timestep simulation. One dynamic body (the ball) vs
// static segments and bumper circles. See vec.ts for the determinism contract.

import { dot, len, type Vec2 } from "./vec.ts";
import { createHash, digest, mixFloat, type HashState } from "./hash.ts";
import {
  DT,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type MapDef,
  type RunResult,
  type SimEvent,
} from "./types.ts";

export const GRAVITY = 2200; // px/s^2, +y is down
// Terminal velocity. Also the tunneling guard: per-tick displacement stays
// under the ball radius (1150/120 ≈ 9.6px < r=10), so the ball can never pass
// through a segment between ticks — no CCD needed.
const MAX_SPEED = 1150;
const MAX_TICKS = 120 * 40; // 40s hard cap
const SETTLE_SPEED = 12; // px/s — below this (while in contact) counts as resting
const SETTLE_TICKS = 72; // 0.6s of rest = settled
const BOUNCE_STOP = 45; // px/s — normal rebounds slower than this are killed (no micro-jitter)
const REVERSAL_MIN_VX = 30; // px/s — horizontal speed that counts as "moving that way"
const AIR_EVENT_MIN_TICKS = 36; // 0.3s airtime is worth an event
const BUMPER_COOLDOWN_TICKS = 8;
const INERT_BUMPER_RESTITUTION = 0.35;
const CONTACT_PASSES = 3; // collision resolution passes per tick (handles corners)
const BELT_ACCEL = 900; // px/s^2 a conveyor applies toward its belt speed
const ROLLING_K = 50; // constant rolling deceleration = friction * ROLLING_K (px/s^2)
// Coulomb-style impact friction: hard landings shed tangential speed in
// proportion to impact strength (mu = surface friction). This is what makes
// catch-ramp re-convergence possible — without it the ball converts all its
// speed back into height and sails over every catch. Gated to real impacts:
// applying it to rolling contact would pin balls on ramps (v1's classic trap).
const IMPACT_FRICTION_MIN = 100; // px/s of normal speed before impact friction kicks in
const IMPACT_FRICTION_MAX_MU = 0.5; // cap: high-friction floors still allow a landing slide
const FAN_VX_CAP = 520; // px/s — a fan never accelerates horizontal speed past this
const LIFT_BUDGET_TICKS = 240; // a lift field can only hold the ball up for 2s per drop
const TELEPORT_COOLDOWN_TICKS = 45; // re-entry lockout after a warp (per teleporter)

export interface RunState {
  map: MapDef;
  tick: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  restTicks: number;
  airTicks: number;
  dirX: 0 | 1 | -1;
  bumperHits: number[];
  bumperCooldown: number[];
  padUsed: boolean[];
  turboUsed: boolean[];
  teleCooldown: number[];
  liftBudget: number[];
  /** Element ids the ball has contacted at least once (any contact, not just impacts). */
  touched: Set<string>;
  hash: HashState;
  events: SimEvent[];
  done: boolean;
}

export function createRun(map: MapDef, spawnOverride?: Vec2): RunState {
  const spawn = spawnOverride ?? map.spawn;
  return {
    map,
    tick: 0,
    px: spawn.x,
    py: spawn.y,
    vx: 0,
    vy: 0,
    restTicks: 0,
    airTicks: 0,
    dirX: 0,
    bumperHits: map.bumpers.map(() => 0),
    bumperCooldown: map.bumpers.map(() => 0),
    padUsed: (map.pads ?? []).map(() => false),
    turboUsed: (map.turbos ?? []).map(() => false),
    teleCooldown: (map.teleporters ?? []).map(() => 0),
    liftBudget: (map.fields ?? []).map(() => LIFT_BUDGET_TICKS),
    touched: new Set(),
    hash: createHash(),
    events: [],
    done: false,
  };
}

/** Advance one fixed tick. Mutates state. Returns events emitted this tick. */
export function step(s: RunState): SimEvent[] {
  if (s.done) return [];
  const emitted: SimEvent[] = [];
  const emit = (e: SimEvent) => {
    s.events.push(e);
    emitted.push(e);
  };
  const r = s.map.ballRadius;

  // Integrate (semi-implicit Euler).
  s.vy += GRAVITY * DT;

  // Wind: a small constant horizontal acceleration. Gated so wind-free maps are
  // byte-identical (the golden digest must not move).
  if (s.map.wind !== undefined && s.map.wind !== 0) {
    s.vx += s.map.wind * DT;
  }

  // Force fields: continuous acceleration while the ball is inside a region.
  const fields = s.map.fields;
  if (fields) {
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i]!;
      const dx = s.px - f.pos.x;
      const dy = s.py - f.pos.y;
      const inX = dx < 0 ? -dx : dx;
      const inY = dy < 0 ? -dy : dy;
      if (inX > f.halfW || inY > f.halfH) continue;
      if (f.kind === "fan") {
        const dir = f.dir;
        const ux = dir ? dir.x : 1;
        const uy = dir ? dir.y : 0;
        // Don't drive horizontal speed past the cap in the push direction.
        const along = s.vx * ux + s.vy * uy;
        if (along < FAN_VX_CAP) {
          s.vx += ux * f.strength * DT;
          s.vy += uy * f.strength * DT;
        }
      } else if (f.kind === "lift") {
        if (s.liftBudget[i]! > 0) {
          s.vy -= f.strength * DT;
          s.liftBudget[i]!--;
        }
      } else {
        // magnet: pull toward the center, falling off linearly to zero at the
        // region corner (use the larger half-extent as the falloff radius).
        const reach = f.halfW > f.halfH ? f.halfW : f.halfH;
        const dist = len(dx, dy);
        if (dist > 0 && dist < reach) {
          const falloff = (reach - dist) / reach;
          const a = f.strength * falloff * DT;
          s.vx -= (dx / dist) * a;
          s.vy -= (dy / dist) * a;
        }
      }
    }
  }

  const speedNow = len(s.vx, s.vy);
  if (speedNow > MAX_SPEED) {
    const k = MAX_SPEED / speedNow;
    s.vx *= k;
    s.vy *= k;
  }
  s.px += s.vx * DT;
  s.py += s.vy * DT;

  let contact = false;

  for (let pass = 0; pass < CONTACT_PASSES; pass++) {
    // --- Surfaces (segments) ---
    for (const surf of s.map.surfaces) {
      const ax = surf.a.x;
      const ay = surf.a.y;
      const abx = surf.b.x - ax;
      const aby = surf.b.y - ay;
      const abLenSq = abx * abx + aby * aby;
      let t = abLenSq === 0 ? 0 : dot(s.px - ax, s.py - ay, abx, aby) / abLenSq;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      const cx = ax + abx * t;
      const cy = ay + aby * t;
      let nx = s.px - cx;
      let ny = s.py - cy;
      const d = len(nx, ny);
      if (d >= r || d === 0) continue;

      nx /= d;
      ny /= d;
      // Push out of penetration.
      const pen = r - d;
      s.px += nx * pen;
      s.py += ny * pen;

      if (!s.touched.has(surf.id)) {
        s.touched.add(surf.id);
        emit({ tick: s.tick, type: "touch", id: surf.id, kind: "surface" });
      }

      const vn = dot(s.vx, s.vy, nx, ny);
      if (vn < 0) {
        // Split velocity into normal + tangential parts.
        let rvn = -vn * surf.restitution;
        if (rvn < BOUNCE_STOP) rvn = 0; // rest on the surface instead of micro-bouncing
        let tvx = s.vx - vn * nx;
        let tvy = s.vy - vn * ny;
        // Tangential friction: proportional damping plus a constant rolling
        // resistance, so flat-surface slides stop instead of decaying forever.
        let damp = 1 - surf.friction * DT;
        if (damp < 0) damp = 0;
        tvx *= damp;
        tvy *= damp;
        const tlen = len(tvx, tvy);
        let dec = surf.friction * ROLLING_K * DT;
        if (-vn > IMPACT_FRICTION_MIN) {
          const mu = surf.friction < IMPACT_FRICTION_MAX_MU ? surf.friction : IMPACT_FRICTION_MAX_MU;
          dec += -vn * mu;
        }
        if (tlen <= dec) {
          tvx = 0;
          tvy = 0;
        } else {
          const keep = (tlen - dec) / tlen;
          tvx *= keep;
          tvy *= keep;
        }
        // Conveyor drive: accelerate the tangential velocity toward the belt
        // speed (signed along a->b). Never brakes the ball past it.
        if (surf.belt !== undefined && surf.belt !== 0) {
          const abLen = Math.sqrt(abLenSq);
          if (abLen > 0) {
            const tx = abx / abLen;
            const ty = aby / abLen;
            const along = tvx * tx + tvy * ty;
            const target = surf.belt;
            const delta = target - along;
            const maxStep = BELT_ACCEL * DT;
            const stepMag = delta < 0 ? -delta : delta;
            const sign = delta < 0 ? -1 : 1;
            // Only drive toward the belt speed, never overshoot it.
            const step = sign * (stepMag < maxStep ? stepMag : maxStep);
            if ((target > 0 && along < target) || (target < 0 && along > target)) {
              tvx += tx * step;
              tvy += ty * step;
            }
          }
        }
        s.vx = tvx + rvn * nx;
        s.vy = tvy + rvn * ny;
        if (pass === 0) {
          const speed = len(s.vx, s.vy);
          // Only log meaningful impacts, not every rolling-contact tick.
          if (-vn > BOUNCE_STOP) {
            emit({ tick: s.tick, type: "collide", surfaceId: surf.id, speed, normalSpeed: -vn });
          }
        }
      }
      contact = true;
    }

    // --- Bumpers (circles) ---
    for (let i = 0; i < s.map.bumpers.length; i++) {
      const b = s.map.bumpers[i]!;
      let nx = s.px - b.pos.x;
      let ny = s.py - b.pos.y;
      const minDist = r + b.radius;
      const d = len(nx, ny);
      if (d >= minDist || d === 0) continue;

      nx /= d;
      ny /= d;
      const pen = minDist - d;
      s.px += nx * pen;
      s.py += ny * pen;
      contact = true;

      if (!s.touched.has(b.id)) {
        s.touched.add(b.id);
        emit({ tick: s.tick, type: "touch", id: b.id, kind: "bumper" });
      }

      const vn = dot(s.vx, s.vy, nx, ny);
      if (vn >= 0) continue;

      const live = s.bumperHits[i]! < b.maxHits;
      if (live && s.bumperCooldown[i]! === 0) {
        // Reflect velocity (preserves flow direction), then enforce kick speed.
        s.vx -= 2 * vn * nx;
        s.vy -= 2 * vn * ny;
        const speed = len(s.vx, s.vy);
        if (speed > 0 && speed < b.kick) {
          const scale = b.kick / speed;
          s.vx *= scale;
          s.vy *= scale;
        }
        s.bumperHits[i]!++;
        s.bumperCooldown[i] = BUMPER_COOLDOWN_TICKS;
        emit({ tick: s.tick, type: "bumper", bumperId: b.id, hit: s.bumperHits[i]!, live: true });
      } else {
        // Inert (or cooling down): respond like a plain dull surface. The cooldown
        // gates only the kick — skipping the velocity response here would let
        // normal velocity build against the pushout and release as endless jitter.
        let rvn = -vn * INERT_BUMPER_RESTITUTION;
        if (rvn < BOUNCE_STOP) rvn = 0; // allow resting contact on an inert bumper
        s.vx += (rvn - vn) * nx;
        s.vy += (rvn - vn) * ny;
        if (-vn > BOUNCE_STOP) {
          emit({ tick: s.tick, type: "bumper", bumperId: b.id, hit: s.bumperHits[i]!, live: false });
        }
      }
    }
  }

  for (let i = 0; i < s.bumperCooldown.length; i++) {
    if (s.bumperCooldown[i]! > 0) s.bumperCooldown[i]!--;
  }

  // --- Boost pads: one-shot velocity push on entry ---
  const pads = s.map.pads;
  if (pads) {
    for (let i = 0; i < pads.length; i++) {
      if (s.padUsed[i]!) continue;
      const p = pads[i]!;
      const dx = s.px - p.pos.x;
      const dy = s.py - p.pos.y;
      const reach = p.radius + s.map.ballRadius;
      if (dx * dx + dy * dy > reach * reach) continue;
      s.padUsed[i] = true;
      s.vx += p.push.x;
      s.vy += p.push.y;
      s.touched.add(p.id);
      emit({ tick: s.tick, type: "touch", id: p.id, kind: "pad" });
      emit({ tick: s.tick, type: "pad", padId: p.id });
    }
  }

  // --- Turbo rings: one-shot speed multiplier on entry (direction preserved) ---
  const turbos = s.map.turbos;
  if (turbos) {
    for (let i = 0; i < turbos.length; i++) {
      if (s.turboUsed[i]!) continue;
      const tr = turbos[i]!;
      const dx = s.px - tr.pos.x;
      const dy = s.py - tr.pos.y;
      const reach = tr.radius + s.map.ballRadius;
      if (dx * dx + dy * dy > reach * reach) continue;
      s.turboUsed[i] = true;
      s.vx *= tr.mult;
      s.vy *= tr.mult;
      s.touched.add(tr.id);
      emit({ tick: s.tick, type: "touch", id: tr.id, kind: "pad" });
      emit({ tick: s.tick, type: "turbo", turboId: tr.id });
    }
  }

  // --- Teleporters: warp from entrance to exit, velocity preserved, cooldown ---
  const teleporters = s.map.teleporters;
  if (teleporters) {
    for (let i = 0; i < teleporters.length; i++) {
      if (s.teleCooldown[i]! > 0) continue;
      const tp = teleporters[i]!;
      const dx = s.px - tp.a.x;
      const dy = s.py - tp.a.y;
      const reach = tp.radius + s.map.ballRadius;
      if (dx * dx + dy * dy > reach * reach) continue;
      // Reappear at the exit, nudged along the travel direction so the ball
      // clears the exit disc before the cooldown lifts.
      const sp = len(s.vx, s.vy);
      const nudge = tp.radius + s.map.ballRadius + 2;
      if (sp > 0) {
        s.px = tp.b.x + (s.vx / sp) * nudge;
        s.py = tp.b.y + (s.vy / sp) * nudge;
      } else {
        s.px = tp.b.x;
        s.py = tp.b.y;
      }
      s.teleCooldown[i] = TELEPORT_COOLDOWN_TICKS;
      s.touched.add(tp.id);
      emit({ tick: s.tick, type: "touch", id: tp.id, kind: "pad" });
      emit({ tick: s.tick, type: "teleport", teleporterId: tp.id });
    }
  }
  for (let i = 0; i < s.teleCooldown.length; i++) {
    if (s.teleCooldown[i]! > 0) s.teleCooldown[i]!--;
  }

  // Safety clamp: the map should enclose the ball, but never let it escape the world.
  if (s.px < r) { s.px = r; if (s.vx < 0) s.vx = 0; }
  if (s.px > LOGICAL_WIDTH - r) { s.px = LOGICAL_WIDTH - r; if (s.vx > 0) s.vx = 0; }
  if (s.py > LOGICAL_HEIGHT - r) { s.py = LOGICAL_HEIGHT - r; if (s.vy > 0) s.vy = 0; contact = true; }

  // --- Event tracking ---
  if (contact) {
    if (s.airTicks >= AIR_EVENT_MIN_TICKS) {
      emit({ tick: s.tick, type: "air", ticks: s.airTicks });
    }
    s.airTicks = 0;
  } else {
    s.airTicks++;
  }

  if (s.vx > REVERSAL_MIN_VX && s.dirX !== 1) {
    if (s.dirX === -1) emit({ tick: s.tick, type: "reversal", dir: 1 });
    s.dirX = 1;
  } else if (s.vx < -REVERSAL_MIN_VX && s.dirX !== -1) {
    if (s.dirX === 1) emit({ tick: s.tick, type: "reversal", dir: -1 });
    s.dirX = -1;
  }

  // --- Settle detection ---
  const speed = len(s.vx, s.vy);
  if (contact && speed < SETTLE_SPEED) {
    s.restTicks++;
  } else {
    s.restTicks = 0;
  }

  // --- Hash the post-step state ---
  mixFloat(s.hash, s.px);
  mixFloat(s.hash, s.py);
  mixFloat(s.hash, s.vx);
  mixFloat(s.hash, s.vy);

  s.tick++;

  if (s.restTicks >= SETTLE_TICKS) {
    s.done = true;
    emit({ tick: s.tick, type: "settle", pos: { x: s.px, y: s.py } });
  } else if (s.tick >= MAX_TICKS) {
    s.done = true;
    emit({ tick: s.tick, type: "timeout", pos: { x: s.px, y: s.py } });
  }

  return emitted;
}

/** Run a full simulation to settle (or timeout) and return the result. */
export function simulate(map: MapDef, spawnOverride?: Vec2): RunResult {
  const s = createRun(map, spawnOverride);
  while (!s.done) step(s);
  return {
    settled: s.events[s.events.length - 1]?.type === "settle",
    landing: { x: s.px, y: s.py },
    ticks: s.tick,
    digest: digest(s.hash),
    events: s.events,
  };
}

export function runDigest(s: RunState): string {
  return digest(s.hash);
}
