/**
 * The wiki view — the same article and the same anchors, rendered for reading.
 *
 * This is the other half of "same data, two renderers". Pins don't disappear
 * when you leave the board; they become margin markers at the vertical position
 * of the words they hold, with a leader line back to the text. Clicking one
 * offers to show it on the board.
 *
 * It reuses the anchor layer verbatim — `projectDom`, `resolveAnchor`,
 * `flatRangeToDomRange` — which is the payoff of anchoring to text rather than
 * to board coordinates: the same pin resolves correctly in a completely
 * different layout, at a different width, with no board involved at all.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  flatRangeToDomRange,
  projectDom,
  rangeToContainerRects,
} from '../anchors/dom'
import { resolveAnchor } from '../anchors/resolve'
import type { TextAnchor } from '../anchors/types'
import { leaderPath, needsLeader, stackMarkers } from './layout'

export interface WikiPin {
  id: string
  anchor: TextAnchor
  dateLabel: string
}

export interface WikiViewProps {
  html: string
  pins: WikiPin[]
  /** Ids the chronology says are known at the current cursor. */
  activeIds: Set<string>
  /** False when every pin is live and nothing should be dimmed. */
  dimming: boolean
  fontsLoaded: boolean
  onShowOnBoard: (id: string) => void
}

interface MeasuredPin extends WikiPin {
  status: 'exact' | 'repaired' | 'orphaned'
  detail: string
  /** Vertical position of the anchored text, in article coordinates. */
  anchorY: number | null
  /** Right edge of the anchored text, so the leader starts at the words. */
  anchorX: number
}

export function WikiView({
  html,
  pins,
  activeIds,
  dimming,
  fontsLoaded,
  onShowOnBoard,
}: WikiViewProps) {
  const articleRef = useRef<HTMLDivElement>(null)
  const [measured, setMeasured] = useState<MeasuredPin[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)

  useLayoutEffect(() => {
    const element = articleRef.current
    if (!element || !fontsLoaded) return

    const projection = projectDom(element)

    setMeasured(
      pins.map((pin) => {
        const result = resolveAnchor(projection.flat.text, pin.anchor)

        if (result.status === 'orphaned') {
          return {
            ...pin,
            status: 'orphaned' as const,
            detail: 'the words it was pinned to are gone',
            anchorY: null,
            anchorX: 0,
          }
        }

        const range = flatRangeToDomRange(projection, result.start, result.end)
        const rects = range ? rangeToContainerRects(range, element) : []
        const last = rects[rects.length - 1] ?? null

        return {
          ...pin,
          status: result.status,
          detail:
            result.status === 'exact'
              ? 'unchanged'
              : `${result.reason.replace('-', ' ')} · ${Math.round(result.confidence * 100)}% context match`,
          // A range spanning several lines has one rect per line; the marker
          // belongs beside the last of them, which is where the pin visually
          // sits when you read down the page.
          anchorY: last ? last.y + last.height / 2 : null,
          anchorX: last ? last.x + last.width : 0,
        }
      }),
    )
  }, [html, pins, fontsLoaded])

  const placed = measured.filter((pin) => pin.anchorY !== null)

  // Markers cluster: three pins on one paragraph all want the same y. Push them
  // apart so every one stays reachable, and draw a leader for the ones that had
  // to move.
  const slots = useMemo(
    () => stackMarkers(placed.map((pin) => pin.anchorY as number), { minGap: 40, minY: 0 }),
    [placed],
  )

  const handleShow = useCallback(
    (id: string) => {
      setExpanded((current) => (current === id ? null : id))
      onShowOnBoard(id)
    },
    [onShowOnBoard],
  )

  const orphaned = measured.filter((pin) => pin.anchorY === null)

  return (
    <div className="parchment rounded-sm px-9 py-8 sm:px-12 sm:py-10">
      <div className="mx-auto flex max-w-[1180px] gap-6 sm:gap-10">
        {/* The article, at reading width */}
        <div
          ref={articleRef}
          className="article relative min-w-0 flex-1"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* The margin */}
        <aside className="relative hidden w-[300px] shrink-0 sm:block" aria-label="Notes in this article">
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            {placed.map((pin, index) => {
              const slot = slots[index]
              if (!slot || !needsLeader(slot)) return null
              const live = !dimming || activeIds.has(pin.id)
              return (
                <path
                  key={`leader-${pin.id}`}
                  d={leaderPath(slot.anchorY, slot.markerY, pin.anchorX, 0)}
                  fill="none"
                  stroke={live ? 'rgb(201 162 39 / 0.55)' : 'rgb(201 180 138 / 0.2)'}
                  strokeWidth={1}
                  className="transition-opacity duration-300"
                />
              )
            })}
          </svg>

          <div className="relative">
            {placed.map((pin, index) => {
              const slot = slots[index]
              if (!slot) return null
              const live = !dimming || activeIds.has(pin.id)
              const isExpanded = expanded === pin.id

              return (
                <div
                  key={pin.id}
                  className="absolute left-0 w-full transition-opacity duration-300"
                  style={{ top: slot.markerY, opacity: live ? 1 : 0.24 }}
                >
                  <button
                    type="button"
                    onClick={() => handleShow(pin.id)}
                    className={`-translate-y-1/2 rounded-sm border px-2.5 py-1.5 text-left text-xs transition ${
                      isExpanded
                        ? 'border-brass bg-cork-700/90 text-parchment-100'
                        : 'border-parchment-edge/40 bg-cork-700/60 text-parchment-200 hover:border-brass'
                    }`}
                    aria-expanded={isExpanded}
                  >
                    <span className="flex items-start gap-2">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{
                          background:
                            pin.status === 'orphaned'
                              ? 'var(--color-wax)'
                              : pin.status === 'repaired'
                                ? '#d98a2b'
                                : 'var(--color-brass)',
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block truncate italic">“{pin.anchor.quote}”</span>
                        <span className="mt-0.5 block text-[10px] text-parchment-300/60">
                          {pin.dateLabel}
                        </span>
                      </span>
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="mt-1 rounded-sm border border-parchment-edge/40 bg-parchment-100 p-2.5 text-[11px] leading-relaxed text-ink">
                      <p className="text-ink-soft">{pin.detail}</p>
                      <button
                        type="button"
                        onClick={() => onShowOnBoard(pin.id)}
                        className="mt-2 w-full rounded border border-brass/60 bg-parchment-200 px-2 py-1 text-[11px] font-medium text-ink transition hover:bg-parchment-300"
                      >
                        Show on the board
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </aside>
      </div>

      {orphaned.length > 0 && (
        <div className="mx-auto mt-8 max-w-[1180px] border-t border-parchment-edge/50 pt-4">
          <h3 className="text-xs font-semibold tracking-[0.14em] text-wax uppercase">
            Loose pins in this article
          </h3>
          <ul className="mt-2 flex flex-wrap gap-2">
            {orphaned.map((pin) => (
              <li
                key={pin.id}
                className="rounded border border-wax/40 bg-wax/5 px-2.5 py-1 text-xs text-ink-soft"
              >
                <span className="italic">“{pin.anchor.quote}”</span>
                <span className="ml-2 text-[10px] text-ink-soft/60">{pin.dateLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pins.length === 0 && (
        <p className="mx-auto mt-6 max-w-[1180px] text-center text-xs text-ink-soft/60">
          No notes in this article yet. Switch to the board and pin a word.
        </p>
      )}
    </div>
  )
}
