// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import {
  ARTICLE_ID,
  ARTICLE_IDS,
  FOURTH_ARTICLE_ID,
  SECOND_ARTICLE_ID,
  THIRD_ARTICLE_ID,
} from "./app/demo";
import { DEFAULT_SLACK, sagFor } from "./board/yarn";
import {
  DEFAULT_YARN_COLOR,
  YARN_BASE,
  yarnColorCss,
} from "./board/yarn-color";
import { demoBoard, demoPages } from "./app/demo";
import {
  parseBoardFile,
  readBoardFile,
  serializeBoard,
} from "./board/board-file";
import { memoryBoardStorage } from "./boards/board-storage";
import { createBoardRecord, type BoardRecord } from "./boards/board-record";
import { POST_IT_COLORS } from "./board/tuning";
import { newArticle } from "./model/create";
import type { BoardEntity } from "./model/types";
import { getPreferences, resetPreferences } from "./theme/preferences";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

function tap(element: Element): void {
  fireEvent.pointerDown(element, {
    button: 0,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
  });
  fireEvent.pointerUp(element, {
    button: 0,
    pointerId: 1,
    clientX: 10,
    clientY: 10,
  });
}

/** Presses the editor's edge at `from` and drags it to `to`; the panel takes the difference. */
function dragEdge(handle: Element, from: number, to: number): void {
  const at = { button: 0, pointerId: 1, clientY: 200 };
  fireEvent.pointerDown(handle, { ...at, clientX: from });
  fireEvent.pointerMove(handle, { ...at, clientX: to });
  fireEvent.pointerUp(handle, { ...at, clientX: to });
}

/** A right press, which is what the board opens its menu on. */
function rightClick(element: Element, clientX = 400, clientY = 300): void {
  fireEvent.pointerDown(element, { button: 2, pointerId: 3, clientX, clientY });
  fireEvent.pointerUp(element, { button: 2, pointerId: 3, clientX, clientY });
}

/** A click on the bare board, which in a browser always follows a press on it. Without
    the press the board cannot tell it from the click a palette drop leaves behind. */
function clickBoard(canvas: Element, clientX: number, clientY: number): void {
  fireEvent.pointerDown(canvas, { button: 0, pointerId: 77, clientX, clientY });
  fireEvent.pointerUp(canvas, { button: 0, pointerId: 77, clientX, clientY });
  fireEvent.click(canvas, { clientX, clientY });
}

