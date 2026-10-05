import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { createAnchor } from './anchors/create'
import {
  domRangeToFlatRange,
  flatRangeToDomRange,
  projectDom,
  rangeToContainerRects,
  type DomProjection,
} from './anchors/dom'
import { caretRangeFromPoint, caretRangeThroughPins } from './anchors/caret'
import { resolveAnchor } from './anchors/resolve'
import { ARTICLE_ID, ARTICLE_TITLE, CAMPAIGN_EPOCH, FIRST_SESSION, INITIAL_MARKDOWN, SESSION_GAP_MS } from './app/demo'
import { NUDGE_SLOP_PX, PAPER_WIDTH, POST_IT_COLORS, SLACK_STEP, SNAP_RADIUS, STRING_HIT_PX } from './board/tuning'
import { entityIdFromElement, px, withinSlop } from './board/view'
import { YarnBead } from './board/entities/YarnBead'
import { Legend } from './board/Legend'
import { StringLayer } from './board/StringLayer'
import type { DrawableString, PinView } from './board/view'
import { TopBar } from './app/TopBar'
import { LOCAL_VIEWER } from './access/permissions'
import { useRoute } from './app/router'
import { BoardCanvas, type BoardContextTarget } from './board/BoardCanvas'
import { createBoardStore, useBoard, type BoardStore } from './board/store'
import type { EdgeStyle } from './board/edges'
import { decodeImageFile, firstImage } from './board/image-file'
import { clampTilt, rotateAbout } from './board/pivot'
import { useBoardDrag } from './board/useBoardDrag'
import { Pin } from 'lucide-react'

