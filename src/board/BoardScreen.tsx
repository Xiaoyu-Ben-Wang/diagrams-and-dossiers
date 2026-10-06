import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createAnchor } from '../anchors/create'
import { domRangeToFlatRange } from '../anchors/dom'
import { caretRangeFromPoint, caretRangeThroughPins } from '../anchors/caret'
import { CAMPAIGN_EPOCH, FIRST_SESSION, SESSION_GAP_MS } from '../app/demo'
import { IMAGE_CAPTION_SPACE, IMAGE_CAPTION_TOP, NUDGE_SLOP_PX, SLACK_STEP, SNAP_RADIUS, STRING_HIT_PX } from './tuning'
import { DRAG_THRESHOLD } from './useBoardDrag'
import { CAMERA_FLIGHT_MS, prefersReducedMotion } from './motion'
import { MENTION_ATTRIBUTE, resolveMention } from '../markdown/mentions'
import { articleIdFromRange, entityIdFromElement, withinSlop } from './view'
import { useArticleViews, usePinViews } from './useArticleViews'
import { ExportImageDialog, type ExportOptions } from './ExportImageDialog'
import { SHADOW as IMAGE_SHADOW } from './ImageCard'
import { EXPORT_DOT_TILE, backgroundFor, patternFor, planExport } from './export-image'
import { renderBoardPng } from './export-png'
import { YarnBead } from "./entities/YarnBead";
import { StringLayer } from './StringLayer'
import { EdgePicker, type Box } from './EdgePicker'
import { NoteStyleMenu } from './NoteStyleMenu'
import { CAPTION_WIDTH, ImageCaption } from './ImageCaption'
import { BoardPalette } from './Palette'
import { StringNote } from './StringNote'
import type { DrawableString, PinView } from './view'
import { TopBar } from '../app/TopBar'
import { can, LOCAL_VIEWER } from '../access/permissions'
import { BoardCanvas, type BoardContextTarget } from './BoardCanvas'
import { createBoardStore, useBoard, type BoardState, type BoardStore } from './store'
import { boardFileName, parseBoardFile, readBoardFile, serializeBoard } from './board-file'
import { ArrowLeft } from 'lucide-react'

import { boardNameFrom } from '../boards/board-record'

import { ImportChoice } from './ImportChoice'
import { attachAutosave } from '../boards/autosave'
import type { EdgeStyle } from './edges'
import { decodeImageFile, firstImage } from './image-file'
import { clampTilt, rotateAbout } from './pivot'

import { NO_RECTS, frameTargets } from './frame'
import { ArticleSheet } from './ArticleSheet'
import { EntityLayer } from './EntityLayer'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { GridLayer } from './GridLayer'
import { PaperEditor } from './PaperEditor'
import { PinTooltip } from './PinTooltip'
import { PinEditor } from './PinEditor'
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
} from './camera'
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
} from './yarn'
import { maxStrandDeviation } from './yarn-style'
import {
  freshEdgeSeed,
  imageFootprint,
  newAnchoredPin,
  newFreePin,
  newImage,
  newNote,
} from '../model/create'
import { descriptorFor, NOTE_SIZE } from '../model/kinds'
import { pinToBoard, pinToText, sameAnchor } from '../model/pinning'
import {
  isAnchoredPin,
  isPin,
  type ArticleEntity,
  type BoardEntity,
  type EntityContext,
  type ImageEntity,
  type NoteEntity,
  type NoteStyle,
} from '../model/types'
import { PREFERENCES_PANEL_ID, PreferencesPanel } from '../theme/PreferencesPanel'
import { preferenceVariables, setPreferences, usePreferences } from '../theme/preferences'

function pictureName(fileName: string): string {
  const trimmed = fileName.replace(/\.[^.]+$/, '').trim()
  return trimmed === '' ? fileName : trimmed
}

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
export interface BoardScreenProps {
  /** The document to open. Loaded before this renders, never empty by accident. */
  board: BoardState
  /** Called as the document changes; the caller decides where it goes. */
  onSave?: (board: BoardState) => void | Promise<void>
  /** Where the back control goes. Left out when there is nowhere to go back to. */
  onBack?: () => void
  /** Which board this is, for the top bar. */
  name?: string
  /** Adds an imported board to the library, rather than into this one. */
  onAddBoard?: (name: string, board: BoardState) => void | Promise<void>
}

