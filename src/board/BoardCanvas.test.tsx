// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { BoardCanvas } from "./BoardCanvas";
import type { Camera } from "./camera";

function Harness({
  onContextTarget,
  initial = { x: 0, y: 0, zoom: 1 },
  onCamera,
}: {
  onContextTarget?: (target: {
    clientX: number;
    clientY: number;
    target: EventTarget | null;
  }) => void;
  initial?: Camera;
  onCamera?: (camera: Camera) => void;
}) {
  const [camera, setCamera] = useState<Camera>(initial);
  return (
    <BoardCanvas
      camera={camera}
      onCameraChange={(next) => {
        setCamera(next);
        onCamera?.(next);
      }}
      onContextTarget={onContextTarget}
    >
      <div style={{ width: 200, height: 200 }}>paper</div>
    </BoardCanvas>
  );
}

function viewport(): HTMLElement {
  return screen.getByTestId("board-canvas");
}

// jsdom does not implement layout, so every element reports a zero-sized box.
function stubBox(width = 800, height = 600): void {
  const element = viewport();
  element.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe("BoardCanvas", () => {
  it("renders its children", () => {
    render(<Harness />);
    expect(screen.getByText("paper")).toBeTruthy();
  });

  it("shows the zoom level and a way back to 100%", () => {
    render(<Harness initial={{ x: 0, y: 0, zoom: 0.5 }} />);
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("resets zoom to 100% when the readout is clicked", () => {
    const onCamera = vi.fn();
    render(<Harness initial={{ x: 40, y: 40, zoom: 2 }} onCamera={onCamera} />);

    fireEvent.click(screen.getByTitle("Reset zoom to 100%"));
    expect(onCamera).toHaveBeenCalledWith({ x: 40, y: 40, zoom: 1 });
  });
});

describe("zoom", () => {
  it("zooms out on a downward wheel", () => {
    const onCamera = vi.fn();
    render(<Harness onCamera={onCamera} />);
    stubBox();

    fireEvent.wheel(viewport(), { deltaY: 200, clientX: 400, clientY: 300 });

    expect(onCamera).toHaveBeenCalled();
    expect(onCamera.mock.calls[0][0].zoom).toBeLessThan(1);
  });

  it("zooms in on an upward wheel", () => {
    const onCamera = vi.fn();
    render(<Harness onCamera={onCamera} />);
    stubBox();

    fireEvent.wheel(viewport(), { deltaY: -200, clientX: 400, clientY: 300 });

    expect(onCamera.mock.calls[0][0].zoom).toBeGreaterThan(1);
  });

  it("anchors the zoom at the cursor, not the corner", () => {
    const onCamera = vi.fn();
    render(<Harness onCamera={onCamera} />);
    stubBox();

    fireEvent.wheel(viewport(), { deltaY: -200, clientX: 700, clientY: 100 });
    const camera: Camera = onCamera.mock.calls[0][0];

    const before = { x: 700 / 1 + 0, y: 100 / 1 + 0 };
    const after = {
      x: 700 / camera.zoom + camera.x,
      y: 100 / camera.zoom + camera.y,
    };
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("leaves zoom within its limits after a very large scroll", () => {
    const onCamera = vi.fn();
    render(<Harness onCamera={onCamera} />);
    stubBox();

    fireEvent.wheel(viewport(), { deltaY: 100000, clientX: 400, clientY: 300 });
    expect(onCamera.mock.calls[0][0].zoom).toBeGreaterThanOrEqual(0.2);
  });

  it("does not let the page scroll behind the zoom", () => {
    render(<Harness />);
    stubBox();

    // Dispatched directly so the event object can be inspected afterwards.
    const event = new WheelEvent("wheel", {
      deltaY: 100,
      cancelable: true,
      bubbles: true,
    });
    act(() => {
      viewport().dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
  });
});

describe("panning", () => {
  it("pans on a middle-button drag", () => {
    const onCamera = vi.fn();
    render(<Harness onCamera={onCamera} />);

    fireEvent.pointerDown(viewport(), {
      button: 1,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 140,
      clientY: 100,
    });

    expect(onCamera).toHaveBeenCalled();
    expect(onCamera.mock.calls[0][0].x).toBeLessThan(0);
  });

  it("pans on a right-button drag", () => {
    const onCamera = vi.fn();
    render(<Harness onCamera={onCamera} />);

    fireEvent.pointerDown(viewport(), {
      button: 2,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 100,
      clientY: 150,
    });

    expect(onCamera.mock.calls[0][0].y).toBeLessThan(0);
  });

  it("does not pan on a left-button drag", () => {
    const onCamera = vi.fn();
    render(<Harness onCamera={onCamera} />);

    fireEvent.pointerDown(viewport(), {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });

    expect(onCamera).not.toHaveBeenCalled();
  });

  it("stops panning after the pointer is released", () => {
    const onCamera = vi.fn();
    render(<Harness onCamera={onCamera} />);

    fireEvent.pointerDown(viewport(), {
      button: 1,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(viewport(), {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    onCamera.mockClear();

    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 300,
      clientY: 300,
    });
    expect(onCamera).not.toHaveBeenCalled();
  });

  it("ignores movement from a pointer that never went down", () => {
    const onCamera = vi.fn();
    render(<Harness onCamera={onCamera} />);

    fireEvent.pointerMove(viewport(), {
      pointerId: 99,
      clientX: 300,
      clientY: 300,
    });
    expect(onCamera).not.toHaveBeenCalled();
  });
});

describe("middle-drag on an entity", () => {
  function EntityHarness({
    onEntityDrag,
    onCamera,
    entity = true,
    zoom = 1,
  }: {
    onEntityDrag?: (element: Element, delta: { x: number; y: number }) => void;
    onCamera?: (camera: Camera) => void;
    entity?: boolean;
    zoom?: number;
  }) {
    const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom });
    return (
      <BoardCanvas
        camera={camera}
        onCameraChange={(next) => {
          setCamera(next);
          onCamera?.(next);
        }}
        onEntityDrag={onEntityDrag}
      >
        {entity ? (
          <div
            data-board-entity="note"
            data-post-it-id="n1"
            style={{ width: 100, height: 100 }}
          >
            note
          </div>
        ) : (
          <div style={{ width: 100, height: 100 }}>loose</div>
        )}
      </BoardCanvas>
    );
  }

  it("reports the entity and moves it rather than the camera", () => {
    const onEntityDrag = vi.fn();
    const onCamera = vi.fn();
    render(<EntityHarness onEntityDrag={onEntityDrag} onCamera={onCamera} />);

    fireEvent.pointerDown(screen.getByText("note"), {
      button: 1,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 160,
      clientY: 130,
    });
    fireEvent.pointerUp(viewport(), {
      pointerId: 1,
      clientX: 160,
      clientY: 130,
    });

    expect(onEntityDrag).toHaveBeenCalledTimes(1);
    const [element, delta] = onEntityDrag.mock.calls[0];
    expect(element.getAttribute("data-post-it-id")).toBe("n1");
    expect(delta).toEqual({ x: 60, y: 30 });
    expect(onCamera).not.toHaveBeenCalled();
  });

  it("scales the delta by the zoom, so the entity keeps up with the pointer", () => {
    const onEntityDrag = vi.fn();
    render(<EntityHarness onEntityDrag={onEntityDrag} zoom={2} />);

    fireEvent.pointerDown(screen.getByText("note"), {
      button: 1,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 200,
      clientY: 100,
    });
    expect(onEntityDrag.mock.calls[0][1]).toEqual({ x: 50, y: 0 });
  });

  it("still pans when the press lands on something that is not an entity", () => {
    const onEntityDrag = vi.fn();
    const onCamera = vi.fn();
    render(
      <EntityHarness
        onEntityDrag={onEntityDrag}
        onCamera={onCamera}
        entity={false}
      />,
    );

    fireEvent.pointerDown(screen.getByText("loose"), {
      button: 1,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 160,
      clientY: 100,
    });

    expect(onEntityDrag).not.toHaveBeenCalled();
    expect(onCamera).toHaveBeenCalled();
  });

  it("leaves right-drag to the camera even over an entity", () => {
    const onEntityDrag = vi.fn();
    const onCamera = vi.fn();
    render(<EntityHarness onEntityDrag={onEntityDrag} onCamera={onCamera} />);

    fireEvent.pointerDown(screen.getByText("note"), {
      button: 2,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 160,
      clientY: 100,
    });

    expect(onEntityDrag).not.toHaveBeenCalled();
    expect(onCamera).toHaveBeenCalled();
  });

  it("stops moving the entity once the pointer is released", () => {
    const onEntityDrag = vi.fn();
    render(<EntityHarness onEntityDrag={onEntityDrag} />);

    fireEvent.pointerDown(screen.getByText("note"), {
      button: 1,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(viewport(), {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 300,
      clientY: 300,
    });

    expect(onEntityDrag).not.toHaveBeenCalled();
  });
});

describe("right-click context", () => {
  it("reports a right-click that did not drag", () => {
    const onContextTarget = vi.fn();
    render(<Harness onContextTarget={onContextTarget} />);

    fireEvent.pointerDown(viewport(), {
      button: 2,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(viewport(), {
      button: 2,
      pointerId: 1,
      clientX: 101,
      clientY: 102,
    });

    expect(onContextTarget).toHaveBeenCalledTimes(1);
    expect(onContextTarget.mock.calls[0][0].clientX).toBe(101);
  });

  it("does not report a right-drag as a context click", () => {
    const onContextTarget = vi.fn();
    render(<Harness onContextTarget={onContextTarget} />);

    fireEvent.pointerDown(viewport(), {
      button: 2,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport(), {
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerUp(viewport(), {
      button: 2,
      pointerId: 1,
      clientX: 200,
      clientY: 200,
    });

    expect(onContextTarget).not.toHaveBeenCalled();
  });

  it("accumulates travel across small steps", () => {
    const onContextTarget = vi.fn();
    render(<Harness onContextTarget={onContextTarget} />);

    fireEvent.pointerDown(viewport(), {
      button: 2,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    for (let i = 1; i <= 5; i++) {
      fireEvent.pointerMove(viewport(), {
        pointerId: 1,
        clientX: 100 + i * 2,
        clientY: 100,
      });
    }
    fireEvent.pointerUp(viewport(), {
      button: 2,
      pointerId: 1,
      clientX: 110,
      clientY: 100,
    });

    expect(onContextTarget).not.toHaveBeenCalled();
  });

  it("does not fire on a left click", () => {
    const onContextTarget = vi.fn();
    render(<Harness onContextTarget={onContextTarget} />);

    fireEvent.pointerDown(viewport(), {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerUp(viewport(), {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });

    expect(onContextTarget).not.toHaveBeenCalled();
  });

  it("suppresses the browser menu", () => {
    render(<Harness />);

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    viewport().dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });
});
