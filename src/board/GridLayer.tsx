// Mount before the transformed world div in BoardCanvas.tsx so it sits behind the paper, and
// outside the world transform: a grid scaled by zoom scales its dots and shimmers as it moves.

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
