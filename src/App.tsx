import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { createAnchor } from './anchors/create'
import {
  domRangeToFlatRange,
  flatRangeToDomRange,
  projectDom,
  rangeToContainerRects,
  type AnchorRect,
  type DomProjection,
} from './anchors/dom'
import { resolveAnchor } from './anchors/resolve'
import { TopBar } from './app/TopBar'
import { useRoute } from './app/router'
import { BoardCanvas, type BoardContextTarget } from './board/BoardCanvas'
import { useBoardDrag } from './board/useBoardDrag'
import { ContextMenu, type ContextMenuEntry } from './board/ContextMenu'
import { GridLayer } from './board/GridLayer'
import { PaperEditor } from './board/PaperEditor'
import { PinTooltip, pinTooltipId } from './board/PinTooltip'
import { PinEditor } from './board/PinEditor'
import { TimelineRibbon } from './board/TimelineRibbon'
import {
  fitBounds,
  IDENTITY_CAMERA,
  rectsIntersect,
  screenToBoard,
  type Camera,
  type Rect,
} from './board/camera'
import { activeAt, buildTimeline, clusterTimeline, type TimelineEntry } from './board/timeline'
import {
  createSpring,
  distance,
  distanceToYarn,
  DEFAULT_SLACK,
  MAX_SAG_RATIO,
  MAX_SLACK,
  pointOnYarn,
  sagFor,
  slackForSag,
  stepSpring,
  yarnPath,
  YARN_COLOR,
  type Point,
} from './board/yarn'
import { maxStrandDeviation, seedFromKey, yarnStrands } from './board/yarn-style'
import { newAnchoredPin, newFreePin, newNote } from './model/create'
import { descriptorFor, NOTE_SIZE } from './model/kinds'
import {
  isAnchoredPin,
  isPin,
  type BoardEntity,
  type EntityContext,
  type NoteEntity,
  type StringLink,
} from './model/types'
import { PREFERENCES_PANEL_ID, PreferencesPanel } from './theme/PreferencesPanel'
import { usePreferences } from './theme/preferences'

const INITIAL_MARKDOWN = `# The Drowned Bell

**Session 12** — 3rd of Eleint, 1492 DR

The party returned to Saltmarsh with the bell they pulled from the
Sea Ghost. Molgar the Pale paid the ferryman in
silver and said nothing at all about the water.

## What we know

- The bell rings at low tide, though no hand touches it
- Three dockworkers have gone missing since the harvest festival
- The harbormaster's ledger lists a fourth name, scratched out

> "The tide keeps what it takes," the ferryman said.

The Black Coin came up twice: once from the ferryman,
and once in the ledger, in a hand nobody recognised.
`

const ARTICLE_TITLE = 'The Drowned Bell'
/**
 * The article the demo board renders.
 *
 * A fixed id rather than a generated one because there is exactly one article
 * and pins must be able to name it — an anchored pin stores `articleId`, and
 * that has to survive a reload once persistence lands.
 */
const ARTICLE_ID = 'the-drowned-bell'

const SNAP_RADIUS = 34
/**
 * How close a click must land to a string to select it, in screen px.
 *
 * Added to the fuzz's own reach: 'realistic' sprays filaments up to
 * `maxStrandDeviation()` either side of the base curve, so hit-testing the
 * curve alone would miss a click that plainly landed on visible wool.
 */
const STRING_HIT_PX = 10
/**
 * Width of the halo that marks a selected string, in screen px.
 *
 * Screen px, not board px: this is an affordance rather than part of the yarn,
 * so it has to stay legible at any zoom. Divided by zoom where it is drawn.
 */
const STRING_HALO_PX = 11
/** The bead's footprint in board px, and so how big a target it is to grab. */
const BEAD_SIZE = 20
/**
 * Slack is rounded to this many steps per unit on every change.
 *
 * Slack is interpolated raw into the yarn geometry cache key, so a continuous
 * drag would otherwise mint a fresh cache entry every frame and evict the
 * board's settled strings as it went. Three decimals is sub-pixel: at a 600px
 * gap one step moves the droop by under half a pixel.
 */
const SLACK_STEP = 1000
const PAPER_WIDTH = 720
/** Post-it footprint, shared by the renderer and by fit-bounds. */
const POST_IT_WIDTH = NOTE_SIZE.width

const CAMPAIGN_EPOCH = Date.UTC(2026, 0, 10)
const SESSION_GAP_MS = 14 * 24 * 60 * 60 * 1000
const FIRST_SESSION = 12

/** Post-it colours, keyed to the yarn palette so the board reads as one set. */
const POST_IT_COLORS = ['#e8d9a8', '#e6c9a8', '#d9c2b0', '#cfd6bd'] as const

interface PinView {
  id: string
  quote: string
  body: string
  /**
   * Manual offset from wherever the pin would otherwise sit, in board space.
   * An anchored pin's position is derived from the words it holds, so nudging
   * it is stored as a delta rather than by overwriting a position it does not
   * really have.
   */
  nudge: Point
  /** 'free' is a pin stuck straight into the board rather than into text. */
  status: 'exact' | 'repaired' | 'orphaned' | 'free'
  detail: string
  /** In-world date, shown in the hover card. */
  dateLabel: string
  /** Position within the paper, for a pin anchored to text. */
  rect: AnchorRect | null
  /** Position in board space, for a pin stuck into the board itself. */
  board: Point | null
}

/** A string with both ends resolved to board points, ready to draw or pick. */
interface DrawableString {
  id: string
  slack: number
  from: Point
  to: Point
}

function caretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }

  if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y)

  const position = doc.caretPositionFromPoint?.(x, y)
  if (!position) return null
  const range = document.createRange()
  range.setStart(position.offsetNode, position.offset)
  range.collapse(true)
  return range
}

function tackPoint(rect: AnchorRect): Point {
  return { x: rect.x + rect.width - 6 + 7, y: rect.y - 5 + 7 }
}

/**
 * The entity an element belongs to, if any.
 *
 * Hit-testing stays in the DOM — the canvas reports whatever element was under
 * the pointer and has no idea what the application calls it — so this is the one
 * place a node becomes an id. Being the only such place is what lets the drag
 * router, the context menu and the middle-drag all stop naming kinds.
 *
 * The older per-kind attributes are still honoured rather than renamed in one
 * go: they are load-bearing for a lot of tests, and a rename is a churn with no
 * behaviour behind it.
 */
function entityIdFromElement(element: Element): string | null {
  return (
    element.closest('[data-entity-id]')?.getAttribute('data-entity-id') ??
    element.closest('[data-pin-id]')?.getAttribute('data-pin-id') ??
    element.closest('[data-post-it-id]')?.getAttribute('data-post-it-id') ??
    null
  )
}

/**
 * A computed-style length as a number of px.
 *
 * jsdom has no layout engine and reports these as empty strings, so a bare
 * parseFloat would poison board coordinates with NaN and every string would
 * render as "M NaN NaN".
 */
