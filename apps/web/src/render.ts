// Canvas2D renderer. Pure draw functions over logical coordinates — the canvas
// backing store is the fixed logical resolution; CSS scales it (letterboxing).
// No gameplay state lives here. Idle animations are time-based (pass timeMs=0
// to freeze them, e.g. for prefers-reduced-motion).

import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  type MapDef,
  type Surface,
  type Vec2,
} from "@gravguess/sim";

export const SURFACE_COLORS: Record<Surface["kind"], string> = {
  ramp: "#22d3ee",
  wall: "#334155",
  basin: "#475569",
  lip: "#818cf8",
  ice: "#9be8ff",
  trampoline: "#ff5fa2",
  conveyor: "#e8590c",
};

export interface Camera {
  /** Logical-space point the camera looks at. */
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_CAMERA: Camera = {
  x: LOGICAL_WIDTH / 2,
  y: LOGICAL_HEIGHT / 2,
  zoom: 1,
};

export interface FrameOpts {
  ball?: Vec2 | undefined;
  guess?: Vec2 | undefined;
  landing?: Vec2 | undefined;
  bumperFlash: Map<string, number>;
  /** Wall-clock ms driving idle animations. Pass 0 to freeze them. */
  timeMs?: number;
  camera?: Camera | undefined;
  /** Drawn between the map and the markers, inside the camera transform. */
  drawFx?: ((ctx: CanvasRenderingContext2D) => void) | undefined;
}

/** A small open arrowhead at (x,y) pointing along the unit vector (ux,uy). */
function glyphArrow(ctx: CanvasRenderingContext2D, x: number, y: number, ux: number, uy: number): void {
  const tipX = x + ux * 5;
  const tipY = y + uy * 5;
  ctx.beginPath();
  ctx.moveTo(tipX - ux * 9 - uy * 5, tipY - uy * 9 + ux * 5);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(tipX - ux * 9 + uy * 5, tipY - uy * 9 - ux * 5);
  ctx.stroke();
}

export function drawFrame(ctx: CanvasRenderingContext2D, map: MapDef, opts: FrameOpts): void {
  const t = opts.timeMs ?? 0;
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  ctx.save();
  const cam = opts.camera ?? DEFAULT_CAMERA;
  ctx.translate(LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.x, -cam.y);

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
    // Ice shimmer / trampoline pulse: subtle idle glow variation.
    let glowAlpha = 0.18;
    if (s.kind === "ice") glowAlpha = 0.18 + 0.08 * Math.sin(t / 600 + s.a.x * 0.01);
    if (s.kind === "trampoline") glowAlpha = 0.18 + 0.1 * Math.sin(t / 350 + s.a.x * 0.01);
    ctx.save();
    ctx.lineCap = "round";
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = color;
    ctx.globalAlpha = glowAlpha;
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

    // Conveyor: chevron ticks crawling in the belt direction.
    if (s.kind === "conveyor") {
      const dx = s.b.x - s.a.x;
      const dy = s.b.y - s.a.y;
      const segLen = Math.hypot(dx, dy);
      if (segLen > 0) {
        const tx = dx / segLen;
        const ty = dy / segLen;
        const beltSign = (s.belt ?? 0) >= 0 ? 1 : -1;
        const crawl = ((t / 1000) * 40 * beltSign) % 26;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.8;
        for (let d = 18 + ((crawl % 26) + 26) % 26 - 13; d < segLen - 8; d += 26) {
          if (d < 8) continue;
          const cx = s.a.x + tx * d;
          const cy = s.a.y + ty * d;
          const flip = beltSign;
          ctx.beginPath();
          ctx.moveTo(cx - tx * 7 * flip - ty * 5, cy - ty * 7 * flip + tx * 5);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx - tx * 7 * flip + ty * 5, cy - ty * 7 * flip - tx * 5);
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }

  // Boost pads: glowing ring + arrow in the push direction, idle shimmer.
  for (const p of map.pads ?? []) {
    const shimmer = 0.3 + 0.12 * Math.sin(t / 400 + p.pos.x * 0.02);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#facc15";
    ctx.globalAlpha = shimmer;
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

  // Bumpers: idle pulse + hit flash.
  for (let i = 0; i < map.bumpers.length; i++) {
    const b = map.bumpers[i]!;
    const flash = opts.bumperFlash.get(b.id) ?? 0;
    const pulse = 1 + 0.04 * Math.sin(t / 300 + i * 1.7);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#fb923c";
    ctx.globalAlpha = 0.25 + flash * 0.75;
    ctx.lineWidth = 6 + flash * 8;
    ctx.beginPath();
    ctx.arc(b.pos.x, b.pos.y, b.radius * pulse, 0, Math.PI * 2);
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

  // Force fields: tinted region + directional hint.
  for (const f of map.fields ?? []) {
    const color = f.kind === "fan" ? "#38bdf8" : f.kind === "lift" ? "#a3e635" : "#c084fc";
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.08 + 0.03 * Math.sin(t / 500 + f.pos.x * 0.01);
    ctx.fillRect(f.pos.x - f.halfW, f.pos.y - f.halfH, f.halfW * 2, f.halfH * 2);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.strokeRect(f.pos.x - f.halfW, f.pos.y - f.halfH, f.halfW * 2, f.halfH * 2);
    ctx.setLineDash([]);
    // Animated flow glyphs: arrows drifting in the force direction.
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    const phase = (t / 1000) % 1;
    if (f.kind === "fan") {
      const ux = f.dir ? f.dir.x : 1;
      const uy = f.dir ? f.dir.y : 0;
      for (let k = 0; k < 3; k++) {
        const p = (phase + k / 3) % 1 - 0.5;
        glyphArrow(ctx, f.pos.x + ux * p * f.halfW * 2, f.pos.y + uy * p * f.halfH * 2, ux, uy);
      }
    } else if (f.kind === "lift") {
      for (let k = 0; k < 3; k++) {
        const p = (phase + k / 3) % 1 - 0.5;
        glyphArrow(ctx, f.pos.x, f.pos.y - p * f.halfH * 2, 0, -1);
      }
    } else {
      // magnet: inward chevrons toward the center.
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        glyphArrow(ctx, f.pos.x + dx * f.halfW * 0.6, f.pos.y + dy * f.halfH * 0.6, -dx, -dy);
      }
    }
    ctx.restore();
  }

  // Turbo rings: concentric glowing arcs.
  for (const tr of map.turbos ?? []) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "#fde047";
    for (let ring = 0; ring < 3; ring++) {
      ctx.globalAlpha = 0.5 - ring * 0.13 + 0.1 * Math.sin(t / 200 + ring);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(tr.pos.x, tr.pos.y, tr.radius - ring * 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Teleporters: paired portals with a connecting dashed thread.
  for (const tp of map.teleporters ?? []) {
    ctx.save();
    ctx.strokeStyle = "rgba(217, 70, 239, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 9]);
    ctx.beginPath();
    ctx.moveTo(tp.a.x, tp.a.y);
    ctx.lineTo(tp.b.x, tp.b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    for (const [pt, entrance] of [[tp.a, true], [tp.b, false]] as const) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = entrance ? "#d946ef" : "#f0abfc";
      ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t / 250 + (entrance ? 0 : Math.PI));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, tp.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
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

  // FX layer (trail, particles, confetti) — under the markers, over the map.
  if (opts.drawFx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    opts.drawFx(ctx);
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

  ctx.restore();

  // Wind HUD — screen space, top-right corner. A single glyph + strength bar so
  // a loss reads as "I saw it pushing, I misjudged how much" (v1's fairness law).
  if (map.wind !== undefined && map.wind !== 0) {
    const dir = map.wind > 0 ? 1 : -1;
    const mag = Math.min(1, Math.abs(map.wind) / 110);
    const cx = LOGICAL_WIDTH - 120;
    const cy = 34;
    ctx.save();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("WIND", cx - 56, cy);
    ctx.strokeStyle = "#67e8f9";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dir * 40, cy);
    ctx.lineTo(cx + dir * 40 - dir * 9, cy - 6);
    ctx.moveTo(cx + dir * 40, cy);
    ctx.lineTo(cx + dir * 40 - dir * 9, cy + 6);
    ctx.stroke();
    ctx.fillStyle = "rgba(103, 232, 249, 0.25)";
    ctx.fillRect(cx + 50, cy - 5, 44, 10);
    ctx.fillStyle = "#67e8f9";
    ctx.fillRect(cx + 50, cy - 5, 44 * mag, 10);
    ctx.restore();
  }
}
