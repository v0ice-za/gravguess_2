// Canvas2D renderer. Pure draw functions over logical coordinates — the canvas
// backing store is the fixed logical resolution; CSS scales it (letterboxing).
// No gameplay state lives here.

import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type MapDef,
  type Surface,
  type Vec2,
} from "@gravguess/sim";

export interface TrailPoint {
  x: number;
  y: number;
}

export const SURFACE_COLORS: Record<Surface["kind"], string> = {
  ramp: "#22d3ee",
  wall: "#334155",
  basin: "#475569",
  lip: "#818cf8",
  ice: "#9be8ff",
  trampoline: "#ff5fa2",
  conveyor: "#e8590c",
};

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  map: MapDef,
  opts: {
    ball?: Vec2 | undefined;
    trail: TrailPoint[];
    guess?: Vec2 | undefined;
    landing?: Vec2 | undefined;
    bumperFlash: Map<string, number>;
  },
): void {
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // Backdrop grid
  ctx.save();
  ctx.strokeStyle = "rgba(51, 65, 85, 0.25)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= LOGICAL_WIDTH; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, LOGICAL_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= LOGICAL_HEIGHT; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(LOGICAL_WIDTH, y);
    ctx.stroke();
  }
  ctx.restore();

  // Surfaces: a soft glow pass then a crisp core line
  for (const s of map.surfaces) {
    const color = SURFACE_COLORS[s.kind];
    ctx.save();
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
    ctx.restore();

    // Conveyor: chevron ticks along the belt direction (a->b).
    if (s.kind === "conveyor") {
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen > 0) {
        const tx = dx / segLen;
        const ty = dy / segLen;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8;
        for (let d = 18; d < segLen - 8; d += 26) {
          const cx = s.a.x + tx * d;
          const cy = s.a.y + ty * d;
          ctx.beginPath();
          ctx.moveTo(cx - tx * 7 - ty * 5, cy - ty * 7 + tx * 5);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx - tx * 7 + ty * 5, cy - ty * 7 - tx * 5);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // Boost pads: glowing ring + arrow in the push direction.
  for (const p of map.pads ?? []) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#facc15";
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2);
    ctx.stroke();
    const mag = Math.hypot(p.push.x, p.push.y);
    if (mag > 0) {
      const ux = p.push.x / mag;
      const uy = p.push.y / mag;
      const tipX = p.pos.x + ux * (p.radius - 4);
      const tipY = p.pos.y + uy * (p.radius - 4);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(p.pos.x - ux * (p.radius - 6), p.pos.y - uy * (p.radius - 6));
      ctx.lineTo(tipX, tipY);
      ctx.moveTo(tipX - ux * 8 - uy * 6, tipY - uy * 8 + ux * 6);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tipX - ux * 8 + uy * 6, tipY - uy * 8 - ux * 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Bumpers
  for (const b of map.bumpers) {
    const flash = opts.bumperFlash.get(b.id) ?? 0;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#fb923c";
    ctx.globalAlpha = 0.25 + flash * 0.75;
    ctx.lineWidth = 6 + flash * 8;
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "#fb923c";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, b.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(251, 146, 60, 0.18)";
    ctx.fill();
    ctx.restore();
  }

  // Spawn marker
  ctx.save();
  ctx.strokeStyle = "#facc15";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(map.spawn.x, map.spawn.y, map.ballRadius + 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Trail
  if (opts.trail.length > 1) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let i = 1; i < opts.trail.length; i++) {
      const t = i / opts.trail.length;
      ctx.strokeStyle = "#22d3ee";
      ctx.globalAlpha = t * 0.55;
      ctx.lineWidth = 1 + t * 5;
      ctx.beginPath();
      ctx.moveTo(opts.trail[i - 1]!.x, opts.trail[i - 1]!.y);
      ctx.lineTo(opts.trail[i]!.x, opts.trail[i]!.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Guess marker
  if (opts.guess) {
    ctx.save();
    ctx.strokeStyle = "#f472b6";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(opts.guess.x, opts.guess.y, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(opts.guess.x - 22, opts.guess.y);
    ctx.lineTo(opts.guess.x + 22, opts.guess.y);
    ctx.moveTo(opts.guess.x, opts.guess.y - 22);
    ctx.lineTo(opts.guess.x, opts.guess.y + 22);
    ctx.stroke();
    ctx.restore();
  }

  // Result: landing point + line to guess
  if (opts.landing) {
    if (opts.guess) {
      ctx.save();
      ctx.strokeStyle = "rgba(250, 204, 21, 0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(opts.guess.x, opts.guess.y);
      ctx.lineTo(opts.landing.x, opts.landing.y);
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(opts.landing.x, opts.landing.y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Ball
  if (opts.ball) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(34, 211, 238, 0.35)";
    ctx.beginPath();
    ctx.arc(opts.ball.x, opts.ball.y, map.ballRadius * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#f8fafc";
    ctx.beginPath();
    ctx.arc(opts.ball.x, opts.ball.y, map.ballRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