export function BoardScreen({ board, onSave, onBack, name, onAddBoard }: BoardScreenProps) {
  const preferences = usePreferences()

  const storeRef = useRef<BoardStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createBoardStore({ viewer: LOCAL_VIEWER, initial: board })
  }
  const store = storeRef.current
  const { entities, strings } = useBoard(store)

  useEffect(() => {
    if (!onSave) return
    const autosave = attachAutosave({ store, save: onSave })
    return () => autosave.detach()
  }, [store, onSave])

  // Memoised: these feed dependency lists, and a fresh array every render would
  // re-run the anchor projection — which sets state, so the board would loop.
  const placed = useMemo(() => entities.filter(isPin), [entities])
  const postIts = useMemo(
    () => entities.filter((entity): entity is NoteEntity => entity.kind === 'note'),
    [entities],
  )
  const articles = useMemo(
    () => entities.filter((entity): entity is ArticleEntity => entity.kind === 'article'),
    [entities],
  )
  const articlesById = useMemo(
    () => new Map(articles.map((article) => [article.id, article])),
    [articles],
  )

  const [dragFrom, setDragFrom] = useState<string | null>(null)
  const stringStartRef = useRef<{ x: number; y: number } | null>(null)
  const [fontsLoaded, setFontsLoaded] = useState(() => !globalThis.document?.fonts)
  const [camera, setCamera] = useState<Camera>(IDENTITY_CAMERA)
  const zoomRef = useRef(camera.zoom)
  zoomRef.current = camera.zoom

  const articleViews = useArticleViews(articles, fontsLoaded)
  const viewsRef = useRef(articleViews.views)
  viewsRef.current = articleViews.views
  const articleViewsRef = useRef(articleViews)
  articleViewsRef.current = articleViews
  const pins = usePinViews(placed, articlesById, articleViews, zoomRef)

  const [editingPin, setEditingPin] = useState<{ id: string; x: number; y: number } | null>(null)

  const openPinEditorAt = useCallback((id: string, clientX: number, clientY: number) => {
    setEditingPin({ id, x: clientX, y: clientY })
  }, [])
  const [contextMenu, setContextMenu] = useState<
    (BoardContextTarget & { board: Point; entityId: string | null }) | null
  >(null)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set())
  const [movingPin, setMovingPin] = useState<string | null>(null)
  const [hovered, setHovered] = useState<{ id: string; element: Element } | null>(null)

  const articleToBoard = useCallback((articleId: string, local: Point): Point | null => {
    const article = articlesByIdRef.current.get(articleId)
    const view = viewsRef.current.get(articleId)
    if (!article || !view) return null

    const pivot = { x: article.options.width / 2, y: 0 }
    const inPaper = { x: view.inset.x + local.x, y: view.inset.y + local.y }
    const turned = rotateAbout(pivot, inPaper, article.rotation)
    return { x: article.board.x + turned.x, y: article.board.y + turned.y }
  }, [])

  const entityContext = useMemo<EntityContext>(() => {
    const rects = new Map(pins.map((pin) => [pin.id, pin.rect]))
    return {
      articleToBoard,
      anchorRect: (id) => rects.get(id) ?? null,
      articleSize: (articleId) => {
        const size = articleViews.views.get(articleId)?.size
        // An unmeasured page (jsdom, or a first frame) is not a zero-size one:
        // null keeps an unmeasured board from framing the origin.
        return size && size.width > 0 && size.height > 0 ? size : null
      },
    }
  }, [articleToBoard, pins, articleViews])
  const entityContextRef = useRef(entityContext)
  entityContextRef.current = entityContext

  const [exportImageOpen, setExportImageOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<{
    board: BoardState
    fileName: string
  } | null>(null)

  /** Open for one note, or for the palette pad where it sets what new notes are made of. */
  const [noteStyleMenu, setNoteStyleMenu] = useState<
    { at: 'pad'; anchor: Box } | { at: 'note'; id: string } | null
  >(null)

  /** The same "everything" the opening view frames, so the two cannot disagree. */
  const exportRects = useMemo(() => frameTargets(entities, entityContext), [entities, entityContext])



  /**
   * Draw the board and hand back the file, or a reason it could not be drawn.
   * The error path is a cross-origin picture tainting the canvas, which is the
   * only way this fails that the person can do something about.
   */
  const renderBoardImage = useCallback(
    async (options: ExportOptions): Promise<Blob | string> => {
      const world = document.querySelector<HTMLElement>('[data-testid="board-world"]')
      if (!world) return 'The board is not on screen to draw.'
      const plan = planExport(exportRects, options.scale)
      if (!plan) return 'There is nothing on the board to export.'

      try {
        return await renderBoardPng({
          world,
          plan,
          background: backgroundFor(options, preferences.theme),
          pattern: patternFor(options, preferences.theme),
          patternTile: EXPORT_DOT_TILE,
          variables: preferenceVariables(preferences),
          imageShadow: IMAGE_SHADOW,
        })
      } catch (error) {
        return error instanceof Error ? error.message : 'The image could not be drawn.'
      }
    },
    [exportRects, preferences],
  )

  const livePathRef = useRef<SVGPathElement>(null)

  const springRef = useRef({ x: createSpring(0), y: createSpring(0) })
  const targetRef = useRef<Point>({ x: 0, y: 0 })
  const originRef = useRef<Point | null>(null)
  const frameRef = useRef<number>(0)
  const cameraRef = useRef(camera)

  // Deliberately not frameRef: two animations sharing one handle cancel each other.
  const flightRef = useRef<number | null>(null)

  const cancelFlight = useCallback(() => {
    if (flightRef.current !== null) {
      cancelAnimationFrame(flightRef.current)
      flightRef.current = null
    }
  }, [])

  const commitCamera = useCallback(
    (next: Camera) => {
      cancelFlight()
      setCamera(next)
    },
    [cancelFlight],
  )

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
  // Refs rather than the arrays: a pointer handler rebuilt on every entity change
  // would rebind mid-gesture.
  const entitiesRef = useRef(entities)
  entitiesRef.current = entities
  const articlesByIdRef = useRef(articlesById)
  articlesByIdRef.current = articlesById
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

  const worldPoint = useCallback((clientX: number, clientY: number): Point => {
    const box = document.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect()
    if (!box) return { x: 0, y: 0 }
    return screenToBoard(cameraRef.current, { x: clientX - box.left, y: clientY - box.top })
  }, [])

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

      createFreePin(worldPoint(clientX, clientY))
    },
    [createFreePin, nextDateLabel, worldPoint],
  )

  const replaceEntity = useCallback(
    (next: BoardEntity) => {
      store.updateEntities([next.id], () => next)
    },
    [store],
  )

  const addImageAt = useCallback(
    async (file: File, clientX: number, clientY: number) => {
      let decoded
      try {
        decoded = await decodeImageFile(file)
      } catch {
        return
      }

      const footprint = imageFootprint(decoded.width, decoded.height)
      const at = worldPoint(clientX, clientY)
      const board = { x: at.x - footprint.width / 2, y: at.y - footprint.height / 2 }

      store.addEntities((state) => [
        newImage(board, decoded.src, footprint, {
          alt: decoded.name,
          title: uniqueName(pictureName(decoded.name), state.entities),
          dateLabel: nextDateLabel(state.entities.length),
        }),
      ])
    },
    [nextDateLabel, worldPoint],
  )

  const rotateEntity = useCallback((id: string, degrees: number) => {
    const angle = clampTilt(degrees)
    store.updateEntities([id], (entity) =>
      entity.kind === 'image' || entity.kind === 'article'
        ? { ...entity, rotation: angle, updatedAt: Date.now() }
        : entity,
    )
  }, [])

  const rerollEdge = useCallback((id: string) => {
    store.updateEntities([id], (entity) =>
      entity.kind === 'image'
        ? { ...entity, edgeSeed: freshEdgeSeed(), updatedAt: Date.now() }
        : entity,
    )
  }, [])

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

  const selectOnly = useCallback((id: string) => {
    setSelection(new Set([id]))
  }, [])

  const selectImage = useCallback(
    (id: string) => {
      const alreadySelected = selection.size === 1 && selection.has(id)
      setSelection(new Set([id]))
      if (!alreadySelected) rerollEdge(id)
    },
    [rerollEdge, selection],
  )

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

  const resizeNote = useCallback(
    (id: string, size: { width: number; height: number }) => {
      store.updateEntities([id], (entity) =>
        entity.kind === 'note' ? { ...entity, ...size, updatedAt: Date.now() } : entity,
      )
    },
    [store],
  )

  const resizeImage = useCallback((id: string, size: { width: number; height: number }) => {
    store.updateEntities([id], (entity) => {
      if (entity.kind !== 'image') return entity
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

  const removeEntities = useCallback((ids: readonly string[]) => {
    if (ids.length === 0) return
    const doomed = new Set(ids)
    store.removeEntities(ids)
    setSelection((previous) => new Set([...previous].filter((id) => !doomed.has(id))))
    setHovered((previous) => (previous && doomed.has(previous.id) ? null : previous))
  }, [])

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
          // The nudge test is only about the pin's own words: on a different page
          // the pointer offset is between two coordinate spaces and means nothing.
          if (isAnchoredPin(pin) && pin.articleId === articleId) {
            if (sameAnchor(pin.anchor, anchor)) return

            const box = element.getBoundingClientRect()
            const zoom = cameraRef.current.zoom || 1
            const local = { x: (clientX - box.left) / zoom, y: (clientY - box.top) / zoom }
            const rect = pinsRef.current.find((entry) => entry.id === pinId)?.rect
            if (rect && withinSlop(local, rect, NUDGE_SLOP_PX / zoom)) return
          }

          replaceEntity(pinToText(pin, articleId, anchor))
          return
        }
      }

      const board = worldPoint(clientX, clientY)
      if (overAnyArticle(board)) return

      replaceEntity(pinToBoard(pin, board))
    },
    [overAnyArticle, replaceEntity, worldPoint],
  )

  const stringAt = useCallback((boardPoint: Point): string | null => {
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
      if (movingPin) {
        setMovingPin(null)
        return
      }

      const board = screenToBoard(cameraRef.current, point)

      if (!ctrlKey && !metaKey) {
        const string = stringAt(board)
        if (string) {
          setSelection(new Set([string]))
          return
        }
        setSelection(new Set())
        return
      }
      const box = document.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect()
      if (!box) return
      pinAt(point.x + box.left, point.y + box.top)
    },
    [pinAt, movingPin, stringAt],
  )

  // Declared before the click handler that calls it: a `useCallback` reads its
  // dependencies at creation, so a `const` declared below would be in its TDZ.
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
      if (!event.ctrlKey && !event.metaKey) {
        // `closest` is on Element only, and a click usually lands on a text node.
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
            event.preventDefault()
            flyToEntity(entity)
            return
          }
        }

        const string = stringAt(worldPoint(event.clientX, event.clientY))
        if (string) setSelection(new Set([string]))
        return
      }

      pinAt(event.clientX, event.clientY)
    },
    [flyToEntity, pinAt, stringAt, worldPoint],
  )

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
    // Without this the browser refuses the drop and opens the file in a new tab.
    const carriesFiles = Array.from(event.dataTransfer?.types ?? []).includes('Files')
    if (carriesFiles) event.preventDefault()
  }, [])

  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      // instanceof Element, not a null check: a paste with nothing focused targets
      // the document, which is a Node and has no `closest`.
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
      // Left button only: stopping propagation on every button swallows the
      // right-click that opens a pin's editor.
      if (event.button !== 0) return

      event.stopPropagation()
      event.preventDefault()

      if (!origin) return

      stringStartRef.current = { x: event.clientX, y: event.clientY }

      originRef.current = origin
      targetRef.current = origin
      springRef.current = { x: createSpring(origin.x, 220, 22), y: createSpring(origin.y, 220, 22) }
      setDragFrom(fromId)
      frameRef.current = requestAnimationFrame(runClock)
    },
    [runClock],
  )

  const finishString = useCallback(
    (clientX: number, clientY: number, tapped: boolean) => {
      const from = dragFromRef.current
      stringStartRef.current = null
      if (!from) return

      if (tapped && byIdRef.current.has(from)) {
        openPinEditorAt(from, clientX, clientY)
        cancelAnimationFrame(frameRef.current)
        originRef.current = null
        dragFromRef.current = null
        setDragFrom(null)
        return
      }

      const drop = worldPoint(clientX, clientY)

      let nearest: { id: string; distance: number } | null = null
      for (const [id, point] of anchorPointsRef.current) {
        if (id === from) continue
        const distance = Math.hypot(point.x - drop.x, point.y - drop.y)
        if (distance <= SNAP_RADIUS && (!nearest || distance < nearest.distance)) {
          nearest = { id, distance }
        }
      }

      if (nearest) {
        store.addString({
          id: crypto.randomUUID(),
          from,
          to: nearest.id,
          slack: DEFAULT_SLACK,
          color: YARN_COLOR,
          style: 'solid',
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

  useEffect(() => {
    if (!dragFrom) return

    const onMove = (event: PointerEvent): void => {
      targetRef.current = worldPoint(event.clientX, event.clientY)
    }
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

  useEffect(() => {
    if (!movingPin) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMovingPin(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [movingPin])

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

  const moveSelection = useCallback((delta: Point) => {
    store.updateEntities([...selection], (entity) => {
      const descriptor = descriptorFor(entity)
      return descriptor.capabilities(entity).movable ? descriptor.move(entity, delta) : entity
    })
  }, [selection])

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

    const onEntity = element ? entityIdFromElement(element) : null

    setContextMenu({
      ...target,
      board: screenToBoard(cameraRef.current, viewportPoint),
      entityId: onEntity,
    })

    if (onEntity) setSelection(new Set([onEntity]))
  }, [openPinEditorAt])

  const createPostIt = useCallback(
    (point: Point) => {
      store.addEntities((state) => [
        newNote(point, {
          // The pad's menu sets these, and they are remembered, so a board made
          // of one kind of note does not have to be recoloured as it is written.
          color: preferences.noteColor,
          style: preferences.noteStyle,
          dateLabel: nextDateLabel(state.entities.length),
        }),
      ])
    },
    [nextDateLabel, preferences.noteColor, preferences.noteStyle],
  )

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

  const moveOne = useCallback((id: string, delta: Point) => {
    store.updateEntities([id], (entity) => {
      const descriptor = descriptorFor(entity)
      return descriptor.capabilities(entity).movable ? descriptor.move(entity, delta) : entity
    })
  }, [])

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

  const handleEntityDrag = useCallback(
    (element: Element, delta: Point) => {
      const id = entityIdFromElement(element)
      if (id) moveEntity(id, delta)
    },
    [moveEntity],
  )

  useEffect(() => {
    setHovered(null)
  }, [camera])

  const handlePinHover = useCallback((pin: PinView, element: Element | null) => {
    setHovered(element ? { id: pin.id, element } : null)
  }, [])

  const setEntityBody = useCallback((id: string, bodyMd: string) => {
    store.updateEntities([id], (entity) => ({ ...entity, bodyMd, updatedAt: Date.now() }))
  }, [])

  const setNoteFontScale = useCallback((id: string, fontScale: number) => {
    store.updateEntities([id], (entity) =>
      entity.kind === 'note' ? { ...entity, fontScale, updatedAt: Date.now() } : entity,
    )
  }, [])

  const setNoteColor = useCallback((id: string, color: string) => {
    store.updateEntities([id], (entity) =>
      entity.kind === 'note' ? { ...entity, color, updatedAt: Date.now() } : entity,
    )
  }, [])

  const setNoteStyle = useCallback((id: string, style: NoteStyle) => {
    store.updateEntities([id], (entity) =>
      entity.kind === 'note' ? { ...entity, style, updatedAt: Date.now() } : entity,
    )
  }, [])

  // One menu, two hosts. A pick made on the pad changes what the next note is
  // made of; a pick made on a note changes that note. It deliberately does not
  // also move the default — changing one old note should not silently change
  // every note made afterwards.
  const pickStyle = useCallback(
    (style: NoteStyle) => {
      if (!noteStyleMenu) return
      if (noteStyleMenu.at === 'note') setNoteStyle(noteStyleMenu.id, style)
      else setPreferences({ noteStyle: style })
    },
    [noteStyleMenu, setNoteStyle],
  )

  const pickColor = useCallback(
    (color: string) => {
      if (!noteStyleMenu) return
      if (noteStyleMenu.at === 'note') setNoteColor(noteStyleMenu.id, color)
      else setPreferences({ noteColor: color })
    },
    [noteStyleMenu, setNoteColor],
  )

  // The anchor is in board-canvas pixels, not viewport pixels: the menu is
  // placed by `placeEdgePicker` against its offsetParent, which is the canvas.
  const openStyleMenuForPad = useCallback(() => {
    const pad = document.querySelector('[data-testid="palette-pad-1"]')?.getBoundingClientRect()
    const canvas = document.querySelector('[data-testid="board-canvas"]')?.getBoundingClientRect()
    const anchor =
      pad && canvas && pad.width > 0
        ? {
            left: pad.left - canvas.left,
            top: pad.top - canvas.top,
            width: pad.width,
            height: pad.height,
          }
        : // jsdom lays nothing out; the menu only has to be in the tree there.
          { left: 16, top: 100, width: 62, height: 62 }
    // The pad is a disclosure, so a second press closes it, as the note's trigger does.
    setNoteStyleMenu((menu) => (menu?.at === 'pad' ? null : { at: 'pad', anchor }))
  }, [])

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

  const removeEntity = useCallback(
    (id: string) => {
      store.removeEntities([id])
      setEditingPin(null)
      setNoteStyleMenu((menu) => (menu?.at === 'note' && menu.id === id ? null : menu))
    },
    [store],
  )

  const [awaitingFit, setAwaitingFit] = useState(false)

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
    // Revoked on a timer, not synchronously: Safari reads the URL after the
    // click handler returns.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }, [store])

  const importBoard = useCallback(
    async (file: File): Promise<string | null> => {
      let text: string
      try {
        text = await readBoardFile(file)
      } catch {
        return 'That file could not be read.'
      }
      const result = parseBoardFile(text)
      if (!result.ok) return result.reason

      setPendingImport({ board: result.board, fileName: file.name })
      return null
    },
    [],
  )

  const replaceWithImport = useCallback(() => {
    if (!pendingImport) return
    store.replaceAll(pendingImport.board)
    setSelection(new Set())
    setEditingPin(null)
    setHovered(null)
    setContextMenu(null)
    setNoteStyleMenu(null)
    setAwaitingFit(true)
    setPendingImport(null)
  }, [pendingImport, store])

  const addImportAsBoard = useCallback(() => {
    if (!pendingImport) return
    const { board, fileName } = pendingImport
    setPendingImport(null)
    void onAddBoard?.(boardNameFrom(board) ?? fileName.replace(/\.json$/i, ''), board)
  }, [onAddBoard, pendingImport])

  const clearBoard = useCallback(() => {
    store.removeEntities(store.get().entities.map((entity) => entity.id))
    setSelection(new Set())
    setEditingPin(null)
    setHovered(null)
    setContextMenu(null)
    setNoteStyleMenu(null)
  }, [store])

  const anchorPoints = useMemo(() => {
    const map = new Map<string, Point>()
    for (const entity of entities) {
      const descriptor = descriptorFor(entity)
      if (!descriptor.capabilities(entity).connectable) continue
      const point = descriptor.anchorPoint(entity, entityContext)
      if (point) map.set(entity.id, point)
    }
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

  const selectedString = drawableStrings.find((string) => selection.has(string.id)) ?? null

  const [hoveredString, setHoveredString] = useState<string | null>(null)
  const handleCanvasHover = useCallback(
    (point: Point | null) => {
      setHoveredString(point ? stringAt(screenToBoard(cameraRef.current, point)) : null)
    },
    [stringAt],
  )

  const dragStringSag = useCallback((id: string, dy: number) => {
    store.updateStrings([id], (string) => {
      {
        const drawn = drawableStringsRef.current.find((item) => item.id === id)
        if (!drawn) return string

        const gap = distance(drawn.from, drawn.to)
        if (gap <= 0) return string

        // The dragged point sits at half the control offset, hence the ×2.
        const sag = Math.min(Math.max(sagFor(gap, string.slack) + dy * 2, 0), gap * MAX_SAG_RATIO)
        // Rounded because slack is interpolated raw into the yarn geometry cache
        // key: a continuous drag would otherwise mint a fresh entry every frame.
        const slack = Math.round(Math.min(MAX_SLACK, slackForSag(gap, sag)) * SLACK_STEP) / SLACK_STEP
        return slack === string.slack ? string : { ...string, slack }
      }
    })
  }, [store])

  const slideStringNote = useCallback(
    (id: string, t: number) => {
      store.updateStrings([id], (link) => ({ ...link, labelAt: t }))
    },
    [store],
  )

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
      if (editingPin || contextMenu || prefsOpen || movingPin || exportImageOpen || noteStyleMenu) {
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedString) {
          event.preventDefault()
          removeString(selectedString.id)
          return
        }
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
    exportImageOpen,
    movingPin,
    noteStyleMenu,
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

  const selectedImage = useMemo(
    () => (selection.size === 1 ? images.find((image) => selection.has(image.id)) ?? null : null),
    [images, selection],
  )

  const selectedArticle = useMemo(
    () => (selection.size === 1 ? articles.find((a) => selection.has(a.id)) ?? null : null),
    [articles, selection],
  )

  const pageRects = useMemo(() => frameTargets(articles, entityContext), [articles, entityContext])

  const openingFrame = useMemo(
    () => (pageRects.length === 0 ? NO_RECTS : frameTargets(entities, entityContext)),
    [entities, entityContext, pageRects],
  )

  useEffect(() => {
    if (!awaitingFit || pageRects.length === 0) return
    fitBoard()
    setAwaitingFit(false)
  }, [awaitingFit, pageRects, fitBoard])

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
      // The caption's own space, in screen px like the bar: without it the bar
      // lands across the caption fields.
      height: bottomRight.y - topLeft.y + IMAGE_CAPTION_SPACE,
    }
  }, [selectedImage, entityContext, camera])

  const menuNote = useMemo(() => {
    if (noteStyleMenu?.at !== 'note') return null
    const found = entities.find((entity) => entity.id === noteStyleMenu.id)
    return found && found.kind === 'note' ? found : null
  }, [noteStyleMenu, entities])

  const noteStyleAnchor = useMemo(() => {
    if (!menuNote) return null
    const box = descriptorFor(menuNote).bounds(menuNote, entityContext)
    if (!box) return null
    const topLeft = boardToScreen(camera, { x: box.x, y: box.y })
    const bottomRight = boardToScreen(camera, { x: box.x + box.width, y: box.y + box.height })
    return {
      left: topLeft.x,
      top: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    }
  }, [menuNote, entityContext, camera])

  /** What the menu shows as current: the note's own pair, or the pad's default. */
  const menuTarget = useMemo(() => {
    // A note with no colour of its own presses nothing, rather than claiming one.
    if (menuNote) return { style: menuNote.style, color: menuNote.color ?? '' }
    return { style: preferences.noteStyle, color: preferences.noteColor }
  }, [menuNote, preferences.noteStyle, preferences.noteColor])

  const named = useMemo(
    () =>
      entities.flatMap((entity) => {
        if (entity.kind !== 'article' && entity.kind !== 'image') return []
        const name = entity.title?.trim()
        return name ? [{ id: entity.id, name, kind: entity.kind }] : []
      }),
    [entities],
  )

  const mentionNames = useMemo(
    () => new Set(named.map((candidate) => candidate.name.toLowerCase())),
    [named],
  )

  const mentions = useMemo(
    () => named.map(({ id, name, kind }) => ({ id, name, kind })),
    [named],
  )

  const byId = useMemo(() => new Map(pins.map((pin) => [pin.id, pin])), [pins])
  const byIdRef = useRef(byId)
  byIdRef.current = byId

  const anchored = pins.filter((pin) => pin.rect)
  const freePins = pins.filter((pin) => pin.board)
  const activePin = editingPin ? byId.get(editingPin.id) : null

  const contextEntity = contextMenu?.entityId
    ? entities.find((entity) => entity.id === contextMenu.entityId) ?? null
    : null

  const contextItems: ContextMenuEntry[] = contextMenu
    ? [
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
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            data-testid="back-to-boards"
            className="flex items-center gap-1.5 rounded border border-parchment-edge/25 px-2.5 py-1 text-[13px] text-board-ink-soft transition hover:border-brass hover:text-board-ink"
          >
            <ArrowLeft size={13} strokeWidth={2.2} aria-hidden="true" />
            Boards
          </button>
        ) : null}
        {name ? (
          <span className="truncate text-[13px] text-board-ink-soft" data-testid="board-name">
            {name}
          </span>
        ) : null}
      </TopBar>

      <main className="relative flex min-h-0 flex-1">
        <>
          {selectedArticle && (
            <PaperEditor
              title={selectedArticle.title?.trim() || "Untitled sheet"}
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
              idleCursor={hoveredString ? "pointer" : "default"}
              camera={camera}
              onCameraChange={commitCamera}
              onContextTarget={handleContextTarget}
              onFileDrop={handleFileDrop}
              onFileDragOver={handleDragOver}
              onBackgroundClick={handleBackgroundClick}
              onMarquee={handleMarquee}
              className="min-h-0 flex-1"
              fitTo={openingFrame}
              backdrop={(viewport) => <GridLayer camera={camera} viewport={viewport} />}
              overlay={
                <>
                  {/* Chrome sits outside the world layer: it is a transformed
                      element, so nothing inside it can rise above this overlay. */}
                  {selectedImage && captionAt ? (
                    <ImageCaption
                      x={captionAt.x}
                      y={captionAt.y}
                      title={selectedImage.title ?? ""}
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
                    canCreate={can(LOCAL_VIEWER, "create")}
                    onDropNote={(clientX, clientY) => {
                      const at = worldPoint(clientX, clientY);
                      createPostIt({
                        x: at.x - NOTE_SIZE.width / 2,
                        y: at.y - NOTE_SIZE.height / 2,
                      });
                    }}
                    onDropPin={(clientX, clientY) => createFreePin(worldPoint(clientX, clientY))}
                    onOpenNoteMenu={openStyleMenuForPad}
                    noteMenuOpen={noteStyleMenu?.at === "pad"}
                    noteStyle={preferences.noteStyle}
                    noteColor={preferences.noteColor}
                  />

                  {noteStyleMenu && (noteStyleMenu.at === "pad" ? noteStyleMenu.anchor : noteStyleAnchor) ? (
                    <NoteStyleMenu
                      anchor={noteStyleMenu.at === "pad" ? noteStyleMenu.anchor : noteStyleAnchor!}
                      style={menuTarget.style}
                      color={menuTarget.color}
                      onPickStyle={pickStyle}
                      onPickColor={pickColor}
                      onClose={() => setNoteStyleMenu(null)}
                    />
                  ) : null}
                </>
              }
            >
              {/* Each sheet gets only its own tacks: the whole anchored list
                  would draw every other page's pins in this page's coordinates. */}
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
                onOpenStyleMenu={(id) =>
                  setNoteStyleMenu((menu) => (menu?.at === "note" && menu.id === id ? null : { at: "note", id }))
                }
                styleMenuNoteId={noteStyleMenu?.at === "note" ? noteStyleMenu.id : null}
                onRemove={removeEntity}
              />
              {/* Rendered last so the yarn paints over everything; pointer-events-none
                  so it never steals a click meant for a pin or post-it. */}
              <StringLayer
                strings={drawableStrings}
                selected={selection}
                hovered={hoveredString}
                style={preferences.yarnStyle}
                zoom={camera.zoom}
                livePathRef={livePathRef}
                drawing={dragFrom !== null}
              />
              {drawableStrings.map((drawn) => {
                const link = strings.find((candidate) => candidate.id === drawn.id);
                if (!link) return null;
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
                );
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

      <footer className="border-t border-parchment-edge/15 bg-cork-900/55 px-4 py-2 lg:px-6">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pb-1 text-xs text-board-ink-soft/50">
          <span>
            {placed.length} pin{placed.length === 1 ? "" : "s"} · {strings.length} string
            {strings.length === 1 ? "" : "s"}
          </span>
          <span className="ml-auto hidden lg:inline text-sm">
            Scroll to zoom · right/middle-drag to pan · right-click for options
          </span>
        </div>
      </footer>

      <PinTooltip
        pin={
          hovered && !editingPin && !movingPin
            ? (() => {
                const pin = byId.get(hovered.id);
                return pin && pin.body.trim().length === 0
                  ? {
                      id: pin.id,
                      quote: pin.quote,
                      body: pin.body,
                      dateLabel: pin.dateLabel,
                    }
                  : null;
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
            setMovingPin(editingPin.id);
            setEditingPin(null);
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
        // Not stacked on the drawer: both are modal, and the drawer would sit
        // over the dialog it just opened.
        onExportImage={() => {
          setPrefsOpen(false);
          setExportImageOpen(true);
        }}
      />

      {pendingImport ? (
        <ImportChoice
          fileName={pendingImport.fileName}
          onReplace={replaceWithImport}
          onAddBoard={addImportAsBoard}
          onCancel={() => setPendingImport(null)}
        />
      ) : null}

      {exportImageOpen ? (
        <ExportImageDialog
          board={{ entities, strings }}
          rects={exportRects}
          surface={preferences.surface}
          theme={preferences.theme}
          onRender={renderBoardImage}
          onClose={() => setExportImageOpen(false)}
        />
      ) : null}
    </div>
  );
}
