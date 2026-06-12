// How-to-play overlay. Auto-shows on first visit, reopenable from the menu.

export function Tutorial({ onClose }: { onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card" onClick={(e) => e.stopPropagation()}>
        <h2>How to play</h2>
        <ol>
          <li>
            <strong>Study the map.</strong> One ball will drop from the dashed yellow ring and
            ride the ramps all the way down. Every element is in the legend below the map.
          </li>
          <li>
            <strong>Place your guess.</strong> Tap anywhere — you're predicting where the ball
            finally <em>settles</em>, not where it lands first.
          </li>
          <li>
            <strong>Drop the ball</strong> and watch the run. No take-backs.
          </li>
          <li>
            <strong>Score by distance</strong> — in ball-widths. Beat the par to prove you
            out-read the map. Come back tomorrow: everyone on Earth gets the same map every day.
          </li>
        </ol>
        <p className="overlay-hint">
          Tip: bumpers reflect the ball and boost pads shove it — but the basin walls decide
          where it finally rests. Think about the <em>end</em> of the story, not the middle.
        </p>
        <button onClick={onClose}>Got it</button>
      </div>
    </div>
  );
}