function px(value: string): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Where a pin's tack sits in BOARD space.
 *
 * `paper` is the ARTICLE's corner, not the paper's — anchored rects are measured
 * against the article, which begins at the paper's content box. Callers pass
 * `paperOrigin`, which includes that padding; passing `paperPos` instead puts
 * every anchored tack off by the paper's padding, which is enough to stop a
 * dragged string from ever snapping to it. Free pins already are board
 * coordinates and ignore the argument. Returning null for an orphaned pin keeps
 * a string to something that no longer exists out of the render rather than
 * drawing it to the origin.
 */
function pinPoint(pin: PinView, paper: Point): Point | null {
  if (pin.rect) {
    const tack = tackPoint(pin.rect)
    return {
      x: paper.x + tack.x + pin.nudge.x,
      y: paper.y + tack.y + pin.nudge.y,
    }
  }
  if (pin.board) return { x: pin.board.x + pin.nudge.x, y: pin.board.y + pin.nudge.y }
  return null
}

export function App() {
  const { route } = useRoute()
  const preferences = usePreferences()

  // Board state lives above the route switch on purpose: navigating away and
  // back must not wipe the board.
  const [source, setSource] = useState(INITIAL_MARKDOWN)
  /**
   * Everything on the board, of every kind.
   *
   * One collection rather than one per kind: a pin, a note, an article and an
   * image are the same row to the database, differing by `kind`, and the
   * operations that matter — move, hit-test, select, frame — are the same for
   * all of them. The per-kind differences live in the descriptors in
   * `model/kinds.ts`, so a caller loops over entities once instead of looping
   * over a collection per kind and remembering what each one can do.
   */
  const [entities, setEntities] = useState<BoardEntity[]>([])
  const [pins, setPins] = useState<PinView[]>([])
  const [strings, setStrings] = useState<StringLink[]>([])

  // Memoised, not filtered inline: these feed useCallback and effect dependency
  // lists, and a fresh array every render would re-run the anchor projection —
  // which sets state, so the board would re-resolve in a loop.
  /** Pins of both kinds: the entities that wear a tack. */
  const placed = useMemo(() => entities.filter(isPin), [entities])
  /** Loose notes on the cork. */
  const postIts = useMemo(
    () => entities.filter((entity): entity is NoteEntity => entity.kind === 'note'),
    [entities],
  )

  const [dragFrom, setDragFrom] = useState<string | null>(null)
  const [fontsLoaded, setFontsLoaded] = useState(() => !globalThis.document?.fonts)
  const [cursor, setCursor] = useState(CAMPAIGN_EPOCH)
  const [playing, setPlaying] = useState(false)
  const [camera, setCamera] = useState<Camera>(IDENTITY_CAMERA)
  const [editingPin, setEditingPin] = useState<{ id: string; x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<
    (BoardContextTarget & { board: Point }) | null
  >(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [paperRect, setPaperRect] = useState<Rect | null>(null)
  /** The editor only appears once a document has been selected. */
  const [documentSelected, setDocumentSelected] = useState(false)
  /**
   * Pin mode inverts the gesture: with it on, a plain left-click places a pin.
   * Off by default, because a board you can accidentally pin while trying to
   * select something is a board you stop trusting.
   */
  const [pinMode, setPinMode] = useState(false)
  /**
   * Ids of selected objects. Only things that can move are selectable — a pin
   * anchored to a word has no position of its own to drag.
   */
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  /** The pin currently being repositioned, or null. A mode, not a permanent tool. */
  const [movingPin, setMovingPin] = useState<string | null>(null)
  /** The pin under the pointer, and the element the hover card anchors to. */
  const [hovered, setHovered] = useState<{ id: string; element: Element } | null>(null)
  /** Where the article sits in board space. Its own position, like any object. */
  const [paperPos, setPaperPos] = useState<Point>({ x: 0, y: 0 })
  const paperPosRef = useRef(paperPos)
  paperPosRef.current = paperPos

  /**
   * The paper's own padding, i.e. the offset from the paper's top-left corner
   * to the article inside it.
   *
   * Anchor rects are measured against the article, and the tacks are drawn in an
   * `inset-0` overlay over that same article — so both are in article space,
   * while `paperPos` is the *paper's* corner. Anything converting an anchor rect
   * into board space has to cross that gap. Leaving it out put every anchored
   * tack 48x40 board px away from where it is drawn, which is further than
   * SNAP_RADIUS: a string could be started but never dropped onto a pin, so no
   * string was ever created and no yarn ever appeared.
   */
  const [paperInset, setPaperInset] = useState<Point>({ x: 0, y: 0 })
  /** The article's corner in board space — paperPos plus that inset. */
  const paperOrigin = { x: paperPos.x + paperInset.x, y: paperPos.y + paperInset.y }
  const paperOriginRef = useRef(paperOrigin)
  paperOriginRef.current = paperOrigin

  /**
   * What a descriptor cannot know on its own.
   *
   * An anchored entity's place is not on the entity — it is wherever its quote
   * resolved to, which only the projection effect knows. Passing that in keeps
   * the descriptors pure and keeps the anchor ladder where it belongs.
   */
  const entityContext = useMemo<EntityContext>(
    () => ({
      articleOrigin: () => paperOriginRef.current,
      anchorRect: (id) => pins.find((pin) => pin.id === id)?.rect ?? null,
      articleSize: () =>
        paperRect && paperRect.width > 0
          ? { width: paperRect.width, height: paperRect.height }
          : null,
    }),
    [pins, paperRect, paperOrigin.x, paperOrigin.y],
  )
  const entityContextRef = useRef(entityContext)
  entityContextRef.current = entityContext

  const articleRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const livePathRef = useRef<SVGPathElement>(null)
  const projectionRef = useRef<DomProjection | null>(null)

  const springRef = useRef({ x: createSpring(0), y: createSpring(0) })
  const targetRef = useRef<Point>({ x: 0, y: 0 })
  const originRef = useRef<Point | null>(null)
  const frameRef = useRef<number>(0)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const dragFromRef = useRef(dragFrom)
  dragFromRef.current = dragFrom
  const pinsRef = useRef(pins)
  pinsRef.current = pins
  // Assigned where the strings are resolved, far below. Declared up here because
  // the pointer handlers that pick a string are defined before that, and a ref
  // is what lets them read the latest resolution without depending on it.
  const drawableStringsRef = useRef<DrawableString[]>([])

  // Sanitized before it reaches the DOM: the article is markdown the user can
  // edit, so it is untrusted input like any other.
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(source, { async: false })),
    [source],
  )

  useEffect(() => {
    if (!document.fonts) return
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (!cancelled) setFontsLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useLayoutEffect(() => {
    const paper = paperRef.current
    if (!paper || !fontsLoaded) return

    const measure = (): void => {
      const width = paper.offsetWidth
      const height = paper.offsetHeight
      // Read rather than assumed: the padding is responsive (px-9/py-8 flips to
      // sm:px-12/sm:py-10), so a hardcoded 48x40 would be wrong below the
      // breakpoint. Bail out on an unchanged value so panning, which re-runs
      // this effect, does not re-render on every frame.
      const style = getComputedStyle(paper)
      const insetX = px(style.paddingLeft) + px(style.borderLeftWidth)
      const insetY = px(style.paddingTop) + px(style.borderTopWidth)
      setPaperInset((previous) =>
        previous.x === insetX && previous.y === insetY ? previous : { x: insetX, y: insetY },
      )
      // In board space, and offset by wherever the paper has been dragged to —
      // otherwise "zoom to fit" frames where the paper used to be.
      if (width > 0 && height > 0) {
        setPaperRect({ x: paperPosRef.current.x, y: paperPosRef.current.y, width, height })
      }
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(paper)
    return () => observer.disconnect()
  }, [fontsLoaded, paperPos])

  useLayoutEffect(() => {
    const element = articleRef.current
    if (!element || !fontsLoaded) return

    const projection = projectDom(element)
    projectionRef.current = projection

    setPins(
      placed.map((item) => {
        const base = {
          id: item.id,
          body: item.bodyMd,
          dateLabel: item.dateLabel ?? '',
          nudge: item.nudge,
        }

        // A pin stuck into the board has no quote to resolve; its position is
        // simply its position.
        if (!isAnchoredPin(item)) {
          return {
            ...base,
            quote: '',
            status: 'free' as const,
            detail: 'loose on the board',
            rect: null,
            board: item.board,
          }
        }

        const result = resolveAnchor(projection.flat.text, item.anchor)

        if (result.status === 'orphaned') {
          return {
            ...base,
            quote: item.anchor.quote,
            status: 'orphaned' as const,
            detail:
              result.reason === 'empty-quote'
                ? 'no text to anchor to'
                : 'the words it was pinned to are gone',
            rect: null,
            board: null,
          }
        }

        const range = flatRangeToDomRange(projection, result.start, result.end)
        const rects = range ? rangeToContainerRects(range, element) : []
        const first = rects[0] ?? null

        if (result.status === 'exact') {
          return {
            ...base,
            quote: item.anchor.quote,
            status: 'exact' as const,
            detail: 'unchanged',
            rect: first,
            board: null,
          }
        }

        return {
          ...base,
          quote: item.anchor.quote,
          status: 'repaired' as const,
          detail: `${result.reason.replace('-', ' ')} · ${Math.round(result.confidence * 100)}% context match`,
          rect: first,
          board: null,
        }
      }),
    )
  }, [html, placed, fontsLoaded])

  const nextDateLabel = useCallback(
    (index: number) => `Session ${FIRST_SESSION + index}, 1492 DR`,
    [],
  )



  /** Stick a pin straight into the board, at a point in board space. */
  const createFreePin = useCallback(
    (board: Point) => {
      setEntities((previous) => [
        ...previous,
        newFreePin(board, {
          occurredAt: CAMPAIGN_EPOCH + previous.filter(isPin).length * SESSION_GAP_MS,
          dateLabel: nextDateLabel(previous.filter(isPin).length),
        }),
      ])
    },
    [nextDateLabel],
  )

  /** Viewport coordinates -> board coordinates. */
  const worldPoint = useCallback((clientX: number, clientY: number): Point => {
    const box = document.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return screenToBoard(cameraRef.current, { x: clientX - box.left, y: clientY - box.top })
  }, [])

  /**
   * Place a pin at a screen position — the single pin gesture.
   *
   * Where it lands decides what kind of pin it is: over the article it anchors
   * to the word under the cursor, and anywhere else it is stuck into the board.
   * Both outcomes are a pin, so both callers (ctrl-click anywhere, and the
   * context menu's "Add pin") go through here rather than each deciding.
   *
   * It used to bail silently when the caret was not inside the article, which
   * made right-clicking bare board and choosing "Add pin" do nothing at all.
   */
  const pinAt = useCallback(
    (clientX: number, clientY: number) => {
      const projection = projectionRef.current
      const element = articleRef.current

      const range = element ? caretRangeFromPoint(clientX, clientY) : null
      if (projection && element && range && element.contains(range.startContainer)) {
        const flatRange = domRangeToFlatRange(projection, range)
        const anchor = flatRange
          ? createAnchor(projection.flat.text, flatRange.start, flatRange.end)
          : null

        if (anchor?.quote) {
          setEntities((previous) => [
            ...previous,
            newAnchoredPin(ARTICLE_ID, anchor, {
              occurredAt: CAMPAIGN_EPOCH + previous.filter(isPin).length * SESSION_GAP_MS,
              dateLabel: nextDateLabel(previous.filter(isPin).length),
            }),
          ])
          return
        }
      }

      // Not over readable text — the caret is in a gap, or on bare cork.
      createFreePin(worldPoint(clientX, clientY))
    },
    [createFreePin, nextDateLabel, worldPoint],
  )

  /**
   * The string under a board-space point, if any.
   *
   * Yarn stays `pointer-events-none`. It is painted over everything, so making
   * it hit-testable through the DOM would swallow clicks meant for the pins and
   * notes underneath it — the reason it was made non-interactive in the first
   * place. Asking the geometry instead answers "is this click on the string?"
   * against the same curve the eye sees, and leaves the layering alone.
   */
  const stringAt = useCallback((boardPoint: Point): string | null => {
    // Constant on screen: a string should be no easier to hit at 400% than at
    // 40%. The fuzz's own reach counts too — 'realistic' sprays filaments
    // either side of the base curve, and a click on visible wool is a hit.
    const zoom = cameraRef.current.zoom || 1
    const tolerance = (maxStrandDeviation() + STRING_HIT_PX) / zoom
    let best: { id: string; distance: number } | null = null

    for (const string of drawableStringsRef.current) {
      const { distance: away } = distanceToYarn(string.from, string.to, boardPoint, string.slack)
      if (away <= tolerance && (!best || away < best.distance)) {
        best = { id: string.id, distance: away }
      }
    }

    return best?.id ?? null
  }, [])

  const handleBackgroundClick = useCallback(
    ({ point, ctrlKey, metaKey }: { point: Point; ctrlKey: boolean; metaKey: boolean }) => {
      // Ctrl (or Cmd, since Ctrl-click is the context menu on macOS) is the
      // gesture that always places a pin; pin mode is what lets you drop the
      // modifier. Anything else on bare board is not a pin.
      // A click on bare cork finishes any reposition in progress, before it
      // means anything else.
      if (movingPin) {
        setMovingPin(null)
        return
      }

      // The canvas reports viewport coordinates; everything below wants board
      // ones.
      const board = screenToBoard(cameraRef.current, point)

      if (!pinMode && !ctrlKey && !metaKey) {
        // A string lies on the bare board as much as on the paper, and it is
        // the only thing a plain click there does not already mean.
        const string = stringAt(board)
        if (string) {
          setSelection(new Set([string]))
          return
        }
        // A plain click on bare cork is a deselect, which is what every canvas
        // does and what people reach for without thinking.
        setSelection(new Set())
        return
      }
      // pinAt wants screen coordinates and converts itself. Undo the canvas's
      // local offset.
      const box = document.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect()
      if (!box) return
      pinAt(point.x + box.left, point.y + box.top)
    },
    [pinAt, pinMode, movingPin, stringAt],
  )

  const handleArticleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!pinMode && !event.ctrlKey && !event.metaKey) {
        // A string drawn across the paper lands here rather than on the canvas,
        // because the article is what the click actually hits. Same pick, other
        // entry point — otherwise strings would only be selectable on cork.
        const string = stringAt(worldPoint(event.clientX, event.clientY))
        if (string) setSelection(new Set([string]))
        return
      }
      pinAt(event.clientX, event.clientY)
    },
    [pinAt, pinMode, stringAt, worldPoint],
  )

  const runClock = useCallback(() => {
    const origin = originRef.current
    const path = livePathRef.current
    if (!origin || !path) return

    const spring = springRef.current
    stepSpring(spring.x, targetRef.current.x, 1 / 60)
    stepSpring(spring.y, targetRef.current.y, 1 / 60)
    path.setAttribute(
      'd',
      yarnPath(origin, { x: spring.x.value, y: spring.y.value }, DEFAULT_SLACK),
    )
    frameRef.current = requestAnimationFrame(runClock)
  }, [])

  const beginString = useCallback(
    (event: React.PointerEvent, pin: PinView) => {
      // Left button only. Stopping propagation on every button swallowed the
      // right-click before the canvas ever saw it, which is why right-clicking
      // a pin did nothing — the button that opens its editor was being eaten
      // here.
      if (event.button !== 0) return

      event.stopPropagation()
      event.preventDefault()

      // Board space, matching what moveString computes. This was paper-local
      // while the target was board-space, so the live string was drawn from
      // near the board origin instead of from the tack.
      const origin = pinPoint(pin, paperOriginRef.current)
      if (!origin) return

      originRef.current = origin
      targetRef.current = origin
      springRef.current = { x: createSpring(origin.x, 220, 22), y: createSpring(origin.y, 220, 22) }
      setDragFrom(pin.id)
      frameRef.current = requestAnimationFrame(runClock)
    },
    [runClock],
  )

  /**
   * Complete a string drag at a screen position.
   *
   * Takes coordinates rather than an event because it is driven from window
   * listeners, which fire wherever the pointer happens to be.
   */
  const finishString = useCallback(
    (clientX: number, clientY: number) => {
      const from = dragFromRef.current
      if (!from) return

      const drop = worldPoint(clientX, clientY)

      let nearest: { id: string; distance: number } | null = null
      for (const pin of pinsRef.current) {
        if (pin.id === from) continue
        const point = pinPoint(pin, paperOriginRef.current)
        if (!point) continue
        const distance = Math.hypot(point.x - drop.x, point.y - drop.y)
        if (distance <= SNAP_RADIUS && (!nearest || distance < nearest.distance)) {
          nearest = { id: pin.id, distance }
        }
      }

      if (nearest) {
        const to = nearest.id
        setStrings((previous) => {
          const exists = previous.some(
            (s) => (s.from === from && s.to === to) || (s.from === to && s.to === from),
          )
          if (exists) return previous
          return [
            ...previous,
            {
              id: crypto.randomUUID(),
              from,
              to,
              slack: DEFAULT_SLACK,
              color: YARN_COLOR,
              style: 'solid' as const,
              visibility: 'shared' as const,
            },
          ]
        })
      }

      cancelAnimationFrame(frameRef.current)
      originRef.current = null
      dragFromRef.current = null
      setDragFrom(null)
    },
    [worldPoint],
  )

  /**
   * The string drag runs on WINDOW, not on the board or the article.
   *
   * It used to hang off the article's own wrapper, which meant a drag only
   * tracked while the pointer stayed inside the paper — so a string between two
   * pins stuck in the cork never completed at all, and even a pin-to-pin drag
   * was abandoned the moment the pointer crossed the paper's edge.
   */
  useEffect(() => {
    if (!dragFrom) return

    const onMove = (event: PointerEvent): void => {
      targetRef.current = worldPoint(event.clientX, event.clientY)
    }
    const onUp = (event: PointerEvent): void => finishString(event.clientX, event.clientY)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragFrom, worldPoint, finishString])

  useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  // Repositioning is a mode, so it needs an exit that does not require finding
  // the pin again. Escape is the one people reach for.
  useEffect(() => {
    if (!movingPin) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMovingPin(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [movingPin])

  /** Right-click: a pin opens its editor, bare board opens the context menu. */
  /**
   * Turn a rubber band into a selection.
   *
   * The band arrives in viewport coordinates and the objects live in board
   * space, so both the origin and the size have to be converted — dividing only
   * the origin would make the band select the right thing at 100% and the wrong
   * thing at every other zoom.
   */
  const handleMarquee = useCallback(
    (rect: Rect | null) => {
      if (!rect) return

      const zoom = cameraRef.current.zoom || 1
      const origin = screenToBoard(cameraRef.current, { x: rect.x, y: rect.y })
      const band: Rect = {
        x: origin.x,
        y: origin.y,
        width: rect.width / zoom,
        height: rect.height / zoom,
      }

      const hits = new Set<string>()

      // One pass for every kind. Each descriptor answers for its own shape and
      // for whether a band may pick it up at all — a tack in a word has nothing
      // on the board to enclose.
      for (const entity of entities) {
        const descriptor = descriptorFor(entity)
        if (!descriptor.capabilities(entity).marqueeSelectable) continue
        const box = descriptor.bounds(entity, entityContextRef.current)
        if (box && rectsIntersect(band, box)) hits.add(entity.id)
      }

      setSelection(hits)
    },
    [entities],
  )

  /** Move everything selected by a board-space delta. */
  const moveSelection = useCallback((delta: Point) => {
    setEntities((previous) =>
      previous.map((entity) => {
        if (!selection.has(entity.id)) return entity
        const descriptor = descriptorFor(entity)
        // An anchored pin, if one were ever selected, stores the shift against
        // its words rather than moving — the descriptor decides that, not us.
        return descriptor.capabilities(entity).movable ? descriptor.move(entity, delta) : entity
      }),
    )
  }, [selection])

  /**
   * Frame everything on the board, not just the document.
   *
   * Pins stuck into the cork and post-its laid beside the paper are the whole
   * point of a board — fitting to the document alone would deliberately hide
   * the things you pinned around it.
   */
  const fitBoard = useCallback(() => {
    const canvas = document.querySelector('[data-testid="board-canvas"]')
    const box = canvas?.getBoundingClientRect()
    if (!box || box.width === 0) return

    const targets: Rect[] = []
    if (paperRect) targets.push(paperRect)

    for (const entity of entities) {
      const descriptor = descriptorFor(entity)
      const box =
        descriptor.frameBounds?.(entity, entityContextRef.current) ??
        descriptor.bounds(entity, entityContextRef.current)
      if (box) targets.push(box)
    }

    if (targets.length === 0) return
    const fitted = fitBounds(targets, { width: box.width, height: box.height }, 56)
    if (fitted) setCamera(fitted)
  }, [entities, paperRect])

  const handleContextTarget = useCallback((target: BoardContextTarget) => {
    const element = target.target instanceof Element ? target.target : null
    const pinId = element?.closest('[data-pin-id]')?.getAttribute('data-pin-id')

    if (pinId) {
      setEditingPin({ id: pinId, x: target.clientX, y: target.clientY })
      return
    }

    const canvas = document.querySelector('[data-testid="board-canvas"]')
    const box = canvas?.getBoundingClientRect()
    const viewportPoint = box
      ? { x: target.clientX - box.left, y: target.clientY - box.top }
      : { x: 0, y: 0 }

    setContextMenu({
      ...target,
      board: screenToBoard(cameraRef.current, viewportPoint),
    })
  }, [])

  const createPostIt = useCallback(
    (point: Point) => {
      setEntities((previous) => [
        ...previous,
        newNote(point, {
          color: POST_IT_COLORS[previous.length % POST_IT_COLORS.length],
          dateLabel: nextDateLabel(previous.length),
        }),
      ])
    },
    [nextDateLabel],
  )

  // Tap toggles the editor, drag moves the sheet. Without the tap handler the
  // tab would be a handle you could only drag, never click.
  const paperDrag = useBoardDrag({
    zoom: camera.zoom,
    onDrag: (delta) =>
      setPaperPos((previous) => ({ x: previous.x + delta.x, y: previous.y + delta.y })),
    onTap: () => setDocumentSelected((previous) => !previous),
  })

  /**
   * Move one entity by a board-space delta, ignoring the selection.
   *
   * How a kind moves is the descriptor's business: a free pin and a note shift
   * their own position, while an anchored pin stores the delta as an offset
   * against the words it holds — which is what makes its move temporary, since
   * it still belongs to its quote and will follow it through edits.
   */
  const moveOne = useCallback((id: string, delta: Point) => {
    setEntities((previous) =>
      previous.map((entity) => {
        if (entity.id !== id) return entity
        const descriptor = descriptorFor(entity)
        return descriptor.capabilities(entity).movable ? descriptor.move(entity, delta) : entity
      }),
    )
  }, [])

  /**
   * Drag one entity.
   *
   * Dragging one of several selected objects moves the whole set; dragging an
   * unselected one moves only it. Same rule for every kind, because the rule is
   * about selection rather than about what was grabbed.
   */
  const moveEntity = useCallback(
    (id: string, delta: Point) => {
      if (selection.has(id)) {
        moveSelection(delta)
        return
      }
      moveOne(id, delta)
    },
    [moveOne, moveSelection, selection],
  )

  /**
   * Middle-drag on a thing moves that thing.
   *
   * Which thing is settled by the DOM, the way the context menu already does it:
   * the canvas hands back whatever was under the press and this resolves it
   * innermost-first. A tack is drawn inside the paper's wrapper, so testing the
   * pin before the article is what makes dragging a pin move the pin rather than
   * the sheet it is stuck through.
   *
   * Both kinds of pin and post-its route through their own move functions, so an
   * anchored pin still stores the shift as a nudge against its words and a
   * selected post-it still takes its neighbours with it.
   */
  const handleEntityDrag = useCallback(
    (element: Element, delta: Point) => {
      const id = entityIdFromElement(element)
      if (id) {
        moveEntity(id, delta)
        return
      }

      // The article is not an entity yet — it is still a singleton with its own
      // paper position — so it keeps its own branch until it joins the others.
      if (element.closest('[data-board-entity="article"]')) {
        setPaperPos((previous) => ({ x: previous.x + delta.x, y: previous.y + delta.y }))
      }
    },
    [moveEntity],
  )

  /**
   * Drop the hover card whenever the camera moves.
   *
   * The card measures where its pin is on screen when it appears, and a zoom or
   * pan relocates every pin without firing a scroll event — the one thing the
   * card listens for. Left alone it would sit where the pin used to be, pointing
   * at nothing. Clearing is cheap: the pointer re-enters the tack and the card
   * comes straight back, correctly placed.
   */
  useEffect(() => {
    setHovered(null)
  }, [camera])

  const handlePinHover = useCallback((pin: PinView, element: Element | null) => {
    setHovered(element ? { id: pin.id, element } : null)
  }, [])

  /** Rewrite one entity's body. Shared by kinds — a body is a body. */
  const setEntityBody = useCallback((id: string, bodyMd: string) => {
    setEntities((previous) =>
      previous.map((entity) =>
        entity.id === id ? { ...entity, bodyMd, updatedAt: Date.now() } : entity,
      ),
    )
  }, [])

  /** Take an entity off the board, and every string that touched it with it. */
  const removeEntity = useCallback((id: string) => {
    setEntities((previous) => previous.filter((entity) => entity.id !== id))
    setStrings((previous) => previous.filter((s) => s.from !== id && s.to !== id))
    setEditingPin(null)
  }, [])

  const clearBoard = useCallback(() => {
    setEntities([])
    setStrings([])
    setEditingPin(null)
    setContextMenu(null)
  }, [])

  const timeline = useMemo(
    () =>
      buildTimeline([
        ...placed.map(
          (item): TimelineEntry => ({
            id: item.id,
            // A pin is dated when it is placed; the columns are nullable for
            // entities that inherit a date from their group instead.
            occurredAt: item.occurredAt ?? null,
            dateLabel: item.dateLabel ?? null,
          }),
        ),
      ]),
    [placed],
  )
  const clusters = useMemo(() => clusterTimeline(timeline), [timeline])
  const activeIds = useMemo(() => new Set(activeAt(timeline, cursor)), [timeline, cursor])

  useEffect(() => {
    if (!playing) return
    if (clusters.length === 0) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => {
      const next = clusters.find((cluster) => cluster.start > cursor)
      if (!next) {
        setPlaying(false)
        return
      }
      setCursor(next.start)
    }, 1200)
    return () => clearTimeout(timer)
  }, [playing, cursor, clusters])

  const togglePlay = useCallback(() => {
    if (!playing && clusters.length > 0) {
      const last = clusters[clusters.length - 1]
      if (cursor >= last.start) setCursor(clusters[0].start)
    }
    setPlaying((previous) => !previous)
  }, [playing, cursor, clusters])

  const byId = useMemo(() => new Map(pins.map((pin) => [pin.id, pin])), [pins])
  const dimming = placed.length > 0

  const drawableStrings = strings.flatMap((string) => {
    const from = byId.get(string.from)
    const to = byId.get(string.to)
    if (!from || !to) return []

    const fromPoint = pinPoint(from, paperOrigin)
    const toPoint = pinPoint(to, paperOrigin)
    if (!fromPoint || !toPoint) return []

    return [
      {
        id: string.id,
        slack: string.slack,
        from: fromPoint,
        to: toPoint,
      },
    ]
  })

  drawableStringsRef.current = drawableStrings

  // The selection is a single untyped set shared with pins and post-its, so a
  // string is "selected" only if one of these ids is in it.
  const selectedString = drawableStrings.find((string) => selection.has(string.id)) ?? null

  /**
   * The string under the pointer.
   *
   * Yarn is the one thing on the board you cannot discover by pointing at it:
   * it is drawn `pointer-events-none` so it never steals a click from a pin,
   * which also means the browser gives it no hover state of its own. Probing
   * the geometry on every move is what buys back the affordance — a string that
   * lights up under the cursor is a string you know you can click.
   */
  const [hoveredString, setHoveredString] = useState<string | null>(null)
  const handleCanvasHover = useCallback(
    (point: Point | null) => {
      setHoveredString(point ? stringAt(screenToBoard(cameraRef.current, point)) : null)
    },
    [stringAt],
  )

  /**
   * The string under a board-space point, if any.
   *
   * Yarn stays `pointer-events-none`. It is painted over everything, so making
   * it hit-testable through the DOM would swallow clicks meant for the pins and
   * notes underneath it — the reason it was made non-interactive in the first
   * place. Asking the geometry instead answers "is this click on the string?"
   * against the same curve the eye sees, and leaves the layering alone.
   */
  /**
   * Droop a string further, or take up its rope, by `dy` board px.
   *
   * The dragged point is the curve's lowest — `pointOnYarn(…, 0.5)` — which sits
   * at half the control offset, so one pixel of pointer travel is two of sag.
   * Inverting `sagFor` (rather than nudging slack) is what makes the string
   * track the hand: sag grows as the square root of slack, so a linear nudge
   * would crawl when taut and lurch when loose.
   *
   * The clamp is applied to the SAG. Past `MAX_SAG_RATIO` the droop is pinned,
   * so letting slack keep climbing would store a number that no longer
   * described the string — and would only unwind on the way back down.
   */
  const dragStringSag = useCallback((id: string, dy: number) => {
    setStrings((previous) =>
      previous.map((string) => {
        if (string.id !== id) return string
        const drawn = drawableStringsRef.current.find((item) => item.id === id)
        if (!drawn) return string

        const gap = distance(drawn.from, drawn.to)
        if (gap <= 0) return string

        const sag = Math.min(Math.max(sagFor(gap, string.slack) + dy * 2, 0), gap * MAX_SAG_RATIO)
        // Rounded because slack is interpolated raw into the yarn geometry
        // cache key: a continuous drag would otherwise mint a fresh entry every
        // frame and evict the board's settled strings as it went.
        const slack = Math.round(Math.min(MAX_SLACK, slackForSag(gap, sag)) * SLACK_STEP) / SLACK_STEP
        return slack === string.slack ? string : { ...string, slack }
      }),
    )
  }, [])

  const removeString = useCallback((id: string) => {
    setStrings((previous) => previous.filter((string) => string.id !== id))
    setSelection((previous) => new Set([...previous].filter((selected) => selected !== id)))
  }, [])

  /**
   * Delete takes the selected string off the board; Escape lets go of it.
   *
   * This is the first keyboard deletion in the app, so it is deliberate about
   * where it may fire. Not while a field has focus — the article is selectable
   * text, a post-it is a textarea and the pin editor is full of inputs, and
   * Backspace in any of them is someone editing, not deleting. And not while a
   * card is open, where Escape already means "close me".
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }
      if (editingPin || contextMenu || prefsOpen || movingPin) return

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selectedString) return
        event.preventDefault()
        removeString(selectedString.id)
        return
      }
      if (event.key === 'Escape' && selection.size > 0) setSelection(new Set())
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [contextMenu, editingPin, movingPin, prefsOpen, removeString, selectedString, selection])

  const anchored = pins.filter((pin) => pin.rect)
  const freePins = pins.filter((pin) => pin.board)
  const orphaned = pins.filter((pin) => pin.status === 'orphaned')
  const repaired = pins.filter((pin) => pin.status === 'repaired').length
  const activePin = editingPin ? byId.get(editingPin.id) : null

  const contextItems: ContextMenuEntry[] = contextMenu
    ? [
        {
          id: 'post-it',
          label: 'Create post-it',
          hint: 'A loose note on the board',
          onSelect: () => createPostIt(contextMenu.board),
        },
        {
          id: 'pin',
          label: 'Add pin',
          hint: 'Pin a note to the text under the cursor',
          onSelect: () => pinAt(contextMenu.clientX, contextMenu.clientY),
        },
        { id: 'sep-1', separator: true },
        {
          id: 'fit',
          label: 'Zoom to fit',
          hint: 'Frame everything on the board',
          disabled: !paperRect,
          onSelect: fitBoard,
        },
        {
          id: 'prefs',
          label: 'Preferences…',
          onSelect: () => setPrefsOpen(true),
        },
      ]
    : []

  return (
    <div className="app-shell flex h-screen flex-col overflow-hidden">
      <TopBar
        onOpenPreferences={() => setPrefsOpen(true)}
        preferencesOpen={prefsOpen}
        preferencesPanelId={PREFERENCES_PANEL_ID}
      >
        {route.name === 'board' && (
          <>
            <button
              type="button"
              onClick={() => setPinMode((previous) => !previous)}
              aria-pressed={pinMode}
              aria-label="Pin mode"
              title={
                pinMode
                  ? 'Pin mode on — click anywhere to place a pin'
                  : 'Pin mode off — ctrl-click to place a pin'
              }
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition ${
                pinMode
                  ? 'border-brass bg-brass/25 text-board-ink'
                  : 'border-brass/40 bg-cork-700/70 text-board-ink-soft hover:border-brass'
              }`}
            >
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: pinMode ? 'var(--color-brass)' : 'currentColor' }}
              />
              Pin<span className="hidden sm:inline">&nbsp;mode</span>
            </button>
          </>
        )}
      </TopBar>

      <main className="relative flex min-h-0 flex-1">
        <>
          {documentSelected && (
              <PaperEditor
                title={ARTICLE_TITLE}
                value={source}
                onChange={setSource}
                onClose={() => setDocumentSelected(false)}
              />
            )}

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <BoardCanvas
                onEntityDrag={handleEntityDrag}
                onHover={handleCanvasHover}
                // A string is clickable, and the cursor is the only place the
                // board can say so without covering it in chrome.
                idleCursor={hoveredString ? 'pointer' : 'default'}
                camera={camera}
                onCameraChange={setCamera}
                onContextTarget={handleContextTarget}
                onBackgroundClick={handleBackgroundClick}
                // Pin mode claims the left button for pinning, so the rubber
                // band stands down rather than fighting it for the same drag.
                onMarquee={pinMode ? undefined : handleMarquee}
                pinMode={pinMode}
                className="min-h-0 flex-1"
                fitTo={paperRect ? [paperRect] : undefined}
                backdrop={(viewport) => (
                  <GridLayer camera={camera} viewport={viewport} />
                )}
              >

                <div
                  ref={paperRef}
                  data-testid="paper"
                  data-board-entity="article"
                  className={`parchment absolute top-0 left-0 rounded-sm px-9 py-8 shadow-xl sm:px-12 sm:py-10 ${
                    documentSelected ? 'ring-2 ring-brass/70' : ''
                  }`}
                  style={{
                    width: PAPER_WIDTH,
                    transform: `translate3d(${paperPos.x}px, ${paperPos.y}px, 0)`,
                  }}
                >
                  {/* The tab is the selection affordance. Clicking the body of
                      the paper pins a note; clicking the tab selects the
                      document and opens the editor. Two gestures, one sheet. */}
                  <button
                    type="button"
                    data-testid="paper-tab"
                    {...paperDrag}
                    aria-pressed={documentSelected}
                    className={`drag-bar absolute -top-7 left-0 rounded-t px-3 py-1 text-[11px] transition ${
                      documentSelected
                        ? 'bg-brass/80 text-cork-900'
                        : 'bg-parchment-200/85 text-ink-soft hover:bg-parchment-200'
                    }`}
                    title="Click to edit, drag to move"
                  >
                    {documentSelected ? '▾ ' : '▸ '}
                    {ARTICLE_TITLE}
                  </button>

                  <div className="relative">
                    <div
                      ref={articleRef}
                      onClick={handleArticleClick}
                      className="article relative cursor-text select-text"
                      dangerouslySetInnerHTML={{ __html: html }}
                    />

                    <div ref={overlayRef} className="pointer-events-none absolute inset-0">

                      {anchored.map((pin) =>
                        pin.rect ? (
                          <div
                            key={`mark-${pin.id}`}
                            className="anchor-mark absolute transition-opacity duration-300"
                            data-status={pin.status}
                            style={{
                              left: pin.rect.x,
                              top: pin.rect.y,
                              width: pin.rect.width,
                              height: pin.rect.height,
                              opacity: !dimming || activeIds.has(pin.id) ? 1 : 0.16,
                            }}
                          />
                        ) : null,
                      )}

                      {anchored.map((pin) =>
                        pin.rect ? (
                          <Tack
                            key={`tack-${pin.id}`}
                            pin={pin}
                            x={pin.rect.x + pin.rect.width - 6 + pin.nudge.x}
                            y={pin.rect.y - 5 + pin.nudge.y}
                            selected={selection.has(pin.id)}
                            dimmed={dimming && !activeIds.has(pin.id)}
                            moving={movingPin === pin.id}
                            zoom={camera.zoom}
                            onStartYarn={(event) => beginString(event, pin)}
                            onMove={moveOne}
                            onHover={handlePinHover}
                          />
                        ) : null,
                      )}
                    </div>
                  </div>
                </div>

                {/* Pins stuck into the cork rather than into text. Same object
                    as an anchored pin, different location — which is why they
                    share the note editor and the yarn. */}
                {freePins.map((pin) =>
                  pin.board ? (
                    <Tack
                      key={`free-${pin.id}`}
                      pin={pin}
                      x={pin.board.x - 7 + pin.nudge.x}
                      y={pin.board.y - 7 + pin.nudge.y}
                      selected={selection.has(pin.id)}
                      dimmed={dimming && !activeIds.has(pin.id)}
                      moving={movingPin === pin.id}
                      zoom={camera.zoom}
                      onStartYarn={(event) => beginString(event, pin)}
                      onMove={moveOne}
                      onHover={handlePinHover}
                    />
                  ) : null,
                )}

                {postIts.map((note) => (
                  <PostIt
                    key={note.id}
                    note={note}
                    zoom={camera.zoom}
                    selected={selection.has(note.id)}
                    onDrag={moveEntity}
                    onChange={setEntityBody}
                    onRemove={removeEntity}
                  />
                ))}
                <svg
                  className="pointer-events-none absolute top-0 left-0 z-20 overflow-visible"
                  width={1}
                  height={1}
                  aria-hidden="true"
                >
                  {drawableStrings.map((string) => (
                    // Yarn is never dimmed with the timeline. Pins carry that
                    // signal well enough on their own, and 0.12 — which reads as
                    // "faded" on a chunky brass tack — is indistinguishable from
                    // absent on a 1-2px hairline, so every string touching a pin
                    // newer than the cursor simply vanished.
                    <g key={string.id}>
                      {/* The halo sits under the strands rather than around
                          them, so the wool still reads as wool. Drawn in the
                          yarn's own colour at low opacity: a white glow would
                          be invisible on the whiteboard and a dark one on
                          slate, but a red one reads on every surface. */}
                      {selection.has(string.id) || hoveredString === string.id ? (
                        <path
                          data-testid="yarn-halo"
                          d={yarnPath(string.from, string.to, string.slack)}
                          fill="none"
                          stroke={YARN_COLOR}
                          // Selected reads stronger than merely hovered, so the
                          // two states are told apart at a glance rather than
                          // both meaning "something is happening here".
                          strokeOpacity={selection.has(string.id) ? 0.22 : 0.12}
                          strokeWidth={STRING_HALO_PX / (camera.zoom || 1)}
                          strokeLinecap="round"
                        />
                      ) : null}
                      {yarnStrands(
                        preferences.yarnStyle,
                        string.from,
                        string.to,
                        string.slack,
                        seedFromKey(string.id),
                      ).map((strand, index) => (
                        <path
                          key={index}
                          d={strand.d}
                          fill="none"
                          stroke={YARN_COLOR}
                          strokeWidth={strand.width}
                          strokeOpacity={strand.opacity}
                          strokeLinecap="round"
                        />
                      ))}
                    </g>
                  ))}

                  <path
                    ref={livePathRef}
                    data-testid="live-yarn"
                    fill="none"
                    stroke={YARN_COLOR}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    opacity={dragFrom ? 0.95 : 0}
                  />
                </svg>
                {/* Rendered LAST so it paints over everything. Yarn lies on
                    top of the board the way it does on a real one — a string
                    running behind a pinned document reads as a mistake. It
                    stays pointer-events-none, so it never intercepts a click
                    meant for a pin or a post-it. */}
                {selectedString ? (
                  <YarnBead
                    key={selectedString.id}
                    from={selectedString.from}
                    to={selectedString.to}
                    slack={selectedString.slack}
                    zoom={camera.zoom}
                    onSag={(dy) => dragStringSag(selectedString.id, dy)}
                  />
                ) : null}
              </BoardCanvas>
            </div>
        </>
      </main>

      {route.name === 'board' && (
        <footer className="border-t border-parchment-edge/15 bg-cork-900/55 px-4 py-2 lg:px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pb-1 text-[10px] text-board-ink-soft/50">
            <Legend
              colour="var(--color-brass)"
              label={`Anchored exactly (${pins.length - repaired - orphaned.length})`}
            />
            <Legend colour="#d98a2b" label={`Repaired after an edit (${repaired})`} />
            <Legend colour="var(--color-wax)" label={`Orphaned (${orphaned.length})`} />
            <span>
              {placed.length} pin{placed.length === 1 ? '' : 's'} · {strings.length} string
              {strings.length === 1 ? '' : 's'}
            </span>
            <span className="ml-auto hidden lg:inline">
              Scroll to zoom · right/middle-drag to pan · right-click for options
            </span>
          </div>
          <TimelineRibbon
            timeline={timeline}
            clusters={clusters}
            cursor={cursor}
            onScrub={(time) => {
              setPlaying(false)
              setCursor(time)
            }}
            playing={playing}
            onTogglePlay={togglePlay}
            activeCount={activeIds.size}
            totalCount={timeline.placed.length}
          />
        </footer>
      )}

      {/* The hover card stands down while the editor is open or a pin is being
          dragged: in both cases you already have the pin's contents in front of
          you, and a card following the cursor would just be in the way. */}
      <PinTooltip
        pin={
          hovered && !editingPin && !movingPin
            ? (() => {
                const pin = byId.get(hovered.id)
                return pin
                  ? {
                      id: pin.id,
                      quote: pin.quote,
                      body: pin.body,
                      dateLabel: pin.dateLabel,
                    }
                  : null
              })()
            : null
        }
        anchor={hovered?.element ?? null}
      />

      {movingPin && (
        <div
          className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center"
          role="status"
        >
          <span className="rounded-full border border-brass/50 bg-cork-900/90 px-3 py-1 text-xs text-board-ink shadow-lg">
            Drag the pin to reposition it · <span className="text-board-ink-soft">Esc to finish</span>
          </span>
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.clientX}
          y={contextMenu.clientY}
          items={contextItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {editingPin && activePin && (
        <PinEditor
          quote={activePin.quote}
          status={activePin.status === 'free' ? 'exact' : activePin.status}
          dateLabel={placed.find((item) => item.id === editingPin.id)?.dateLabel ?? ''}
          body={activePin.body}
          x={editingPin.x}
          y={editingPin.y}
          onChange={(body) => setEntityBody(editingPin.id, body)}
          onDelete={() => removeEntity(editingPin.id)}
          onMove={() => {
            // Hand the pin to the board and get the editor out of the way —
            // you cannot drag something accurately with a card over it.
            setMovingPin(editingPin.id)
            setEditingPin(null)
          }}
          onClose={() => setEditingPin(null)}
        />
      )}

      <PreferencesPanel
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        onClearBoard={clearBoard}
      />
    </div>
  )
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: colour }} />
      {label}
    </span>
  )
}


