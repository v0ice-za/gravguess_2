// Render-side juice: particle bursts, settle confetti, ball trail, screen
// shake. Consumes sim events and never feeds anything back into the sim —
// determinism untouched. Tuned values ported from v1's FX layer.

import type { MapDef, SimEvent, SurfaceKind } from "@gravguess/sim";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface TrailDot {
  x: number;
  y: number;
  life: number;
}

export interface Fx {
  particles: Particle[];
  trail: TrailDot[];
  shakeFrames: number;
  reduced: boolean;
}

// v1 FX_COLORS, keyed by v2 mechanic names.
const FX_COLORS: Record<string, string[]> = {
  bumper: ["#00c8ff", "#9be8ff", "#ffffff"],
  pad: ["#ffd43b", "#ffa94d", "#fff3bf"],
  trampoline: ["#ff5fa2", "#ffc9de"],
  conveyor: ["#ff922b", "#ffd8a8"],
  capacitor: ["#ffaa00", "#ffd43b"],
  turbo: ["#ffd24a", "#fff3bf", "#ffffff"],
  teleporter: ["#ff50dc", "#ffa0eb", "#ffffff"],
};
const CONFETTI = ["#ffd43b", "#ff6b9d", "#69db7c", "#4dabf7", "#b197fc"];

const TRAIL_LIFE = 26;
const SHAKE_FRAMES = 7;

export function createFx(): Fx {
  return {
    particles: [],
    trail: [],
    shakeFrames: 0,
    reduced:
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

export function fxReset(fx: Fx): void {
  fx.particles.length = 0;
  fx.trail.length = 0;
  fx.shakeFrames = 0;
}

function burst(fx: Fx, x: number, y: number, colors: string[], count: number, speed: number): void {
  if (fx.reduced) return;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    fx.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - 1,
      life: 0,
      maxLife: 26 + Math.random() * 22,
      color: colors[i % colors.length]!,
      size: 2 + Math.random() * 3,
    });
  }
}

function surfaceKinds(map: MapDef): Map<string, SurfaceKind> {
  const kinds = new Map<string, SurfaceKind>();
  for (const s of map.surfaces) kinds.set(s.id, s.kind);
  return kinds;
}

const kindCache = new WeakMap<MapDef, Map<string, SurfaceKind>>();

export function fxOnEvent(fx: Fx, e: SimEvent, map: MapDef, x: number, y: number): void {
  let kinds = kindCache.get(map);
  if (!kinds) {
    kinds = surfaceKinds(map);
    kindCache.set(map, kinds);
  }
  switch (e.type) {
    case "bumper":
      if (e.live) {
        burst(fx, x, y, FX_COLORS.bumper!, 18, 4);
        if (!fx.reduced) fx.shakeFrames = SHAKE_FRAMES;
      }
      break;
    case "pad":
      burst(fx, x, y, FX_COLORS.pad!, 10, 2.5);
      break;
    case "collide": {
      if (kinds.get(e.surfaceId) === "trampoline") {
        burst(fx, x, y, FX_COLORS.trampoline!, 10, 2.5);
      }
      break;
    }
    case "touch":
      if (e.kind === "surface" && kinds.get(e.id) === "conveyor") {
        burst(fx, x, y, FX_COLORS.conveyor!, 8, 2);
      }
      break;
    case "settle":
      burst(fx, e.pos.x, e.pos.y, CONFETTI, 44, 5);
      break;
    default:
      break;
  }
}

export function fxTrailPush(fx: Fx, x: number, y: number): void {
  fx.trail.push({ x, y, life: 0 });
}

/** Advance the FX state by `frames` 60fps-equivalent frames (v1's tuning unit). */
export function fxStep(fx: Fx, frames: number): void {
  for (let i = fx.trail.length - 1; i >= 0; i--) {
    fx.trail[i]!.life += frames;
    if (fx.trail[i]!.life > TRAIL_LIFE) fx.trail.splice(i, 1);
  }
  const drag = Math.pow(0.985, frames);
  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const p = fx.particles[i]!;
    p.life += frames;
    if (p.life > p.maxLife) {
      fx.particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * frames;
    p.y += p.vy * frames;
    p.vy += 0.12 * frames;
    p.vx *= drag;
  }
  if (fx.shakeFrames > 0) fx.shakeFrames = Math.max(0, fx.shakeFrames - frames);
}

export function fxShakeOffset(fx: Fx): { x: number; y: number } {
  if (fx.shakeFrames <= 0) return { x: 0, y: 0 };
  const m = fx.shakeFrames * 0.6;
  return { x: (Math.random() - 0.5) * m, y: (Math.random() - 0.5) * m };
}

export function fxDraw(fx: Fx, ctx: CanvasRenderingContext2D): void {
  for (const t of fx.trail) {
    ctx.beginPath();
    ctx.arc(t.x, t.y, Math.max(1, 13 * (1 - t.life / 30)), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0, 255, 204, ${0.35 * (1 - t.life / TRAIL_LIFE)})`;
    ctx.fill();
  }
  for (const p of fx.particles) {
    ctx.globalAlpha = 1 - p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

export function fxActive(fx: Fx): boolean {
  return fx.particles.length > 0 || fx.trail.length > 0 || fx.shakeFrames > 0;
}
