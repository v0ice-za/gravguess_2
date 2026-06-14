// Publish daily payloads as static JSON for the web client.
// Usage: pnpm --filter @gravguess/pipeline publish-dailies [startDate] [days]
// Defaults: today (UTC), 14 days. Output: apps/web/public/dailies/<date>.json

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDaily, dailyFingerprint, type DailyPayload } from "../src/publish.ts";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", "..", "apps", "web", "public", "dailies");
mkdirSync(outDir, { recursive: true });

const startArg = process.argv[2];
const days = Number(process.argv[3] ?? 14);
const start = startArg ? new Date(`${startArg}T00:00:00Z`) : new Date();

const fmt = (d: Date) => d.toISOString().slice(0, 10);

// Archetype rotation looks back a few days — seed `recent` (most recent first)
// from already-published files so a fresh run continues the rotation cleanly.
const RECENT_WINDOW = 3;
let recent: ReturnType<typeof dailyFingerprint>[] = [];
for (let k = 1; k <= RECENT_WINDOW; k++) {
  const d = new Date(start.getTime() - k * 86400000);
  const p = join(outDir, `${fmt(d)}.json`);
  if (existsSync(p)) recent.push(dailyFingerprint(JSON.parse(readFileSync(p, "utf8")) as DailyPayload));
}

let published = 0;
for (let i = 0; i < days; i++) {
  const date = fmt(new Date(start.getTime() + i * 86400000));
  const payload = buildDaily(date, recent);
  if (!payload) {
    console.error(`!! ${date}: no passing candidates — NOT published`);
    recent = [];
    continue;
  }
  writeFileSync(join(outDir, `${date}.json`), JSON.stringify(payload));
  recent = [dailyFingerprint(payload), ...recent].slice(0, RECENT_WINDOW);
  published++;
  console.log(
    `${date}  ${payload.archetype.padEnd(7)} seed=${payload.seed.padEnd(16)} ` +
      `fun=${payload.funScore.toFixed(1)} par=${payload.parPx.toFixed(0)}px ` +
      `run=${(payload.ticks / 120).toFixed(1)}s land=(${payload.landing.x.toFixed(0)},${payload.landing.y.toFixed(0)})`,
  );
}
console.log(`\npublished ${published}/${days} dailies -> ${outDir}`);
