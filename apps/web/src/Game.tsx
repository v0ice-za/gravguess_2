// The play screen: canvas + HUD. All sim state lives in refs driven by one rAF
// loop; React only renders phase transitions.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createRun,
  DT,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  runDigest,
  step,
  type MapDef,
  type RunState,
  type Vec2,
} from "@gravguess/sim";
import { drawFrame, type TrailPoint } from "./render.ts";
import { Legend } from "./Legend.tsx";
import {
  buildShareText,
  countdownToNextDaily,
  loadStreak,
  savePlayed,
  type DailyPayload,
  type PlayedRecord,
  type Streak,
} from "./daily.ts";

type Phase = "aim" | "running" | "result";

export interface LoadedMap {
  map: MapDef;
  label: string;
  daily: DailyPayload | null; // null in practice mode
}

const DIAGONAL = Math.sqrt(LOGICAL_WIDTH * LOGICAL_WIDTH + LOGICAL_HEIGHT * LOGICAL_HEIGHT);
const TRAIL_LENGTH = 40;

export function Game({
  loaded,
  initialRecord,
  onBack,
}: {
  loaded: LoadedMap;
  initialRecord: PlayedRecord | null;
  onBack: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [phase, setPhase] = useState<Phase>(initialRecord ? "result" : "aim");
  const [guess, setGuess] = useState<Vec2 | null>(initialRecord?.guess ?? null);
  const [record, setRecord] = useState<PlayedRecord | null>(initialRecord);
  const [streak, setStreak] = useState<Streak>(() => loadStreak());
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState("");

  const runRef = useRef<RunState | null>(null);
  const trailRef = useRef<TrailPoint[]>([]);
  const bumperFlashRef = useRef<Map<string, number>>(new Map());
  const phaseRef = useRef<Phase>(phase);
  const guessRef = useRef<Vec2 | null>(guess);
  const recordRef = useRef<PlayedRecord | null>(record);
  phaseRef.current = phase;
  guessRef.current = guess;
  recordRef.current = record;

  useEffect(() => {
    if (phase !== "result" || !loaded.daily) return;
    const update = () => setCountdown(countdownToNextDaily());
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [phase, loaded]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const map = loaded.map;

    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const finishRun = (run: RunState) => {
      const daily = loaded.daily;
      const clientLanding = { x: run.px, y: run.py };
      // Daily scoring uses the AUTHORITATIVE landing; the digest comparison is
      // our in-production determinism canary.
      const landing = daily ? daily.landing : clientLanding;
      if (daily && runDigest(run) !== daily.digest) {
        console.warn(
          `[gravguess] determinism mismatch! client=${runDigest(run)} published=${daily.digest}`,
        );
      }
      const g = guessRef.current;
      const distancePx = g ? Math.hypot(g.x - landing.x, g.y - landing.y) : DIAGONAL;
      const rec: PlayedRecord = {
        date: daily?.date ?? "practice",
        guess: g ?? { x: 0, y: 0 },
        landing,
        distancePx,
        ballWidths: distancePx / (map.ballRadius * 2),
        accuracy: Math.max(0, 1 - distancePx / DIAGONAL),
        beatPar: daily ? distancePx <= daily.parPx : false,
        playedAt: new Date().toISOString(),
      };
      recordRef.current = rec;
      setRecord(rec);
      if (daily) setStreak(savePlayed(rec));
      setPhase("result");
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const elapsed = Math.min((now - last) / 1000, 0.1);
      last = now;

      const run = runRef.current;
      if (phaseRef.current === "running" && run && !run.done) {
        acc += elapsed;
        while (acc >= DT && !run.done) {
          acc -= DT;
          const events = step(run);
          for (const e of events) {
            if (e.type === "bumper") bumperFlashRef.current.set(e.bumperId, 1);
            if (e.type === "pad") bumperFlashRef.current.set(e.padId, 1);
          }
          const trail = trailRef.current;
          trail.push({ x: run.px, y: run.py });
          if (trail.length > TRAIL_LENGTH) trail.shift();
        }
        if (run.done) {
          acc = 0;
          finishRun(run);
        }
      }

      for (const [id, v] of bumperFlashRef.current) {
        const next = v - elapsed * 3;
        if (next <= 0) bumperFlashRef.current.delete(id);
        else bumperFlashRef.current.set(id, next);
      }

      const ball = phaseRef.current === "running" && run ? { x: run.px, y: run.py } : undefined;
      drawFrame(ctx, map, {
        ball,
        trail: trailRef.current,
        guess: guessRef.current ?? undefined,
        landing: phaseRef.current === "result" ? recordRef.current?.landing : undefined,
        bumperFlash: bumperFlashRef.current,
      });
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [loaded]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (phaseRef.current !== "aim") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * LOGICAL_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * LOGICAL_HEIGHT;
    setGuess({
      x: Math.max(0, Math.min(LOGICAL_WIDTH, x)),
      y: Math.max(0, Math.min(LOGICAL_HEIGHT, y)),
    });
  }, []);

  const drop = useCallback(() => {
    if (!guessRef.current) return;
    runRef.current = createRun(loaded.map);
    trailRef.current = [];
    setRecord(null);
    setPhase("running");
  }, [loaded]);

  const practiceAgain = useCallback(() => {
    runRef.current = null;
    trailRef.current = [];
    setGuess(null);
    setRecord(null);
    setPhase("aim");
  }, []);

  const share = useCallback(() => {
    const rec = recordRef.current;
    if (!rec) return;
    void navigator.clipboard.writeText(buildShareText(rec, loadStreak())).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  const isDaily = loaded.daily != null;
  const par = loaded.daily ? loaded.daily.parPx / (loaded.map.ballRadius * 2) : null;

  return (
    <>
      <header>
        <h1>
          Grav<span className="accent">Guess</span>
        </h1>
        <span className="tagline seed-label">{loaded.label}</span>
        <button className="ghost" onClick={onBack}>
          ‹ menu
        </button>
      </header>
      <div className="stage">
        <canvas
          ref={canvasRef}
          width={LOGICAL_WIDTH}
          height={LOGICAL_HEIGHT}
          onPointerDown={onPointerDown}
        />
        <Legend map={loaded.map} />
      </div>
      <div className="hud">
        {phase === "aim" && (
          <>
            <span className="hint">
              {guess ? "Guess placed — drop when ready." : "Tap the map where the ball will settle."}
              {par !== null && ` Par: ${par.toFixed(1)} ball-widths.`}
            </span>
            <button onClick={drop} disabled={!guess}>
              Drop ball
            </button>
          </>
        )}
        {phase === "running" && <span className="hint">The run is the show…</span>}
        {phase === "result" && record && (
          <>
            <span className="score">
              {record.ballWidths < 1 ? "Bullseye!" : `${record.ballWidths.toFixed(1)} ball-widths off`}
              {" · "}
              {(record.accuracy * 100).toFixed(1)}%
              {isDaily && record.beatPar && " · ⛳ under par"}
              {isDaily && streak.count > 1 && ` · 🔥 ${streak.count}`}
            </span>
            {isDaily ? (
              <>
                <button onClick={share}>{copied ? "Copied!" : "Share"}</button>
                <span className="hint">next map in {countdown}</span>
              </>
            ) : (
              <button onClick={practiceAgain}>Play again</button>
            )}
          </>
        )}
      </div>
    </>
  );
}
