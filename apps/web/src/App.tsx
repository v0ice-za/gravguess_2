// Screen router + map loading. Menu structure ported from v1: Daily / Practice /
// How to Play / Map Maker (returning later).

import { useCallback, useEffect, useState } from "react";
import { firstLight } from "@gravguess/sim";
import { generateDaily } from "@gravguess/gen";
import { Game, type LoadedMap } from "./Game.tsx";
import { Tutorial } from "./Tutorial.tsx";
import { fetchDaily, loadPlayed, loadStreak, todayUTC, type PlayedRecord } from "./daily.ts";

type Screen = "menu" | "game";

const TUTORIAL_SEEN_KEY = "gg2:tutorial-seen";

// Practice maps are generated client-side — deterministic but uncurated. The
// DAILY always comes from the published pipeline payload.
function loadPractice(seed: string): LoadedMap {
  if (seed === "first-light") {
    return { map: firstLight, label: "practice · first-light (hand-built)", daily: null };
  }
  const d = generateDaily(seed);
  const status = d.validation.pass ? "" : " · UNVALIDATED";
  return { map: d.map, label: `practice · ${seed} · ${d.archetype}${status}`, daily: null };
}

export function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [loaded, setLoaded] = useState<LoadedMap | null>(null);
  const [initialRecord, setInitialRecord] = useState<PlayedRecord | null>(null);
  const [dailyState, setDailyState] = useState<"unknown" | "available" | "missing">("unknown");
  const [busy, setBusy] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const streak = loadStreak();
  const today = todayUTC();
  const playedToday = loadPlayed(today);

  // Deep link: ?seed=... goes straight into practice.
  useEffect(() => {
    const seedParam = new URLSearchParams(window.location.search).get("seed");
    if (seedParam) {
      setLoaded(loadPractice(seedParam));
      setInitialRecord(null);
      setScreen("game");
    }
  }, []);

  // Probe whether today's daily exists (for the menu button state).
  useEffect(() => {
    void fetchDaily(today).then((d) => setDailyState(d ? "available" : "missing"));
  }, [today]);

  const playDaily = useCallback(() => {
    setBusy(true);
    void fetchDaily(today).then((daily) => {
      setBusy(false);
      if (!daily) {
        setDailyState("missing");
        return;
      }
      setLoaded({ map: daily.map, label: `daily ${today} · ${daily.archetype}`, daily });
      setInitialRecord(loadPlayed(today));
      setScreen("game");
      if (!localStorage.getItem(TUTORIAL_SEEN_KEY)) {
        setShowTutorial(true);
        localStorage.setItem(TUTORIAL_SEEN_KEY, "1");
      }
    });
  }, [today]);

  const playPractice = useCallback(() => {
    const seed = `practice-${Math.random().toString(36).slice(2, 8)}`;
    setLoaded(loadPractice(seed));
    setInitialRecord(null);
    setScreen("game");
  }, []);

  const backToMenu = useCallback(() => {
    setScreen("menu");
    setLoaded(null);
    // Clear a practice deep link so "back" really lands on the menu.
    if (window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  if (screen === "game" && loaded) {
    return (
      <>
        <Game loaded={loaded} initialRecord={initialRecord} onBack={backToMenu} />
        {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
      </>
    );
  }

  return (
    <div className="menu-screen">
      <h1 className="menu-logo">
        Grav<span className="accent">Guess</span>
      </h1>
      <p className="menu-copy">
        One physics puzzle a day. Study the map, call the landing, watch the run.
      </p>
      {(streak.count > 0 || playedToday) && (
        <p className="menu-status">
          {playedToday
            ? `Played today: ${playedToday.ballWidths.toFixed(1)} ball-widths (${(playedToday.accuracy * 100).toFixed(1)}%)`
            : null}
          {playedToday && streak.count > 1 ? " · " : null}
          {streak.count > 1 ? `🔥 ${streak.count}-day streak` : null}
        </p>
      )}
      <div className="menu-grid">
        <button onClick={playDaily} disabled={busy || dailyState === "missing"}>
          {playedToday ? "Today's result" : "Play today's map"}
          {dailyState === "missing" ? " (not published)" : ""}
        </button>
        <button onClick={playPractice}>Practice map</button>
        <button onClick={() => setShowTutorial(true)}>How to play</button>
        <button disabled title="Returning from v1 soon">
          Map maker
        </button>
      </div>
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
    </div>
  );
}