import { ArticleSheet } from './board/ArticleSheet'
import { EntityLayer } from './board/EntityLayer'
import { ContextMenu, type ContextMenuEntry } from './board/ContextMenu'
import { GridLayer } from './board/GridLayer'
import { PaperEditor } from './board/PaperEditor'
import { PinTooltip } from './board/PinTooltip'
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
  sagFor,
  slackForSag,
  stepSpring,
  yarnPath,
  YARN_COLOR,
  type Point,
} from './board/yarn'
import { maxStrandDeviation } from './board/yarn-style'
import {
  freshEdgeSeed,
  imageFootprint,
  newAnchoredPin,
  newFreePin,
  newImage,
  newNote,
} from './model/create'
import { descriptorFor } from './model/kinds'
import { pinToBoard, pinToText, sameAnchor } from './model/pinning'
import {
  isAnchoredPin,
  isPin,
  type BoardEntity,
  type EntityContext,
  type ImageEntity,
  type NoteEntity,
} from './model/types'
import { PREFERENCES_PANEL_ID, PreferencesPanel } from './theme/PreferencesPanel'
import { usePreferences } from './theme/preferences'

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
  /**
   * The board's data, and the seams every change to it passes through.
   *
   * `useState` arrays until now, written by a dozen call sites that each
   * computed the next array themselves. That is a fine way to build a board and
   * a hopeless way to add permissions or live editing to one: "may this person
   * do this?" has to be asked in one place or it is asked in eleven and
   * answered differently in three, and a peer needs to hear "this one pin
   * moved" rather than being sent a whole board.
   *
   * Built once and held in a ref rather than created per render: a store is a
   * thing with an identity — subscribers attach to it — and a new one each
   * render would drop them.
   */
  const storeRef = useRef<BoardStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createBoardStore({ viewer: LOCAL_VIEWER })
  }
  const store = storeRef.current
  const { entities, strings } = useBoard(store)
  const [pins, setPins] = useState<PinView[]>([])

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
    (BoardContextTarget & { board: Point; entityId: string | null }) | null
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
   * How far the sheet is swung about its pin, in degrees.
   *
   * Its own state rather than a field on an entity, because the article is the
   * one kind that has not joined the entity list yet — it is still a singleton
   * with its own paper position. When it does, this moves onto it with `board`.
   */
  const [paperTilt, setPaperTilt] = useState(0)
  const paperTiltRef = useRef(paperTilt)
  paperTiltRef.current = paperTilt
  /**
   * The page's width, which the reader drags.
   *
   * `PAPER_WIDTH` is only the width it opens at. Changing it reflows the text,
   * and that is safe here because an anchor is a character offset rather than a
   * pixel — every pin re-resolves against the page as it now is, through the
   * same ladder it uses after an edit. The resolver is pure and idempotent, so
   * a reflow is just another edit as far as it is concerned.
   */
  const [paperWidth, setPaperWidth] = useState(PAPER_WIDTH)
  const paperWidthRef = useRef(paperWidth)
  paperWidthRef.current = paperWidth
  /** Whether the page is rolled up to its tab. */
  const [paperCollapsed, setPaperCollapsed] = useState(false)

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
  const paperInsetRef = useRef(paperInset)
  paperInsetRef.current = paperInset

  /**
   * What a descriptor cannot know on its own.
   *
   * An anchored entity's place is not on the entity — it is wherever its quote
   * resolved to, which only the projection effect knows. Passing that in keeps
   * the descriptors pure and keeps the anchor ladder where it belongs.
   */
  /**
   * A point in the article's own space, in board space.
   *
   * The paper is turned by a CSS transform whose origin is its own top-centre,
   * so the same three steps reproduce it exactly: into the paper's space, turn
   * about that origin, then out to the board. Anything measured against the
   * article and drawn on the board — a tack's position for a string's end, for
   * one — has to come through here, or it stays where the sheet was before it
   * was swung.
   */
  const articleToBoard = useCallback((local: Point): Point => {
    const pivot = { x: paperWidthRef.current / 2, y: 0 }
    const inset = paperInsetRef.current
    const inPaper = { x: inset.x + local.x, y: inset.y + local.y }
    const turned = rotateAbout(pivot, inPaper, paperTiltRef.current)
    const at = paperPosRef.current
    return { x: at.x + turned.x, y: at.y + turned.y }
  }, [])

  const entityContext = useMemo<EntityContext>(
    () => ({
      articleToBoard: (_articleId, local) => articleToBoard(local),
      anchorRect: (id) => pins.find((pin) => pin.id === id)?.rect ?? null,
      articleSize: () =>
        paperRect && paperRect.width > 0
          ? { width: paperRect.width, height: paperRect.height }
          : null,
    }),
    [articleToBoard, pins, paperRect],
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
  // The full list, for the handlers that need to look an entity up by id
  // without taking a dependency on the array — a pointer handler rebuilt on
  // every entity change would rebind mid-gesture.
  const entitiesRef = useRef(entities)
  entitiesRef.current = entities
  const paperRectRef = useRef(paperRect)
  paperRectRef.current = paperRect
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
        // Read through the ref, not the state: the rects come out in the
        // article's own space once the scale is divided out, so they do not
        // depend on which zoom was in force when they were measured — and
        // taking `camera.zoom` as a dependency would re-resolve every anchor on
        // every frame of a zoom.
        const rects = range
          ? rangeToContainerRects(range, element, cameraRef.current.zoom || 1)
          : []
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
      store.addEntities((state) => [
        newFreePin(board, {
          occurredAt: CAMPAIGN_EPOCH + state.entities.filter(isPin).length * SESSION_GAP_MS,
          dateLabel: nextDateLabel(state.entities.filter(isPin).length),
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
          store.addEntities((state) => [
            newAnchoredPin(ARTICLE_ID, anchor, {
              occurredAt: CAMPAIGN_EPOCH + state.entities.filter(isPin).length * SESSION_GAP_MS,
              dateLabel: nextDateLabel(state.entities.filter(isPin).length),
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
   * Swap an entity for another carrying the same id.
   *
   * For the changes that are not a move — a pin gaining an anchor, losing one,
   * being re-anchored to different words. Those replace the entity rather than
   * shifting it, because the thing holding it is what changed.
   */
  const replaceEntity = useCallback(
    (next: BoardEntity) => {
      store.updateEntities([next.id], () => next)
    },
    [store],
  )

  /**
   * Pin a picture the user brought in.
   *
   * Async because a file has to be decoded before it can be measured, and an
   * image entity's footprint is its own proportions — there is nothing to
   * create until the browser has read the file. The drop point is captured
   * first, because by the time the bytes are through there is no longer a
   * pointer to ask.
   *
   * The sheet is centred on where it was dropped rather than hung from its
   * top-left corner there: a picture appears under the cursor that brought it,
   * which is what makes dropping feel like placing rather than like throwing.
   */
  const addImageAt = useCallback(
    async (file: File, clientX: number, clientY: number) => {
      let decoded
      try {
        decoded = await decodeImageFile(file)
      } catch {
        // The board has nowhere to put a message yet, and a picture that will
        // not decode is not worth a dialog. Doing nothing is the honest
        // outcome — the drop simply does not take.
        return
      }

      const footprint = imageFootprint(decoded.width, decoded.height)
      const at = worldPoint(clientX, clientY)
      const board = { x: at.x - footprint.width / 2, y: at.y - footprint.height / 2 }

      store.addEntities((state) => [
        newImage(board, decoded.src, footprint, {
          alt: decoded.name,
          // A picture with no description is a picture nothing can be said
          // about, and the name it arrived under is the only one there is.
          bodyMd: decoded.name,
          dateLabel: nextDateLabel(state.entities.length),
        }),
      ])
    },
    [nextDateLabel, worldPoint],
  )

  /** Swing a sheet about its pin. Shared by images and, later, articles. */
  const rotateEntity = useCallback((id: string, degrees: number) => {
    const angle = clampTilt(degrees)
    store.updateEntities([id], (entity) =>
      entity.kind === 'image' ? { ...entity, rotation: angle, updatedAt: Date.now() } : entity,
    )
  }, [])

  /**
   * Give a picture's border a new shape.
   *
   * The geometry is deterministic and stays that way — this changes the *seed*
   * it is generated from, which is the one input that is allowed to be random.
   * `edges.ts` keeps its guarantee, its cache stays sound, and a picture's crop
   * is still a pure function of what is stored on it.
   */
  const rerollEdge = useCallback((id: string) => {
    store.updateEntities([id], (entity) =>
      entity.kind === 'image'
        ? { ...entity, edgeSeed: freshEdgeSeed(), updatedAt: Date.now() }
        : entity,
    )
  }, [])

  /**
   * Re-crop a picture's border, damaging it freshly.
   *
   * Re-rolled on every pick, not only when the style changes, so choosing
   * "burnt" twice gives two different burns rather than nothing happening the
   * second time.
   */
  const setImageEdge = useCallback(
    (id: string, edge: EdgeStyle) => {
      store.updateEntities([id], (entity) =>
        entity.kind === 'image'
          ? { ...entity, edge, edgeSeed: freshEdgeSeed(), updatedAt: Date.now() }
          : entity,
      )
    },
    [],
  )

  /** Select one thing and nothing else. What a click on a note means. */
  const selectOnly = useCallback((id: string) => {
    setSelection(new Set([id]))
  }, [])

  /**
   * Select a picture, and damage its border afresh.
   *
   * Picking a picture up is the moment you look at it, so it is the moment the
   * crop is regenerated — a torn edge that is the same tear every time is a
   * stamp, not damage. Re-rolled only when the selection actually moves to this
   * picture: dragging one that is already selected must not reshuffle its edge
   * under the hand that is moving it.
   */
  const selectImage = useCallback(
    (id: string) => {
      const alreadySelected = selection.size === 1 && selection.has(id)
      setSelection(new Set([id]))
      if (!alreadySelected) rerollEdge(id)
    },
    [rerollEdge, selection],
  )

  /**
   * Change the page's width, keeping the pin where it is.
   *
   * The sheet is drawn from its top-left, so growing it by width alone would
   * push the pin — which sits at the top-*centre* — half the growth to the
   * right, and the page would crawl sideways every time it was dragged wider.
   * Half the change comes off `paperPos.x` to hold the pin still, the same
   * correction the pictures make.
   */
  const resizePaper = useCallback((nextWidth: number) => {
    const delta = nextWidth - paperWidthRef.current
    setPaperWidth(nextWidth)
    setPaperPos((previous) => ({ x: previous.x - delta / 2, y: previous.y }))
  }, [])

  /** Resize a note. Its corner is where it is drawn from, so nothing else moves. */
  const resizeNote = useCallback(
    (id: string, size: { width: number; height: number }) => {
      store.updateEntities([id], (entity) =>
        entity.kind === 'note' ? { ...entity, ...size, updatedAt: Date.now() } : entity,
      )
    },
    [store],
  )

  /** Resize a picture, keeping the pin it hangs from where it is. */
  const resizeImage = useCallback((id: string, size: { width: number; height: number }) => {
    store.updateEntities([id], (entity) => {
      if (entity.kind !== 'image') return entity
      // Anchored at the pin at the top-centre, so a picture grows and shrinks
      // from where it is pinned rather than from a corner that the eye is not
      // watching.
      const pivotX = entity.board.x + entity.width / 2
      return {
        ...entity,
        width: size.width,
        height: size.height,
        board: { x: pivotX - size.width / 2, y: entity.board.y },
        updatedAt: Date.now(),
      }
    })
  }, [store])

  /** Take entities off the board, whatever they are. */
  const removeEntities = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return
    const doomed = new Set(ids)
    // The store takes the strings that were tied to them with them: one that is
    // left behind has nothing to attach to and would sit in the list invisibly
    // until it happened to resolve again.
    store.removeEntities(ids)
    setSelection((previous) => new Set([...previous].filter((id) => !doomed.has(id))))
    setHovered((previous) => (previous && doomed.has(previous.id) ? null : previous))
  }, [])

  /**
   * Where a dragged pin comes to rest.
   *
   * A drag is the only way to say "not there, *there*", so it has to be able to
   * change what holds a pin and not merely shift it. Until this existed a pin
   * was welded to the words it was first given: dragging it onto a different
   * passage moved the tack and left it still claiming the old quote, and a pin
   * carried in from the cork sat on the text without ever being stuck into it.
   *
   * The release point settles it:
   *
   *   near its own word    a nudge — the offset the drag applied is kept
   *   over other words     re-anchor to them
   *   off the page         pull the pin out and stick it in the cork
   *
   * The first case is the subtle one, and `NUDGE_SLOP_PX` is why it is not
   * simply "different word, so re-anchor". A caret clamps: `caretRangeFromPoint`
   * asked anywhere on the page returns the nearest text, so a tack shifted a
   * few pixels to stop two of them overlapping resolves to whatever word it slid
   * onto — and the pin silently changes *what it is about* because the hand
   * moved a hair. Measured from the tack, a rightward nudge only had about five
   * pixels of room before it crossed into the next word. So a drop near the
   * word the pin already holds counts as adjusting that word, whatever the
   * caret clamped to.
   *
   * There is no case for "on the page but not on any word": the clamp means
   * there isn't one. A page with no text at all is the exception, and there the
   * pin keeps its quote rather than being thrown onto the cork.
   */
  const handlePinDrop = useCallback(
    (pinId: string, clientX: number, clientY: number) => {
      const pin = entitiesRef.current.find((entity) => entity.id === pinId)
      if (!pin || !isPin(pin)) return

      const projection = projectionRef.current
      const element = articleRef.current
      const range = element ? caretRangeThroughPins(clientX, clientY) : null

      if (projection && element && range && element.contains(range.startContainer)) {
        const flatRange = domRangeToFlatRange(projection, range)
        const anchor = flatRange
          ? createAnchor(projection.flat.text, flatRange.start, flatRange.end)
          : null

        if (anchor?.quote) {
          if (isAnchoredPin(pin)) {
            // Already on these words: a nudge, and the drag stored the offset.
            if (sameAnchor(pin.anchor, anchor)) return

            // On other words, but still close enough to the pin's own to be the
            // same adjustment — see the note above.
            const box = element.getBoundingClientRect()
            const zoom = cameraRef.current.zoom || 1
            const local = { x: (clientX - box.left) / zoom, y: (clientY - box.top) / zoom }
            const rect = pinsRef.current.find((view) => view.id === pinId)?.rect
            if (rect && withinSlop(local, rect, NUDGE_SLOP_PX / zoom)) return
          }

          replaceEntity(pinToText(pin, ARTICLE_ID, anchor))
          return
        }
      }

      // Off the readable text. On the page the pin keeps the quote it holds —
      // this is the page-with-no-words case, where the caret had nothing to
      // clamp to — and off the page it is pulled out and stuck in the cork.
      const board = worldPoint(clientX, clientY)
      const paper = paperRectRef.current
      const onPaper =
        paper !== null &&
        board.x >= paper.x &&
        board.x <= paper.x + paper.width &&
        board.y >= paper.y &&
        board.y <= paper.y + paper.height

      if (onPaper) return

      replaceEntity(pinToBoard(pin, board))
    },
    [replaceEntity, worldPoint],
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

  /**
   * Take a picture from a drop or a paste.
   *
   * One handler for both because the two gestures differ only in where the
   * picture lands: a drop knows the point it happened at, and a paste has none
   * — a paste fires on the document with no position at all — so it goes to
   * the middle of whatever the camera is looking at.
   *
   * `preventDefault` on the drag-over is load-bearing and not a formality:
   * without it the browser refuses the drop outright and opens the file in a
   * new tab, which is exactly the behaviour that made this look like a feature
   * that was broken rather than one that was missing.
   */
  const handleFileDrop = useCallback(
    (event: React.DragEvent) => {
      const file = firstImage(Array.from(event.dataTransfer?.files ?? []))
      if (!file) return
      event.preventDefault()
      void addImageAt(file, event.clientX, event.clientY)
    },
    [addImageAt],
  )

  const handleDragOver = useCallback((event: React.DragEvent) => {
    // Only claim the gesture for files, so dragging text or a link across the
    // board is left to the browser.
    const carriesFiles = Array.from(event.dataTransfer?.types ?? []).includes('Files')
    if (carriesFiles) event.preventDefault()
  }, [])

  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      // Never steal a paste from a field: a post-it is a textarea and the pin
      // editor is full of inputs, and pasting into those is not this.
      //
      // Guarded by `instanceof Element` rather than by a null check, because a
      // paste with nothing focused is dispatched at the *document*, which is a
      // Node and has no `closest` — so the tidy-looking version of this line
      // throws on exactly the case it is meant to allow.
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) {
        return
      }

      const file = firstImage(Array.from(event.clipboardData?.files ?? []))
      if (!file) return

      event.preventDefault()
      const box = document.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect()
      if (!box) return
      void addImageAt(file, box.left + box.width / 2, box.top + box.height / 2)
    },
    [addImageAt],
  )

  useEffect(() => {
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [handlePaste])

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
    (event: React.PointerEvent, fromId: string, origin: Point | null) => {
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
      //
      // The origin is handed in rather than derived from the pin, so a string
      // can be started from anything that has an anchor — a tack in a word, a
      // tack in the cork, or the pin holding a picture up — without this
      // needing to know which it was.
      if (!origin) return

      originRef.current = origin
      targetRef.current = origin
      springRef.current = { x: createSpring(origin.x, 220, 22), y: createSpring(origin.y, 220, 22) }
      setDragFrom(fromId)
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

      // Whatever the pointer lands on that a string can be tied to — a tack in
      // a word, a tack in the cork, or the pin holding a picture up.
      let nearest: { id: string; distance: number } | null = null
      for (const [id, point] of anchorPointsRef.current) {
        if (id === from) continue
        const distance = Math.hypot(point.x - drop.x, point.y - drop.y)
        if (distance <= SNAP_RADIUS && (!nearest || distance < nearest.distance)) {
          nearest = { id, distance }
        }
      }

      if (nearest) {
        // The store refuses a second string between the same pair, which the
        // gesture used to have to check for itself.
        store.addString({
          id: crypto.randomUUID(),
          from,
          to: nearest.id,
          slack: DEFAULT_SLACK,
          color: YARN_COLOR,
          style: 'solid',
          visibility: 'shared',
        })
      }

      cancelAnimationFrame(frameRef.current)
      originRef.current = null
      dragFromRef.current = null
      setDragFrom(null)
    },
    [store, worldPoint],
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
    store.updateEntities([...selection], (entity) => {
      const descriptor = descriptorFor(entity)
      // An anchored pin, if one were ever selected, stores the shift against
      // its words rather than moving — the descriptor decides that, not us.
      return descriptor.capabilities(entity).movable ? descriptor.move(entity, delta) : entity
    })
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

    // What was right-clicked, if it was a thing rather than cork. The menu is
    // built from this, which is why a picture gets an entry no other kind has.
    const onEntity = element ? entityIdFromElement(element) : null

    setContextMenu({
      ...target,
      board: screenToBoard(cameraRef.current, viewportPoint),
      entityId: onEntity,
    })

    // Right-clicking a picture also selects it, so the border bar it is about
    // to offer is already up and the thing the menu will act on is visible as
    // the thing you pointed at.
    if (onEntity) setSelection(new Set([onEntity]))
  }, [])

  const createPostIt = useCallback(
    (point: Point) => {
      store.addEntities((state) => [
        newNote(point, {
          color: POST_IT_COLORS[state.entities.length % POST_IT_COLORS.length],
          dateLabel: nextDateLabel(state.entities.length),
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
    store.updateEntities([id], (entity) => {
      const descriptor = descriptorFor(entity)
      return descriptor.capabilities(entity).movable ? descriptor.move(entity, delta) : entity
    })
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
    store.updateEntities([id], (entity) => ({ ...entity, bodyMd, updatedAt: Date.now() }))
  }, [])

  /** Take an entity off the board, and every string that touched it with it. */
  const removeEntity = useCallback(
    (id: string) => {
      store.removeEntities([id])
      setEditingPin(null)
    },
    [store],
  )

  const clearBoard = useCallback(() => {
    // Every id, rather than a "clear" the store would have to special-case: a
    // board that is emptied by describing each thing that left it is a board
    // that can be emptied by a peer too.
    store.removeEntities(store.get().entities.map((entity) => entity.id))
    setEditingPin(null)
    setContextMenu(null)
  }, [store])

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

  /**
   * Where a string may be tied, for every entity that accepts one.
   *
   * Built from the registry rather than from the pin list, which is what lets
   * yarn reach a picture's tack: a photograph is not a pin, so a snap that
   * walked the pins could never find it, and the string simply refused to be
   * tied. Every kind already answers `anchorPoint` and says whether it is
   * `connectable`, so asking all of them costs one loop and gives the string
   * layer no per-kind knowledge at all.
   *
   * An entity with no resolvable place — a pin whose quote is gone — is left
   * out, so a string to something that no longer exists disappears rather than
   * being drawn to the origin.
   */
  /**
   * The page's pin, in board space.
   *
   * The paper is turned about this point, so it is the one place on the sheet
   * that does not move when the sheet swings — no tilt in the sum, and none
   * needed. Null until the paper has been measured, so a string is never tied
   * to a page whose position is not yet known.
   */
  const articlePin = useMemo(
    () => (paperRect ? { x: paperPos.x + paperWidth / 2, y: paperPos.y } : null),
    [paperRect, paperPos.x, paperPos.y, paperWidth],
  )

  const anchorPoints = useMemo(() => {
    const map = new Map<string, Point>()
    for (const entity of entities) {
      const descriptor = descriptorFor(entity)
      if (!descriptor.capabilities(entity).connectable) continue
      const point = descriptor.anchorPoint(entity, entityContext)
      if (point) map.set(entity.id, point)
    }
    // The article is not an entity yet — it is still a singleton with its own
    // paper position — but it is a thing a string can be tied to, and it has a
    // tack at its head to prove it. Keyed by `ARTICLE_ID`, the same id the pins
    // stuck through it already name it by, so the board has one name for the
    // page rather than two. No collision with the entity ids, which are UUIDs.
    if (articlePin) map.set(ARTICLE_ID, articlePin)
    return map
  }, [entities, entityContext, articlePin])
  const anchorPointsRef = useRef(anchorPoints)
  anchorPointsRef.current = anchorPoints

  const drawableStrings = strings.flatMap((string) => {
    const fromPoint = anchorPoints.get(string.from)
    const toPoint = anchorPoints.get(string.to)
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
    store.updateStrings([id], (string) => {
      {
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
      }
    })
  }, [store])

  const removeString = useCallback(
    (id: string) => {
      store.removeStrings([id])
      setSelection((previous) => new Set([...previous].filter((selected) => selected !== id)))
    },
    [store],
  )

  /**
   * Delete takes what is selected off the board; Escape lets go of it.
   *
   * It is deliberate about where it may fire. Not while a field has focus — the
   * article is selectable text, a post-it is a textarea and the pin editor is
   * full of inputs, and Backspace in any of them is someone editing, not
   * deleting. And not while a card is open, where Escape already means "close
   * me", and where the thing selected is the thing the card is editing.
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
        // A selected string goes first. It is the only thing on the board you
        // select by clicking it rather than by enclosing it, so when both a
        // string and an object are selected the string is what was last
        // pointed at.
        if (selectedString) {
          event.preventDefault()
          removeString(selectedString.id)
          return
        }
        if (selection.size > 0) {
          event.preventDefault()
          removeEntities([...selection])
        }
        return
      }
      if (event.key === 'Escape' && selection.size > 0) setSelection(new Set())
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [
    contextMenu,
    editingPin,
    movingPin,
    prefsOpen,
    removeEntities,
    removeString,
    selectedString,
    selection,
  ])

  const images = useMemo(
    () => entities.filter((entity): entity is ImageEntity => entity.kind === 'image'),
    [entities],
  )

  /**
   * The one picture the border bar is for.
   *
   * Exactly one, not "any image in the selection": the bar points at a single
   * object, and with several selected there is no one picture to hang it under
   * and no one answer to show in it.
   */
  const selectedImage = useMemo(
    () => (selection.size === 1 ? images.find((image) => selection.has(image.id)) ?? null : null),
    [images, selection],
  )

  const anchored = pins.filter((pin) => pin.rect)
  const freePins = pins.filter((pin) => pin.board)
  const orphaned = pins.filter((pin) => pin.status === 'orphaned')
  const repaired = pins.filter((pin) => pin.status === 'repaired').length
  const activePin = editingPin ? byId.get(editingPin.id) : null

  const contextEntity = contextMenu?.entityId
    ? entities.find((entity) => entity.id === contextMenu.entityId) ?? null
    : null

  const contextItems: ContextMenuEntry[] = contextMenu
    ? [
        // Only for something that can actually be taken off the board. A
        // picture is the only kind that offers it here: the others each have
        // their own way to go, and a menu that can delete a pin holding a
        // written note is a menu that loses writing.
        ...(contextEntity?.kind === "image"
          ? [
              {
                id: "remove-image",
                label: "Remove picture",
                onSelect: () => removeEntities([contextEntity.id]),
              },
              { id: "sep-0", separator: true } as ContextMenuEntry,
            ]
          : []),
        {
          id: "post-it",
          label: "Create post-it",
          onSelect: () => createPostIt(contextMenu.board),
        },
        {
          id: "pin",
          label: "Add pin",
          onSelect: () => pinAt(contextMenu.clientX, contextMenu.clientY),
        },
        { id: "sep-1", separator: true },
        {
          id: "fit",
          label: "Zoom to fit",
          disabled: !paperRect,
          onSelect: fitBoard,
        },
        {
          id: "prefs",
          label: "Preferences…",
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
        {route.name === "board" && (
          <>
            <button
              type="button"
              onClick={() => setPinMode((previous) => !previous)}
              aria-pressed={pinMode}
              aria-label="Pin mode"
              title={
                pinMode ? "Pin mode on — click anywhere to place a pin" : "Pin mode off — ctrl-click to place a pin"
              }
              className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs transition ${
                pinMode
                  ? "border-brass bg-brass/25 text-board-ink"
                  : "border-brass/40 bg-cork-700/70 text-board-ink-soft hover:border-brass"
              }`}
            >
              <Pin
                size={13}
                strokeWidth={2.2}
                aria-hidden="true"
                // Filled in when armed, so the button reads as a state rather
                // than as a label — the same trick the brass dot played, done
                // with the shape that means "pin".
                fill={pinMode ? "currentColor" : "none"}
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
              idleCursor={hoveredString ? "pointer" : "default"}
              camera={camera}
              onCameraChange={setCamera}
              onContextTarget={handleContextTarget}
              onFileDrop={handleFileDrop}
              onFileDragOver={handleDragOver}
              onBackgroundClick={handleBackgroundClick}
              // Pin mode claims the left button for pinning, so the rubber
              // band stands down rather than fighting it for the same drag.
              onMarquee={pinMode ? undefined : handleMarquee}
              pinMode={pinMode}
              className="min-h-0 flex-1"
              fitTo={paperRect ? [paperRect] : undefined}
              backdrop={(viewport) => <GridLayer camera={camera} viewport={viewport} />}
            >
                            <ArticleSheet
                html={html}
                pos={paperPos}
                tilt={paperTilt}
                width={paperWidth}
                collapsed={paperCollapsed}
                paperRef={paperRef}
                articleRef={articleRef}
                overlayRef={overlayRef}
                anchored={anchored}
                selected={selection}
                dimming={dimming}
                activeIds={activeIds}
                movingPin={movingPin}
                zoom={camera.zoom}
                documentSelected={documentSelected}
                tabDrag={paperDrag}
                pinAt={articlePin}
                onClickArticle={handleArticleClick}
                onStartYarn={beginString}
                onMoveOne={moveOne}
                onPinDrop={handlePinDrop}
                onPinHover={handlePinHover}
                onRotate={setPaperTilt}
                onResize={resizePaper}
                onToggleCollapsed={() => setPaperCollapsed((previous) => !previous)}
                toBoard={worldPoint}
                articleToBoard={articleToBoard}
              />

              <EntityLayer
                freePins={freePins}
                images={images}
                postIts={postIts}
                selectedImage={selectedImage}
                selection={selection}
                dimming={dimming}
                activeIds={activeIds}
                movingPin={movingPin}
                zoom={camera.zoom}
                context={entityContext}
                articleToBoard={articleToBoard}
                toBoard={worldPoint}
                anchorOf={(id) => anchorPoints.get(id) ?? null}
                onStartYarn={beginString}
                onMoveOne={moveOne}
                onMoveEntity={moveEntity}
                onPinDrop={handlePinDrop}
                onPinHover={handlePinHover}
                onRotate={rotateEntity}
                onResize={resizeImage}
                onSelectImage={selectImage}
                onSetEdge={setImageEdge}
                onSelectNote={selectOnly}
                onSetBody={setEntityBody}
                onResizeNote={resizeNote}
                onRemove={removeEntity}
              />
              <StringLayer
                strings={drawableStrings}
                selected={selection}
                hovered={hoveredString}
                style={preferences.yarnStyle}
                zoom={camera.zoom}
                livePathRef={livePathRef}
                drawing={dragFrom !== null}
              />
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

      {route.name === "board" && (
        <footer className="border-t border-parchment-edge/15 bg-cork-900/55 px-4 py-2 lg:px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pb-1 text-[10px] text-board-ink-soft/50">
            <Legend
              colour="var(--color-brass)"
              label={`Anchored exactly (${pins.length - repaired - orphaned.length})`}
            />
            <Legend colour="#d98a2b" label={`Repaired after an edit (${repaired})`} />
            <Legend colour="var(--color-wax)" label={`Orphaned (${orphaned.length})`} />
            <span>
              {placed.length} pin{placed.length === 1 ? "" : "s"} · {strings.length} string
              {strings.length === 1 ? "" : "s"}
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
        <div className="pointer-events-none fixed inset-x-0 top-3 z-40 flex justify-center" role="status">
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
          status={activePin.status === "free" ? "exact" : activePin.status}
          dateLabel={placed.find((item) => item.id === editingPin.id)?.dateLabel ?? ""}
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

      <PreferencesPanel open={prefsOpen} onClose={() => setPrefsOpen(false)} onClearBoard={clearBoard} />
    </div>
  )
}
