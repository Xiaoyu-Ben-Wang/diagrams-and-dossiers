/**
 * Test environment setup.
 *
 * jsdom ships no canvas implementation: `HTMLCanvasElement.getContext` reports
 * "not implemented" to the virtual console for every call. The dust field calls
 * it on mount, so every test that renders the board would emit an error — noise
 * that would eventually hide a real one.
 *
 * Stubbing to null is the honest answer rather than a workaround. The component
 * already treats a null context as "no canvas here, nothing to draw", which is
 * exactly true of jsdom. It also short-circuits before `ResizeObserver`, which
 * jsdom likewise lacks.
 *
 * If a future test genuinely needs a canvas, it should install `node-canvas` and
 * override this locally rather than removing the stub.
 */

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext
}
