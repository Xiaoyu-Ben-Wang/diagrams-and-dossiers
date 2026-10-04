/**
 * The chronology ribbon.
 *
 * Styled as a strip of adding-machine tape with perforated edges and brass tick
 * marks — one tick per session cluster, not per entry, so a busy game night
 * doesn't turn the ribbon into a solid bar.
 *
 * The scrubber is a controlled component: it reports a time and the board
 * decides what that means. Keeping the interpretation outside means the ribbon
 * has no opinion about zoom, culling, or which items exist.
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
  /** How many items are live at the cursor, for the readout. */
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
      const position = (clientX - box.left) / box.width
      onScrub(timeAt(position, timeline))
    },
    [onScrub, timeline],
  )

  const handlePointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled) return
      draggingRef.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
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
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }, [])

  const cursorPosition = positionOf(cursor, timeline)
  const empty = timeline.placed.length === 0
  const currentCluster = clusters.find(
    (cluster) => cluster.start <= cursor && cursor <= cluster.end,
  )

  return (
    <section
      className="select-none"
      aria-label="Campaign chronology"
      data-testid="timeline-ribbon"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-[0.14em] text-brass uppercase">
          Chronology
        </h2>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onTogglePlay}
            disabled={disabled || empty}
            className="flex items-center gap-2 rounded border border-brass/40 bg-cork-700/70 px-3 py-1 text-xs text-parchment-200 transition hover:border-brass hover:bg-cork-700 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={playing ? 'Pause the recap' : 'Play the campaign as a recap'}
          >
            <span aria-hidden className="text-[10px] leading-none">
              {playing ? '❚❚' : '▶'}
            </span>
            {playing ? 'Pause' : 'Play recap'}
          </button>

          <span className="text-xs text-parchment-300/70">
            {empty ? (
              'no dated items'
            ) : (
              <>
                <span className="text-parchment-200">{activeCount}</span>
                <span className="text-parchment-300/50"> / {totalCount} known</span>
              </>
            )}
          </span>
        </div>
      </div>

      {/* The tape */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`tape relative h-14 w-full overflow-hidden rounded-sm ${
          disabled ? 'opacity-50' : 'cursor-ew-resize'
        }`}
        style={{ touchAction: 'none' }}
        role="slider"
        aria-label="Scrub through the campaign timeline"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(cursorPosition * 100)}
        aria-valuetext={currentCluster ? `${activeCount} of ${totalCount} known` : undefined}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={(event) => {
          if (disabled || empty) return
          // Arrow keys step a cluster at a time — the natural unit for a
          // campaign timeline, and far more useful than a fixed time delta.
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (step === 0) return
          event.preventDefault()
          const index = clusters.findIndex((cluster) => cluster.start <= cursor)
          const next = Math.min(
            clusters.length - 1,
            Math.max(0, (index === -1 ? 0 : index) + step),
          )
          onScrub(clusters[next].start)
        }}
      >
        {/* Session ticks */}
        {clusters.map((cluster, index) => {
          const position = positionOf((cluster.start + cluster.end) / 2, timeline)
          const reached = cluster.start <= cursor
          return (
            <span
              key={`${cluster.start}-${index}`}
              className="absolute top-0 h-full w-px"
              style={{
                left: `${position * 100}%`,
                background: reached
                  ? 'rgb(201 162 39 / 0.85)'
                  : 'rgb(201 180 138 / 0.25)',
                boxShadow: reached ? '0 0 6px rgb(201 162 39 / 0.5)' : 'none',
              }}
              title={`${cluster.size} item${cluster.size === 1 ? '' : 's'}`}
            />
          )
        })}

        {/* Progress wash up to the cursor */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{
            width: `${cursorPosition * 100}%`,
            background:
              'linear-gradient(90deg, rgb(201 162 39 / 0.06), rgb(201 162 39 / 0.16))',
          }}
        />

        {/* The scrub handle, shaped like a ticket punch */}
        <div
          className="pointer-events-none absolute top-0 h-full w-[3px] -translate-x-1/2"
          style={{
            left: `${cursorPosition * 100}%`,
            background: 'var(--color-brass)',
            boxShadow: '0 0 10px rgb(201 162 39 / 0.8)',
          }}
        />
        <div
          className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full tack"
          style={{ left: `${cursorPosition * 100}%` }}
        />

        {empty && (
          <span className="absolute inset-0 flex items-center justify-center text-xs text-ink-soft/70">
            Pin something to start the chronology
          </span>
        )}
      </div>

      <div className="mt-1.5 flex justify-between text-[11px] text-parchment-300/60">
        <span>{timeline.placed[0]?.dateLabel ?? '—'}</span>
        <span className="text-parchment-300/40">
          {timeline.undated.length > 0 &&
            `${timeline.undated.length} unsorted · `}
          {clusters.length} session{clusters.length === 1 ? '' : 's'}
        </span>
        <span>{timeline.placed[timeline.placed.length - 1]?.dateLabel ?? '—'}</span>
      </div>
    </section>
  )
}
