// Internal Map Maker: generate a candidate from a seed, run the real validator
// + fun score against it, and save the ones worth keeping. The v2 advance over
// v1's maker: every verdict is the SAME bot that gates the daily pipeline, so a
// map that passes here is a map that could ship as a daily — the seed is the
// export artifact.

import { useCallback, useEffect, useState } from "react";
import { buildMap, funScore, validate, type Validation } from "@gravguess/gen";
import { TICK_RATE } from "@gravguess/sim";
import { legendKeysFor } from "./Legend.tsx";
import type { LoadedMap } from "./Game.tsx";
import {
  deleteMap,
  loadSavedMaps,
  randomSeed,
  saveMap,
  type SavedMap,
} from "./mapmaker.ts";

interface Tested {
  seed: string;
  archetype: string;
  validation: Validation;
  funScore: number;
  loaded: LoadedMap;
  modifiers: string[];
}

function testSeed(seed: string): Tested {
  const gen = buildMap(seed);
  const validation = validate(gen.map, gen.rampIds, gen.archetype);
  return {
    seed,
    archetype: gen.archetype,
    validation,
    funScore: validation.pass ? funScore(validation) : 0,
    loaded: { map: gen.map, label: `map maker · ${seed} · ${gen.archetype}`, daily: null },
    modifiers: legendKeysFor(gen.map),
  };
}

export function MapMaker({
  onPlay,
  onBack,
}: {
  onPlay: (loaded: LoadedMap) => void;
  onBack: () => void;
}) {
  const [seed, setSeed] = useState(() => randomSeed());
  const [tested, setTested] = useState<Tested | null>(null);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState<SavedMap[]>(() => loadSavedMaps());
  const [saveError, setSaveError] = useState(false);

  // Live validation: re-run the bot automatically whenever the seed changes
  // (debounced for typing). The admin always sees current stats — no Test click.
  useEffect(() => {
    if (seed.trim() === "") {
      setTested(null);
      return;
    }
    setTesting(true);
    const id = setTimeout(() => {
      setTested(testSeed(seed));
      setTesting(false);
    }, 120);
    return () => clearTimeout(id);
  }, [seed]);

  const newLevel = useCallback(() => {
    setSeed(randomSeed());
    setSaveError(false);
  }, []);

  const save = useCallback(() => {
    if (!tested) return;
    const next = saveMap({
      seed: tested.seed,
      archetype: tested.archetype,
      funScore: tested.funScore,
      pass: tested.validation.pass,
    });
    if (next === null) setSaveError(true);
    else setSaved(next);
  }, [tested]);

  const m = tested?.validation.metrics;

  return (
    <div className="maker">
      <header>
        <h1>
          Grav<span className="accent">Guess</span>
        </h1>
        <span className="tagline">map maker</span>
        <button className="ghost" onClick={onBack}>
          ‹ menu
        </button>
      </header>

      <div className="maker-body">
        <aside className="maker-sidebar">
          <label className="maker-field">
            <span>Seed</span>
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              spellCheck={false}
            />
          </label>
          <button onClick={newLevel}>New level</button>
          <p className="maker-live">
            {testing ? "validating…" : "live — stats update as you type"}
          </p>

          {tested && m && (
            <div className={`maker-card ${tested.validation.pass ? "pass" : "fail"} ${testing ? "stale" : ""}`}>
              <div className="maker-verdict">
                {tested.validation.pass ? "✓ Passes the bot" : "✗ Rejected"}
                <span className="maker-fun">fun {tested.funScore.toFixed(1)}</span>
              </div>
              <ul className="maker-gates">
                <Gate ok={m.settled} label={`settles (${(m.ticks / TICK_RATE).toFixed(1)}s)`} />
                <Gate ok={m.travel >= 1.3 * 1280} label={`travel ${(m.travel / 1280).toFixed(2)}× width`} />
                <Gate ok={m.reversals >= 3} label={`${m.reversals} reversals`} />
                <Gate
                  ok={tested.validation.spread >= 0.03 && tested.validation.spread <= 0.55}
                  label={`spread ${(tested.validation.spread * 100).toFixed(0)}%`}
                />
                <Gate ok={tested.validation.clusters >= 2} label={`${tested.validation.clusters} landing clusters`} />
              </ul>
              {tested.validation.failures.length > 0 && (
                <ul className="maker-failures">
                  {tested.validation.failures.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              <div className="maker-mods">
                {tested.modifiers.length > 0 ? tested.modifiers.join(" · ") : "no modifiers"}
              </div>
              <div className="maker-actions">
                <button onClick={() => onPlay(tested.loaded)}>Play</button>
                <button onClick={save}>Save</button>
              </div>
              {saveError && <p className="maker-error">Couldn't save (storage full or blocked).</p>}
            </div>
          )}
        </aside>

        <section className="maker-saved">
          <h2>Saved maps ({saved.length})</h2>
          {saved.length === 0 ? (
            <p className="maker-empty">Test a seed and save the keepers. They live in this browser.</p>
          ) : (
            <ul>
              {saved.map((s) => (
                <li key={s.id}>
                  <button
                    className="maker-load"
                    onClick={() => onPlay(testSeed(s.seed).loaded)}
                    title="Play this map"
                  >
                    <span className="maker-load-seed">{s.seed}</span>
                    <span className="maker-load-meta">
                      {s.archetype} · fun {s.funScore.toFixed(1)} {s.pass ? "✓" : "✗"}
                    </span>
                  </button>
                  <button className="ghost" onClick={() => setSaved(deleteMap(s.id))} title="Delete">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Gate({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={ok ? "gate-ok" : "gate-bad"}>
      {ok ? "✓" : "✗"} {label}
    </li>
  );
}
