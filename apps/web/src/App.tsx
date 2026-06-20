// Screen router + map loading. Menu structure ported from v1: Daily / Practice /
// How to Play / Map Maker (returning later).

import { useCallback, useEffect, useState } from "react";
import { firstLight } from "@gravguess/sim";
import { generateDaily } from "@gravguess/gen";
import { Game, type LoadedMap } from "./Game.tsx";
import { MapMaker } from "./MapMaker.tsx";
import { Tutorial } from "./Tutorial.tsx";
import { fetchDaily, loadPlayed, loadStreak, todayUTC, type PlayedRecord } from "./daily.ts";

type Screen = "menu" | "game" | "mapmaker";

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
  // The Map Maker is an admin/authoring tool, not a player feature yet. It is
  // reachable only with ?admin in the URL until the generation is locked in.
  const isAdmin = new URLSearchParams(window.location.search).has("admin");

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
    // generateDaily runs a CPU-bound search (it tries several archetypes so practice
    // shows the full variety). Flip to busy and yield first, so the menu paints the
    // disabled state before the generation runs instead of dead-clicking.
    setBusy(true);
    setTimeout(() => {
      const practice = loadPractice(seed);
      setLoaded(practice);
      setInitialRecord(null);
      setBusy(false);
      setScreen("game");
    }, 0);
  }, []);

  const backToMenu = useCallback(() => {
    setScreen("menu");
    setLoaded(null);
    // Clear a practice deep link so "back" really lands on the menu.
    if (window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // Map Maker "Play" routes a candidate into the game in practice mode. "Back"
  // from that game returns to the maker, not the menu.
  const playFromMaker = useCallback((map: LoadedMap) => {
    setLoaded(map);
    setInitialRecord(null);
    setScreen("game");
  }, []);

  if (screen === "mapmaker" && isAdmin) {
    return <MapMaker onPlay={playFromMaker} onBack={backToMenu} />;
  }

  if (screen === "game" && loaded) {
    // Maker test-plays return to the maker; daily and practice games go to the menu.
    const onBack = loaded.label.startsWith("map maker") ? () => setScreen("mapmaker") : backToMenu;
    return (
      <>
        <Game loaded={loaded} initialRecord={initialRecord} onBack={onBack} />
        {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
      </>
    );
  }

  return (
    <div className="menu-screen">
      <div className="menu-card">
        <div className="menu-banner">
          <h1 className="menu-logo">
            GRAV<span className="accent">GUESS</span>
          </h1>
          <p className="menu-tagline">PREDICT · FALL · COMPETE</p>
        </div>
        <h2 className="menu-heading">Choose how you want to play</h2>
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
        <div className="menu-buttons">
          <button
            className="primary"
            onClick={playDaily}
            disabled={busy || dailyState === "missing"}
          >
            {playedToday ? "Today's result" : "Play today's map"}
            {dailyState === "missing" ? " (not published)" : ""}
          </button>
          <button onClick={playPractice} disabled={busy}>
            {busy ? "Generating…" : "Practice map"}
          </button>
          <button onClick={() => setShowTutorial(true)}>How to play</button>
          {isAdmin && (
            <button onClick={() => setScreen("mapmaker")}>Map maker (admin)</button>
          )}
        </div>
      </div>
      {showTutorial && <Tutorial onClose={() => setShowTutorial(false)} />}
    </div>
  );
}
