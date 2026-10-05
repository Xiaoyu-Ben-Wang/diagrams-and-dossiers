import { useCallback, useEffect, useMemo, useRef, useState } from 'react'


import { createAnchor } from './anchors/create'
import { domRangeToFlatRange } from './anchors/dom'
import { caretRangeFromPoint, caretRangeThroughPins } from './anchors/caret'
import { CAMPAIGN_EPOCH, demoBoard, FIRST_SESSION, SESSION_GAP_MS } from './app/demo'
import { IMAGE_CAPTION_SPACE, IMAGE_CAPTION_TOP, NUDGE_SLOP_PX, POST_IT_COLORS, SLACK_STEP, SNAP_RADIUS, STRING_HIT_PX } from './board/tuning'
import { DRAG_THRESHOLD } from './board/useBoardDrag'
import { CAMERA_FLIGHT_MS, prefersReducedMotion } from './board/motion'
import { MENTION_ATTRIBUTE, resolveMention } from './markdown/mentions'
import { articleIdFromRange, entityIdFromElement, withinSlop } from './board/view'
import { useArticleViews, usePinViews } from './board/useArticleViews'
import { YarnBead } from './board/entities/YarnBead'
import { Legend } from './board/Legend'
import { StringLayer } from './board/StringLayer'
import { EdgePicker } from './board/EdgePicker'
import { CAPTION_WIDTH, ImageCaption } from './board/ImageCaption'
import { BoardPalette } from './board/Palette'
import { StringNote } from './board/StringNote'
import type { DrawableString, PinView } from './board/view'
import { TopBar } from './app/TopBar'
import { can, LOCAL_VIEWER } from './access/permissions'
import { useRoute } from './app/router'
import { BoardCanvas, type BoardContextTarget } from './board/BoardCanvas'
import { createBoardStore, useBoard, type BoardState, type BoardStore } from './board/store'
import { boardFileName, parseBoardFile, readBoardFile, serializeBoard } from './board/board-file'
import type { EdgeStyle } from './board/edges'
import { decodeImageFile, firstImage } from './board/image-file'
import { clampTilt, rotateAbout } from './board/pivot'
import { Pin } from 'lucide-react'

import { ArticleSheet } from './board/ArticleSheet'
import { EntityLayer } from './board/EntityLayer'
import { ContextMenu, type ContextMenuEntry } from './board/ContextMenu'
import { GridLayer } from './board/GridLayer'
import { PaperEditor } from './board/PaperEditor'
import { PinTooltip } from './board/PinTooltip'
import { PinEditor } from './board/PinEditor'
import {
  boardToScreen,
  centreOn,
  easeInOut,
  fitBounds,
  IDENTITY_CAMERA,
  lerpCamera,
  rectsIntersect,
  screenToBoard,
  type Camera,
  type Rect,
} from './board/camera'
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
import { descriptorFor, NOTE_SIZE } from './model/kinds'
import { pinToBoard, pinToText, sameAnchor } from './model/pinning'
import {
  isAnchoredPin,
  isPin,
  type ArticleEntity,
  type BoardEntity,
  type EntityContext,
  type ImageEntity,
  type NoteEntity,
} from './model/types'
import { PREFERENCES_PANEL_ID, PreferencesPanel } from './theme/PreferencesPanel'
import { usePreferences } from './theme/preferences'

/**
 * The board-space boxes "frame everything" should enclose.
 *
 * One pass over every kind, asking each descriptor for the box it wants framed
 * and falling back to the box it is hit-tested by. The fallback is not a
 * formality: a tack's hit footprint is a single point, and a zero-size box
 * contributes nothing to a fit — the board would frame its notes and crop the
 * pins holding them.
 *
 * Shared by the initial fit and the menu's, so "zoom to fit" and the board's
 * opening view can never disagree about what "everything" means.
 */
/** Nothing to frame. A shared constant so "not yet" does not churn identity. */
const NO_RECTS: Rect[] = []

function frameTargets(entities: readonly BoardEntity[], context: EntityContext): Rect[] {
  const targets: Rect[] = []
  for (const entity of entities) {
    const descriptor = descriptorFor(entity)
    const box = descriptor.frameBounds?.(entity, context) ?? descriptor.bounds(entity, context)
    if (box) targets.push(box)
  }
  return targets
}

/** A file's name without its extension — `map.png` names a file, not a picture. */
function pictureName(fileName: string): string {
  const trimmed = fileName.replace(/\.[^.]+$/, '').trim()
  return trimmed === '' ? fileName : trimmed
}

/**
 * A name nothing else on the board is already using.
 *
 * A mention is keyed by name, so two pictures called `map` are indistinguishable
 * — the link resolves to whichever comes first and there is no way to write the
 * other one. Suffixing at creation is the only place this can be fixed, since a
 * mention has nothing else to disambiguate with.
 */
