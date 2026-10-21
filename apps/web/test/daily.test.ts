import { describe, expect, it } from "vitest";
import {
  buildShareText,
  countdownToNextDaily,
  getFeedbackTier,
  proximityMeter,
  type PlayedRecord,
  type Streak,
} from "../src/daily.ts";

describe("getFeedbackTier", () => {
  it("boundary values", () => {
    expect(getFeedbackTier(0).label).toBe("Miss");
    expect(getFeedbackTier(49).label).toBe("Miss");
    expect(getFeedbackTier(50).label).toBe("Rough");
    expect(getFeedbackTier(69).label).toBe("Rough");
    expect(getFeedbackTier(70).label).toBe("Solid");
    expect(getFeedbackTier(84).label).toBe("Solid");
    expect(getFeedbackTier(85).label).toBe("Great");
    expect(getFeedbackTier(94).label).toBe("Great");
    expect(getFeedbackTier(95).label).toBe("Insane");
    expect(getFeedbackTier(98).label).toBe("Insane");
    expect(getFeedbackTier(99).label).toBe("Perfect");
    expect(getFeedbackTier(100).label).toBe("Perfect");
  });
});

describe("proximityMeter", () => {
  it("bullseye fills the whole bar", () => {
    expect(proximityMeter(0)).toBe("\u{1F7E9}".repeat(10));
  });

  it("mid-range guess is half filled", () => {
    expect(proximityMeter(5)).toBe("\u{1F7E9}".repeat(5) + "\u{2B1C}".repeat(5));
  });

  it("far-off guess empties the bar", () => {
    expect(proximityMeter(15)).toBe("\u{2B1C}".repeat(10));
  });
});

function makeRecord(overrides: Partial<PlayedRecord> = {}): PlayedRecord {
  return {
    date: "2026-06-12",
    guess: { x: 123, y: 456 },
    landing: { x: 125, y: 460 },
    distancePx: 12.3,
    ballWidths: 1.5,
    accuracy: 0.9,
    beatPar: false,
    playedAt: "2026-06-12T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildShareText", () => {
  it("includes date, tier, and proximity meter without streak or url", () => {
    const rec = makeRecord();
    const streak: Streak = { count: 1, lastDate: "2026-06-12" };
    const text = buildShareText(rec, streak);
    expect(text).toContain("GravGuess 2026-06-12");
    expect(text).toContain("Great");
    expect(text).toContain(proximityMeter(rec.ballWidths));
    expect(text).not.toContain("streak");
    expect(text).not.toContain("http");
  });

  it("adds a streak line when streak.count > 1", () => {
    const rec = makeRecord();
    const streak: Streak = { count: 4, lastDate: "2026-06-12" };
    const text = buildShareText(rec, streak);
    expect(text).toContain("4-day streak");
  });

  it("adds par and url lines when present", () => {
    const rec = makeRecord({ beatPar: true });
    const streak: Streak = { count: 1, lastDate: "2026-06-12" };
    const text = buildShareText(rec, streak, "https://example.com/d/2026-06-12");
    expect(text).toContain("under par");
    expect(text).toContain("https://example.com/d/2026-06-12");
  });

  it("never leaks map-spoiling coordinates or distances", () => {
    const rec = makeRecord();
    const streak: Streak = { count: 3, lastDate: "2026-06-12" };
    const text = buildShareText(rec, streak, "https://example.com/d/2026-06-12");
    expect(text).not.toContain(String(rec.guess.x));
    expect(text).not.toContain(String(rec.guess.y));
    expect(text).not.toContain(String(rec.landing.x));
    expect(text).not.toContain(String(rec.landing.y));
    expect(text).not.toContain(rec.distancePx.toString());
  });
});

describe("countdownToNextDaily", () => {
  it("formats the time remaining just after midnight UTC", () => {
    const now = new Date("2026-06-12T00:00:01.000Z");
    expect(countdownToNextDaily(now)).toBe("23:59:59");
  });

  it("formats the time remaining just before midnight UTC", () => {
    const now = new Date("2026-06-12T23:59:59.000Z");
    expect(countdownToNextDaily(now)).toBe("00:00:01");
  });

  it("is exactly zero at midnight UTC", () => {
    const now = new Date("2026-06-12T00:00:00.000Z");
    expect(countdownToNextDaily(now)).toBe("24:00:00");
  });
});
