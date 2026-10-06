// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { isAwayLink, openAwayLinksInNewTab } from "./links";

function render(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("which links leave the board", () => {
  it("counts the absolute ones", () => {
    expect(isAwayLink("https://example.com/x")).toBe(true);
    expect(isAwayLink("http://example.com")).toBe(true);
  });

  it("counts protocol-relative and site-rooted ones", () => {
    expect(isAwayLink("//example.com/x")).toBe(true);
    expect(isAwayLink("/ledger")).toBe(true);
    expect(isAwayLink("./ledger")).toBe(true);
    expect(isAwayLink("../ledger")).toBe(true);
  });

  it("leaves a mention fragment alone, which is how it reaches its handler", () => {
    expect(isAwayLink("#mention:The%20Bell")).toBe(false);
    expect(isAwayLink("#anything")).toBe(false);
  });

  it("leaves the schemes that hand off without unloading the page", () => {
    expect(isAwayLink("mailto:dm@example.com")).toBe(false);
    expect(isAwayLink("tel:+15550100")).toBe(false);
  });
});

describe("opening them elsewhere", () => {
  it("sends an away link to a new tab, without a way back through the referrer", () => {
    const root = render('<p><a href="https://example.com/x">out</a></p>');

    openAwayLinksInNewTab(root);

    const anchor = root.querySelector("a")!;
    expect(anchor.getAttribute("target")).toBe("_blank");
    expect(anchor.getAttribute("rel")).toContain("noopener");
    expect(anchor.getAttribute("rel")).toContain("noreferrer");
  });

  it("leaves a mention anchor in this tab, since it never navigates", () => {
    const root = render(
      '<a class="mention" href="#mention:Bell" data-mention="Bell">Bell</a>',
    );

    openAwayLinksInNewTab(root);

    expect(root.querySelector("a")!.hasAttribute("target")).toBe(false);
  });

  it("leaves an anchor with no href alone", () => {
    const root = render('<a name="top">top</a>');

    openAwayLinksInNewTab(root);

    expect(root.querySelector("a")!.hasAttribute("target")).toBe(false);
  });

  it("is safe to run twice over the same markup", () => {
    const root = render('<a href="https://example.com">x</a>');

    openAwayLinksInNewTab(root);
    openAwayLinksInNewTab(root);

    const anchor = root.querySelector("a")!;
    expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
