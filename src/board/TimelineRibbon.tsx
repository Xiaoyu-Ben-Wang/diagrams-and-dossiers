/**
 * The chronology ribbon.
 *
 * Deliberately compact — one strip, roughly forty pixels tall. The board is the
 * point of the app and the ribbon is a control for moving through it, so it gets
 * the smallest footprint that still works: the date readout sits inside the tape
 * rather than in a row of its own, and the section heading is an aria-label
 * instead of a visible title.
 *
 * Styled as a strip of adding-machine tape with punched edges and brass ticks —
 * one tick per session cluster, not per entry, so a busy game night doesn't turn
 * the ribbon into a solid bar.
 *
 * Presentational and controlled: it reports a time and the board decides what
 * that means. Keeping the interpretation outside means the ribbon has no opinion
 * about zoom, culling, or which items exist.
 */

import { useCallback, useRef } from 'react'

import { positionOf, timeAt, type Cluster, type Timeline } from './timeline'

export interface TimelineRibbonProps {
  timeline: Timeline
  clusters: Cluster[]
  /** Current scrub position in epoch ms. */
  cursor: number
  onScrub: (time: number) => void
  playing: boolean
  onTogglePlay: () => void
  activeCount: number
  totalCount: number
  disabled?: boolean
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
  const trackRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const scrubFromEvent = useCallback(
    (clientX: number) => {
      const track = trackRef.current
      if (!track) return
      const box = track.getBoundingClientRect()
      if (box.width <= 0) return
      onScrub(timeAt((clientX - box.left) / box.width, timeline))
    },
    [onScrub, timeline],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return
      draggingRef.current = true
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Capture is a refinement, not a requirement.
      }
      scrubFromEvent(event.clientX)
    },
    [disabled, scrubFromEvent],
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!draggingRef.current || disabled) return
      scrubFromEvent(event.clientX)
    },
    [disabled, scrubFromEvent],
  )

  const handlePointerUp = useCallback((event: React.PointerEvent) => {
    draggingRef.current = false
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      // Already released.
    }
  }, [])

  const cursorPosition = positionOf(cursor, timeline)
  const empty = timeline.placed.length === 0

  /** The cluster the cursor currently sits in, for the in-tape readout. */
  const current = clusters.find((cluster) => cluster.start <= cursor)
  const currentEntry = current
    ? timeline.placed[Math.min(current.to, timeline.placed.length - 1)]
    : undefined

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
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-brass/40 bg-cork-700/70 text-[9px] text-board-ink transition hover:border-brass hover:bg-cork-700 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={playing ? 'Pause the recap' : 'Play the campaign as a recap'}
        title={playing ? 'Pause' : 'Play the campaign as a recap'}
      >
        <span aria-hidden>{playing ? '❚❚' : '▶'}</span>
      </button>

      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`tape relative h-7 min-w-0 flex-1 overflow-hidden rounded-sm ${
          disabled ? 'opacity-50' : 'cursor-ew-resize'
        }`}
        style={{ touchAction: 'none' }}
        role="slider"
        aria-label="Scrub through the campaign timeline"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(cursorPosition * 100)}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(event) => {
          if (disabled || empty) return
          // Arrow keys step a cluster at a time — the natural unit for a
          // campaign, and far more useful than a fixed time delta.
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (step === 0) return
          event.preventDefault()
          const index = clusters.findIndex((cluster) => cluster.start <= cursor)
          onScrub(clusters[Math.min(clusters.length - 1, Math.max(0, index + step))].start)
        }}
      >
        {/* Session ticks — one per cluster, so a twenty-event session is one mark. */}
        {clusters.map((cluster, index) => (
          <span
            key={`${cluster.start}-${index}`}
            className="absolute top-0 h-full w-px"
            style={{
              left: `${positionOf((cluster.start + cluster.end) / 2, timeline) * 100}%`,
              background:
                cluster.start <= cursor ? 'rgb(201 162 39 / 0.85)' : 'rgb(201 180 138 / 0.25)',
              boxShadow: cluster.start <= cursor ? '0 0 6px rgb(201 162 39 / 0.5)' : 'none',
            }}
          />
        ))}

        <div
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{
            width: `${cursorPosition * 100}%`,
            background: 'linear-gradient(90deg, rgb(201 162 39 / 0.06), rgb(201 162 39 / 0.16))',
          }}
        />

        <div
          className="pointer-events-none absolute top-0 h-full w-[2px] -translate-x-1/2"
          style={{
            left: `${cursorPosition * 100}%`,
            background: 'var(--color-brass)',
            boxShadow: '0 0 8px rgb(201 162 39 / 0.8)',
          }}
        />

        {/* The readout lives inside the tape rather than in its own row, which is
            where most of the height saving comes from. */}
        <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-[10px] text-ink-soft/80">
          {empty ? 'Pin something to start the chronology' : (currentEntry?.dateLabel ?? '')}
        </span>
      </div>

      <span className="w-[86px] shrink-0 text-right text-[10px] text-board-ink-soft/70 tabular-nums">
        {empty ? (
          'no dated items'
        ) : (
          <>
            <span className="text-board-ink">{activeCount}</span>
            <span className="text-board-ink-soft/50"> / {totalCount} known</span>
          </>
        )}
      </span>

      <span className="hidden shrink-0 text-[10px] text-board-ink-soft/40 lg:inline">
        {clusters.length} session{clusters.length === 1 ? '' : 's'}
      </span>
    </section>
  )
}
