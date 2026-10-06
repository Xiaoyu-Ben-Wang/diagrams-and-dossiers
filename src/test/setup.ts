/**
 * Stubs for what jsdom genuinely lacks: canvas 2D context, ResizeObserver, and
 * PointerEvent — without the last, pointer events silently lose `button`.
 */

if (typeof window !== "undefined") {
  // jsdom's getContext throws "not implemented"; null is what the component
  // already treats as "no canvas here".
  if (typeof HTMLCanvasElement !== "undefined") {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  }

  // Never fires, which is correct: with no layout there is nothing to observe.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }

  /**
   * jsdom has no layout, so a Range reports no client rects and every anchored
   * pin resolves to no position. A fixed box is a lie, but a consistent one.
   */
  if (typeof Range !== "undefined") {
    Range.prototype.getClientRects = function getClientRects() {
      const rect = {
        x: 100,
        y: 50,
        left: 100,
        top: 50,
        right: 180,
        bottom: 70,
        width: 80,
        height: 20,
        toJSON: () => ({}),
      };
      return Object.assign([rect], {
        item: (i: number) => (i === 0 ? rect : null),
      }) as unknown as DOMRectList;
    };
  }

  // PointerEvent is a superset of MouseEvent, so extending it mirrors the real
  // implementation.
  if (
    typeof globalThis.PointerEvent === "undefined" &&
    typeof globalThis.MouseEvent !== "undefined"
  ) {
    class PointerEventPolyfill extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      readonly isPrimary: boolean;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "mouse";
        this.isPrimary = init.isPrimary ?? true;
      }
    }

    globalThis.PointerEvent =
      PointerEventPolyfill as unknown as typeof PointerEvent;
  }
}
