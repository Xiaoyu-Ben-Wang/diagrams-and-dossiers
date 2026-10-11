import { useCallback, useRef } from "react";

import { positionOf, timeAt, type Cluster, type Timeline } from "./timeline";

export interface TimelineRibbonProps {
  timeline: Timeline;
  clusters: Cluster[];
  cursor: number;
  onScrub: (time: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  activeCount: number;
  totalCount: number;
  disabled?: boolean;
}

export function TimelineRibbon({
  timeline,
  clusters,
  cursor,
  onScrub,
  playing,
  onTogglePlay,
  activeCount,
  totalCount,
  disabled = false,
}: TimelineRibbonProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const scrubFromEvent = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const box = track.getBoundingClientRect();
      if (box.width <= 0) return;
      onScrub(timeAt((clientX - box.left) / box.width, timeline));
    },
    [onScrub, timeline],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return;
      draggingRef.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a refinement, not a requirement.
      }
      scrubFromEvent(event.clientX);
    },
    [disabled, scrubFromEvent],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!draggingRef.current || disabled) return;
      scrubFromEvent(event.clientX);
    },
    [disabled, scrubFromEvent],
  );

  const handlePointerUp = useCallback((event: React.PointerEvent) => {
    draggingRef.current = false;
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Already released.
    }
  }, []);

  const cursorPosition = positionOf(cursor, timeline);
  const empty = timeline.placed.length === 0;

  const current = clusters.find((cluster) => cluster.start <= cursor);
  const currentEntry = current
    ? timeline.placed[Math.min(current.to, timeline.placed.length - 1)]
    : undefined;

  return (
    <section
      className="flex items-center gap-2.5 select-none"
      aria-label="Campaign chronology"
      data-testid="timeline-ribbon"
    >
      <button
        type="button"
        onClick={onTogglePlay}
        disabled={disabled || empty}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-accent/40 bg-cork-700/70 text-[9px] text-board-ink transition hover:border-accent hover:bg-cork-700 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={
          playing ? "Pause the recap" : "Play the campaign as a recap"
        }
        title={playing ? "Pause" : "Play the campaign as a recap"}
      >
        <span aria-hidden>{playing ? "❚❚" : "▶"}</span>
      </button>

      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`tape relative h-7 min-w-0 flex-1 overflow-hidden rounded-sm ${
          disabled ? "opacity-50" : "cursor-ew-resize"
        }`}
        style={{ touchAction: "none" }}
        role="slider"
        aria-label="Scrub through the campaign timeline"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(cursorPosition * 100)}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(event) => {
          if (disabled || empty) return;
          const step =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (step === 0) return;
          event.preventDefault();
          const index = clusters.findIndex(
            (cluster) => cluster.start <= cursor,
          );
          onScrub(
            clusters[Math.min(clusters.length - 1, Math.max(0, index + step))]
              .start,
          );
        }}
      >
        {clusters.map((cluster, index) => (
          <span
            key={`${cluster.start}-${index}`}
            className="absolute top-0 h-full w-px"
            style={{
              left: `${positionOf((cluster.start + cluster.end) / 2, timeline) * 100}%`,
              background:
                cluster.start <= cursor
                  ? "color-mix(in srgb, var(--color-accent) 85%, transparent)"
                  : "color-mix(in srgb, var(--color-border) 25%, transparent)",
              boxShadow:
                cluster.start <= cursor
                  ? "0 0 6px color-mix(in srgb, var(--color-accent) 50%, transparent)"
                  : "none",
            }}
          />
        ))}

        <div
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{
            width: `${cursorPosition * 100}%`,
            background:
              "linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 6%, transparent), color-mix(in srgb, var(--color-accent) 16%, transparent))",
          }}
        />

        <div
          className="pointer-events-none absolute top-0 h-full w-[2px] -translate-x-1/2"
          style={{
            left: `${cursorPosition * 100}%`,
            background: "var(--color-accent)",
            boxShadow:
              "0 0 8px color-mix(in srgb, var(--color-accent) 80%, transparent)",
          }}
        />

        <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-[10px] text-ink-soft/80">
          {empty
            ? "Pin something to start the chronology"
            : (currentEntry?.dateLabel ?? "")}
        </span>
      </div>

      <span className="w-[86px] shrink-0 text-right text-[10px] text-board-ink-soft/70 tabular-nums">
        {empty ? (
          "no dated items"
        ) : (
          <>
            <span className="text-board-ink">{activeCount}</span>
            <span className="text-board-ink-soft/50">
              {" "}
              / {totalCount} known
            </span>
          </>
        )}
      </span>

      <span className="hidden shrink-0 text-[10px] text-board-ink-soft/40 lg:inline">
        {clusters.length} session{clusters.length === 1 ? "" : "s"}
      </span>
    </section>
  );
}
