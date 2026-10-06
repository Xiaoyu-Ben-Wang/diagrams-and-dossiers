import { memo, useCallback } from 'react'

import type { ImageEntity, NoteEntity } from '../model/types'
import { ImageCard } from './ImageCard'
import { PostIt } from './entities/PostIt'
import { Tack } from './entities/Tack'
import type { Point } from './yarn'
import { pinPoint, type PinView } from './view'

export interface EntityLayerProps {
  freePins: readonly PinView[]
  images: readonly ImageEntity[]
  postIts: readonly NoteEntity[]

  selection: ReadonlySet<string>
  movingPin: string | null
  zoom: number

  articleToBoard: (articleId: string, local: Point) => Point | null
  toBoard: (clientX: number, clientY: number) => Point
  anchorOf: (id: string) => Point | null

  onStartYarn: (event: React.PointerEvent, fromId: string, origin: Point | null) => void
  onMoveOne: (id: string, delta: Point) => void
  onMoveEntity: (id: string, delta: Point) => void
  onPinDrop: (id: string, clientX: number, clientY: number) => void
  onOpenPinEditor: (id: string, clientX: number, clientY: number) => void
  onPinHover: (pin: PinView, element: Element | null) => void
  onRotate: (id: string, degrees: number) => void
  onResize: (id: string, size: { width: number; height: number }) => void
  onSelectImage: (id: string) => void
  onSelectNote: (id: string) => void
  onSetBody: (id: string, body: string) => void
  onResizeNote: (id: string, size: { width: number; height: number }) => void
  onSetFontScale: (id: string, scale: number) => void
  onOpenStyleMenu: (id: string) => void
  /** The note whose style menu is open, so its trigger can say so. */
  styleMenuNoteId: string | null
  onRemove: (id: string) => void
}

const TACK_RADIUS = 7

export const EntityLayer = memo(function EntityLayer({
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
  onOpenStyleMenu,
  styleMenuNoteId,
  onRemove,
}: EntityLayerProps) {
  const startPinYarn = useCallback(
    (event: React.PointerEvent, pin: PinView) =>
      onStartYarn(event, pin.id, pinPoint(pin, articleToBoard)),
    [onStartYarn, articleToBoard],
  )
  const startImageYarn = useCallback(
    (event: React.PointerEvent, id: string) => onStartYarn(event, id, anchorOf(id)),
    [onStartYarn, anchorOf],
  )

  return (
    <>
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
            onStartYarn={startPinYarn}
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
          onStartYarn={startImageYarn}
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
          onOpenStyleMenu={onOpenStyleMenu}
          styleMenuOpen={styleMenuNoteId === note.id}
          onRemove={onRemove}
        />
      ))}
    </>
  )
})
