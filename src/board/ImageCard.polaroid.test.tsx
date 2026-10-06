// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImageCard, type ImageCardProps } from "./ImageCard";
import { POLAROID_INSETS } from "../model/kinds";

function card(over: Partial<ImageCardProps> = {}) {
  return render(
    <ImageCard
      id="p1"
      src="data:image/png;base64,AAAA"
      x={0}
      y={0}
      width={280}
      height={218}
      rotation={0}
      fit="cover"
      edge="torn"
      edgeSeed={3}
      frame="polaroid"
      title="The safe house"
      description="Seen leaving at 3am, twice."
      selected={false}
      zoom={1}
      toBoard={(x, y) => ({ x, y })}
      onMove={vi.fn()}
      onRotate={vi.fn()}
      onResize={vi.fn()}
      onStartYarn={vi.fn()}
      onSelect={vi.fn()}
      {...over}
    />,
  );
}

describe("ImageCard as a polaroid", () => {
  it("writes the title above the photo and the description below it, unselected", () => {
    card();
    const frame = screen.getByTestId("polaroid");
    const title = screen.getByText("The safe house");
    const caption = screen.getByText("Seen leaving at 3am, twice.");

    expect(frame.contains(title)).toBe(true);
    expect(frame.contains(caption)).toBe(true);
    expect(title.compareDocumentPosition(frame.querySelector("img")!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(caption.style.height).toBe(`${POLAROID_INSETS.bottom}px`);
  });

  it("keeps the title clear of the tack", () => {
    card();
    const tack = screen.getByTestId("image-pin");
    const title = screen.getByText("The safe house");

    expect(parseFloat(title.style.top)).toBeGreaterThan(
      parseFloat(tack.style.top) + 7,
    );
  });

  it("writes nothing when there is no title or description", () => {
    card({ title: "", description: "" });

    expect(screen.getByTestId("polaroid").textContent).toBe("");
  });

  it("does not crop a polaroid with the picture's damaged edge", () => {
    card();

    expect(screen.getByTestId("polaroid").style.clipPath).toBe("");
  });

  it("looks as it always did without a frame", () => {
    const { container } = card({ frame: "none" });

    expect(screen.queryByTestId("polaroid")).toBeNull();
    expect(screen.queryByText("The safe house")).toBeNull();
    const frame = container.querySelector(".image-frame") as HTMLElement;
    expect(frame.style.clipPath).toContain("polygon");
  });
});
