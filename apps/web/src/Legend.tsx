// Always-visible legend strip (spec: every modifier explained at all times).
// Shows only the elements present on the current map.

import type { MapDef } from "@gravguess/sim";
import { SURFACE_COLORS } from "./render.ts";

interface LegendItem {
  key: string;
  color: string;
  shape: "line" | "circle" | "square";
  label: string;
  description: string;
}

const DEFS: Record<string, Omit<LegendItem, "key">> = {
  ramp: { color: SURFACE_COLORS.ramp, shape: "line", label: "Ramp", description: "The ball rolls along it" },
  ice: { color: SURFACE_COLORS.ice, shape: "line", label: "Ice", description: "Frictionless — the ball slides without slowing" },
  trampoline: { color: SURFACE_COLORS.trampoline, shape: "line", label: "Trampoline", description: "Springy — bounces the ball away harder" },
  conveyor: { color: SURFACE_COLORS.conveyor, shape: "line", label: "Conveyor", description: "Belt — drags the ball along the chevrons" },
  lip: { color: SURFACE_COLORS.lip, shape: "line", label: "Basin wall", description: "Catches and contains the ball" },
  bumper: { color: "#fb923c", shape: "circle", label: "Bumper", description: "Pinball pop — kicks the ball away hard (3 kicks max)" },
  pad: { color: "#facc15", shape: "circle", label: "Boost pad", description: "One-shot push in the arrow's direction" },
  turbo: { color: "#fde047", shape: "circle", label: "Turbo ring", description: "Multiplies the ball's speed once, keeping its direction" },
  teleporter: { color: "#d946ef", shape: "circle", label: "Teleporter", description: "Warps the ball to its paired portal, speed preserved" },
  fan: { color: "#38bdf8", shape: "square", label: "Fan", description: "Pushes the ball sideways while it's inside the zone" },
  lift: { color: "#a3e635", shape: "square", label: "Lift", description: "Pushes the ball upward — but only for a moment" },
  magnet: { color: "#c084fc", shape: "square", label: "Magnet", description: "Pulls the ball toward its center, stronger up close" },
  wind: { color: "#67e8f9", shape: "line", label: "Wind", description: "A steady sideways drift on the whole map (see the gauge)" },
};

export function legendKeysFor(map: MapDef): string[] {
  const keys = new Set<string>();
  for (const s of map.surfaces) {
    if (s.kind in DEFS) keys.add(s.kind);
  }
  if (map.bumpers.length > 0) keys.add("bumper");
  if ((map.pads ?? []).length > 0) keys.add("pad");
  if ((map.turbos ?? []).length > 0) keys.add("turbo");
  if ((map.teleporters ?? []).length > 0) keys.add("teleporter");
  for (const f of map.fields ?? []) keys.add(f.kind);
  if (map.wind !== undefined && map.wind !== 0) keys.add("wind");
  return [...keys];
}

export function Legend({ map }: { map: MapDef }) {
  const items = legendKeysFor(map).map((key) => ({ key, ...DEFS[key]! }));
  if (items.length === 0) return null;
  return (
    <div className="legend">
      {items.map((item) => (
        <div key={item.key} className="legend-item" title={item.description}>
          {item.shape === "line" ? (
            <span className="legend-swatch-line" style={{ background: item.color }} />
          ) : item.shape === "square" ? (
            <span className="legend-swatch-square" style={{ borderColor: item.color }} />
          ) : (
            <span className="legend-swatch-circle" style={{ borderColor: item.color }} />
          )}
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