/**
 * A brass tack — the same object whether it is holding a word or a patch of
 * cork, so the drag means the same thing on both and you never have to work out
 * which kind you are looking at.
 *
 * Normally dragging one runs a string. While it is the pin being repositioned,
 * the drag moves it instead: a mode rather than a second button, because
 * "connect" and "move" on the same target would otherwise be indistinguishable.
 *
 * `data-described` drives a ring around tacks that have something written on
 * them, so an annotated pin is findable at a glance across a crowded board.
 */
function Tack({
  pin,
  x,
  y,
  selected,
  dimmed,
  moving,
  zoom,
  onStartYarn,
  onMove,
  onHover,
}: {
  pin: PinView
  x: number
  y: number
  selected: boolean
  dimmed: boolean
  moving: boolean
  zoom: number
  onStartYarn: (event: React.PointerEvent) => void
  onMove: (id: string, delta: Point) => void
  onHover: (pin: PinView, element: Element | null) => void
}) {
  const drag = useBoardDrag({
    zoom,
    onDrag: (delta) => onMove(pin.id, delta),
  })

  const described = pin.body.trim().length > 0

  return (
    <button
      type="button"
      data-pin-id={pin.id}
      data-board-entity="pin"
      data-described={described ? 'true' : undefined}
      {...(moving ? drag : { onPointerDown: onStartYarn })}
      onPointerEnter={(event) => onHover(pin, event.currentTarget)}
      onPointerLeave={() => onHover(pin, null)}
      // The id only exists while the card is mounted, which aria-describedby
      // ignores — so this is safe to declare unconditionally.
      aria-describedby={pinTooltipId(pin.id)}
      // pointer-events-auto is load-bearing on anchored pins: their overlay is
      // pointer-events-none so the article's text keeps its own hit-testing, and
      // a tack that inherits that cannot be pressed at all — so no yarn could
      // ever start from a pin stuck in a word. Re-enabling it here, on the tack
      // alone, leaves the rest of the overlay transparent to the text.
      className={`tack tack-enter pointer-events-auto absolute h-3.5 w-3.5 rounded-full ${
        moving ? 'cursor-grabbing' : 'cursor-crosshair'
      } ${selected ? 'is-selected' : ''}`}
      data-status={pin.status}
      style={{
        left: x,
        top: y,
        touchAction: 'none',
        opacity: dimmed ? 0.2 : 1,
      }}
      aria-label={
        described
          ? `Pin: ${pin.body}`
          : pin.quote
            ? `Pin on "${pin.quote}", ${pin.detail}`
            : 'Pin on the board, no description yet'
      }
    />
  )
}

