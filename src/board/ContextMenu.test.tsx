// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextMenu, clampMenuPosition } from "./ContextMenu";
import type { ContextMenuEntry } from "./ContextMenu";

function fixture() {
  const pin = vi.fn();
  const note = vi.fn();
  const clear = vi.fn();
  const entries: ContextMenuEntry[] = [
    { id: "pin", label: "Add pin", hint: "P", onSelect: pin },
    { id: "note", label: "Create post-it", hint: "N", onSelect: note },
    { id: "sep", separator: true },
    {
      id: "clear",
      label: "Clear board",
      danger: true,
      disabled: true,
      onSelect: clear,
    },
  ];
  return { pin, note, clear, entries };
}

function openMenu(
  entries: ContextMenuEntry[],
  at: { x: number; y: number } = { x: 100, y: 100 },
) {
  const onClose = vi.fn();
  render(<ContextMenu x={at.x} y={at.y} items={entries} onClose={onClose} />);
  return { onClose };
}

function item(name: RegExp): HTMLElement {
  return screen.getByRole("menuitem", { name });
}

function highlighted(name: RegExp): string | null {
  return item(name).getAttribute("data-highlighted");
}

// jsdom reports a zero-sized box for every element, so a size must be faked.
function rectOf(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ContextMenu", () => {
  it("renders each item, its hint and the separators", () => {
    openMenu(fixture().entries);

    expect(item(/add pin/i)).toBeTruthy();
    expect(item(/create post-it/i)).toBeTruthy();
    expect(screen.getByText("P")).toBeTruthy();
    expect(screen.getByRole("separator")).toBeTruthy();
  });

  it("renders through a portal on document.body", () => {
    openMenu(fixture().entries);
    expect(screen.getByRole("menu").parentElement).toBe(document.body);
  });

  it("calls onSelect and then onClose when an item is clicked", () => {
    const { entries, pin } = fixture();
    const { onClose } = openMenu(entries);

    fireEvent.click(item(/add pin/i));

    expect(pin).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(pin.mock.invocationCallOrder[0]).toBeLessThan(
      onClose.mock.invocationCallOrder[0],
    );
  });

  it("takes focus on open so the keyboard works without clicking", () => {
    const { entries } = fixture();
    const { onClose } = openMenu(entries);

    expect(document.activeElement).toBe(screen.getByRole("menu"));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does nothing when a separator is clicked", () => {
    const { entries, pin, note, clear } = fixture();
    const { onClose } = openMenu(entries);

    fireEvent.click(screen.getByRole("separator"));

    expect(pin).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("dismissal", () => {
  it("closes when the pointer goes down outside the menu", () => {
    const { entries } = fixture();
    const { onClose } = openMenu(entries);

    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    fireEvent.pointerDown(elsewhere);
    elsewhere.remove();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open through the pointerdown that precedes an item click", () => {
    const { entries, pin } = fixture();
    const { onClose } = openMenu(entries);
    const button = item(/add pin/i);

    fireEvent.pointerDown(button);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(button);
    expect(pin).toHaveBeenCalledTimes(1);
  });

  it("closes when a pane behind the board scrolls", () => {
    // Scroll does not bubble, so this only works if the listener captures.
    const { entries } = fixture();
    const { onClose } = openMenu(entries);

    const pane = document.createElement("div");
    document.body.appendChild(pane);
    fireEvent.scroll(pane);
    pane.remove();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on resize", () => {
    const { entries } = fixture();
    const { onClose } = openMenu(entries);

    fireEvent(window, new Event("resize"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("keyboard navigation", () => {
  it("moves the highlight with the arrow keys and fires it on Enter", () => {
    const { entries, pin, note } = fixture();
    const { onClose } = openMenu(entries);
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(highlighted(/add pin/i)).toBe("true");
    expect(menu.getAttribute("aria-activedescendant")).toBe(
      item(/add pin/i).id,
    );

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(highlighted(/create post-it/i)).toBe("true");

    fireEvent.keyDown(menu, { key: "Enter" });
    expect(note).toHaveBeenCalledTimes(1);
    expect(pin).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("wraps around and skips the disabled item in both directions", () => {
    const { entries, clear } = fixture();
    openMenu(entries);
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(highlighted(/create post-it/i)).toBe("true");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(highlighted(/add pin/i)).toBe("true");
    expect(highlighted(/clear board/i)).toBeNull();
    expect(clear).not.toHaveBeenCalled();
  });

  it("never activates a disabled item, by keyboard or by click", () => {
    const { entries, clear, note } = fixture();
    const { onClose } = openMenu(entries);
    const menu = screen.getByRole("menu");

    fireEvent.click(item(/clear board/i));
    expect(clear).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(menu, { key: "End" });
    expect(highlighted(/create post-it/i)).toBe("true");
    expect(highlighted(/clear board/i)).toBeNull();

    fireEvent.keyDown(menu, { key: "Enter" });
    expect(note).toHaveBeenCalledTimes(1);
    expect(clear).not.toHaveBeenCalled();
  });

  it("jumps to the first and last enabled items with Home and End", () => {
    openMenu(fixture().entries);
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "End" });
    expect(highlighted(/create post-it/i)).toBe("true");

    fireEvent.keyDown(menu, { key: "Home" });
    expect(highlighted(/add pin/i)).toBe("true");
  });
});

describe("clamping", () => {
  it("pulls a menu opened at the bottom-right corner back on screen", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      rectOf(200, 150),
    );
    const { entries } = fixture();

    openMenu(entries, { x: window.innerWidth - 4, y: window.innerHeight - 4 });

    const menu = screen.getByRole("menu");
    const left = Number.parseFloat(menu.style.left);
    const top = Number.parseFloat(menu.style.top);
    expect(left + 200).toBeLessThanOrEqual(window.innerWidth);
    expect(top + 150).toBeLessThanOrEqual(window.innerHeight);
    expect(left).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);
  });

  it("re-clamps when longer items arrive while it is open", () => {
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockReturnValue(rectOf(120, 60));
    const anchor = { x: window.innerWidth - 4, y: window.innerHeight - 4 };
    const short: ContextMenuEntry[] = [
      { id: "a", label: "A", onSelect: () => {} },
    ];
    const { rerender } = render(
      <ContextMenu
        x={anchor.x}
        y={anchor.y}
        items={short}
        onClose={() => {}}
      />,
    );

    spy.mockReturnValue(rectOf(400, 400));
    const long: ContextMenuEntry[] = [
      {
        id: "a",
        label: "A label long enough to wrap across several lines",
        onSelect: () => {},
      },
      { id: "b", label: "Another item", onSelect: () => {} },
    ];
    rerender(
      <ContextMenu x={anchor.x} y={anchor.y} items={long} onClose={() => {}} />,
    );

    const menu = screen.getByRole("menu");
    const left = Number.parseFloat(menu.style.left);
    const top = Number.parseFloat(menu.style.top);
    expect(left + 400).toBeLessThanOrEqual(window.innerWidth);
    expect(top + 400).toBeLessThanOrEqual(window.innerHeight);
  });
});

describe("clampMenuPosition", () => {
  const viewport = { width: 1024, height: 768 };
  const size = { width: 200, height: 150 };

  it("pulls a menu back from the bottom-right corner", () => {
    expect(clampMenuPosition({ x: 1020, y: 764 }, size, viewport)).toEqual({
      left: 816,
      top: 610,
    });
  });

  it("leaves a menu that already fits where the pointer asked", () => {
    expect(clampMenuPosition({ x: 200, y: 120 }, size, viewport)).toEqual({
      left: 200,
      top: 120,
    });
  });

  it("keeps the margin when the pointer is at the very top-left", () => {
    expect(clampMenuPosition({ x: 0, y: 0 }, size, viewport)).toEqual({
      left: 8,
      top: 8,
    });
  });

  it("pins the corner instead of overflowing when the menu is larger than the viewport", () => {
    expect(
      clampMenuPosition(
        { x: 500, y: 500 },
        { width: 1200, height: 900 },
        viewport,
      ),
    ).toEqual({
      left: 8,
      top: 8,
    });
  });
});
