// Daily-loop plumbing: fetch the published payload, play-once persistence,
// streaks, and the share card. All client-side state lives in localStorage.

import type { Vec2 } from "@gravguess/sim";
import type { DailyPayload } from "@gravguess/pipeline";

export type { DailyPayload };

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function fetchDaily(date: string): Promise<DailyPayload | null> {
  try {
    const res = await fetch(`/dailies/${date}.json`);
    if (!res.ok) return null;
    return (await res.json()) as DailyPayload;
  } catch {
    return null;
  }
}

export interface PlayedRecord {
  date: string;
  guess: Vec2;
  landing: Vec2;
  distancePx: number;
  ballWidths: number;
  accuracy: number;
  beatPar: boolean;
  playedAt: string;
}

export interface Streak {
  count: number;
  lastDate: string;
}

const playedKey = (date: string) => `gg2:played:${date}`;
const STREAK_KEY = "gg2:streak";

export function loadPlayed(date: string): PlayedRecord | null {
  try {
    const raw = localStorage.getItem(playedKey(date));
    return raw ? (JSON.parse(raw) as PlayedRecord) : null;
  } catch {
    return null;
  }
}

export function loadStreak(): Streak {
  try {
    const raw = localStorage.getItem(STREAK_KEY);
    return raw ? (JSON.parse(raw) as Streak) : { count: 0, lastDate: "" };
  } catch {
    return { count: 0, lastDate: "" };
  }
}

function previousDate(date: string): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
}

/** Persist today's result and advance the streak. Returns the updated streak. */
export function savePlayed(rec: PlayedRecord): Streak {
  let streak = loadStreak();
  if (streak.lastDate !== rec.date) {
    streak = {
      count: streak.lastDate === previousDate(rec.date) ? streak.count + 1 : 1,
      lastDate: rec.date,
    };
  }
  try {
    localStorage.setItem(playedKey(rec.date), JSON.stringify(rec));
    localStorage.setItem(STREAK_KEY, JSON.stringify(streak));
  } catch {
    // localStorage unavailable (private mode etc.) — play still works, nothing persists
  }
  return streak;
}

function distanceEmoji(ballWidths: number): string {
  if (ballWidths <= 1) return "\u{1F3AF}"; // direct hit
  if (ballWidths <= 3) return "\u{1F7E2}";
  if (ballWidths <= 8) return "\u{1F7E1}";
  if (ballWidths <= 15) return "\u{1F7E0}";
  return "\u{1F534}";
}

/** Spoiler-free share text — no coordinates, no map details. */
export function buildShareText(rec: PlayedRecord, streak: Streak): string {
  const lines = [
    `GravGuess ${rec.date}`,
    `${distanceEmoji(rec.ballWidths)} ${rec.ballWidths.toFixed(1)} ball-widths · ${(rec.accuracy * 100).toFixed(1)}%`,
  ];
  const extras: string[] = [];
  if (rec.beatPar) extras.push("⛳ under par!");
  if (streak.count > 1) extras.push(`\u{1F525} ${streak.count}-day streak`);
  if (extras.length) lines.push(extras.join(" · "));
  return lines.join("\n");
}

/** "hh:mm:ss" until the next UTC midnight (the next daily). */
export function countdownToNextDaily(now = new Date()): string {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  let s = Math.max(0, Math.floor((next.getTime() - now.getTime()) / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
