import type { ReplaySpeed } from "../types.js";

interface Props {
  canReplay: boolean;
  isReplayMode: boolean;
  isPlaying: boolean;
  currentIndex: number;
  maxIndex: number;
  speed: ReplaySpeed;
  firstFailureIndex: number;
  onReplayModeChange: (enabled: boolean) => void;
  onPlayPause: () => void;
  onScrub: (index: number) => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onJumpToFailure: () => void;
}

const SPEED_OPTIONS: ReplaySpeed[] = [0.5, 1, 2, 4];

export function ReplayControls({
  canReplay,
  isReplayMode,
  isPlaying,
  currentIndex,
  maxIndex,
  speed,
  firstFailureIndex,
  onReplayModeChange,
  onPlayPause,
  onScrub,
  onSpeedChange,
  onJumpToFailure
}: Props) {
  return (
    <section aria-label="Replay controls">
      <h2 style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>Replay</h2>
      {!canReplay && (
        <p role="status" style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
          Replay becomes available after events are loaded.
        </p>
      )}
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isReplayMode}
            disabled={!canReplay}
            onChange={(e) => onReplayModeChange(e.target.checked)}
          />
          Replay Mode
        </label>

        <button
          onClick={onPlayPause}
          disabled={!isReplayMode || !canReplay}
          style={{
            minWidth: 72,
            background: isPlaying ? "#334155" : "#3b82f6",
            borderColor: isPlaying ? "#475569" : "#3b82f6",
            color: "#f1f5f9",
          }}
        >
          {isPlaying ? "⏸ Pause" : "▶ Play"}
        </button>

        <label htmlFor="replay-speed" style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
          Speed
        </label>
        <select
          id="replay-speed"
          value={String(speed)}
          disabled={!isReplayMode || !canReplay}
          onChange={(e) => onSpeedChange(Number(e.target.value) as ReplaySpeed)}
        >
          {SPEED_OPTIONS.map((option) => (
            <option key={option} value={String(option)}>{option}x</option>
          ))}
        </select>

        <button
          onClick={onJumpToFailure}
          disabled={!isReplayMode || firstFailureIndex < 0}
          aria-label="Jump to first failure"
          style={{
            background: firstFailureIndex >= 0 ? "#7f1d1d" : undefined,
            borderColor: firstFailureIndex >= 0 ? "#ef4444" : undefined,
            color: "#f1f5f9",
          }}
        >
          ⚠ Jump To First Failure
        </button>
      </div>

      <div style={{ marginTop: "0.75rem" }}>
        <label htmlFor="replay-scrubber" style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
          Timeline
        </label>
        <input
          id="replay-scrubber"
          type="range"
          min={0}
          max={Math.max(maxIndex, 0)}
          value={Math.max(currentIndex, 0)}
          disabled={!isReplayMode || !canReplay}
          onChange={(e) => onScrub(Number(e.target.value))}
          style={{ width: "100%", marginTop: 4 }}
        />
        <p aria-live="polite" style={{ fontSize: "0.8rem", color: "#94a3b8", margin: "4px 0 0" }}>
          Frame {Math.max(currentIndex, 0) + 1} of {Math.max(maxIndex + 1, 0)}
        </p>
      </div>
    </section>
  );
}
