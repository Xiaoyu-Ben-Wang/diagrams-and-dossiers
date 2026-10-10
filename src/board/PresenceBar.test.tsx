// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BoardPresence, Peer } from "../realtime/presence";
import { PresenceBar, initials } from "./PresenceBar";

function fakePresence(peers: Peer[]): BoardPresence {
  return {
    peers: () => peers,
    subscribe: () => () => {},
    motion: () => new Map(),
    move: () => {},
    moveThing: () => {},
    editing: () => {},
    editors: () => new Map(),
    identify: () => {},
    dispose: () => {},
  };
}

const kael: Peer = {
  userId: "b",
  name: "Kael",
  color: "#c0392b",
  at: { x: 120, y: 40 },
  editing: null,
};

describe("the row of people in the top bar", () => {
  it("shows you alongside everyone else", () => {
    render(
      <PresenceBar
        presence={fakePresence([kael])}
        self={{ name: "Dungeon Master", color: "#2563a8" }}
        onJump={() => {}}
      />,
    );

    expect(screen.getByTestId("presence-you")).toBeTruthy();
    expect(screen.getByTestId("presence-Kael")).toBeTruthy();
  });

  it("goes to where the person is when they are picked", () => {
    const onJump = vi.fn();
    render(<PresenceBar presence={fakePresence([kael])} onJump={onJump} />);

    fireEvent.click(screen.getByTestId("presence-Kael"));

    expect(onJump).toHaveBeenCalledWith({ x: 120, y: 40 });
  });

  it("offers nothing to go to for someone who has not moved yet", () => {
    const onJump = vi.fn();
    render(
      <PresenceBar
        presence={fakePresence([{ ...kael, at: null }])}
        onJump={onJump}
      />,
    );

    // Presence says they are here; the cursor is what says where "here" is.
    expect(screen.queryByTestId("presence-Kael")).toBeNull();
    expect(onJump).not.toHaveBeenCalled();
  });

  it("says nothing at all on a board with no one else on it", () => {
    const { container } = render(
      <PresenceBar presence={null} onJump={() => {}} />,
    );

    expect(container.firstChild).toBeNull();
  });
});

describe("initials", () => {
  it("takes two letters from one word and one from each of two", () => {
    expect(initials("kobold")).toBe("KO");
    expect(initials("Dungeon Master")).toBe("DM");
    expect(initials("Anonymous Kobold")).toBe("AK");
    expect(initials("  ")).toBe("?");
  });
});