function sheet(container: HTMLElement, articleId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-article-id="${articleId}"]`,
  );
  if (!element) throw new Error(`no sheet for article ${articleId}`);
  return element;
}

function posOf(
  container: HTMLElement,
  articleId: string,
): { x: number; y: number } {
  const style = sheet(container, articleId).getAttribute("style") ?? "";
  const match = style.match(/translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/);
  if (!match) throw new Error(`no translation on ${articleId}`);
  return { x: Number.parseFloat(match[1]), y: Number.parseFloat(match[2]) };
}

const FIRST_PAGE = ARTICLE_ID;
const SECOND_PAGE = SECOND_ARTICLE_ID;
const THIRD_PAGE = THIRD_ARTICLE_ID;
const FOURTH_PAGE = FOURTH_ARTICLE_ID;

function renderBoard() {
  return render(<App seed={{ entities: demoPages(), strings: [] }} />);
}

describe("App — the board", () => {
  it("renders without throwing", () => {
    renderBoard();
    expect(screen.getByText("Diagrams & Dossiers")).toBeTruthy();
  });

  it("renders markdown into real elements, not raw text", () => {
    const { container } = renderBoard();
    const article = sheet(container, FIRST_PAGE).querySelector(".article");
    expect(article).not.toBeNull();

    expect(article!.querySelector("h1")?.textContent).toBe("The Drowned Bell");
    expect(article!.textContent).toContain("Black Coin");
    expect(article!.querySelectorAll("li").length).toBeGreaterThan(0);
  });

  it("sanitizes the article rather than injecting raw html", () => {
    const { container } = renderBoard();
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders the article as prose, with the mention syntax resolved away", () => {
    const { container } = renderBoard();
    const article = sheet(container, FIRST_PAGE).querySelector(".article")!;

    expect(article.textContent).not.toContain("@[");
    expect(article.textContent).not.toContain("[[");
    expect(article.textContent).toContain("Molgar the Pale");

    const link = article.querySelector("a.mention");
    expect(link?.textContent).toBe("The Black Coin");
    expect(link?.getAttribute("href")?.startsWith("#")).toBe(true);
  });

  it("renders the board grid", () => {
    renderBoard();
    expect(screen.getByTestId("board-grid")).toBeTruthy();
  });
});

describe("App — document selection", () => {
  it("hides the markdown editor until a document is selected", () => {
    renderBoard();
    expect(screen.queryByLabelText("Article markdown source")).toBeNull();
  });

  it("opens the editor when the document tab is clicked", () => {
    const { container } = renderBoard();
    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));

    const editor = screen.getByTestId("paper-editor");
    expect(editor).toBeTruthy();
    expect(
      within(editor).getByLabelText("Article markdown source"),
    ).toBeTruthy();
  });

  it("shows the formatting toolbar alongside the editor", () => {
    const { container } = renderBoard();
    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));

    const toolbar = screen.getByTestId("markdown-toolbar");
    expect(within(toolbar).getByLabelText(/Bold/)).toBeTruthy();
    expect(within(toolbar).getByLabelText(/Italic/)).toBeTruthy();
  });

  it("closes the editor when the tab is clicked again", () => {
    const { container } = renderBoard();
    const tab = within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab");
    tap(tab);
    tap(tab);

    expect(screen.queryByTestId("paper-editor")).toBeNull();
  });

  it("applies a formatting action to the source", () => {
    const { container } = renderBoard();
    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));

    const textarea = screen.getByLabelText(
      "Article markdown source",
    ) as HTMLTextAreaElement;
    textarea.setSelectionRange(0, 14);
    fireEvent.click(
      within(screen.getByTestId("markdown-toolbar")).getByLabelText(/Bold/),
    );

    expect(textarea.value.startsWith("**# The Drowned")).toBe(true);
  });

  it("opens the editor on the page whose tab was clicked", async () => {
    const { container } = renderBoard();
    tap(within(sheet(container, SECOND_PAGE)).getByTestId("paper-tab"));

    const editor = screen.getByTestId("paper-editor");
    const title = within(editor).getByLabelText(
      "Page title",
    ) as HTMLInputElement;
    expect(title.value).toBe("The Harbormaster's Ledger");

    const textarea = within(editor).getByLabelText(
      "Article markdown source",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toContain("Sea Ghost");
    expect(textarea.value).not.toContain("Drowned Bell");
  });

  it("widens the editor when its edge is dragged", () => {
    const { container } = renderBoard();
    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));

    const editor = screen.getByTestId("paper-editor");
    expect(editor.style.width).toBe("min(92vw, 380px)");

    dragEdge(screen.getByTestId("paper-editor-resize"), 380, 460);

    expect(editor.style.width).toBe("min(92vw, 460px)");
  });

  it("holds the editor between its narrowest and the width of the window", () => {
    const { container } = renderBoard();
    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));

    const editor = screen.getByTestId("paper-editor");
    const handle = screen.getByTestId("paper-editor-resize");

    dragEdge(handle, 380, 20);
    expect(editor.style.width).toBe("min(92vw, 300px)");

    dragEdge(handle, 380, 4000);
    // 92vw of jsdom's 1024px window is 942, past the 900 ceiling.
    expect(editor.style.width).toBe("min(92vw, 900px)");
  });

  it("moves the editor with the selection rather than opening a second one", () => {
    const { container } = renderBoard();
    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));
    tap(within(sheet(container, SECOND_PAGE)).getByTestId("paper-tab"));

    expect(screen.getAllByTestId("paper-editor").length).toBe(1);
    expect(
      (screen.getByLabelText("Article markdown source") as HTMLTextAreaElement)
        .value,
    ).toContain("Sea Ghost");
  });
});

describe("App — four pages on the board", () => {
  it("renders a sheet, a tab and a pin for each", () => {
    const { container } = renderBoard();

    expect(container.querySelectorAll("[data-article-id]").length).toBe(
      ARTICLE_IDS.length,
    );
    expect(screen.getAllByTestId("paper-tab").length).toBe(ARTICLE_IDS.length);
    expect(screen.getAllByTestId("paper-pin").length).toBe(ARTICLE_IDS.length);
  });

  it("labels each tab with its own page", () => {
    const { container } = renderBoard();

    expect(sheet(container, FIRST_PAGE).textContent).toContain(
      "The Drowned Bell",
    );
    expect(sheet(container, SECOND_PAGE).textContent).toContain(
      "The Harbormaster's Ledger",
    );
    expect(sheet(container, THIRD_PAGE).textContent).toContain(
      "The Ferryman's Account",
    );
    expect(sheet(container, FOURTH_PAGE).textContent).toContain(
      "The Sea Ghost's Manifest",
    );
  });

  it("gives each page the width its own options ask for", () => {
    const { container } = renderBoard();

    expect(sheet(container, FIRST_PAGE).style.width).toBe("720px");
    expect(sheet(container, SECOND_PAGE).style.width).toBe("520px");
    expect(sheet(container, THIRD_PAGE).style.width).toBe("500px");
    expect(sheet(container, FOURTH_PAGE).style.width).toBe("560px");
  });

  it("resolves a pin against the page it was pinned to, not the first one", async () => {
    const { container } = renderBoard();
    const second = sheet(container, SECOND_PAGE);
    const body = second.querySelector(".article") as HTMLElement;

    const caret = (document as Document & { caretRangeFromPoint?: unknown })
      .caretRangeFromPoint;
    (
      document as Document & { caretRangeFromPoint?: unknown }
    ).caretRangeFromPoint = () => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode() as Text | null;
      if (!text) return null;
      const range = document.createRange();
      range.setStart(text, 0);
      range.collapse(true);
      return range;
    };

    try {
      fireEvent.click(body, { ctrlKey: true, clientX: 120, clientY: 60 });

      const tacks = container.querySelectorAll("button[data-pin-id]");
      expect(tacks.length).toBe(1);
      const tack = tacks[0] as HTMLElement;

      expect(tack.getAttribute("data-status")).toBe("exact");
      expect(second.contains(tack)).toBe(true);
      expect(sheet(container, FIRST_PAGE).contains(tack)).toBe(false);
    } finally {
      (
        document as Document & { caretRangeFromPoint?: unknown }
      ).caretRangeFromPoint = caret;
    }
  });
});

describe("App — chronology", () => {
  it("is off the board for now", () => {
    renderBoard();
    expect(screen.queryByTestId("timeline-ribbon")).toBeNull();
  });
});

describe("App — routing", () => {
  it("serves the board at the root", () => {
    renderBoard();
    expect(window.location.pathname).toBe("/");
    expect(screen.getByTestId("board-canvas")).toBeTruthy();
  });

  it("offers no way out of a board that was handed to it directly", () => {
    // A seeded board has no library behind it, so there is nowhere to go back to.
    renderBoard();
    expect(screen.queryByTestId("back-to-boards")).toBeNull();
  });
});

describe("App — the demo board on its own address", () => {
  it("opens the sample board, and puts nothing in the library", async () => {
    const storage = memoryBoardStorage([]);
    window.history.replaceState(null, "", "/demo");
    render(<App storage={storage} />);

    // Rendered from the seed, so it is on screen before the library has been read.
    expect(await screen.findByTestId("board-canvas")).toBeTruthy();
    // Twice over: the board's name in the top bar, and the page carrying it.
    expect(screen.getAllByText("The Drowned Bell").length).toBeGreaterThan(1);
    // The point of the address: looking at the demo does not create a board.
    await act(async () => {});
    expect(await storage.list()).toEqual([]);
  });
});

describe("App — the boards library", () => {
  const board = { entities: [], strings: [] };
  const ledger = { ...createBoardRecord("Ledger", board, 1) };
  const manifest = { ...createBoardRecord("Manifest", board, 2) };

  const openLibrary = (
    records: readonly BoardRecord[] = [ledger, manifest],
  ) => {
    const storage = memoryBoardStorage(records);
    // At `/` the app opens the last board; the library is its own address.
    window.history.replaceState(null, "", "/boards");
    render(<App storage={storage} />);
    return storage;
  };

  it("lists the boards you have, most recently changed first", () => {
    openLibrary();

    const names = screen
      .getAllByRole("button", { name: /Ledger|Manifest/ })
      .map((button) => button.textContent);
    expect(names[0]).toContain("Manifest");
  });

  it("walks back out of a board to the library", async () => {
    const storage = memoryBoardStorage([ledger]);
    window.history.replaceState(null, "", `/b/${ledger.id}`);
    render(<App storage={storage} />);
    expect(screen.getByTestId("board-canvas")).toBeTruthy();

    fireEvent.click(screen.getByTestId("back-to-boards"));

    expect(window.location.pathname).toBe("/boards");
    expect(screen.getByTestId("library")).toBeTruthy();
  });

  it("opens a board from the library, and says which one it is", async () => {
    openLibrary();

    fireEvent.click(screen.getByTestId(`open-${ledger.id}`));

    expect(window.location.pathname).toBe(`/b/${ledger.id}`);
    expect(await screen.findByTestId("board-name")).toBeTruthy();
  });

  it("renames the board from the board itself, and writes it down", async () => {
    const storage = memoryBoardStorage([ledger]);
    window.history.replaceState(null, "", `/b/${ledger.id}`);
    render(<App storage={storage} />);
    await screen.findByTestId("board-name");

    const field = screen.getByLabelText("Board name") as HTMLInputElement;
    expect(field.value).toBe("Ledger");

    // Enter drops focus, and it is the blur that commits — so the field has to hold it.
    field.focus();
    fireEvent.change(field, { target: { value: "The Ledger" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect((await storage.get(ledger.id))?.name).toBe("The Ledger");
    expect(
      (screen.getByLabelText("Board name") as HTMLInputElement).value,
    ).toBe("The Ledger");
  });

  it("keeps the old name when the board is renamed to nothing", async () => {
    const storage = memoryBoardStorage([ledger]);
    window.history.replaceState(null, "", `/b/${ledger.id}`);
    render(<App storage={storage} />);
    await screen.findByTestId("board-name");

    const field = screen.getByLabelText("Board name") as HTMLInputElement;
    field.focus();
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect((await storage.get(ledger.id))?.name).toBe("Ledger");
    expect(
      (screen.getByLabelText("Board name") as HTMLInputElement).value,
    ).toBe("Ledger");
  });

  it("leaves the demo's name alone, having no record to write it to", async () => {
    window.history.replaceState(null, "", "/demo");
    render(<App storage={memoryBoardStorage([])} />);

    expect((await screen.findByTestId("board-name")).textContent).toBe(
      "The Drowned Bell",
    );
    expect(screen.queryByLabelText("Board name")).toBeNull();
  });

  it("renames a board, and writes it down", async () => {
    const storage = openLibrary([ledger]);

    fireEvent.click(screen.getByTestId(`rename-${ledger.id}`));
    fireEvent.change(screen.getByLabelText("New name for Ledger"), {
      target: { value: "The Ledger" },
    });
    fireEvent.keyDown(screen.getByLabelText("New name for Ledger"), {
      key: "Enter",
    });

    expect(
      await screen.findByRole("button", { name: "The Ledger" }),
    ).toBeTruthy();
    expect((await storage.get(ledger.id))?.name).toBe("The Ledger");
  });

  it("will not leave a board without a name", async () => {
    const storage = openLibrary([ledger]);

    fireEvent.click(screen.getByTestId(`rename-${ledger.id}`));
    fireEvent.change(screen.getByLabelText("New name for Ledger"), {
      target: { value: "   " },
    });
    fireEvent.keyDown(screen.getByLabelText("New name for Ledger"), {
      key: "Enter",
    });

    expect((await storage.get(ledger.id))?.name).toBe("Ledger");
  });

  it("asks before it deletes, and then deletes", async () => {
    const storage = openLibrary([ledger]);

    fireEvent.click(screen.getByTestId(`delete-${ledger.id}`));
    expect(await storage.get(ledger.id)).not.toBeNull();

    fireEvent.click(screen.getByTestId(`confirm-delete-${ledger.id}`));

    expect(await screen.findByTestId("library-empty")).toBeTruthy();
    expect(await storage.get(ledger.id)).toBeNull();
  });

  it("copies a link to a board", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    openLibrary([ledger]);

    fireEvent.click(screen.getByTestId(`share-${ledger.id}`));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(`/b/${ledger.id}`),
    );
    Reflect.deleteProperty(navigator, "clipboard");
  });

  it("offers the link in a field when the clipboard will not take it", async () => {
    openLibrary([ledger]);

    fireEvent.click(screen.getByTestId(`share-${ledger.id}`));

    const field = await screen.findByTestId(`link-${ledger.id}`);
    expect((field as HTMLInputElement).value).toContain(`/b/${ledger.id}`);
  });

  it("starts empty, and offers the demo board rather than saving it for you", async () => {
    openLibrary([]);

    expect(screen.getByTestId("library-empty")).toBeTruthy();

    fireEvent.click(screen.getByTestId("open-demo"));

    expect(await screen.findByTestId("board-canvas")).toBeTruthy();
  });

  it("makes a new board and opens it", async () => {
    const storage = openLibrary([]);

    fireEvent.click(screen.getByTestId("new-board"));

    expect(await screen.findByTestId("board-canvas")).toBeTruthy();
    expect((await storage.list()).map((record) => record.name)).toEqual([
      "Untitled board",
    ]);
  });

  it("adds an imported file as another board, when that is what you pick", async () => {
    const storage = memoryBoardStorage([ledger]);
    window.history.replaceState(null, "", `/b/${ledger.id}`);
    render(<App storage={storage} />);

    fireEvent.click(screen.getByRole("button", { name: /open preferences/i }));
    fireEvent.click(screen.getByRole("button", { name: /^import board…$/i }));
    const input = screen.getByLabelText(
      /choose a board file/i,
    ) as HTMLInputElement;
    const page = newArticle(
      { x: 0, y: 0 },
      "# A Loaded Case\n\nThe file this board came from.",
      "A Loaded Case",
      undefined,
      { id: "loaded-page" },
    );
    const file = new File(
      [serializeBoard({ entities: [page], strings: [] })],
      "case-board.json",
      {
        type: "application/json",
      },
    );
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input);

    fireEvent.click(await screen.findByTestId("import-add"));

    expect(await screen.findByTestId("board-canvas")).toBeTruthy();
    // Named after the page it carried, which is the habit the file name already had.
    expect((await storage.list()).map((record) => record.name).sort()).toEqual([
      "A Loaded Case",
      "Ledger",
    ]);
  });
});

describe("App — pinning by click", () => {
  const freePins = (container: HTMLElement) =>
    container.querySelectorAll('[data-status="free"]').length;

  it("does not pin on a plain click", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"));
    expect(freePins(container)).toBe(0);
  });

  it("pins on a ctrl-click", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), { ctrlKey: true });
    expect(freePins(container)).toBe(1);
  });

  it("pins on a cmd-click too, since ctrl-click is the macOS context menu", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), { metaKey: true });
    expect(freePins(container)).toBe(1);
  });
});

describe("App — placing pins", () => {
  const freePins = (container: HTMLElement) =>
    container.querySelectorAll('[data-status="free"]').length;

  it("places a pin from the context menu, even over bare board", () => {
    const { container } = renderBoard();
    rightClick(screen.getByTestId("board-canvas"));

    fireEvent.click(screen.getByText("Add pin"));
    expect(freePins(container)).toBe(1);
  });

  it("offers the context menu on bare board", () => {
    renderBoard();
    rightClick(screen.getByTestId("board-canvas"));
    expect(screen.getByText("Create post-it")).toBeTruthy();
  });

  it("creates a post-it from the context menu", () => {
    const { container } = renderBoard();
    rightClick(screen.getByTestId("board-canvas"));

    fireEvent.click(screen.getByText("Create post-it"));
    expect(
      container.querySelectorAll('[aria-label="Post-it note"]').length,
    ).toBe(1);
  });

  it("draws the live string from the tack it started at", async () => {
    // Needs an ANCHORED pin, which needs caretRangeFromPoint — absent in jsdom —
    // so it is stubbed locally: a global stub would anchor every other test's clicks.
    const { container } = renderBoard();
    const article = sheet(container, FIRST_PAGE).querySelector(".article")!;

    const caret = (document as Document & { caretRangeFromPoint?: unknown })
      .caretRangeFromPoint;
    (
      document as Document & { caretRangeFromPoint?: unknown }
    ).caretRangeFromPoint = () => {
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode() as Text | null;
      if (!text) return null;
      const range = document.createRange();
      range.setStart(text, 0);
      range.collapse(true);
      return range;
    };

    try {
      fireEvent.click(article, { ctrlKey: true, clientX: 120, clientY: 60 });

      const tack = container.querySelector(
        "button[data-pin-id]",
      ) as HTMLElement;
      expect(tack).not.toBeNull();

      fireEvent.pointerDown(tack, {
        button: 0,
        pointerId: 7,
        clientX: 181,
        clientY: 52,
      });
      await act(async () => {
        await new Promise((resolve) =>
          requestAnimationFrame(() => resolve(null)),
        );
      });

      // The stubbed range box is 100..180 by 50..70, so the tack sits at 181,52
      // and the paper is at the board origin.
      expect(screen.getByTestId("live-yarn").getAttribute("d")).toMatch(
        /^M 181 52/,
      );
    } finally {
      (
        document as Document & { caretRangeFromPoint?: unknown }
      ).caretRangeFromPoint = caret;
    }
  });

  it("positions an anchored tack across the paper padding, not from its corner", async () => {
    // jsdom reports no padding, so the paper's computed style is stubbed; only
    // the paper's, since the real one is delegated to for everything else.
    const realGetComputedStyle = window.getComputedStyle;
    window.getComputedStyle = ((element: Element, pseudo?: string | null) => {
      if ((element as HTMLElement).dataset?.testid === "paper") {
        return {
          paddingLeft: "48px",
          paddingTop: "40px",
          borderLeftWidth: "0px",
          borderTopWidth: "0px",
        } as CSSStyleDeclaration;
      }
      return realGetComputedStyle.call(window, element, pseudo ?? undefined);
    }) as typeof window.getComputedStyle;

    const { container } = renderBoard();
    const article = sheet(container, FIRST_PAGE).querySelector(".article")!;

    const caret = (document as Document & { caretRangeFromPoint?: unknown })
      .caretRangeFromPoint;
    (
      document as Document & { caretRangeFromPoint?: unknown }
    ).caretRangeFromPoint = () => {
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
      const text = walker.nextNode() as Text | null;
      if (!text) return null;
      const range = document.createRange();
      range.setStart(text, 0);
      range.collapse(true);
      return range;
    };

    try {
      fireEvent.click(article, { ctrlKey: true, clientX: 120, clientY: 60 });
      const tack = container.querySelector(
        "button[data-pin-id]",
      ) as HTMLElement;
      expect(tack).not.toBeNull();

      fireEvent.pointerDown(tack, {
        button: 0,
        pointerId: 7,
        clientX: 181,
        clientY: 52,
      });
      await act(async () => {
        await new Promise((resolve) =>
          requestAnimationFrame(() => resolve(null)),
        );
      });

      // The tack is at 181,52 inside the article; the paper's padding carries it
      // to 229,92 in board space.
      expect(screen.getByTestId("live-yarn").getAttribute("d")).toMatch(
        /^M 229 92/,
      );
    } finally {
      window.getComputedStyle = realGetComputedStyle;
      (
        document as Document & { caretRangeFromPoint?: unknown }
      ).caretRangeFromPoint = caret;
    }
  });

  it("opens the editor when a pin is clicked rather than dragged", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    const tack = container.querySelector("button[data-pin-id]") as HTMLElement;

    fireEvent.pointerDown(tack, {
      button: 0,
      pointerId: 40,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerUp(window, { pointerId: 40, clientX: 300, clientY: 200 });

    expect(screen.getByTestId("pin-editor")).toBeTruthy();
  });

  it("does not open the editor when the same press travels", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    const tack = container.querySelector("button[data-pin-id]") as HTMLElement;

    fireEvent.pointerDown(tack, {
      button: 0,
      pointerId: 41,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerMove(window, {
      pointerId: 41,
      clientX: 420,
      clientY: 260,
    });
    fireEvent.pointerUp(window, { pointerId: 41, clientX: 420, clientY: 260 });

    expect(screen.queryByTestId("pin-editor")).toBeNull();
  });

  it("opens the editor on a pin stuck through a word too", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });

    const tack = container.querySelector("button[data-pin-id]") as HTMLElement;
    fireEvent.pointerDown(tack, {
      button: 0,
      pointerId: 42,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerUp(window, { pointerId: 42, clientX: 302, clientY: 201 });

    expect(screen.getByTestId("pin-editor")).toBeTruthy();
  });

  it("connects two pins on the board with a string", () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 });

    const tacks = container.querySelectorAll("button[data-pin-id]");
    expect(tacks.length).toBe(2);

    fireEvent.pointerDown(tacks[0], {
      button: 0,
      pointerId: 21,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 21,
      clientX: 520,
      clientY: 260,
    });
    fireEvent.pointerUp(canvas, { pointerId: 21, clientX: 520, clientY: 260 });

    const yarn = container.querySelectorAll('[data-testid="yarn"]');
    expect(yarn.length).toBeGreaterThan(0);

    const strands = container.querySelectorAll('[data-testid="yarn"] path');
    expect(strands.length).toBeGreaterThan(0);
    // The shadow is a pass of its own, so the string is the pass in the yarn's colour.
    expect(
      [...strands].map((strand) => strand.getAttribute("stroke")),
    ).toContain(YARN_BASE);

    const group = container.querySelector(
      '[data-testid="yarn"]',
    ) as SVGGElement;
    expect(group.style.getPropertyValue("--yarn-base")).toBe(
      yarnColorCss(DEFAULT_YARN_COLOR),
    );
    expect(group.style.opacity).toBe("");
  });

  function yarnControlY(container: HTMLElement): number {
    const d =
      container.querySelector('[data-testid="yarn"] path')?.getAttribute("d") ??
      "";
    const match = d.match(/Q [\d.-]+ ([\d.-]+)/);
    return match ? Number(match[1]) : Number.NaN;
  }

  it("selects a string by clicking it, and re-sags it by dragging the bead", () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 });
    const tacks = container.querySelectorAll("button[data-pin-id]");
    fireEvent.pointerDown(tacks[0], {
      button: 0,
      pointerId: 21,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 21,
      clientX: 520,
      clientY: 260,
    });
    fireEvent.pointerUp(canvas, { pointerId: 21, clientX: 520, clientY: 260 });

    expect(screen.queryByTestId("yarn-bead")).toBeNull();

    // Aim at the curve's lowest point — the chord midpoint, half the sag below it.
    const span = Math.hypot(520 - 300, 260 - 200);
    const apexY = 230 + sagFor(span, DEFAULT_SLACK) / 2;
    clickBoard(canvas, 410, apexY);

    expect(screen.queryByTestId("yarn-bead")).not.toBeNull();
    expect(screen.queryByTestId("yarn-halo")).not.toBeNull();

    const slackBefore = yarnControlY(container);
    const bead = screen.getByTestId("yarn-bead");
    fireEvent.pointerDown(bead, {
      button: 0,
      pointerId: 9,
      clientX: 410,
      clientY: apexY,
    });
    fireEvent.pointerMove(bead, {
      pointerId: 9,
      clientX: 410,
      clientY: apexY + 40,
    });
    fireEvent.pointerUp(bead, {
      pointerId: 9,
      clientX: 410,
      clientY: apexY + 40,
    });
    const sagged = yarnControlY(container);
    expect(sagged).toBeGreaterThan(slackBefore);

    fireEvent.pointerDown(bead, {
      button: 0,
      pointerId: 10,
      clientX: 410,
      clientY: apexY,
    });
    fireEvent.pointerMove(bead, {
      pointerId: 10,
      clientX: 410,
      clientY: apexY - 60,
    });
    fireEvent.pointerUp(bead, {
      pointerId: 10,
      clientX: 410,
      clientY: apexY - 60,
    });
    expect(yarnControlY(container)).toBeLessThan(sagged);
  });

  it("draws a string in the colour picked from its note", () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 });
    const tacks = container.querySelectorAll("button[data-pin-id]");
    fireEvent.pointerDown(tacks[0], {
      button: 0,
      pointerId: 21,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 21,
      clientX: 520,
      clientY: 260,
    });
    fireEvent.pointerUp(canvas, { pointerId: 21, clientX: 520, clientY: 260 });

    const span = Math.hypot(520 - 300, 260 - 200);
    clickBoard(canvas, 410, 230 + sagFor(span, DEFAULT_SLACK) / 2);

    const painted = () =>
      (
        container.querySelector('[data-testid="yarn"]') as SVGGElement
      ).style.getPropertyValue("--yarn-base");
    expect(painted()).toBe(yarnColorCss(DEFAULT_YARN_COLOR));

    fireEvent.click(screen.getByTestId("yarn-color-indigo"));
    expect(painted()).toBe(yarnColorCss("indigo"));
    expect(
      screen.getByTestId("yarn-color-indigo").getAttribute("data-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("yarn-color-crimson").getAttribute("data-selected"),
    ).toBe("false");
  });

  it("removes a selected string on Delete, and lets go of it on Escape", () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 });
    const tacks = container.querySelectorAll("button[data-pin-id]");
    fireEvent.pointerDown(tacks[0], {
      button: 0,
      pointerId: 21,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 21,
      clientX: 520,
      clientY: 260,
    });
    fireEvent.pointerUp(canvas, { pointerId: 21, clientX: 520, clientY: 260 });

    const span = Math.hypot(520 - 300, 260 - 200);
    const apexY = 230 + sagFor(span, DEFAULT_SLACK) / 2;
    clickBoard(canvas, 410, apexY);
    expect(screen.queryByTestId("yarn-bead")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("yarn-bead")).toBeNull();
    expect(container.querySelectorAll('[data-testid="yarn"]').length).toBe(1);

    clickBoard(canvas, 410, apexY);
    fireEvent.keyDown(document, { key: "Delete" });
    expect(container.querySelectorAll('[data-testid="yarn"]').length).toBe(0);
    expect(container.querySelectorAll("button[data-pin-id]").length).toBe(2);
  });

  it("does not delete while a field has focus", () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");
    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 });
    const tacks = container.querySelectorAll("button[data-pin-id]");
    fireEvent.pointerDown(tacks[0], {
      button: 0,
      pointerId: 21,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 21,
      clientX: 520,
      clientY: 260,
    });
    fireEvent.pointerUp(canvas, { pointerId: 21, clientX: 520, clientY: 260 });

    const span = Math.hypot(520 - 300, 260 - 200);
    const apexY = 230 + sagFor(span, DEFAULT_SLACK) / 2;
    fireEvent.click(canvas, { clientX: 410, clientY: apexY });

    const field = document.createElement("textarea");
    document.body.appendChild(field);
    try {
      fireEvent.keyDown(field, { key: "Backspace" });
      expect(container.querySelectorAll('[data-testid="yarn"]').length).toBe(1);
    } finally {
      field.remove();
    }
  });

  it("draws yarn above the article, not behind it", () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 });

    const tacks = container.querySelectorAll("button[data-pin-id]");
    fireEvent.pointerDown(tacks[0], {
      button: 0,
      pointerId: 31,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 31,
      clientX: 520,
      clientY: 260,
    });
    fireEvent.pointerUp(canvas, { pointerId: 31, clientX: 520, clientY: 260 });

    // By test id, not `svg[aria-hidden]`: the icon set renders aria-hidden SVGs
    // and the first would be a button glyph.
    const yarn = screen.getByTestId("string-layer");
    const paper = sheet(container, FIRST_PAGE);

    expect(
      yarn.compareDocumentPosition(paper) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(
      yarn.compareDocumentPosition(sheet(container, SECOND_PAGE)) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it("starts a string from a pin drag rather than a selection", async () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 });
    const tack = container.querySelector('[data-status="free"]') as HTMLElement;
    expect(tack).not.toBeNull();

    fireEvent.pointerDown(tack, {
      button: 0,
      pointerId: 11,
      clientX: 300,
      clientY: 200,
    });
    expect(screen.queryByTestId("marquee")).toBeNull();

    await act(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => resolve(null)),
      );
    });

    // Camera is untouched in jsdom, so viewport 300,200 is board 300,200.
    expect(screen.getByTestId("live-yarn").getAttribute("d")).toMatch(
      /^M 300 200/,
    );
  });

  it("selects objects inside the rubber band", () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 });
    expect(container.querySelectorAll(".is-selected").length).toBe(0);

    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 9,
      clientX: 250,
      clientY: 150,
    });
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 });

    expect(container.querySelectorAll(".is-selected").length).toBe(1);
  });

  it("shows the rubber band while it is being dragged", () => {
    renderBoard();
    const canvas = screen.getByTestId("board-canvas");

    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 9,
      clientX: 250,
      clientY: 150,
    });
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 });

    expect(screen.getByTestId("marquee")).toBeTruthy();
  });

  it("hides the rubber band on release", () => {
    renderBoard();
    const canvas = screen.getByTestId("board-canvas");

    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 9,
      clientX: 250,
      clientY: 150,
    });
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 });
    fireEvent.pointerUp(canvas, { pointerId: 9, clientX: 350, clientY: 250 });

    expect(screen.queryByTestId("marquee")).toBeNull();
  });

  it("clears the selection on a plain click", () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 9,
      clientX: 250,
      clientY: 150,
    });
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 });
    fireEvent.pointerUp(canvas, { pointerId: 9, clientX: 350, clientY: 250 });
    expect(container.querySelectorAll(".is-selected").length).toBe(1);

    fireEvent.click(canvas, { clientX: 10, clientY: 10 });
    expect(container.querySelectorAll(".is-selected").length).toBe(0);
  });
});

describe("App — undo", () => {
  function stringBetween(canvas: HTMLElement): void {
    const tacks = document.querySelectorAll("button[data-pin-id]");
    fireEvent.pointerDown(tacks[0], {
      button: 0,
      pointerId: 21,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 21,
      clientX: 520,
      clientY: 260,
    });
    fireEvent.pointerUp(canvas, { pointerId: 21, clientX: 520, clientY: 260 });
  }

  it("puts back a string the keyboard cut", () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 });
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 });
    stringBetween(canvas);

    const span = Math.hypot(520 - 300, 260 - 200);
    const apexY = 230 + sagFor(span, DEFAULT_SLACK) / 2;
    clickBoard(canvas, 410, apexY);
    fireEvent.keyDown(document, { key: "Delete" });
    expect(container.querySelectorAll('[data-testid="yarn"]').length).toBe(0);

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });
    expect(container.querySelectorAll('[data-testid="yarn"]').length).toBe(1);

    fireEvent.keyDown(document, { key: "y", ctrlKey: true });
    expect(container.querySelectorAll('[data-testid="yarn"]').length).toBe(0);
  });

  it("takes a whole drag of a page as one step", () => {
    const { container } = renderBoard();
    const before = posOf(container, FIRST_PAGE);
    const target = sheet(container, FIRST_PAGE).querySelector(".article")!;

    fireEvent.pointerDown(target, {
      button: 0,
      pointerId: 3,
      clientX: 400,
      clientY: 400,
    });
    fireEvent.pointerMove(target, { pointerId: 3, clientX: 540, clientY: 460 });
    fireEvent.pointerMove(target, { pointerId: 3, clientX: 560, clientY: 470 });
    fireEvent.pointerUp(target, {
      button: 0,
      pointerId: 3,
      clientX: 560,
      clientY: 470,
    });
    fireEvent.click(target, { clientX: 560, clientY: 470 });
    expect(posOf(container, FIRST_PAGE)).not.toEqual(before);

    fireEvent.keyDown(document, { key: "z", ctrlKey: true });

    expect(posOf(container, FIRST_PAGE)).toEqual(before);
  });

  it("leaves the board alone while a field has the keyboard", () => {
    const { container } = renderBoard();
    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));

    const source = screen.getByLabelText(
      "Article markdown source",
    ) as HTMLTextAreaElement;
    fireEvent.keyDown(source, { key: "z", ctrlKey: true });

    expect(source.value).toContain("The Drowned Bell");
  });
});

describe("App — pin descriptions", () => {
  function openPinEditor(container: HTMLElement): void {
    const tack = container.querySelector("button[data-pin-id]") as HTMLElement;
    expect(tack).not.toBeNull();
    fireEvent.pointerDown(tack, {
      button: 2,
      pointerId: 4,
      clientX: 181,
      clientY: 52,
    });
    fireEvent.pointerUp(tack, {
      button: 2,
      pointerId: 4,
      clientX: 181,
      clientY: 52,
    });
  }

  it("marks a pin once it has a description", () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");
    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 });

    const tack = container.querySelector("button[data-pin-id]") as HTMLElement;
    expect(tack.getAttribute("data-described")).toBeNull();

    openPinEditor(container);
    fireEvent.change(screen.getByLabelText("Pin note"), {
      target: { value: "The ferryman was lying." },
    });

    expect(
      (
        container.querySelector("button[data-pin-id]") as HTMLElement
      ).getAttribute("data-described"),
    ).toBe("true");
  });

  it("does not count whitespace as a description", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    openPinEditor(container);

    fireEvent.change(screen.getByLabelText("Pin note"), {
      target: { value: "   \n  " },
    });
    expect(
      (
        container.querySelector("button[data-pin-id]") as HTMLElement
      ).getAttribute("data-described"),
    ).toBeNull();
  });

  it("shows a hover card on a pin, far sooner than the native tooltip", async () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });

    const tack = container.querySelector("button[data-pin-id]") as HTMLElement;
    fireEvent.pointerEnter(tack);

    const card = await screen.findByRole("tooltip");
    expect(card).toBeTruthy();
  });

  it("hangs the written description on the pin as a tag", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    openPinEditor(container);
    fireEvent.change(screen.getByLabelText("Pin note"), {
      target: { value: "The ferryman was lying." },
    });
    fireEvent.keyDown(document, { key: "Escape" });

    const tag = container.querySelector(".pin-tag");
    expect(tag).not.toBeNull();
    expect(tag!.textContent).toContain("The ferryman was lying.");
    expect((tag as HTMLElement).style.left).not.toBe("");
  });

  it("edits the date on a pin, and the tag on the board follows it", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    openPinEditor(container);

    const field = screen.getByLabelText("Pin date") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "3rd of Eleint" } });

    expect((screen.getByLabelText("Pin date") as HTMLInputElement).value).toBe(
      "3rd of Eleint",
    );
    fireEvent.change(screen.getByLabelText("Pin note"), {
      target: { value: "Paid in silver." },
    });
    expect(container.querySelector(".pin-tag")!.textContent).toContain(
      "3rd of Eleint",
    );
  });

  it("takes the date off a pin when the field is emptied", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    openPinEditor(container);
    fireEvent.change(screen.getByLabelText("Pin note"), {
      target: { value: "Paid in silver." },
    });
    expect(container.querySelector(".pin-tag")!.textContent).toContain(
      "Session",
    );

    fireEvent.change(screen.getByLabelText("Pin date"), {
      target: { value: "" },
    });

    expect(container.querySelector(".pin-tag")!.textContent).not.toContain(
      "Session",
    );
  });

  it("leaves a tag off a pin nobody has written on", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });

    expect(container.querySelector(".pin-tag")).toBeNull();
  });

  describe("the tag as a handle", () => {
    function describedPin() {
      const rendered = renderBoard();
      const { container } = rendered;
      fireEvent.click(screen.getByTestId("board-canvas"), {
        ctrlKey: true,
        clientX: 300,
        clientY: 200,
      });
      openPinEditor(container);
      fireEvent.change(screen.getByLabelText("Pin note"), {
        target: { value: "The ferryman was lying." },
      });
      fireEvent.keyDown(document, { key: "Escape" });

      const tag = container.querySelector(".pin-tag__card") as HTMLElement;
      expect(tag).not.toBeNull();
      return {
        container,
        tag,
        tack: container.querySelector("button[data-pin-id]") as HTMLElement,
      };
    }

    const tackAt = (tack: HTMLElement) => ({
      left: tack.style.left,
      top: tack.style.top,
    });

    it("moves the pin when the tag is dragged", () => {
      const { tag, tack } = describedPin();
      const before = tackAt(tack);

      fireEvent.pointerDown(tag, {
        button: 0,
        pointerId: 7,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(tag, { pointerId: 7, clientX: 180, clientY: 140 });
      fireEvent.pointerUp(tag, {
        button: 0,
        pointerId: 7,
        clientX: 180,
        clientY: 140,
      });

      const after = tackAt(tack);
      expect(after.left).not.toBe(before.left);
      expect(after.top).not.toBe(before.top);
      expect(
        (tack.parentElement!.querySelector(".pin-tag") as HTMLElement).style
          .left,
      ).not.toBe("");
    });

    it("opens the pin’s editor when the tag is clicked", () => {
      const { tag } = describedPin();
      expect(screen.queryByLabelText("Pin note")).toBeNull();

      fireEvent.pointerDown(tag, {
        button: 0,
        pointerId: 7,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerUp(tag, {
        button: 0,
        pointerId: 7,
        clientX: 100,
        clientY: 100,
      });

      expect(screen.getByLabelText("Pin note")).toBeTruthy();
    });

    it("does not open the editor when the tag was dragged", () => {
      const { tag } = describedPin();

      fireEvent.pointerDown(tag, {
        button: 0,
        pointerId: 7,
        clientX: 100,
        clientY: 100,
      });
      fireEvent.pointerMove(tag, { pointerId: 7, clientX: 200, clientY: 160 });
      fireEvent.pointerUp(tag, {
        button: 0,
        pointerId: 7,
        clientX: 200,
        clientY: 160,
      });

      expect(screen.queryByLabelText("Pin note")).toBeNull();
    });

    it("carries the pin’s identity, so the board can tell what was grabbed", () => {
      const { container, tag } = describedPin();
      const wrapper = tag.parentElement as HTMLElement;

      expect(wrapper).toBe(container.querySelector(".pin-tag"));
      expect(wrapper.getAttribute("data-board-entity")).toBe("pin");
      expect(wrapper.getAttribute("data-pin-id")).toBe(
        (
          container.querySelector("button[data-pin-id]") as HTMLElement
        ).getAttribute("data-pin-id"),
      );
    });
  });

  it("drops the hover card when the camera moves under it", async () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });

    const tack = container.querySelector("button[data-pin-id]") as HTMLElement;
    fireEvent.pointerEnter(tack);
    expect(await screen.findByRole("tooltip")).toBeTruthy();

    fireEvent.wheel(screen.getByTestId("board-canvas"), {
      deltaY: -200,
      clientX: 300,
      clientY: 200,
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("describes each pin by the card it will produce", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });

    const tack = container.querySelector("button[data-pin-id]") as HTMLElement;
    expect(tack.getAttribute("aria-describedby")).toMatch(/^pin-tooltip-/);
  });

  it("offers Move pin in the editor", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    openPinEditor(container);

    expect(screen.getByText("Move pin")).toBeTruthy();
  });

  it("closes the editor and prompts for the drag when Move pin is chosen", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    openPinEditor(container);

    fireEvent.click(screen.getByText("Move pin"));

    expect(screen.queryByTestId("pin-editor")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Drag the pin/);
  });

  it("finishes the move on Escape", () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    openPinEditor(container);
    fireEvent.click(screen.getByText("Move pin"));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("repositions the pin when dragged in move mode", async () => {
    const { container } = renderBoard();
    fireEvent.click(screen.getByTestId("board-canvas"), {
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    openPinEditor(container);
    fireEvent.click(screen.getByText("Move pin"));

    const tack = container.querySelector("button[data-pin-id]") as HTMLElement;
    const before = tack.style.left;

    fireEvent.pointerDown(tack, {
      button: 0,
      pointerId: 12,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerMove(tack, { pointerId: 12, clientX: 340, clientY: 200 });

    const after = (
      container.querySelector("button[data-pin-id]") as HTMLElement
    ).style.left;
    expect(after).not.toBe(before);
  });
});

describe("App — mentions", () => {
  const mentioned = (title: string, body: string): BoardEntity =>
    newArticle({ x: 0, y: 0 }, body, title, undefined, { id: title });

  function twoPages() {
    return [
      mentioned("The Ledger", "# The Ledger\n\nWords."),
      mentioned(
        "The Bell",
        "# The Bell\n\nThe bell came up near @[The Ledger], and again.",
      ),
    ];
  }

  const linkIn = (container: HTMLElement, articleId: string): HTMLElement =>
    sheet(container, articleId).querySelector("a.mention") as HTMLElement;

  it("marks a mention whose name is not on the board", () => {
    const { container } = renderBoard();

    expect(
      linkIn(container, FIRST_PAGE).classList.contains("mention--missing"),
    ).toBe(true);
  });

  it("leaves a mention to something that is there unmarked", () => {
    const { container } = render(
      <App seed={{ entities: twoPages(), strings: [] }} />,
    );

    expect(
      linkIn(container, "The Bell").classList.contains("mention--missing"),
    ).toBe(false);
  });

  it("takes the click on a mention, rather than letting the browser follow it", () => {
    const { container } = render(
      <App seed={{ entities: twoPages(), strings: [] }} />,
    );

    expect(fireEvent.click(linkIn(container, "The Bell"))).toBe(false);
  });

  it("swallows a click on a mention that names nothing, rather than the fragment going to the address", () => {
    const { container } = renderBoard();
    window.history.replaceState(null, "", "/");

    // `false` is the default being prevented: the href is a `#mention:` fragment,
    // and an unresolved one would otherwise be written to the URL and the history.
    expect(fireEvent.click(linkIn(container, FIRST_PAGE))).toBe(false);
    expect(window.location.hash).toBe("");
  });

  it("carries a mention on another page over when the page it names is renamed", () => {
    const { container } = render(
      <App seed={{ entities: twoPages(), strings: [] }} />,
    );
    expect(linkIn(container, "The Bell").textContent).toBe("The Ledger");

    tap(within(sheet(container, "The Ledger")).getByTestId("paper-tab"));
    const title = screen.getByLabelText("Page title");
    fireEvent.change(title, { target: { value: "The Iron Ledger" } });
    fireEvent.blur(title);

    expect(linkIn(container, "The Bell").textContent).toBe("The Iron Ledger");
    // And it still resolves, rather than being stranded by the rename.
    expect(
      linkIn(container, "The Bell").classList.contains("mention--missing"),
    ).toBe(false);
  });

  it("gives the editor the names it can suggest", () => {
    const { container } = render(
      <App seed={{ entities: twoPages(), strings: [] }} />,
    );
    tap(within(sheet(container, "The Bell")).getByTestId("paper-tab"));

    expect(screen.getByTestId("paper-editor")).toBeTruthy();
    expect(screen.queryByTestId("mention-list")).toBeNull();

    const source = screen.getByLabelText(
      "Article markdown source",
    ) as HTMLTextAreaElement;
    fireEvent.change(source, {
      target: {
        value: `${source.value} @`,
        selectionStart: source.value.length + 2,
      },
    });

    expect(
      within(screen.getByTestId("mention-list")).getByText("The Ledger"),
    ).toBeTruthy();
  });
});

