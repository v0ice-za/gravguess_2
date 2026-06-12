// Post-guess result modal — the payoff screen and the share/compare hook. Shows
// how close the guess landed, the tier, the proximity meter (the artifact
// friends compare), and the share action. The competitive loop lives here:
// share text is built to be scannable side-by-side without spoiling the map.

import { getFeedbackTier, proximityMeter, type PlayedRecord, type Streak } from "./daily.ts";

export function ResultModal({
  record,
  isDaily,
  parBallWidths,
  streak,
  countdown,
  copied,
  shared,
  onShare,
  onPlayAgain,
  onViewMap,
}: {
  record: PlayedRecord;
  isDaily: boolean;
  parBallWidths: number | null;
  streak: Streak;
  countdown: string;
  copied: boolean;
  shared: boolean;
  onShare: () => void;
  onPlayAgain: () => void;
  onViewMap: () => void;
}) {
  const tier = getFeedbackTier(record.accuracy * 100);
  const meter = proximityMeter(record.ballWidths);

  return (
    <div className="overlay" onClick={onViewMap}>
      <div className="result-card" onClick={(e) => e.stopPropagation()}>
        <button className="result-close" onClick={onViewMap} title="View the map">
          ✕
        </button>

        <div className="result-tier" style={{ color: tier.color }}>
          <span className="result-badge">{tier.badge}</span>
          {tier.label}
        </div>

        <div className="result-headline">
          {record.ballWidths < 1 ? (
            <span className="result-bullseye">Bullseye!</span>
          ) : (
            <>
              <strong>{record.ballWidths.toFixed(1)}</strong> ball-widths off
            </>
          )}
        </div>

        <div className="result-meter" aria-label="proximity">{meter}</div>

        <div className="result-stats">
          <div className="result-stat">
            <span className="result-stat-val">{(record.accuracy * 100).toFixed(1)}%</span>
            <span className="result-stat-key">accuracy</span>
          </div>
          {isDaily && parBallWidths !== null && (
            <div className="result-stat">
              <span className="result-stat-val" style={{ color: record.beatPar ? "#4ade80" : "#94a3b8" }}>
                {record.beatPar ? "⛳ under" : "over"}
              </span>
              <span className="result-stat-key">par {parBallWidths.toFixed(1)}</span>
            </div>
          )}
          {isDaily && streak.count > 0 && (
            <div className="result-stat">
              <span className="result-stat-val">🔥 {streak.count}</span>
              <span className="result-stat-key">day streak</span>
            </div>
          )}
        </div>

        {isDaily ? (
          <>
            <button className="primary result-share" onClick={onShare}>
              {copied ? "Copied — paste it to a friend!" : shared ? "Shared!" : "Share & challenge a friend"}
            </button>
            <p className="result-sub">Compare your meter with theirs. Next map in {countdown}.</p>
          </>
        ) : (
          <div className="result-actions">
            <button className="primary" onClick={onPlayAgain}>
              Play again
            </button>
            <button onClick={onShare}>{copied ? "Copied!" : shared ? "Shared!" : "Share"}</button>
          </div>
        )}
      </div>
    </div>
  );
}
