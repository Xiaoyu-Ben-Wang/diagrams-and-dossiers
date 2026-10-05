/**
 * Everything lying loose on the cork.
 *
 * Pages are not here. They are placed at a point like these are — the reason
 * they are their own component is that a page is not described entirely by its
 * entity: it owns a rendered body, a projection of that body and a measured
 * paper, all of which the board has to reach through a registry rather than
 * through props. Drawing one is cheap; *finding* one is what makes it a
 * component rather than a case in this loop.
 *
 * So what is here is the three kinds that are fully described by their entity:
 * tacks pushed straight into the board, pictures pinned up, and post-its stuck
 * down — plus the border bar, which belongs to whichever picture is selected
 * and has nowhere else sensible to live.
 *
 * They share a layer rather than each getting one because the board has exactly
 * one z-order and it is the order they are rendered in. Rendering the pictures
 * above the post-its in one component is the only way to see at a glance what
 * covers what; three sibling layers would make that a question about the parent
 * instead.
 */

import type { ImageEntity, NoteEntity } from '../model/types'
import { ImageCard } from './ImageCard'
import { PostIt } from './entities/PostIt'
import { Tack } from './entities/Tack'
import type { Point } from './yarn'
import { pinPoint, type PinView } from './view'

export interface EntityLayerProps {
  /** Tacks pushed into the cork, as opposed to the ones through the page. */
  freePins: readonly PinView[]
  images: readonly ImageEntity[]
  postIts: readonly NoteEntity[]

  selection: ReadonlySet<string>
  movingPin: string | null
  zoom: number

  /**
   * A point in an article's own space, in board space.
   *
   * Takes the article's id, because there is more than one page: an anchored
   * pin's position is only meaningful against the sheet it is stuck through,
   * and this layer draws free pins *and* pictures, either of which may be tied
   * to a different page.
   */
  articleToBoard: (articleId: string, local: Point) => Point | null
  /** A viewport point in board space. */
  toBoard: (clientX: number, clientY: number) => Point
  /** Where a string may be tied, by entity id. */
  anchorOf: (id: string) => Point | null

  onStartYarn: (event: React.PointerEvent, fromId: string, origin: Point | null) => void
  onMoveOne: (id: string, delta: Point) => void
  onMoveEntity: (id: string, delta: Point) => void
  onPinDrop: (id: string, clientX: number, clientY: number) => void
  /** Open a pin's editor at a point on screen — what its tag does when clicked. */
  onOpenPinEditor: (id: string, clientX: number, clientY: number) => void
  onPinHover: (pin: PinView, element: Element | null) => void
  onRotate: (id: string, degrees: number) => void
  onResize: (id: string, size: { width: number; height: number }) => void
  onSelectImage: (id: string) => void
  onSelectNote: (id: string) => void
  onSetBody: (id: string, body: string) => void
  onResizeNote: (id: string, size: { width: number; height: number }) => void
  onSetFontScale: (id: string, scale: number) => void
  onRemove: (id: string) => void
}

/** Half a tack, so a pin's own coordinate lands in the middle of it. */
const TACK_RADIUS = 7

export function EntityLayer({
  freePins,
  images,
  postIts,
  selection,
  movingPin,
  zoom,
  articleToBoard,
  toBoard,
  anchorOf,
  onStartYarn,
  onMoveOne,
  onMoveEntity,
  onPinDrop,
  onOpenPinEditor,
  onPinHover,
  onRotate,
  onResize,
  onSelectImage,
  onSelectNote,
  onSetBody,
  onResizeNote,
  onSetFontScale,
  onRemove,
}: EntityLayerProps) {
  return (
    <>
      {/* Pins stuck into the cork rather than into text. Same object as an
          anchored pin, different location — which is why they share the note
          editor and the yarn. */}
      {freePins.map((pin) =>
        pin.board ? (
          <Tack
            key={`free-${pin.id}`}
            pin={pin}
            x={pin.board.x - TACK_RADIUS + pin.nudge.x}
            y={pin.board.y - TACK_RADIUS + pin.nudge.y}
            selected={selection.has(pin.id)}
            moving={movingPin === pin.id}
            zoom={zoom}
            onStartYarn={(event) => onStartYarn(event, pin.id, pinPoint(pin, articleToBoard))}
            onMove={onMoveOne}
            onDrop={onPinDrop}
            onOpenEditor={onOpenPinEditor}
            onHover={onPinHover}
          />
        ) : null,
      )}

      {images.map((picture) => (
        <ImageCard
          key={picture.id}
          id={picture.id}
          src={picture.src}
          alt={picture.alt}
          x={picture.board.x}
          y={picture.board.y}
          width={picture.width}
          height={picture.height}
          rotation={picture.rotation}
          fit={picture.fit}
          edge={picture.edge}
          edgeSeed={picture.edgeSeed}
          selected={selection.has(picture.id)}
          zoom={zoom}
          toBoard={toBoard}
          onMove={onMoveEntity}
          onRotate={onRotate}
          onSelect={onSelectImage}
          onResize={onResize}
          onStartYarn={(event) => onStartYarn(event, picture.id, anchorOf(picture.id))}
        />
      ))}

      {postIts.map((note) => (
        <PostIt
          key={note.id}
          note={note}
          zoom={zoom}
          selected={selection.has(note.id)}
          toBoard={toBoard}
          onSelect={onSelectNote}
          onDrag={onMoveEntity}
          onChange={onSetBody}
          onResize={onResizeNote}
          onSetFontScale={onSetFontScale}
          onRemove={onRemove}
        />
      ))}
    </>
  )
}