/**
 * The bead on a selected string: the handle you haul up and down to change how
 * much the string sags.
 *
 * Its own component so the drag hook lives here, and so the gesture is bound to
 * one string by construction rather than through a ref of "which string is
 * selected right now". Only the vertical component is used — the sag is a
 * single number, and letting sideways travel feed into it would make the string
 * lurch whenever the hand drifted.
 */
function YarnBead({
  from,
  to,
  slack,
  zoom,
  onSag,
}: {
  from: Point
  to: Point
  slack: number
  zoom: number
  onSag: (dy: number) => void
}) {
  const drag = useBoardDrag({ zoom, onDrag: (delta) => onSag(delta.y) })
  // The curve's lowest point is the middle of the rope, and the only part of it
  // that means "tightness" to the eye.
  const apex = pointOnYarn(from, to, 0.5, slack)

  return (
    <button
      type="button"
      data-testid="yarn-bead"
      aria-label="Drag up or down to adjust how much the string sags"
      className="yarn-bead tack-enter absolute rounded-full"
      style={{
        left: apex.x - BEAD_SIZE / 2,
        top: apex.y - BEAD_SIZE / 2,
        width: BEAD_SIZE,
        height: BEAD_SIZE,
        touchAction: 'none',
      }}
      {...drag}
    />
  )
}

