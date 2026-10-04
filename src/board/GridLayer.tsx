/**
 * The cork's dot grid, painted on the viewport.
 *
 * Mount as a direct child of the viewport element (BoardCanvas.tsx), before the
 * transformed world div, so it sits behind the paper. It is deliberately NOT
 * inside the world transform: a grid element scaled by `zoom` scales its dots
 * with it, so at 2.5× four giant blobs fill the screen, at 0.2× a fine grey
 * wash, and in between every dot lands on fractional device pixels and shimmers
 * as the camera moves. Here the browser repeats one screen-space gradient
 * instead — dot size stays constant, the camera maths in `grid.ts` keeps the
 * phase locked to board space, and a camera move repaints nothing but a
 * composited background layer.
 */

import type { Camera, Viewport } from './camera'
import { gridFrame } from './grid'
import './GridLayer.css'

export interface GridLayerProps {
  camera: Camera
  viewport: Viewport
}

export function GridLayer({ camera, viewport }: GridLayerProps) {
  const frame = gridFrame(camera, viewport)

  return (
    <div
      className="board-grid"
      data-testid="board-grid"
      aria-hidden="true"
      style={{
        backgroundSize: `${frame.tileSize}px ${frame.tileSize}px`,
        backgroundPosition: `${frame.offsetX}px ${frame.offsetY}px`,
      }}
    />
  )
}