describe("App — making a page", () => {
  /** The drag from a palette pad, which is tracked on the window rather than captured.
      jsdom measures nothing, so the canvas is given a box for the drop to land in. */
  function padDrag(pad: string, to: { x: number; y: number }): void {
    const canvas = screen.getByTestId("board-canvas");
    const box = vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    try {
      fireEvent.pointerDown(screen.getByTestId(pad), {
        button: 0,
        pointerId: 9,
        clientX: 40,
        clientY: 500,
      });
      fireEvent.pointerMove(window, {
        pointerId: 9,
        clientX: to.x,
        clientY: to.y,
      });
      fireEvent.pointerUp(window, {
        pointerId: 9,
        clientX: to.x,
        clientY: to.y,
      });
    } finally {
      box.mockRestore();
    }
  }

  it("makes a page by dragging it off the palette", () => {
    const { container } = renderBoard();
    const before = container.querySelectorAll("[data-article-id]").length;

    padDrag("palette-pad-2", { x: 400, y: 400 });

    const sheets = container.querySelectorAll("[data-article-id]");
    expect(sheets.length).toBe(before + 1);
    const made = sheets[sheets.length - 1];
    expect(made.querySelector('[data-testid="paper-tab"]')?.textContent).toBe(
      "Untitled sheet",
    );
    expect(made.querySelector(".article h1")?.textContent).toBe(
      "Untitled sheet",
    );
  });

  it("opens the new page for writing, rather than leaving it blank on the board", () => {
    renderBoard();

    padDrag("palette-pad-2", { x: 400, y: 400 });

    const editor = screen.getByTestId("paper-editor");
    expect(
      (within(editor).getByLabelText("Page title") as HTMLInputElement).value,
    ).toBe("Untitled sheet");
    expect(
      (
        within(editor).getByLabelText(
          "Article markdown source",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("# Untitled sheet\n");
  });

  it("makes one from the board's own menu too", () => {
    const { container } = renderBoard();
    const canvas = screen.getByTestId("board-canvas");
    const before = container.querySelectorAll("[data-article-id]").length;

    rightClick(canvas, 300, 300);
    fireEvent.click(screen.getByText("Create page"));

    expect(container.querySelectorAll("[data-article-id]").length).toBe(
      before + 1,
    );
    expect(screen.getByTestId("paper-editor")).toBeTruthy();
  });

  it("gives a second page a name of its own, so a mention is unambiguous", () => {
    const { container } = renderBoard();

    padDrag("palette-pad-2", { x: 400, y: 300 });
    padDrag("palette-pad-2", { x: 700, y: 500 });

    const tabs = [
      ...container.querySelectorAll('[data-testid="paper-tab"]'),
    ].map((tab) => tab.textContent);
    expect(tabs.filter((name) => name === "Untitled sheet").length).toBe(1);
    expect(tabs).toContain("Untitled sheet (2)");
  });
});

describe("App — a picture from a link", () => {
  function openLinkDialog(): void {
    rightClick(screen.getByTestId("board-canvas"), 300, 300);
    fireEvent.click(screen.getByText("Add picture from link…"));
  }

  it("refuses an address that is not a link before storing anything", () => {
    renderBoard();
    openLinkDialog();

    fireEvent.change(screen.getByLabelText("Image address"), {
      target: { value: "not a link" },
    });
    fireEvent.click(screen.getByTestId("image-link-add"));

    expect(screen.getByText(/http or https/i)).toBeTruthy();
    expect(screen.getByTestId("image-link-dialog")).toBeTruthy();
  });

  it("loads the picture at the address and closes", async () => {
    // jsdom neither loads an image nor fires its events, so the probe answers itself.
    class StubImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 400;
      naturalHeight = 300;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", StubImage);

    const { container } = renderBoard();
    const before = container.querySelectorAll("[data-entity-id] img").length;
    openLinkDialog();

    fireEvent.change(screen.getByLabelText("Image address"), {
      target: { value: "https://example.test/cat.png" },
    });
    // Act-wrapped: the measure resolves on a promise, and adding is what follows it.
    await act(async () => {
      fireEvent.click(screen.getByTestId("image-link-add"));
    });

    expect(container.querySelectorAll("[data-entity-id] img").length).toBe(
      before + 1,
    );
    expect(screen.queryByTestId("image-link-dialog")).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("App — the writing on a note", () => {
  const note = (container: HTMLElement): HTMLElement =>
    container.querySelector("[data-post-it-id]") as HTMLElement;
  const writing = (container: HTMLElement): HTMLTextAreaElement =>
    container.querySelector(
      'textarea[aria-label="Post-it note"]',
    ) as HTMLTextAreaElement;

  const selectNote = (container: HTMLElement): void => {
    fireEvent.pointerDown(note(container), { button: 0, pointerId: 5 });
  };

  const openNoteMenu = (): void => {
    fireEvent.click(screen.getByTestId("post-it-style"));
  };

  it("offers the size controls once the note is selected", () => {
    const { container } = render(<App seed={demoBoard()} />);
    expect(screen.queryByTestId("post-it-font-up")).toBeNull();

    selectNote(container);

    expect(screen.getByTestId("post-it-font-up")).toBeTruthy();
    expect(screen.getByTestId("post-it-font-down")).toBeTruthy();
    expect(screen.getByTestId("post-it-font-reset")).toBeTruthy();
  });

  it("makes the writing bigger and smaller, a step at a time", () => {
    const { container } = render(<App seed={demoBoard()} />);
    selectNote(container);
    const start = writing(container).style.fontSize;
    expect(start).toBe("12px");

    fireEvent.click(screen.getByTestId("post-it-font-up"));
    expect(writing(container).style.fontSize).toBe("13.5px");

    fireEvent.click(screen.getByTestId("post-it-font-down"));
    fireEvent.click(screen.getByTestId("post-it-font-down"));
    expect(writing(container).style.fontSize).toBe("10.5px");
  });

  it("puts it back to the normal size in one press", () => {
    const { container } = render(<App seed={demoBoard()} />);
    selectNote(container);
    for (let i = 0; i < 3; i++)
      fireEvent.click(screen.getByTestId("post-it-font-up"));

    fireEvent.click(screen.getByTestId("post-it-font-reset"));

    expect(writing(container).style.fontSize).toBe("12px");
  });

  it("will not step past either end, rather than going quiet about it", () => {
    const { container } = render(<App seed={demoBoard()} />);
    selectNote(container);

    expect(
      (screen.getByTestId("post-it-font-reset") as HTMLButtonElement).disabled,
    ).toBe(true);
    for (let i = 0; i < 12; i++)
      fireEvent.click(screen.getByTestId("post-it-font-up"));
    expect(writing(container).style.fontSize).toBe("24px");
    expect(
      (screen.getByTestId("post-it-font-up") as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("changes only the note it belongs to", () => {
    const { container } = render(<App seed={demoBoard()} />);
    const all = container.querySelectorAll<HTMLTextAreaElement>(
      'textarea[aria-label="Post-it note"]',
    );
    selectNote(container);

    fireEvent.click(screen.getByTestId("post-it-font-up"));

    expect(all[0].style.fontSize).toBe("13.5px");
    expect(all[1].style.fontSize).toBe("12px");
  });

  it("offers the note its paper and colours once its menu is opened", () => {
    const { container } = render(<App seed={demoBoard()} />);
    expect(screen.queryByTestId("post-it-color-sage")).toBeNull();

    selectNote(container);
    expect(screen.queryByTestId("post-it-color-sage")).toBeNull();

    openNoteMenu();

    expect(screen.getByTestId("post-it-color-sage")).toBeTruthy();
    expect(screen.getByTestId("post-it-color-yellow")).toBeTruthy();
    expect(screen.getByTestId("post-it-paper-ruled")).toBeTruthy();
  });

  it("repaints the note when a colour is picked", () => {
    const { container } = render(<App seed={demoBoard()} />);
    selectNote(container);
    openNoteMenu();
    const before = note(container).style.backgroundColor;

    fireEvent.click(screen.getByTestId("post-it-color-sage"));

    expect(note(container).style.backgroundColor).not.toBe(before);
    expect(
      screen.getByTestId("post-it-color-sage").getAttribute("data-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("post-it-color-yellow").getAttribute("data-selected"),
    ).toBe("false");
  });

  it("repaints one note, not the board", () => {
    const { container } = render(<App seed={demoBoard()} />);
    const notes = container.querySelectorAll<HTMLElement>("[data-post-it-id]");
    const other = notes[1].style.backgroundColor;
    selectNote(container);
    openNoteMenu();

    fireEvent.click(screen.getByTestId("post-it-color-sage"));

    expect(notes[1].style.backgroundColor).toBe(other);
  });
});

describe("App — the note’s paper", () => {
  const note = (container: HTMLElement): HTMLElement =>
    container.querySelector("[data-post-it-id]") as HTMLElement;
  const selectNote = (container: HTMLElement): void => {
    fireEvent.pointerDown(note(container), { button: 0, pointerId: 5 });
  };
  const openNoteMenu = (): void => {
    fireEvent.click(screen.getByTestId("post-it-style"));
  };

  // The preferences store is module-global, and this block changes it.
  afterEach(() => {
    act(() => resetPreferences());
  });

  it("gives the note the paper that was picked, and only that note", () => {
    const { container } = render(<App seed={demoBoard()} />);
    const notes = container.querySelectorAll<HTMLElement>("[data-post-it-id]");
    expect(notes[0].getAttribute("data-note-style")).toBe("plain");
    const other = notes[1].getAttribute("data-note-style");

    selectNote(container);
    openNoteMenu();
    fireEvent.click(screen.getByTestId("post-it-paper-grid"));

    expect(notes[0].getAttribute("data-note-style")).toBe("grid");
    expect(notes[1].getAttribute("data-note-style")).toBe(other);
  });

  it("writes the note in the hand that was picked, and only that note", () => {
    const { container } = render(<App seed={demoBoard()} />);
    const notes = container.querySelectorAll<HTMLElement>("[data-post-it-id]");
    expect(notes[0].getAttribute("data-note-font")).toBe("system");
    const other = notes[1].getAttribute("data-note-font");

    selectNote(container);
    openNoteMenu();
    fireEvent.click(screen.getByTestId("post-it-typeface-courier-prime"));

    expect(notes[0].getAttribute("data-note-font")).toBe("courier-prime");
    expect(notes[1].getAttribute("data-note-font")).toBe(other);
  });

  it("opens the menu on a press that stays put", () => {
    const { container } = render(<App seed={demoBoard()} />);
    const before = container.querySelectorAll("[data-post-it-id]").length;

    // Down and up at the same point: the click the pad used to swallow.
    tap(screen.getByTestId("palette-pad-1"));

    expect(screen.getByTestId("post-it-style-menu")).toBeTruthy();
    expect(container.querySelectorAll("[data-post-it-id]").length).toBe(before);
  });

  it("still makes a note when the press travels, and opens no menu", () => {
    const { container } = render(<App seed={demoBoard()} />);
    // jsdom lays nothing out, so the drop's own bounds check needs a real box.
    const canvas = container.querySelector(
      '[data-testid="board-canvas"]',
    ) as HTMLElement;
    const box = vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const before = container.querySelectorAll("[data-post-it-id]").length;

    fireEvent.pointerDown(screen.getByTestId("palette-pad-1"), {
      button: 0,
      pointerId: 9,
      clientX: 40,
      clientY: 500,
    });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 400, clientY: 400 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 400, clientY: 400 });

    box.mockRestore();
    expect(screen.queryByTestId("post-it-style-menu")).toBeNull();
    expect(container.querySelectorAll("[data-post-it-id]").length).toBe(
      before + 1,
    );
  });

  it("makes the next note out of the pair chosen on the pad, and remembers it", () => {
    const { container } = render(<App seed={demoBoard()} />);

    tap(screen.getByTestId("palette-pad-1"));
    fireEvent.click(screen.getByTestId("post-it-paper-taped"));
    fireEvent.click(screen.getByTestId("post-it-color-sage"));
    expect(screen.getByTestId("post-it-style-menu")).toBeTruthy();

    // The menu owns Escape, and a real key event goes to whatever has focus.
    expect(document.activeElement).toBe(
      screen.getByTestId("post-it-style-menu"),
    );
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    expect(screen.queryByTestId("post-it-style-menu")).toBeNull();

    expect(getPreferences().noteStyle).toBe("taped");
    expect(getPreferences().noteColor).toBe(POST_IT_COLORS[3].color);

    // The pad carries the pair, so the next drop is visible before it happens.
    const before = container.querySelectorAll("[data-post-it-id]").length;
    fireEvent.keyDown(screen.getByTestId("palette-pad-1"), { key: "Enter" });
    expect(screen.getByTestId("post-it-style-menu")).toBeTruthy();
    expect(container.querySelectorAll("[data-post-it-id]").length).toBe(before);
  });
});

describe("App — naming a picture", () => {
  const card = (container: HTMLElement, alt = "Saltmarsh"): HTMLElement =>
    Array.from(container.querySelectorAll("[data-image-id]")).find((element) =>
      (element.querySelector("img")?.getAttribute("alt") ?? "").includes(alt),
    ) as HTMLElement;

  const clickPicture = (container: HTMLElement, alt?: string): void => {
    fireEvent.pointerDown(card(container, alt), {
      button: 0,
      pointerId: 9,
      clientX: 100,
      clientY: 100,
    });
  };

  it("shows a picture’s title and description once it is clicked", () => {
    const { container } = render(<App seed={demoBoard()} />);
    expect(screen.queryByTestId("image-caption")).toBeNull();

    clickPicture(container);

    expect(
      (screen.getByLabelText("Picture title") as HTMLInputElement).value,
    ).toBe("The Saltmarsh Map");
    expect(
      (screen.getByLabelText("Picture description") as HTMLTextAreaElement)
        .value,
    ).toContain("drowned road");
  });

  it("writes both fields back to the picture", () => {
    const { container } = render(<App seed={demoBoard()} />);
    clickPicture(container);

    fireEvent.change(screen.getByLabelText("Picture title"), {
      target: { value: "The Map" },
    });
    fireEvent.change(screen.getByLabelText("Picture description"), {
      target: { value: "Drawn from the harbormaster’s window." },
    });

    expect(
      (screen.getByLabelText("Picture title") as HTMLInputElement).value,
    ).toBe("The Map");
    expect(
      (screen.getByLabelText("Picture description") as HTMLTextAreaElement)
        .value,
    ).toBe("Drawn from the harbormaster’s window.");
  });

  it("carries a mention of a picture over to the picture’s new name", () => {
    const { container } = render(<App seed={demoBoard()} />);
    const before = sheet(container, ARTICLE_ID).querySelector(
      "a.mention",
    ) as HTMLElement;
    expect(before.textContent).toBe("The Black Coin");
    expect(before.classList.contains("mention--missing")).toBe(false);

    clickPicture(container, "Black Coin");
    const title = screen.getByLabelText("Picture title");
    fireEvent.change(title, { target: { value: "The Rubbing" } });
    // Committed when the field is left, not on the keystroke.
    fireEvent.blur(title);

    // The rewrite replaces the page's markup, so the anchor is a new node.
    const after = sheet(container, ARTICLE_ID).querySelector(
      "a.mention",
    ) as HTMLElement;
    expect(after.textContent).toBe("The Rubbing");
    expect(after.classList.contains("mention--missing")).toBe(false);
  });

  it("renames nothing until the title field is left", () => {
    const { container } = render(<App seed={demoBoard()} />);

    clickPicture(container, "Black Coin");
    fireEvent.change(screen.getByLabelText("Picture title"), {
      target: { value: "The Rubbing" },
    });

    // Half a word in, the old name is still the one the board knows.
    const mention = sheet(container, ARTICLE_ID).querySelector(
      "a.mention",
    ) as HTMLElement;
    expect(mention.textContent).toBe("The Black Coin");
  });
});

describe("App — the demo board", () => {
  it("leaves a click on a picture’s pin doing nothing, since a picture has no editor", () => {
    const { container } = render(<App seed={demoBoard()} />);
    const pin = container.querySelector(
      '[data-testid="image-pin"]',
    ) as HTMLElement;

    fireEvent.pointerDown(pin, {
      button: 0,
      pointerId: 43,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerUp(window, { pointerId: 43, clientX: 300, clientY: 200 });

    expect(screen.queryByTestId("pin-editor")).toBeNull();
  });

  it("opens on four pages with notes, pictures, tacks and yarn around them", () => {
    const { container } = render(<App seed={demoBoard()} />);

    expect(container.querySelectorAll("[data-article-id]").length).toBe(
      ARTICLE_IDS.length,
    );
    expect(
      container.querySelectorAll('[aria-label="Post-it note"]').length,
    ).toBe(8);
    expect(container.querySelectorAll("button[data-pin-id]").length).toBe(8);
    expect(container.querySelectorAll("[data-image-id]").length).toBe(4);
    expect(
      screen
        .getByTestId("string-layer")
        .querySelectorAll('[data-testid="yarn"]').length,
    ).toBe(12);
  });

  it("leaves some tacks and notes without a description", () => {
    const { container } = render(<App seed={demoBoard()} />);

    const tacks = container.querySelectorAll("button[data-pin-id]");
    const described = container.querySelectorAll(
      'button[data-pin-id][data-described="true"]',
    );
    expect(described.length).toBe(6);
    expect(described.length).toBeLessThan(tacks.length);

    const notes = Array.from(
      container.querySelectorAll<HTMLTextAreaElement>(
        '[aria-label="Post-it note"]',
      ),
    );
    const written = notes.filter((note) => note.value.trim() !== "");
    expect(written.length).toBe(6);
  });

  it("rolls one page up, so the board shows that state too", () => {
    const { container } = render(<App seed={demoBoard()} />);

    const disclosure = (page: string) =>
      sheet(container, page)
        .querySelector('[data-testid="paper-disclosure"]')
        ?.getAttribute("aria-expanded");
    expect(disclosure(FOURTH_PAGE)).toBe("false");
    expect(disclosure(FIRST_PAGE)).toBe("true");
  });

  it("writes a tag that says what the connection is, not what the note says", () => {
    render(<App seed={demoBoard()} />);

    expect(screen.getByText("Molgar paid him")).toBeTruthy();
    expect(screen.getByText("a third hand")).toBeTruthy();
  });

  it("ties yarn to a page, not only to pins", () => {
    render(<App seed={demoBoard()} />);
    const yarn = screen
      .getByTestId("string-layer")
      .querySelectorAll('[data-testid="yarn"]');
    expect(yarn.length).toBe(12);

    for (const group of yarn) {
      expect(group.querySelectorAll("path").length).toBeGreaterThan(0);
    }
  });

  it("cuts the yarn away under every tack, so the tacks read as on top", () => {
    const board = demoBoard();
    render(<App seed={board} />);
    const holes = screen
      .getByTestId("string-layer")
      .querySelectorAll("mask circle");
    const tacked = board.entities.filter(
      (entity) => entity.kind === "image" || entity.kind === "article",
    );
    // Every picture and page has its own tack; the pins' tacks add to that.
    expect(holes.length).toBeGreaterThan(tacked.length);
  });

  it("does not count a tack in the cork as an anchored pin", () => {
    const { container } = render(<App seed={demoBoard()} />);

    // The footer no longer carries a legend, so the status is read off the tacks themselves.
    expect(container.querySelectorAll('[data-status="exact"]')).toHaveLength(0);
    expect(screen.getByText("8 pins · 12 strings")).toBeTruthy();
  });

  it("lays the demo out away from the origin, so a misplacement shows", () => {
    const board = demoBoard();
    const placed = board.entities.filter((e) => "board" in e);
    const xs = placed.map((e) => (e as { board: { x: number } }).board.x);
    expect(new Set(xs).size).toBe(placed.length);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1000);
  });
});

describe("App — moving a page by its body", () => {
  const body = (container: HTMLElement, articleId: string): HTMLElement =>
    sheet(container, articleId).querySelector(".article") as HTMLElement;

  function bodyDrag(
    container: HTMLElement,
    articleId: string,
    from: [number, number],
    to: [number, number],
  ): void {
    const target = body(container, articleId);
    fireEvent.pointerDown(target, {
      button: 0,
      pointerId: 3,
      clientX: from[0],
      clientY: from[1],
    });
    fireEvent.pointerMove(target, {
      pointerId: 3,
      clientX: to[0],
      clientY: to[1],
    });
    fireEvent.pointerUp(target, {
      button: 0,
      pointerId: 3,
      clientX: to[0],
      clientY: to[1],
    });
    fireEvent.click(target, { clientX: to[0], clientY: to[1] });
  }

  it("moves the sheet when its prose is dragged", () => {
    const { container } = renderBoard();
    const before = posOf(container, FIRST_PAGE);
    const neighbour = posOf(container, SECOND_PAGE);

    bodyDrag(container, FIRST_PAGE, [400, 400], [540, 460]);

    const after = posOf(container, FIRST_PAGE);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
    expect(posOf(container, SECOND_PAGE)).toEqual(neighbour);
  });

  it("does not move it when the press never travelled", () => {
    const { container } = renderBoard();
    const before = posOf(container, FIRST_PAGE);

    bodyDrag(container, FIRST_PAGE, [400, 400], [402, 401]);

    expect(posOf(container, FIRST_PAGE)).toEqual(before);
  });

  it("says on the sheet that it is being dragged", () => {
    const { container } = renderBoard();
    const target = body(container, FIRST_PAGE);

    fireEvent.pointerDown(target, {
      button: 0,
      pointerId: 3,
      clientX: 400,
      clientY: 400,
    });
    fireEvent.pointerMove(target, { pointerId: 3, clientX: 500, clientY: 400 });

    expect(sheet(container, FIRST_PAGE).getAttribute("data-dragging")).toBe(
      "true",
    );

    fireEvent.pointerUp(target, {
      button: 0,
      pointerId: 3,
      clientX: 500,
      clientY: 400,
    });
    expect(sheet(container, FIRST_PAGE).getAttribute("data-dragging")).toBe(
      "false",
    );
  });
});

describe("App — the page folded up", () => {
  const caret = (container: HTMLElement, articleId: string): HTMLElement =>
    within(sheet(container, articleId)).getByTestId("paper-disclosure");

  const fold = (
    container: HTMLElement,
    articleId: string,
  ): HTMLElement | null =>
    sheet(container, articleId).querySelector('[data-testid="paper-fold"]');

  it("leaves a folded sheet on the board rather than an empty space", () => {
    const { container } = renderBoard();
    expect(fold(container, FIRST_PAGE)).toBeNull();

    fireEvent.click(caret(container, FIRST_PAGE));

    expect(fold(container, FIRST_PAGE)).not.toBeNull();
    expect(sheet(container, FIRST_PAGE).querySelector(".article")).toBeNull();
  });

  it("unfolds when the fold itself is clicked", () => {
    const { container } = renderBoard();
    fireEvent.click(caret(container, FIRST_PAGE));

    fireEvent.click(fold(container, FIRST_PAGE)!);

    expect(
      sheet(container, FIRST_PAGE).querySelector(".article"),
    ).not.toBeNull();
  });

  it("moves rather than unfolds when the fold is dragged", () => {
    const { container } = renderBoard();
    fireEvent.click(caret(container, FIRST_PAGE));
    const before = posOf(container, FIRST_PAGE);
    const target = fold(container, FIRST_PAGE)!;

    fireEvent.pointerDown(target, {
      button: 0,
      pointerId: 3,
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerMove(target, { pointerId: 3, clientX: 420, clientY: 360 });
    fireEvent.pointerUp(target, {
      button: 0,
      pointerId: 3,
      clientX: 420,
      clientY: 360,
    });
    // The browser sends a click wherever the drag finished, drag or not.
    fireEvent.click(target, { clientX: 420, clientY: 360 });

    expect(posOf(container, FIRST_PAGE)).not.toEqual(before);
    expect(sheet(container, FIRST_PAGE).querySelector(".article")).toBeNull();
  });

  it("toggles once, not twice, when the tab is used", () => {
    const { container } = renderBoard();

    fireEvent.click(caret(container, FIRST_PAGE));
    expect(fold(container, FIRST_PAGE)).not.toBeNull();

    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));
    expect(
      sheet(container, FIRST_PAGE).querySelector(".article"),
    ).not.toBeNull();
  });

  it("toggles once when the fold is unfolded by its own click", () => {
    const { container } = renderBoard();
    fireEvent.click(caret(container, FIRST_PAGE));

    fireEvent.click(fold(container, FIRST_PAGE)!);

    expect(
      sheet(container, FIRST_PAGE).querySelector(".article"),
    ).not.toBeNull();
    expect(fold(container, FIRST_PAGE)).toBeNull();
  });
});

describe("App — swinging the page", () => {
  function drag(
    element: Element,
    from: [number, number],
    to: [number, number],
  ): void {
    fireEvent.pointerDown(element, {
      button: 0,
      pointerId: 3,
      clientX: from[0],
      clientY: from[1],
    });
    fireEvent.pointerMove(element, {
      pointerId: 3,
      clientX: to[0],
      clientY: to[1],
    });
    fireEvent.pointerUp(element, {
      button: 0,
      pointerId: 3,
      clientX: to[0],
      clientY: to[1],
    });
  }

  const tiltOf = (container: HTMLElement, articleId: string): number => {
    const transform = sheet(container, articleId).getAttribute("style") ?? "";
    const match = transform.match(/rotate\(([-\d.]+)deg\)/);
    return match ? Number.parseFloat(match[1]) : 0;
  };

  it("hangs each page from a pin at its top-centre", () => {
    const { container } = renderBoard();

    expect(
      within(sheet(container, FIRST_PAGE)).getByTestId("paper-pin"),
    ).toBeTruthy();
    expect(
      within(sheet(container, SECOND_PAGE)).getByTestId("paper-pin"),
    ).toBeTruthy();
  });

  it("offers no rotate handle on an unselected page", () => {
    const { container } = renderBoard();

    expect(
      within(sheet(container, FIRST_PAGE)).queryByTestId("article-rotate"),
    ).toBeNull();
  });

  it("offers the rotate handle once the page is selected", () => {
    const { container } = renderBoard();
    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));

    expect(
      within(sheet(container, FIRST_PAGE)).getByTestId("article-rotate"),
    ).toBeTruthy();
  });

  it("swings the page when the handle is dragged", () => {
    const { container } = renderBoard();
    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));

    expect(tiltOf(container, FIRST_PAGE)).toBe(0);

    drag(
      within(sheet(container, FIRST_PAGE)).getByTestId("article-rotate"),
      [400, 100],
      [700, 400],
    );

    expect(tiltOf(container, FIRST_PAGE)).not.toBe(0);
  });

  it("holds the swing inside 45 degrees", () => {
    const { container } = renderBoard();
    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));

    drag(
      within(sheet(container, FIRST_PAGE)).getByTestId("article-rotate"),
      [400, 100],
      [1400, 900],
    );

    expect(Math.abs(tiltOf(container, FIRST_PAGE))).toBeLessThanOrEqual(45);
  });

  it("swings only the page whose handle was dragged", () => {
    const { container } = renderBoard();
    const seeded = tiltOf(container, SECOND_PAGE);
    expect(seeded).not.toBe(0);

    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));
    drag(
      within(sheet(container, FIRST_PAGE)).getByTestId("article-rotate"),
      [400, 100],
      [700, 400],
    );

    expect(tiltOf(container, FIRST_PAGE)).not.toBe(0);
    expect(tiltOf(container, SECOND_PAGE)).toBe(seeded);
  });

  it("leaves a page hanging straight unless something swung it", () => {
    const { container } = renderBoard();

    expect(tiltOf(container, FIRST_PAGE)).toBe(0);
    expect(tiltOf(container, THIRD_PAGE)).toBe(0);
    expect(tiltOf(container, SECOND_PAGE)).not.toBe(0);
  });
});

describe("App — board files", () => {
  function armImport(): HTMLInputElement {
    fireEvent.click(screen.getByRole("button", { name: /open preferences/i }));
    fireEvent.click(screen.getByRole("button", { name: /^import board…$/i }));
    return screen.getByLabelText(/choose a board file/i) as HTMLInputElement;
  }

  function choose(text: string, name = "case-board.json"): void {
    const input = armImport();
    const file = new File([text], name, { type: "application/json" });
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input);
  }

  it("loads a board out of a file, replacing the one that was there", async () => {
    const { container } = render(<App seed={demoBoard()} />);
    expect(container.querySelectorAll("[data-article-id]").length).toBe(
      ARTICLE_IDS.length,
    );

    const page = newArticle(
      { x: 0, y: 0 },
      "# A Loaded Case\n\nThe file this board came from.",
      "A Loaded Case",
      undefined,
      { id: "loaded-page" },
    );
    choose(serializeBoard({ entities: [page], strings: [] }));

    // Nothing is overwritten until it has been asked where the file should go.
    expect(await screen.findByTestId("import-choice")).toBeTruthy();
    fireEvent.click(screen.getByTestId("import-replace"));

    expect(
      await screen.findByRole("heading", { name: "A Loaded Case" }),
    ).toBeTruthy();
    expect(
      within(sheet(container, "loaded-page")).getByTestId("paper-tab")
        .textContent,
    ).toContain("A Loaded Case");
    expect(container.querySelectorAll("[data-article-id]").length).toBe(1);
  });

  it("leaves the board alone when the file is turned away", async () => {
    const { container } = render(<App seed={demoBoard()} />);
    const page = newArticle(
      { x: 0, y: 0 },
      "# A Loaded Case\n\nThe file this board came from.",
      "A Loaded Case",
      undefined,
      { id: "loaded-page" },
    );
    choose(serializeBoard({ entities: [page], strings: [] }));

    fireEvent.click(await screen.findByTestId("import-cancel"));

    expect(screen.queryByTestId("import-choice")).toBeNull();
    expect(container.querySelectorAll("[data-article-id]").length).toBe(
      ARTICLE_IDS.length,
    );
  });

  it("says why a file could not be read, and leaves the board alone", async () => {
    const { container } = render(<App seed={demoBoard()} />);
    choose("{ this is not json");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("not JSON");
    expect(container.querySelectorAll("[data-article-id]").length).toBe(
      ARTICLE_IDS.length,
    );
  });

  it("exports the board as a file that loads back", async () => {
    // jsdom has no createObjectURL and a real anchor click would navigate, so
    // both are stubbed.
    const downloads: string[] = [];
    const urls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const saved: Blob[] = [];
    URL.createObjectURL = (blob: Blob) => {
      saved.push(blob);
      return "blob:board";
    };
    URL.revokeObjectURL = () => {};
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });

    try {
      render(<App seed={demoBoard()} />);
      fireEvent.click(
        screen.getByRole("button", { name: /open preferences/i }),
      );
      fireEvent.click(screen.getByRole("button", { name: /^export board…$/i }));

      expect(downloads).toEqual(["the-drowned-bell.json"]);
      expect(saved).toHaveLength(1);
      const round = parseBoardFile(await readBoardFile(saved[0]));
      expect(round.ok).toBe(true);
      if (round.ok)
        expect(round.board.entities.length).toBe(demoBoard().entities.length);

      // Let the deferred revoke run while the stub is installed: it is on a timer
      // (Safari), and restoring first would leave it calling jsdom's missing API.
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      click.mockRestore();
      URL.createObjectURL = urls.create;
      URL.revokeObjectURL = urls.revoke;
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

describe("App — preferences", () => {
  it("opens the preferences panel from the top bar", () => {
    renderBoard();
    fireEvent.click(screen.getByRole("button", { name: /open preferences/i }));

    expect(screen.getByTestId("preferences-panel")).toBeTruthy();
  });

  it("keeps clear-board inside preferences, behind confirmation", () => {
    renderBoard();
    expect(screen.queryByText(/clear board/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /open preferences/i }));
    expect(screen.getByRole("button", { name: /clear board/i })).toBeTruthy();
  });

  it("closes the editor when the board is cleared out from under it", () => {
    const { container } = renderBoard();
    tap(within(sheet(container, FIRST_PAGE)).getByTestId("paper-tab"));
    expect(screen.getByTestId("paper-editor")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /open preferences/i }));
    fireEvent.click(screen.getByRole("button", { name: /^clear board…$/i }));
    fireEvent.change(screen.getByLabelText(/to confirm clearing the board/i), {
      target: { value: "clear" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^clear board$/i }));

    expect(screen.queryByTestId("paper-editor")).toBeNull();
    expect(container.querySelectorAll("[data-article-id]").length).toBe(0);
  });
});