/**
 * A post-it on the board.
 *
 * Its own component because it needs a drag hook, and hooks cannot live inside
 * a `.map`. The body is edited in place — a post-it is a thing you scribble on,
 * so opening a dialog to do it would be a step backwards.
 */
function PostIt({
  note,
  zoom,
  selected,
  onDrag,
  onChange,
  onRemove,
}: {
  note: NoteEntity
  zoom: number
  selected: boolean
  onDrag: (id: string, delta: Point) => void
  onChange: (id: string, body: string) => void
  onRemove: (id: string) => void
}) {
  const drag = useBoardDrag({
    zoom,
    onDrag: (delta) => onDrag(note.id, delta),
  })

  return (
    <div
      data-entity-id={note.id}
      data-post-it-id={note.id}
      data-board-entity="note"
      className={`post-it absolute rounded-sm p-2 ${selected ? 'is-selected' : ''}`}
      style={{
        left: note.board.x,
        top: note.board.y,
        width: POST_IT_WIDTH,
        background: note.color,
      }}
    >
      {/* The header is the grab handle, so dragging never fights with selecting
          text inside the note. */}
      <div
        {...drag}
        className="drag-bar mb-1 h-2.5 rounded-sm"
        title="Drag to move"
        aria-label="Drag post-it"
      />
      <textarea
        value={note.bodyMd}
        onChange={(event) => onChange(note.id, event.target.value)}
        placeholder="Write something…"
        className="h-24 w-full resize-none bg-transparent text-[12px] leading-snug text-ink outline-none placeholder:text-ink-soft/40"
        aria-label="Post-it note"
      />
      <button
        type="button"
        onClick={() => onRemove(note.id)}
        className="absolute top-1 right-1 text-[11px] text-ink-soft/40 transition hover:text-wax"
        aria-label="Remove post-it"
      >
        ×
      </button>
    </div>
  )
}
