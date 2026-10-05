/**
 * Everything lying loose on the cork.
 *
 * The page is not here — it is its own component, because it is not a thing
 * placed at a point the way these are. What is here is the three kinds that
 * are: tacks pushed straight into the board, pictures pinned up, and post-its
 * stuck down. Plus the border bar, which belongs to whichever picture is
 * selected and has nowhere else sensible to live.
 *
 * They share a layer rather than each getting one because the board has exactly
 * one z-order and it is the order they are rendered in. Rendering the pictures
 * above the post-its in one component is the only way to see at a glance what
 * covers what; three sibling layers would make that a question about the parent
 * instead.
 */

import { descriptorFor } from '../model/kinds'
import type { EntityContext, ImageEntity, NoteEntity } from '../model/types'
import { EdgePicker } from './EdgePicker'
import type { EdgeStyle } from './edges'
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
  /** The picture the border bar is for, if exactly one is selected. */
  selectedImage: ImageEntity | null

  selection: ReadonlySet<string>
  /** Whether the timeline is holding anything back right now. */
  dimming: boolean
  activeIds: ReadonlySet<string>
  movingPin: string | null
  zoom: number

  /** What the descriptors need that they cannot know alone. */
  context: EntityContext
  /** A point in the article's own space, in board space. */
  articleToBoard: (local: Point) => Point
  /** A viewport point in board space. */
  toBoard: (clientX: number, clientY: number) => Point
  /** Where a string may be tied, by entity id. */
  anchorOf: (id: string) => Point | null

  onStartYarn: (event: React.PointerEvent, fromId: string, origin: Point | null) => void
  onMoveOne: (id: string, delta: Point) => void
  onMoveEntity: (id: string, delta: Point) => void
  onPinDrop: (id: string, clientX: number, clientY: number) => void
  onPinHover: (pin: PinView, element: Element | null) => void
  onRotate: (id: string, degrees: number) => void
  onResize: (id: string, size: { width: number; height: number }) => void
  onSelectImage: (id: string) => void
  onSetEdge: (id: string, edge: EdgeStyle) => void
  onSelectNote: (id: string) => void
  onSetBody: (id: string, body: string) => void
  onResizeNote: (id: string, size: { width: number; height: number }) => void
  onRemove: (id: string) => void
}

/** Half a tack, so a pin's own coordinate lands in the middle of it. */
const TACK_RADIUS = 7

export function EntityLayer({
  freePins,
  images,
  postIts,
  selectedImage,
  selection,
  dimming,
  activeIds,
  movingPin,
  zoom,
  context,
  articleToBoard,
  toBoard,
  anchorOf,
  onStartYarn,
  onMoveOne,
  onMoveEntity,
  onPinDrop,
  onPinHover,
  onRotate,
  onResize,
  onSelectImage,
  onSetEdge,
  onSelectNote,
  onSetBody,
  onResizeNote,
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
            dimmed={dimming && !activeIds.has(pin.id)}
            moving={movingPin === pin.id}
            zoom={zoom}
            onStartYarn={(event) => onStartYarn(event, pin.id, pinPoint(pin, articleToBoard))}
            onMove={onMoveOne}
            onDrop={onPinDrop}
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

      {/* The border bar follows the selection: it belongs to the one picture
          you are looking at, not to the board. */}
      {selectedImage ? (
        <EdgePicker
          seed={selectedImage.edgeSeed}
          edge={selectedImage.edge}
          box={
            // The swept box, so a tilted picture's bar hangs below the picture
            // rather than below the upright rectangle it is drawn from.
            descriptorFor(selectedImage).bounds(selectedImage, context) ?? {
              x: selectedImage.board.x,
              y: selectedImage.board.y,
              width: selectedImage.width,
              height: selectedImage.height,
            }
          }
          tilt={selectedImage.rotation}
          onPick={(style) => onSetEdge(selectedImage.id, style)}
        />
      ) : null}

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
          onRemove={onRemove}
        />
      ))}
    </>
  )
}
