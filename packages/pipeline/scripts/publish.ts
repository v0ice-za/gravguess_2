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

// Variety check needs yesterday's fingerprint — load it if already published.
const dayBefore = new Date(start.getTime() - 86400000);
let previous: ReturnType<typeof dailyFingerprint> | undefined;
const prevPath = join(outDir, `${fmt(dayBefore)}.json`);
if (existsSync(prevPath)) {
  previous = dailyFingerprint(JSON.parse(readFileSync(prevPath, "utf8")) as DailyPayload);
}

let published = 0;
for (let i = 0; i < days; i++) {
  const date = fmt(new Date(start.getTime() + i * 86400000));
  const payload = buildDaily(date, previous);
  if (!payload) {
    console.error(`!! ${date}: no passing candidates — NOT published`);
    previous = undefined;
    continue;
  }
  writeFileSync(join(outDir, `${date}.json`), JSON.stringify(payload));
  previous = dailyFingerprint(payload);
  published++;
  console.log(
    `${date}  ${payload.archetype.padEnd(7)} seed=${payload.seed.padEnd(16)} ` +
      `fun=${payload.funScore.toFixed(1)} par=${payload.parPx.toFixed(0)}px ` +
      `run=${(payload.ticks / 120).toFixed(1)}s land=(${payload.landing.x.toFixed(0)},${payload.landing.y.toFixed(0)})`,
  );
}
console.log(`\npublished ${published}/${days} dailies -> ${outDir}`);
