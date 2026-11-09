// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HistoryPanel } from "./HistoryPanel";
import type { BoardHistory, SnapshotSummary } from "../history/types";
import { HOUR_MS } from "../history/retention";

const NOW = Date.UTC(2026, 10, 8, 12);
const restored = { entities: [], strings: [] };

function historyOf(
  snapshots: SnapshotSummary[] | null,
  load: BoardHistory["load"] = async () => restored,
): BoardHistory {
  return { list: async () => snapshots, load };
}

describe("HistoryPanel", () => {
  it("splits the last day's versions from the daily ones", async () => {
    render(
      <HistoryPanel
        history={historyOf([
          { id: "hour", takenAt: NOW - 2 * HOUR_MS, items: 3, strings: 1 },
          { id: "day", takenAt: NOW - 3 * 24 * HOUR_MS, items: 2, strings: 0 },
        ])}
        onRestore={() => {}}
        onClose={() => {}}
        now={NOW}
      />,
    );

    expect(await screen.findByText("Last 24 hours")).toBeTruthy();
    expect(screen.getByText("Daily")).toBeTruthy();
    expect(screen.getByText("3 things · 1 strings")).toBeTruthy();
  });

  it("restores a version only after it is confirmed", async () => {
    const onRestore = vi.fn();
    const onClose = vi.fn();
    const load = vi.fn(async () => restored);
    render(
      <HistoryPanel
        history={historyOf(
          [{ id: "v1", takenAt: NOW - HOUR_MS, items: 1, strings: 0 }],
          load,
        )}
        onRestore={onRestore}
        onClose={onClose}
        now={NOW}
      />,
    );

    fireEvent.click(await screen.findByTestId("history-restore-v1"));
    expect(load).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("history-confirm-v1"));
    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(restored));
    expect(load).toHaveBeenCalledWith("v1");
    expect(onClose).toHaveBeenCalled();
  });

  it("says so when a version cannot be loaded, and stays open", async () => {
    const onRestore = vi.fn();
    const onClose = vi.fn();
    render(
      <HistoryPanel
        history={historyOf(
          [{ id: "v1", takenAt: NOW - HOUR_MS, items: 1, strings: 0 }],
          async () => null,
        )}
        onRestore={onRestore}
        onClose={onClose}
        now={NOW}
      />,
    );

    fireEvent.click(await screen.findByTestId("history-restore-v1"));
    fireEvent.click(screen.getByTestId("history-confirm-v1"));

    expect(
      await screen.findByText("That version could not be loaded."),
    ).toBeTruthy();
    expect(onRestore).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("has an empty state and a failure state", async () => {
    const { unmount } = render(
      <HistoryPanel
        history={historyOf([])}
        onRestore={() => {}}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByTestId("history-empty")).toBeTruthy();
    unmount();

    render(
      <HistoryPanel
        history={historyOf(null)}
        onRestore={() => {}}
        onClose={() => {}}
      />,
    );
    expect(
      await screen.findByText("The history could not be loaded."),
    ).toBeTruthy();
  });
});
