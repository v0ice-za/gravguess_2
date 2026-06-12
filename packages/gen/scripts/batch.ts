// Batch sanity report: pass rates, attempt counts, gate-failure histogram, and
// fun-bar metrics over N seeds. THE tuning tool — gates change based on this
// output, never on intuition. Usage: pnpm --filter @gravguess/gen batch [N]

import { buildMap } from "../src/generate.ts";
import { validate } from "../src/validate.ts";
import { generateDaily } from "../src/pipeline.ts";

const N = Number(process.argv[2] ?? 40);

// --- Raw gate health: validate first attempts only (no retry), histogram failures ---
const failureCounts = new Map<string, number>();
const archCounts = new Map<string, { tried: number; passed: number }>();
let rawPass = 0;
for (let i = 0; i < N; i++) {
  const gen = buildMap(`batch-${i}`);
  const v = validate(gen.map, gen.rampIds, gen.archetype);
  const a = archCounts.get(gen.archetype) ?? { tried: 0, passed: 0 };
  a.tried++;
  if (v.pass) {
    rawPass++;
    a.passed++;
  }
  archCounts.set(gen.archetype, a);
  for (const f of v.failures) {
    const key = f.split(":")[0]!; // group by gate, not by value
    failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
  }
}

console.log(`=== Raw candidate health (${N} seeds, first attempt only) ===`);
console.log(`pass rate: ${rawPass}/${N} (${((rawPass / N) * 100).toFixed(0)}%)`);
console.log(`per archetype:`);
for (const [name, a] of archCounts) {
  console.log(`  ${name.padEnd(8)} ${a.passed}/${a.tried}`);
}
console.log(`gate failure histogram:`);
for (const [gate, count] of [...failureCounts.entries()].sort((x, y) => y[1] - x[1])) {
  console.log(`  ${String(count).padStart(3)}x  ${gate}`);
}

// --- Pipeline health: full generate-and-reject loop ---
console.log(`\n=== Pipeline (generate-and-reject, ${N} seeds) ===`);
let shipped = 0;
let totalAttempts = 0;
let worstAttempts = 0;
const funStats: { spread: number; clusters: number; ticks: number; lateDrama: boolean }[] = [];
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const d = generateDaily(`daily-${i}`);
  totalAttempts += d.attempts;
  if (d.attempts > worstAttempts) worstAttempts = d.attempts;
  if (d.validation.pass) shipped++;
  funStats.push({
    spread: d.validation.spread,
    clusters: d.validation.clusters,
    ticks: d.validation.metrics.ticks,
    lateDrama: d.validation.metrics.lateDrama,
  });
}
const elapsed = performance.now() - t0;

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`shipped passing: ${shipped}/${N}`);
console.log(`attempts: avg ${(totalAttempts / N).toFixed(1)}, worst ${worstAttempts}`);
console.log(`time: ${(elapsed / N).toFixed(0)}ms per daily`);
console.log(`fun bar: avg spread ${(avg(funStats.map((f) => f.spread)) * 100).toFixed(1)}%, ` +
  `avg clusters ${avg(funStats.map((f) => f.clusters)).toFixed(1)}, ` +
  `avg run ${(avg(funStats.map((f) => f.ticks)) / 120).toFixed(1)}s, ` +
  `late-drama ${funStats.filter((f) => f.lateDrama).length}/${N}`);
