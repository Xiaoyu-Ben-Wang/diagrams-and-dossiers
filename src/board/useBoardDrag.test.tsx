// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CLICK_SLOP, DRAG_THRESHOLD, useBoardDrag } from "./useBoardDrag";
import type { Point } from "./yarn";

interface HarnessProps {
  onDrag: (delta: Point) => void;
  captureOnPress?: boolean;
  onDragStart?: () => void;
  onTap?: () => void;
  onEnd?: (end: {
    clientX: number;
    clientY: number;
    travelled: boolean;
  }) => void;
  zoom?: number;
  disabled?: boolean;
}

function Harness({
  onDrag,
  onDragStart,
  onTap,
  onEnd,
  zoom = 1,
  disabled,
  captureOnPress = true,
}: HarnessProps) {
  const drag = useBoardDrag({
    onDrag,
    onDragStart,
    onTap,
    onEnd,
    zoom,
    disabled,
    captureOnPress,
  });
  return <div data-testid="handle" {...drag} />;
}

function dragThrough(
  points: readonly [number, number][],
  props: Partial<HarnessProps> = {},
): { deltas: Point[]; starts: number; taps: number; ends: unknown[] } {
  const deltas: Point[] = [];
  const ends: unknown[] = [];
  let starts = 0;
  let taps = 0;

  render(
    <Harness
      {...props}
      onDrag={(delta) => {
        deltas.push(delta);
        props.onDrag?.(delta);
      }}
      onDragStart={() => {
        starts++;
        props.onDragStart?.();
      }}
      onTap={() => {
        taps++;
        props.onTap?.();
      }}
      onEnd={(end) => {
        ends.push(end);
        props.onEnd?.(end);
      }}
    />,
  );

  const handle = screen.getByTestId("handle");
  const [first, ...rest] = points;
  fireEvent.pointerDown(handle, {
    button: 0,
    pointerId: 1,
    clientX: first[0],
    clientY: first[1],
  });
  for (const [x, y] of rest)
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: x, clientY: y });
  const last = points[points.length - 1];
  fireEvent.pointerUp(handle, {
    button: 0,
    pointerId: 1,
    clientX: last[0],
    clientY: last[1],
  });

  return { deltas, starts, taps, ends };
}

describe("a press that does not travel", () => {
  it("moves nothing while the mouse twitches under the threshold", () => {
    const { deltas, starts } = dragThrough([
      [100, 100],
      [102, 100],
      [101, 101],
    ]);

    expect(deltas).toEqual([]);
    expect(starts).toBe(0);
  });

  it("is a tap", () => {
    expect(
      dragThrough([
        [100, 100],
        [102, 100],
      ]).taps,
    ).toBe(1);
  });
});

describe("a press that travels", () => {
  it("starts moving only once it is a drag, and covers the whole travel at once", () => {
    const { deltas, starts } = dragThrough([
      [100, 100],
      [102, 100],
      [106, 100],
      [120, 130],
    ]);

    expect(starts).toBe(1);
    expect(deltas).toEqual([
      { x: 6, y: 0 },
      { x: 14, y: 30 },
    ]);
  });

  it("says the drag began exactly once, not once per move", () => {
    const { starts } = dragThrough([
      [0, 0],
      [10, 0],
      [40, 0],
      [80, 0],
      [120, 0],
    ]);

    expect(starts).toBe(1);
  });

  it("is not a tap", () => {
    expect(
      dragThrough([
        [100, 100],
        [140, 100],
      ]).taps,
    ).toBe(0);
  });

  it("divides by the zoom, so the object keeps up with the pointer", () => {
    const { deltas } = dragThrough(
      [
        [0, 0],
        [100, 40],
      ],
      { zoom: 2 },
    );

    expect(deltas).toEqual([{ x: 50, y: 20 }]);
  });

  it("tells the end where it finished and that it travelled", () => {
    const { ends } = dragThrough([
      [10, 10],
      [90, 50],
    ]);

    expect(ends).toEqual([{ clientX: 90, clientY: 50, travelled: true }]);
  });
});

describe("the threshold", () => {
  it("is a travel of its own, not a single big step", () => {
    const step = Math.ceil(DRAG_THRESHOLD / 3);
    const { starts } = dragThrough([
      [0, 0],
      [step, 0],
      [step * 2, 0],
      [step * 3, 0],
    ]);

    expect(starts).toBe(1);
  });

  it("is what a click is matched against afterwards", () => {
    // Shared so the canvas and the sheet agree on what counts as the same spot; a drift means a
    // swallowed click that should have landed.
    expect(CLICK_SLOP).toBeLessThan(DRAG_THRESHOLD);
  });
});

describe("the other buttons", () => {
  it("leaves the middle and right buttons to the canvas", () => {
    const onDrag = vi.fn();
    render(<Harness onDrag={onDrag} />);
    const handle = screen.getByTestId("handle");

    fireEvent.pointerDown(handle, {
      button: 1,
      pointerId: 4,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(handle, { pointerId: 4, clientX: 60, clientY: 60 });

    expect(onDrag).not.toHaveBeenCalled();
  });

  it("does nothing at all when it is disabled", () => {
    const { deltas, starts } = dragThrough(
      [
        [0, 0],
        [80, 80],
      ],
      { disabled: true },
    );

    expect(deltas).toEqual([]);
    expect(starts).toBe(0);
  });
});

describe("when the pointer is taken", () => {
  // jsdom has no pointer capture, so stand one up to watch what is asked of it.
  function withCapture(): { calls: string[]; restore: () => void } {
    const calls: string[] = [];
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const had = "setPointerCapture" in proto;
    proto.setPointerCapture = function (this: Element, id: number) {
      calls.push(`capture:${id}`);
    };
    return {
      calls,
      restore: () => {
        if (!had) delete proto.setPointerCapture;
      },
    };
  }

  function show(over: Partial<HarnessProps> = {}): HTMLElement {
    render(<Harness onDrag={() => {}} {...over} />);
    return screen.getByTestId("handle");
  }

  it("takes it on the press by default, so a flick on a small target keeps tracking", () => {
    const capture = withCapture();
    try {
      const handle = show();
      fireEvent.pointerDown(handle, {
        button: 0,
        pointerId: 7,
        clientX: 0,
        clientY: 0,
      });
      expect(capture.calls).toEqual(["capture:7"]);
    } finally {
      capture.restore();
    }
  });

  it("holds off until the press has travelled, so the click after it still finds its target", () => {
    const capture = withCapture();
    try {
      const handle = show({ captureOnPress: false });
      fireEvent.pointerDown(handle, {
        button: 0,
        pointerId: 7,
        clientX: 0,
        clientY: 0,
      });
      expect(capture.calls).toEqual([]);

      fireEvent.pointerMove(handle, {
        pointerId: 7,
        clientX: DRAG_THRESHOLD + 2,
        clientY: 0,
      });
      expect(capture.calls).toEqual(["capture:7"]);
    } finally {
      capture.restore();
    }
  });
});