function uniqueName(desired: string, entities: readonly BoardEntity[]): string {
  const taken = new Set(
    entities
      .map((entity) => entity.title?.trim().toLowerCase())
      .filter((title): title is string => title !== undefined && title !== ''),
  )
  if (!taken.has(desired.toLowerCase())) return desired
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${desired} (${suffix})`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

export interface AppProps {
  /**
   * What is already on the board.
   *
   * Defaults to the demo board, which is what a person opening the app gets.
   * Passing one is how a board with a known, minimal contents is rendered —
   * which is what a test of the board's *behaviour* wants, since a test that
   * counts things should not have to count around demo content it did not put
   * there. It is also the seam persistence will come through: a board that
   * arrives from a server arrives here.
   */
  seed?: BoardState
}

export function App({ seed }: AppProps = {}) {
  const { route } = useRoute()
  const preferences = usePreferences()

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
    storeRef.current = createBoardStore({ viewer: LOCAL_VIEWER, initial: seed ?? demoBoard() })
  }
  const store = storeRef.current
  const { entities, strings } = useBoard(store)

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
  /**
   * The pages, in board order.
   *
   * The same list the descriptors already loop over — the article kind has been
   * in the registry all along — but held separately because the sheets are the
   * one thing that has to be rendered *by* the list rather than described by it.
   */
  const articles = useMemo(
    () => entities.filter((entity): entity is ArticleEntity => entity.kind === 'article'),
    [entities],
  )
  /**
   * The pages by id, for the questions only an id can ask.
   *
   * A pin names the article it is stuck through and nothing else about it; so
   * does an `EntityContext` mapping call. A map rather than a `find` because
   * these are asked once per pin per resolve, and a resolve runs on every edit.
   */
  const articlesById = useMemo(
    () => new Map(articles.map((article) => [article.id, article])),
    [articles],
  )

  const [dragFrom, setDragFrom] = useState<string | null>(null)
  /** Where the string press landed, so the release can tell a click from a drag. */
  const stringStartRef = useRef<{ x: number; y: number } | null>(null)
  const [fontsLoaded, setFontsLoaded] = useState(() => !globalThis.document?.fonts)
  const [camera, setCamera] = useState<Camera>(IDENTITY_CAMERA)
  /** The zoom, for the geometry that has to divide it out. Read, not depended on. */
  const zoomRef = useRef(camera.zoom)
  zoomRef.current = camera.zoom

  /**
   * What every page has measured to, and every pin resolved against the page it
   * actually names.
   *
   * Both are derived rather than stored. A projection is a function of the
   * article as it is rendered and a pin's position is a function of that
   * projection, so holding either in state is holding an answer the next edit
   * invalidates — and with more than one page, holding it in *one* piece of
   * state is holding an answer for the wrong page.
   */
  const articleViews = useArticleViews(articles, fontsLoaded)
  const viewsRef = useRef(articleViews.views)
  viewsRef.current = articleViews.views
  // The registry as well as the views: a drop has to measure against the sheet
  // it landed on, and that needs the element, not the numbers.
  const articleViewsRef = useRef(articleViews)
  articleViewsRef.current = articleViews
  const pins = usePinViews(placed, articlesById, articleViews, zoomRef)

  const [editingPin, setEditingPin] = useState<{ id: string; x: number; y: number } | null>(null)

  /**
   * Open a pin's editor at a point on screen.
   *
   * One place, because there are three ways in — a right-click, a click on the
   * tack, and a click on the tack's tag — and the editor opens where the press
   * landed, which is the only thing telling the three apart. Three copies of
   * that line is three chances for one of them to open somewhere else.
   */
  const openPinEditorAt = useCallback((id: string, clientX: number, clientY: number) => {
    setEditingPin({ id, x: clientX, y: clientY })
  }, [])
  const [contextMenu, setContextMenu] = useState<
    (BoardContextTarget & { board: Point; entityId: string | null }) | null
  >(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
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

  /**
   * A point in an article's own space, in board space.
   *
   * The paper is turned by a CSS transform whose origin is its own top-centre,
   * so the same three steps reproduce it exactly: into the paper's space, turn
   * about that origin, then out to the board. Anything measured against the
   * article and drawn on the board — a tack's position for a string's end, for
   * one — has to come through here, or it stays where the sheet was before it
   * was swung.
   *
   * The article's id is the argument that matters. The three facts this needs —
   * where the sheet is, how wide it is, how far it is swung — are read from the
   * entity, which is always current; only the measured inset comes from the
   * views, and that changes only when the page reflows. Reading the position
   * from a *measurement* instead would leave every tack a frame behind a drag.
   *
   * Null when the article is not on the board: a pin whose page is gone has no
   * point in board space, and answering with a number would put it somewhere.
   */
  const articleToBoard = useCallback((articleId: string, local: Point): Point | null => {
    const article = articlesByIdRef.current.get(articleId)
    const view = viewsRef.current.get(articleId)
    if (!article || !view) return null

    const pivot = { x: article.options.width / 2, y: 0 }
    const inPaper = { x: view.inset.x + local.x, y: view.inset.y + local.y }
    const turned = rotateAbout(pivot, inPaper, article.rotation)
    return { x: article.board.x + turned.x, y: article.board.y + turned.y }
  }, [])

  /**
   * What a descriptor cannot know on its own.
   *
   * An anchored entity's place is not on the entity — it is wherever its quote
   * resolved to, which only the measurement layer knows. Passing that in keeps
   * the descriptors pure and keeps the anchor ladder where it belongs.
   */
  const entityContext = useMemo<EntityContext>(() => {
    const rects = new Map(pins.map((pin) => [pin.id, pin.rect]))
    return {
      articleToBoard,
      anchorRect: (id) => rects.get(id) ?? null,
      articleSize: (articleId) => {
        const size = articleViews.views.get(articleId)?.size
        // A page that has not been laid out — jsdom, or a sheet in its first
        // frame — is not a page with no size. It is one nothing can be placed
        // against yet, which is what null says, and it is why an unmeasured
        // board frames nothing rather than framing the origin.
        return size && size.width > 0 && size.height > 0 ? size : null
      },
    }
  }, [articleToBoard, pins, articleViews])
  const entityContextRef = useRef(entityContext)
  entityContextRef.current = entityContext

  const livePathRef = useRef<SVGPathElement>(null)

  const springRef = useRef({ x: createSpring(0), y: createSpring(0) })
  const targetRef = useRef<Point>({ x: 0, y: 0 })
  const originRef = useRef<Point | null>(null)
  const frameRef = useRef<number>(0)
  const cameraRef = useRef(camera)

  /**
   * The camera flight in progress, if any.
   *
   * A ref rather than state, because the animation writes the camera every
   * frame and a state variable would rebuild the loop driving it. Deliberately
   * not `frameRef` either: that one clocks the live-yarn spring, and two
   * animations sharing a handle would cancel each other.
   */
  const flightRef = useRef<number | null>(null)

  const cancelFlight = useCallback(() => {
    if (flightRef.current !== null) {
      cancelAnimationFrame(flightRef.current)
      flightRef.current = null
    }
  }, [])

  /**
   * Move the camera, cancelling anything already flying there.
   *
   * Every camera write that is not the flight itself goes through here — pan,
   * wheel, the zoom readout, zoom-to-fit. Without it, panning during a flight
   * is overwritten frame by frame by the animation it was meant to interrupt,
   * and the board fights the pointer for half a second.
   */
  const commitCamera = useCallback(
    (next: Camera) => {
      cancelFlight()
      setCamera(next)
    },
    [cancelFlight],
  )

  /**
   * Put a rect in the middle of the viewport, smoothly.
   *
   * The zoom is left alone — `centreOn` says why — and the loop is the shortest
   * one that works: `lerpCamera` and `easeInOut` were written for this and had
   * no callers until now.
   *
   * Reduced motion jumps rather than declining. Declining would leave the click
   * looking broken, which is not what anybody asking for less movement asked
   * for.
   */
  const flyTo = useCallback(
    (rect: Rect) => {
      const box = document.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect()
      if (!box || box.width === 0) return

      cancelFlight()
      const target = centreOn(
        rect,
        { width: box.width, height: box.height },
        cameraRef.current.zoom,
      )
      if (prefersReducedMotion()) {
        setCamera(target)
        return
      }

      const from = cameraRef.current
      const started = performance.now()
      const step = (now: number): void => {
        const t = Math.min(1, (now - started) / CAMERA_FLIGHT_MS)
        setCamera(lerpCamera(from, target, easeInOut(t)))
        flightRef.current = t < 1 ? requestAnimationFrame(step) : null
      }
      flightRef.current = requestAnimationFrame(step)
    },
    [cancelFlight],
  )
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
  // The same reason as `entitiesRef`: the mapping below is handed to descriptors
  // and to pointer handlers that must not be rebuilt when a page moves.
  const articlesByIdRef = useRef(articlesById)
  articlesByIdRef.current = articlesById
  // Assigned where the strings are resolved, far below. Declared up here because
  // the pointer handlers that pick a string are defined before that, and a ref
  // is what lets them read the latest resolution without depending on it.
  const drawableStringsRef = useRef<DrawableString[]>([])

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
   * Where it lands decides what kind of pin it is: over a page it anchors to
   * the word under the cursor, and anywhere else it is stuck into the board.
   * Both outcomes are a pin, so both callers (ctrl-click anywhere, and the
   * context menu's "Add pin") go through here rather than each deciding.
   *
   * Which page the cursor was over is the caret's answer, not ours: the range
   * comes back from the whole document, so the text node it landed in is what
   * attributes it. A caret over page B used to be indistinguishable from a
   * caret over bare cork, and every pin placed on a second page fell through to
   * the cork — a tack sitting on top of the words it was meant to hold.
   *
   * It also used to bail silently when the caret was not in the article, which
   * made right-clicking bare board and choosing "Add pin" do nothing at all.
   */
  const pinAt = useCallback(
    (clientX: number, clientY: number) => {
      const range = caretRangeFromPoint(clientX, clientY)
      const articleId = range ? articleIdFromRange(range) : null
      const view = articleId ? viewsRef.current.get(articleId) : null

      if (range && articleId && view) {
        const flatRange = domRangeToFlatRange(view.projection, range)
        const anchor = flatRange
          ? createAnchor(view.projection.flat.text, flatRange.start, flatRange.end)
          : null

        if (anchor?.quote) {
          store.addEntities((state) => [
            newAnchoredPin(articleId, anchor, {
              occurredAt: CAMPAIGN_EPOCH + state.entities.filter(isPin).length * SESSION_GAP_MS,
              dateLabel: nextDateLabel(state.entities.filter(isPin).length),
            }),
          ])
          return
        }
      }

      // Not over readable text — the caret is in a gap, on a page's margin, or
      // on bare cork.
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
          // The filename is what the file is called; the title is what the
          // picture is called. Only the second is something a mention can name,
          // and only the second is worth naming a picture after.
          alt: decoded.name,
          title: uniqueName(pictureName(decoded.name), state.entities),
          dateLabel: nextDateLabel(state.entities.length),
        }),
      ])
    },
    [nextDateLabel, worldPoint],
  )

  /**
   * Swing a sheet about its pin. Shared by pictures and pages.
   *
   * One clamp in one place, because the two are the same gesture on the same
   * kind of object: something hanging from a single tack, turned about it. Two
   * copies of the limit is two places for it to drift.
   */
  const rotateEntity = useCallback((id: string, degrees: number) => {
    const angle = clampTilt(degrees)
    store.updateEntities([id], (entity) =>
      entity.kind === 'image' || entity.kind === 'article'
        ? { ...entity, rotation: angle, updatedAt: Date.now() }
        : entity,
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
   * Change a page's width, keeping its pin where it is.
   *
   * The sheet is drawn from its top-left, so growing it by width alone would
   * push the pin — which sits at the top-*centre* — half the growth to the
   * right, and the page would crawl sideways every time it was dragged wider.
   * Half the change comes off the sheet's `board.x` to hold the pin still, the
   * same correction pictures get for the same reason.
   *
   * The width goes into the page's own options rather than a board-wide value:
   * two pages do not have to be the same width, and dragging one must not
   * reflow the other. Changing it does re-resolve that page's pins, which is
   * safe because an anchor is a character offset rather than a pixel — the
   * resolver is pure and idempotent, so a reflow is just another edit.
   */
  const resizeArticle = useCallback(
    (id: string, nextWidth: number) => {
      store.updateEntities([id], (entity) => {
        if (entity.kind !== 'article') return entity
        const pivotX = entity.board.x + entity.options.width / 2
        return {
          ...entity,
          options: { ...entity.options, width: nextWidth },
          board: { x: pivotX - nextWidth / 2, y: entity.board.y },
          updatedAt: Date.now(),
        }
      })
    },
    [store],
  )

  /** Roll a page up to its tab, or open it again. */
  const toggleArticleCollapsed = useCallback(
    (id: string) => {
      store.updateEntities([id], (entity) =>
        entity.kind === 'article'
          ? {
              ...entity,
              options: { ...entity.options, collapsed: !entity.options.collapsed },
              updatedAt: Date.now(),
            }
          : entity,
      )
    },
    [store],
  )

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
  /**
   * Whether a board-space point is over any page's sheet.
   *
   * The axis-aligned footprint, not the swept one: this is the forgiving test
   * that decides whether a pin dropped on a page keeps the quote it holds or is
   * pulled out into the cork, and being generous about a swung page is the
   * right way to be wrong — the alternative is a pin yanked out of the text by
   * a drop that visibly landed on paper.
   */
  const overAnyArticle = useCallback((board: Point): boolean => {
    for (const article of articlesByIdRef.current.values()) {
      const size = viewsRef.current.get(article.id)?.size
      if (!size || size.width <= 0 || size.height <= 0) continue
      if (
        board.x >= article.board.x &&
        board.x <= article.board.x + size.width &&
        board.y >= article.board.y &&
        board.y <= article.board.y + size.height
      ) {
        return true
      }
    }
    return false
  }, [])

  const handlePinDrop = useCallback(
    (pinId: string, clientX: number, clientY: number) => {
      const pin = entitiesRef.current.find((entity) => entity.id === pinId)
      if (!pin || !isPin(pin)) return

      const range = caretRangeThroughPins(clientX, clientY)
      const articleId = range ? articleIdFromRange(range) : null
      const view = articleId ? viewsRef.current.get(articleId) : null
      const element = articleId
        ? (articleViewsRef.current.nodes().get(articleId)?.article ?? null)
        : null

      if (range && articleId && view && element) {
        const flatRange = domRangeToFlatRange(view.projection, range)
        const anchor = flatRange
          ? createAnchor(view.projection.flat.text, flatRange.start, flatRange.end)
          : null

        if (anchor?.quote) {
          // The nudge test is only about the pin's *own* words. Dragged onto a
          // different page, it is being re-pinned, however close the pointer is
          // to where it used to be — those are two pages' coordinates and
          // subtracting them is meaningless.
          if (isAnchoredPin(pin) && pin.articleId === articleId) {
            // Already on these words: a nudge, and the drag stored the offset.
            if (sameAnchor(pin.anchor, anchor)) return

            // On other words, but still close enough to the pin's own to be the
            // same adjustment — see the note above.
            const box = element.getBoundingClientRect()
            const zoom = cameraRef.current.zoom || 1
            const local = { x: (clientX - box.left) / zoom, y: (clientY - box.top) / zoom }
            const rect = pinsRef.current.find((entry) => entry.id === pinId)?.rect
            if (rect && withinSlop(local, rect, NUDGE_SLOP_PX / zoom)) return
          }

          // The page it landed on becomes the page it belongs to, which is what
          // makes a drag able to *move* a pin between sheets rather than only
          // between words on one.
          replaceEntity(pinToText(pin, articleId, anchor))
          return
        }
      }

      // Off the readable text. On a page the pin keeps the quote it holds —
      // this is the page-with-no-words case, where the caret had nothing to
      // clamp to — and off every page it is pulled out and stuck in the cork.
      const board = worldPoint(clientX, clientY)
      if (overAnyArticle(board)) return

      replaceEntity(pinToBoard(pin, board))
    },
    [overAnyArticle, replaceEntity, worldPoint],
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

  /**
   * Take the camera to an entity a mention named.
   *
   * Declared before the click handler that calls it — a `useCallback` reads its
   * dependencies as it is created, so a `const` declared below would be in its
   * temporal dead zone and throw on the first render.
   *
   * Falls back to the entity's anchor point when it has no measured box: a page
   * that has not been laid out yet, or one rolled up thin enough that there is
   * nothing to measure, still has a place on the board, and "went nowhere at
   * all" is a worse answer than "went to the pin".
   */
  const flyToEntity = useCallback(
    (entity: BoardEntity) => {
      const [rect] = frameTargets([entity], entityContextRef.current)
      if (rect) {
        flyTo(rect)
        return
      }
      const point = descriptorFor(entity).anchorPoint(entity, entityContextRef.current)
      if (point) flyTo({ x: point.x, y: point.y, width: 0, height: 0 })
    },
    [flyTo],
  )

  const handleArticleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      // A mention, before anything else the page's body does with a click.
      // Gated on the same modifiers as the rest: ctrl-click is how a pin is
      // placed, and it must go on doing that even over a link.
      if (!pinMode && !event.ctrlKey && !event.metaKey) {
        // A click usually lands on a text node, and `closest` is only on an
        // Element — the deleted linkifier had exactly this guard.
        const target = event.target
        const element =
          target instanceof Element
            ? target
            : target instanceof Node
              ? target.parentElement
              : null
        const mention = element?.closest(`[${MENTION_ATTRIBUTE}]`) ?? null
        if (mention) {
          const name = mention.getAttribute(MENTION_ATTRIBUTE) ?? ''
          const entity = resolveMention(name, entitiesRef.current)
          if (entity) {
            // The anchor carries an href so it can be focused and reached by
            // keyboard; this is what stops it navigating there.
            event.preventDefault()
            flyToEntity(entity)
            return
          }
        }
      }

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
    [flyToEntity, pinAt, pinMode, stringAt, worldPoint],
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

      // Kept so the release can tell a click from a drag. Screen px, like every
      // other travel threshold on the board.
      stringStartRef.current = { x: event.clientX, y: event.clientY }

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
    (clientX: number, clientY: number, tapped: boolean) => {
      const from = dragFromRef.current
      stringStartRef.current = null
      if (!from) return

      // A press that never left the tack is a click on it, not a string meant
      // to go nowhere, and it opens the editor behind the pin. Right-click has
      // done that all along; a plain click is the gesture people reach for
      // first, and a board where the obvious one does nothing is a board you
      // have to be taught.
      //
      // Pins only. The identical gesture starts a string from the pin holding
      // a picture up, and a picture has no editor to open — for it, a click
      // that travels nowhere goes on doing nothing, which is what it did
      // before.
      if (tapped && byIdRef.current.has(from)) {
        openPinEditorAt(from, clientX, clientY)
        cancelAnimationFrame(frameRef.current)
        originRef.current = null
        dragFromRef.current = null
        setDragFrom(null)
        return
      }

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
          // Halfway along, which is where a tag looks like it belongs and is
          // the easiest place to grab.
          labelAt: 0.5,
          visibility: 'shared',
        })
      }

      cancelAnimationFrame(frameRef.current)
      originRef.current = null
      dragFromRef.current = null
      setDragFrom(null)
    },
    [store, worldPoint, openPinEditorAt],
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
    // A pointercancel is the browser taking the gesture away — a system
    // gesture, the window losing focus — and is never somebody clicking a
    // pin, so it is finished as a drag that simply ended nowhere.
    const onUp = (event: PointerEvent): void => {
      const start = stringStartRef.current
      const travelled = start
        ? Math.hypot(event.clientX - start.x, event.clientY - start.y)
        : Number.POSITIVE_INFINITY
      finishString(event.clientX, event.clientY, travelled < DRAG_THRESHOLD)
    }
    const onCancel = (event: PointerEvent): void =>
      finishString(event.clientX, event.clientY, false)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
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
   * Frame everything on the board, not just the pages.
   *
   * Pins stuck into the cork and post-its laid beside the paper are the whole
   * point of a board — fitting to the document alone would deliberately hide
   * the things you pinned around it. And the pages themselves are entities now,
   * so they arrive through the same loop as everything else: there is no longer
   * one rectangle to push in by hand, and no longer one page it could describe.
   */
  const fitBoard = useCallback(() => {
    const canvas = document.querySelector('[data-testid="board-canvas"]')
    const box = canvas?.getBoundingClientRect()
    if (!box || box.width === 0) return

    const targets = frameTargets(entities, entityContextRef.current)
    if (targets.length === 0) return
    const fitted = fitBounds(targets, { width: box.width, height: box.height }, 56)
    if (fitted) commitCamera(fitted)
  }, [entities, commitCamera])

  const handleContextTarget = useCallback((target: BoardContextTarget) => {
    const element = target.target instanceof Element ? target.target : null
    const pinId = element?.closest('[data-pin-id]')?.getAttribute('data-pin-id')

    if (pinId) {
      openPinEditorAt(pinId, target.clientX, target.clientY)
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
  }, [openPinEditorAt])

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

  /**
   * A tap on a page's tab: open it if it is rolled up, otherwise toggle it.
   *
   * Tapping selects the page, and a selected page is one whose editor is open —
   * so this is also how editing is entered and left. A rolled-up page opens on
   * the first click rather than toggling, because that is what the tab is for
   * once there is nothing else on the sheet to click; only an open page toggles,
   * or closing one would leave it shut with no way back that anyone would find.
   */
  const tapArticleTab = useCallback(
    (id: string) => {
      if (articlesByIdRef.current.get(id)?.options.collapsed) {
        toggleArticleCollapsed(id)
        setSelection(new Set([id]))
        return
      }
      setSelection((previous) =>
        previous.size === 1 && previous.has(id) ? new Set() : new Set([id]),
      )
    },
    [toggleArticleCollapsed],
  )

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
      if (id) moveEntity(id, delta)
      // Nothing to fall back to. Every kind that can be moved now carries its id
      // on the element, so an element with no id is one this board does not
      // move — where the page used to need a branch of its own here because it
      // was the one thing on the board that was not an entity.
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

  /**
   * Rewrite the words on one entity's date.
   *
   * Free text, not a date input, and the reason is the campaign's calendar
   * rather than laziness: "3rd of Eleint" and "the night of the storm" are
   * facts about the fiction, and a picker would replace them with a Gregorian
   * date no one in it has ever written down. `occurredAt` — the stamp that
   * orders the board — is left alone, so what a pin says and where it sorts
   * are two different things, which is what having both fields is for.
   *
   * Emptying it removes the date rather than storing a blank one: the tag and
   * the hover card both hide on a falsy label, and a pin from before the party
   * started dating things should be able to say so.
   */
  /** Set how large a note's writing is, as a multiple of the base size. */
  const setNoteFontScale = useCallback((id: string, fontScale: number) => {
    store.updateEntities([id], (entity) =>
      entity.kind === 'note' ? { ...entity, fontScale, updatedAt: Date.now() } : entity,
    )
  }, [])

  /** Rewrite what one entity is called. The name a mention resolves against. */
  const setEntityTitle = useCallback((id: string, title: string) => {
    store.updateEntities([id], (entity) => ({ ...entity, title, updatedAt: Date.now() }))
  }, [])

  const setEntityDate = useCallback((id: string, dateLabel: string) => {
    store.updateEntities([id], (entity) => ({
      ...entity,
      dateLabel: dateLabel.trim() === '' ? undefined : dateLabel,
      updatedAt: Date.now(),
    }))
  }, [])

  /** Take an entity off the board, and every string that touched it with it. */
  const removeEntity = useCallback(
    (id: string) => {
      store.removeEntities([id])
      setEditingPin(null)
    },
    [store],
  )

  /**
   * Whether the camera still owes the board a fit.
   *
   * Set by an import, cleared once the pages it brought have been measured. The
   * board fits itself once, on the first measurement, and a board that arrives
   * later is a board the camera has already finished with — so without this an
   * imported case file would open wherever the previous one happened to leave
   * the view, which for a file written on another machine is off screen
   * entirely.
   */
  const [awaitingFit, setAwaitingFit] = useState(false)

  /** Hand the board to the browser as a file. */
  const exportBoard = useCallback(() => {
    const board = store.get()
    const url = URL.createObjectURL(
      new Blob([serializeBoard(board)], { type: 'application/json' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = boardFileName(board)
    link.rel = 'noopener'
    document.body.append(link)
    link.click()
    link.remove()
    // Revoked on the next turn of the loop rather than straight away: the click
    // hands the URL to the download machinery, and Safari reads it after the
    // handler returns. Revoking synchronously is the version that works
    // everywhere except the browser somebody is actually using.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [store])

  /**
   * Load a board out of a file, replacing whatever is on the board now.
   *
   * Returns the reason it could not be read, or null when it was. The panel
   * shows it: this owns the store, so it owns the reporting too, and a file
   * that was refused without a word is the failure mode that makes people think
   * their board is corrupt when it is their JSON that is.
   *
   * The selection, the open editor and the menu all go, for the reason
   * `clearBoard` gives — they hold ids that the incoming board does not answer
   * for — and the camera is told to fit again, because the pages it was framing
   * are gone.
   */
  const importBoard = useCallback(
    async (file: File): Promise<string | null> => {
      let text: string
      try {
        text = await readBoardFile(file)
      } catch {
        // A file the browser cannot read at all — a directory, a permission it
        // will not grant — is reported like any other refusal rather than being
        // allowed to reject out of the click handler and vanish.
        return 'That file could not be read.'
      }
      const result = parseBoardFile(text)
      if (!result.ok) return result.reason

      store.replaceAll(result.board)
      setSelection(new Set())
      setEditingPin(null)
      setHovered(null)
      setContextMenu(null)
      setAwaitingFit(true)
      return null
    },
    [store],
  )

  const clearBoard = useCallback(() => {
    // Every id, rather than a "clear" the store would have to special-case: a
    // board that is emptied by describing each thing that left it is a board
    // that can be emptied by a peer too. It takes the pages with it — an empty
    // board is empty — which is why the selection has to go too: a selection
    // holding an id nothing answers for is a set that will silently match
    // again the day an id is reused.
    store.removeEntities(store.get().entities.map((entity) => entity.id))
    setSelection(new Set())
    setEditingPin(null)
    setHovered(null)
    setContextMenu(null)
  }, [store])


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
  const anchorPoints = useMemo(() => {
    const map = new Map<string, Point>()
    for (const entity of entities) {
      const descriptor = descriptorFor(entity)
      if (!descriptor.capabilities(entity).connectable) continue
      const point = descriptor.anchorPoint(entity, entityContext)
      if (point) map.set(entity.id, point)
    }
    // No page is spliced in by hand any more. A page's tack is its own entity's
    // `anchorPoint`, produced by the same loop as a picture's and a post-it's —
    // which is also what removed the collision this map used to have to be
    // careful about: the singleton's pin was keyed by a constant, so a real
    // article entity with that id would have overwritten it or been overwritten
    // by it, depending on which line ran last.
    return map
  }, [entities, entityContext])
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

  /**
   * Where the border bar hangs, in the board's own coordinates.
   *
   * The picture's *swept* box converted through the camera, so a tilted
   * picture's bar sits under the picture rather than under the upright
   * rectangle it is drawn from — and in viewport space, where a control
   * belongs. Null until the descriptors have a size to work with.
   */

  /** Slide a string's note to a new place along the rope. */
  const slideStringNote = useCallback(
    (id: string, t: number) => {
      store.updateStrings([id], (link) => ({ ...link, labelAt: t }))
    },
    [store],
  )

  /** Write on a string's note. An empty one takes the note off. */
  const writeStringNote = useCallback(
    (id: string, label: string) => {
      store.updateStrings([id], (link) => {
        const next = label || undefined
        return next === link.label ? link : { ...link, label: next }
      })
    },
    [store],
  )

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
        // Pages are not deleted by a keystroke, and the reason is the same one
        // the close button already runs on: every pin anchored into a page has
        // nowhere else to be, so a page deleted here orphans all of its notes
        // at once. The × rolls a page up instead, which is what a page's own
        // control offers and what the board can come back from.
        const doomed = [...selection].filter(
          (id) => articlesByIdRef.current.get(id) === undefined,
        )
        if (doomed.length > 0) {
          event.preventDefault()
          removeEntities(doomed)
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

  /**
   * The one page whose editor is open, if any.
   *
   * Exactly one, for the same reason as the picture above — and this is what
   * replaced a board-wide `documentSelected` boolean. That flag could not tell
   * which page it meant, so with two pages it would have opened one editor over
   * another page's text. Selecting a page *is* opening its editor; the close
   * button and Escape are how you stop.
   */
  const selectedArticle = useMemo(
    () => (selection.size === 1 ? articles.find((a) => selection.has(a.id)) ?? null : null),
    [articles, selection],
  )

  /**
   * Where the pages are, for the two things that frame them.
   *
   * Empty until the sheets have been measured, which is what the board's first
   * fit waits on — and what disables "zoom to fit" on a board with no pages on
   * it, where there is nothing to frame but the cork.
   */
  const pageRects = useMemo(() => frameTargets(articles, entityContext), [articles, entityContext])

  /**
   * Where the camera opens.
   *
   * Everything on the board — but only once the pages have been measured, which
   * is what the gate is for. Framing on the pages alone was right when a page
   * was the only thing on the board; now that there are notes down the margin
   * and tacks off to the right, it would open with all of them off screen.
   * Framing on everything *without* the gate is worse in a subtler way: on the
   * first render the pages have no measured size, so the frame would be built
   * from the pins and notes alone, fire once, and hold a view of the cork with
   * both pages cropped out of it.
   */
  const openingFrame = useMemo(
    () => (pageRects.length === 0 ? NO_RECTS : frameTargets(entities, entityContext)),
    [entities, entityContext, pageRects],
  )

  /**
   * Fit the camera to a board that has just arrived.
   *
   * Waits for `pageRects`, which is the same gate the opening fit uses and for
   * the same reason: on the render an import lands, the pages it brought have
   * no measured size, so framing now would build the view out of the notes and
   * tacks alone and crop every page out of it. The dependency on `pageRects` is
   * what makes this run again once the sheets are measured.
   */
  useEffect(() => {
    if (!awaitingFit || pageRects.length === 0) return
    fitBoard()
    setAwaitingFit(false)
  }, [awaitingFit, pageRects, fitBoard])

  /**
   * The selected picture's footprint in the board's own viewport space.
   *
   * A box rather than the single point this used to hand over. The bar has to
   * decide whether it fits *below* the picture, and that question needs the
   * picture's top edge as well as its bottom — so the component that knows the
   * camera hands over the whole rectangle and lets `EdgePicker` place itself.
   *
   * `EDGE_PICKER_DROP` is deliberately not added here. It is a screen-pixel
   * clearance (see `tuning.ts`), and adding it to a board-space point before
   * this conversion — which is what this did — scales it with the zoom: the
   * gap was 44px at 100% and 30px at 68%, which is the opposite of what
   * "screen px" was chosen for.
   */
  /**
   * Where the caption goes: under the picture, in the board's own box.
   *
   * Centred on the picture but clamped to the board, so a picture at the edge
   * does not open a field half off screen. Screen px, like the bar below it.
   */
  const captionAt = useMemo(() => {
    if (!selectedImage) return null
    const box = descriptorFor(selectedImage).bounds(selectedImage, entityContext)
    if (!box) return null
    const topLeft = boardToScreen(camera, { x: box.x, y: box.y })
    const bottomRight = boardToScreen(camera, { x: box.x + box.width, y: box.y + box.height })
    return {
      x: (topLeft.x + bottomRight.x) / 2 - CAPTION_WIDTH / 2,
      y: bottomRight.y + IMAGE_CAPTION_TOP,
    }
  }, [selectedImage, entityContext, camera])

  const edgePickerAnchor = useMemo(() => {
    if (!selectedImage) return null
    const box = descriptorFor(selectedImage).bounds(selectedImage, entityContext)
    if (!box) return null
    const topLeft = boardToScreen(camera, { x: box.x, y: box.y })
    const bottomRight = boardToScreen(camera, {
      x: box.x + box.width,
      y: box.y + box.height,
    })
    return {
      left: topLeft.x,
      top: topLeft.y,
      width: bottomRight.x - topLeft.x,
      // The caption that the selected picture is wearing, in screen px like
      // the bar itself. Without it the bar is placed 44px under the picture
      // and lands across the fields you are meant to be typing in.
      height: bottomRight.y - topLeft.y + IMAGE_CAPTION_SPACE,
    }
  }, [selectedImage, entityContext, camera])

  /**
   * Everything on the board that has a name a mention could use.
   *
   * Pages and pictures only — the two kinds `resolveMention` will match — and
   * only those actually titled, since the empty title a note or a tack carries
   * is not a name.
   */
  const named = useMemo(
    () =>
      entities.flatMap((entity) => {
        if (entity.kind !== 'article' && entity.kind !== 'image') return []
        const name = entity.title?.trim()
        return name ? [{ id: entity.id, name, kind: entity.kind }] : []
      }),
    [entities],
  )

  /** The names, lowercased, for deciding whether a mention has gone cold. */
  const mentionNames = useMemo(
    () => new Set(named.map((candidate) => candidate.name.toLowerCase())),
    [named],
  )

  /** The same list for the editor's `@` list, in board order. */
  const mentions = useMemo(
    () => named.map(({ id, name, kind }) => ({ id, name, kind })),
    [named],
  )

  const byId = useMemo(() => new Map(pins.map((pin) => [pin.id, pin])), [pins])
  /**
   * The same map, for a callback that outlives the render that made it.
   *
   * `finishString` is bound to window listeners, so it cannot close over a
   * memo — it would go on answering with the board as it was when the drag
   * began. It is asked one question: is this id a pin, or the pin holding a
   * picture up?
   */
  const byIdRef = useRef(byId)
  byIdRef.current = byId

  const anchored = pins.filter((pin) => pin.rect)
  const freePins = pins.filter((pin) => pin.board)
  const orphaned = pins.filter((pin) => pin.status === 'orphaned')
  const repaired = pins.filter((pin) => pin.status === 'repaired').length
  /**
   * Found exactly where they were pinned, counted by status rather than by
   * subtraction.
   *
   * The legend used to say `pins.length - repaired - orphaned`, which silently
   * counted every *free* pin as anchored — a tack pushed into the cork has no
   * quote to resolve and is neither repaired nor orphaned, so it landed in the
   * "anchored exactly" column. On a board whose pins were mostly in the cork
   * that read as a confident lie: "Anchored exactly (3)" over three tacks
   * holding nothing. The count now says what it means.
   */
  const exact = pins.filter((pin) => pin.status === 'exact').length
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
          disabled: pageRects.length === 0,
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
          {selectedArticle && (
            <PaperEditor
              title={selectedArticle.title?.trim() || 'Untitled sheet'}
              value={selectedArticle.bodyMd}
              onChange={(body) => setEntityBody(selectedArticle.id, body)}
              onClose={() => setSelection(new Set())}
              mentions={mentions}
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
              onCameraChange={commitCamera}
              onContextTarget={handleContextTarget}
              onFileDrop={handleFileDrop}
              onFileDragOver={handleDragOver}
              onBackgroundClick={handleBackgroundClick}
              // Pin mode claims the left button for pinning, so the rubber
              // band stands down rather than fighting it for the same drag.
              onMarquee={pinMode ? undefined : handleMarquee}
              pinMode={pinMode}
              className="min-h-0 flex-1"
              fitTo={openingFrame}
              backdrop={(viewport) => <GridLayer camera={camera} viewport={viewport} />}
              overlay={
                <>
                  {/* The border bar hangs under the selected picture, placed
                      here rather than inside the world layer because that layer
                      is a transformed element — its own stacking context — and
                      nothing inside it can be lifted above this palette. */}
                  {/* The caption, above the bar and below the picture. Both
                      are chrome, so both are placed here rather than inside
                      the world layer — see `ImageCaption` for what that cost
                      the first time. */}
                  {selectedImage && captionAt ? (
                    <ImageCaption
                      x={captionAt.x}
                      y={captionAt.y}
                      title={selectedImage.title ?? ''}
                      description={selectedImage.bodyMd}
                      onTitle={(next) => setEntityTitle(selectedImage.id, next)}
                      onDescription={(next) => setEntityBody(selectedImage.id, next)}
                    />
                  ) : null}

                  {selectedImage && edgePickerAnchor ? (
                    <EdgePicker
                      seed={selectedImage.edgeSeed}
                      edge={selectedImage.edge}
                      anchor={edgePickerAnchor}
                      onPick={(style) => setImageEdge(selectedImage.id, style)}
                    />
                  ) : null}

                  <BoardPalette
                    canCreate={can(LOCAL_VIEWER, 'create')}
                    onDropNote={(clientX, clientY) => {
                    // Centred on the drop, because that is what the note under
                    // the pointer showed: a note that landed with its corner
                    // there would appear half a note from where it was aimed.
                    const at = worldPoint(clientX, clientY)
                    createPostIt({
                      x: at.x - NOTE_SIZE.width / 2,
                      y: at.y - NOTE_SIZE.height / 2,
                    })
                  }}
                  // A tack's own coordinate *is* its centre, so this one lands
                  // where it was put without a correction.
                    onDropPin={(clientX, clientY) => createFreePin(worldPoint(clientX, clientY))}
                  />
                </>
              }
            >
              {/* One sheet per page, in board order — so pages sit under the
                  things pinned around them, as they always have. Each is given
                  only its own tacks: a sheet that drew the whole anchored list
                  would draw every other page's pins too, in its own
                  coordinates. */}
              {articles.map((article) => (
                <ArticleSheet
                  key={article.id}
                  article={article}
                  nodes={articleViews.nodesFor(article.id)}
                  anchored={anchored.filter((pin) => pin.articleId === article.id)}
                  selected={selection.has(article.id)}
                  selectedPins={selection}
                  movingPin={movingPin}
                  zoom={camera.zoom}
                  pinAt={anchorPoints.get(article.id) ?? null}
                  mentionNames={mentionNames}
                  onClickArticle={handleArticleClick}
                  onStartYarn={beginString}
                  onMoveOne={moveOne}
                  onPinDrop={handlePinDrop}
                  onOpenPinEditor={openPinEditorAt}
                  onPinHover={handlePinHover}
                  onRotate={(degrees) => rotateEntity(article.id, degrees)}
                  onResize={(width) => resizeArticle(article.id, width)}
                  onToggleCollapsed={() => toggleArticleCollapsed(article.id)}
                  onTapTab={() => tapArticleTab(article.id)}
                  onMove={(delta) => moveEntity(article.id, delta)}
                  toBoard={worldPoint}
                  articleToBoard={articleToBoard}
                />
              ))}

              <EntityLayer
                freePins={freePins}
                images={images}
                postIts={postIts}
                selection={selection}
                movingPin={movingPin}
                zoom={camera.zoom}
                articleToBoard={articleToBoard}
                toBoard={worldPoint}
                anchorOf={(id) => anchorPoints.get(id) ?? null}
                onStartYarn={beginString}
                onMoveOne={moveOne}
                onMoveEntity={moveEntity}
                onPinDrop={handlePinDrop}
                onOpenPinEditor={openPinEditorAt}
                onPinHover={handlePinHover}
                onRotate={rotateEntity}
                onResize={resizeImage}
                onSelectImage={selectImage}
                onSelectNote={selectOnly}
                onSetBody={setEntityBody}
                onResizeNote={resizeNote}
                onSetFontScale={setNoteFontScale}
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
              {/* A note on every string that has one. Rendered after the yarn
                  so the card sits on top of the wool rather than under it, and
                  outside the SVG because it is a card, not a path. */}
              {drawableStrings.map((drawn) => {
                const link = strings.find((candidate) => candidate.id === drawn.id)
                if (!link) return null
                return (
                  <StringNote
                    key={`note-${link.id}`}
                    link={link}
                    from={drawn.from}
                    to={drawn.to}
                    selected={selection.has(link.id)}
                    toBoard={worldPoint}
                    onSlide={(t) => slideStringNote(link.id, t)}
                    onWrite={(text) => writeStringNote(link.id, text)}
                  />
                )
              })}

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
              label={`Anchored exactly (${exact})`}
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
                // Only for a pin whose words are not already on the board. A
                // described pin wears a tag (`entities/Tack.tsx`), and a card
                // that repeated it on hover would be the same sentence twice,
                // one of them covering the other. What is left are the pins
                // with a quote and no note of their own — the one case where
                // hovering still has something to add.
                return pin && pin.body.trim().length === 0
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
          onDateChange={(dateLabel) => setEntityDate(editingPin.id, dateLabel)}
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
        onExportBoard={exportBoard}
        onImportBoard={importBoard}
      />
    </div>
  )
}
