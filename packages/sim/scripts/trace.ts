// Dev tool: trace a run on a map, print trajectory samples + events.
// Usage: pnpm trace

import { createRun, step } from "../src/sim.ts";
import { runDigest } from "../src/sim.ts";
import { firstLight } from "../src/maps/first-light.ts";

const s = createRun(firstLight);
const samples: string[] = [];

while (!s.done) {
  const events = step(s);
  if (s.tick % 12 === 0) {
    samples.push(
      `t=${(s.tick / 120).toFixed(2)}s  pos=(${s.px.toFixed(0)}, ${s.py.toFixed(0)})  vel=(${s.vx.toFixed(0)}, ${s.vy.toFixed(0)})`,
    );
  }
  for (const e of events) {
    if (e.type === "collide") {
      samples.push(`  >> collide ${e.surfaceId} speed=${e.speed.toFixed(0)} normal=${e.normalSpeed.toFixed(0)} @t=${(e.tick / 120).toFixed(2)}`);
    } else if (e.type === "bumper") {
      samples.push(`  >> bumper ${e.bumperId} hit#${e.hit} live=${e.live} @t=${(e.tick / 120).toFixed(2)}`);
    } else if (e.type === "reversal") {
      samples.push(`  >> REVERSAL dir=${e.dir} @t=${(e.tick / 120).toFixed(2)}`);
    } else if (e.type === "air") {
      samples.push(`  >> air ${(e.ticks / 120).toFixed(2)}s @t=${(e.tick / 120).toFixed(2)}`);
    } else if (e.type === "settle" || e.type === "timeout") {
      samples.push(`  >> ${e.type} (${e.pos.x.toFixed(1)}, ${e.pos.y.toFixed(1)}) @t=${(e.tick / 120).toFixed(2)}`);
    }
  }
}

console.log(samples.join("\n"));
console.log(`\nticks=${s.tick} (${(s.tick / 120).toFixed(2)}s)  digest=${runDigest(s)}`);
