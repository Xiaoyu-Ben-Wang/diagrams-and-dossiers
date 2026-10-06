/**
 * Keeping an authored link from taking the board with it.
 *
 * Followed in this tab, an `http(s)` link replaces the document — and the board,
 * which is only in memory between autosaves, goes with it. Opening those in a new
 * tab costs nothing and cannot lose work.
 *
 * A live-DOM pass rather than a sanitiser setting: it needs no relaxation of
 * DOMPurify's attribute allow-list, and untrusted markdown can never contribute a
 * `target` of its own.
 */

/** Links that would replace the board if they were followed in this tab. */
export function isAwayLink(href: string): boolean {
  // Absolute, protocol-relative, or rooted at the site: all of them navigate.
  // A bare fragment stays — it is how a mention reaches its own handler — and so
  // do `mailto:` and `tel:`, which hand off without unloading the page.
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(href) || /^\.{0,2}\//.test(href);
}

/**
 * Marks every away link in the subtree so the browser opens it in a new tab.
 * Idempotent, and safe to re-run: React replaces the whole `innerHTML` on the
 * next render, taking these attributes with it.
 */
export function openAwayLinksInNewTab(root: Element): void {
  for (const anchor of Array.from(root.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") ?? "";
    if (!isAwayLink(href)) continue;
    anchor.setAttribute("target", "_blank");
    anchor.setAttribute("rel", "noopener noreferrer");
  }
}
