import { useRotateDrag } from '../useRotateDrag'
import type { Point } from '../yarn'

/**
 * The handle that swings the article.
 *
 * At the foot of the sheet, matching a picture's. The head is already busy —
 * the pin the page hangs from, and the tab that selects it — and a control
 * beside the pin reads as part of the pin.
 */
export function ArticleRotateHandle({
  tilt,
  pivot,
  toBoard,
  onRotate,
}: {
  tilt: number
  pivot: Point
  toBoard: (clientX: number, clientY: number) => Point
  onRotate: (degrees: number) => void
}) {
  const rotate = useRotateDrag({ pivot, tilt, toBoard, onRotate })

  return (
    <>
      <span
        aria-hidden="true"
        className="image-rotate-stem absolute"
        style={{ left: '50%', top: '100%', height: 16, marginLeft: -1 }}
      />
      <button
        type="button"
        data-testid="article-rotate"
        aria-label="Drag to swing the page about its pin"
        className="image-rotate absolute"
        style={{ left: '50%', top: '100%', marginTop: 16, marginLeft: -11 }}
        {...rotate}
      >
        <svg viewBox="0 0 22 22" aria-hidden="true" className="h-full w-full">
          <path
            d="M 4.2 11.4 A 6.8 6.8 0 1 1 8.4 17.4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <path
            d="M 1.4 7.6 L 4.4 11.9 L 8.8 9.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </>
  )
}

