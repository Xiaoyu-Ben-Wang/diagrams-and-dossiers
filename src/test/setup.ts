/**
 * Test environment setup.
 *
 * Most suites here are pure logic — strings, numbers, geometry — and run in the
 * node environment, where none of this applies. The guards below keep the DOM
 * stubs out of their way.
 *
 * Everything stubbed here is genuinely absent from jsdom rather than awkward to
 * work with. Each stub is the honest answer to "what does this environment
 * actually do?", not a way to make a test pass:
 *
 *   canvas        jsdom ships no 2D context at all
 *   ResizeObserver  no layout engine, so nothing ever resizes
 *   PointerEvent  absent, which silently stripped `button` from every event
 *
 * That last one mattered. Without it `fireEvent.pointerDown` falls back to a
 * bare Event with no `button`, `pointerId` or coordinates — so a test asserting
 * "the board pans on a middle-drag" was passing for reasons unrelated to the
 * board. A stub that lies is worse than no test.
 */

if (typeof window !== 'undefined') {
  // jsdom's getContext reports "not implemented" for every call, which would
  // make every board render emit an error — noise that eventually hides a real
  // one. Null is also what the component already treats as "no canvas here".
  if (typeof HTMLCanvasElement !== 'undefined') {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext
  }

  // Never fires, which is correct: with no layout there is nothing to observe.
  // Components register and are simply never called back.
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver
  }

  // PointerEvent is a superset of MouseEvent, so extending it mirrors the real
  // implementation.
  if (typeof globalThis.PointerEvent === 'undefined' && typeof globalThis.MouseEvent !== 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number
      readonly pointerType: string
      readonly isPrimary: boolean

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
        this.pointerType = init.pointerType ?? 'mouse'
        this.isPrimary = init.isPrimary ?? true
      }
    }

    globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent
  }
}
