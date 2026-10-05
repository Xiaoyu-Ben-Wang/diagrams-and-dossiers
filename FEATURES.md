# Feature queue

Things asked for and not yet done. **Check this file at the start of a session** — see
`CLAUDE.md`.

This is a working queue, not a roadmap: `docs/architecture.md` §12 is the plan and §13 is the
candidate list. What lives here is the specific things a person asked for, with enough context
that whoever picks one up does not have to reconstruct the conversation.

Move an item out when it is done. If it turns out to be a bad idea, say why in the commit rather
than deleting it silently — the next person will wonder.

---

## Queued

Numbering continues from the archive rather than restarting, so an item number still means one
thing across both files. The queue was cleared on 5 October 2026; earlier items are in
`docs/feature-queue-archive-2026-10-05.md`.

### 20. A markdown link in a page navigates the board away
`marked` renders `[text](url)` as a real `<a href>`, and `handleArticleClick` never calls
`preventDefault`. So clicking an ordinary link inside a page loads it in the same tab, and the
board — unsaved, and not recoverable — is gone. Found while adding mentions, which is the same
handler; left alone because it is a different bug with a different right answer (open in a new tab?
intercept and confirm? a route?), and because it wants a decision rather than a patch.

### 21. Nothing can be renamed, and mention links are keyed by name
A mention stores the name as written, so renaming a page or a picture breaks every link to it —
they keep their text and go quietly dead (`mention--missing`). There is no rename UI for any kind:
the article tab is a button, `PaperEditor` shows the title without a field for it, and an image's
`title` is set once from the filename at drop and never again.

Two ways out, and they are not exclusive: let a title be edited (which needs the rename to update
links, so links-by-name stops being enough), or keep an id alongside the name in the link syntax.
Both are more than the rename control they look like.

The **Explicitly rejected** list below was not cleared, and should not be: it is a record
of decisions rather than of work, and its whole purpose is to stop them being re-litigated.

---

## Explicitly rejected

Recorded so nobody re-litigates them:

- **React Flow / `@xyflow/react`** — reasons in `docs/architecture.md` §7b: a pin has no
  coordinate, it has a character offset that resolves to one.
- **`tldraw`** — 518 KB gzip (4.1× the whole current bundle) and a licence key that stops the
  editor rendering after five seconds without one.
- **`konva` / `pixi.js` / `paper.js` / `two.js` / `roughjs`** — a canvas renderer has no text
  nodes and therefore no `Range.getClientRects()`, which is where every pin's position comes from.
- **The W3C-annotation libraries** — `@apache-annotator/*` was retired from the Incubator in Aug
  2025 and `dom-anchor-text-quote` has not shipped since 2017; both address the rendered DOM,
  which is the trap the flat-text projection exists to avoid.
- **Virtualisation in a scroll container** — `@tanstack/react-virtual`, `react-window` and
  `react-virtuoso` all assume a linear scroll container with an intrinsic content size; a pan/zoom
  camera is a transform. (A *spatial* culler is a different thing and may be worth taking — see
  #13.)
- **`content-visibility: auto`** — it imposes size containment, so `getBoundingClientRect` returns
  the placeholder and every pin on the article would silently land at zero size. It also does not
  reduce DOM cost, clips descendants, and establishes a positioning containing block.
- **Tilted-page text sharpness: the obvious fixes are null results.** Measured 2026-10-05 with a
  harness in `/tmp/yarn2/sharp/`, calibrated against known blur (a 0.3px Gaussian costs 5% of edge
  energy, 1px costs 47%) and with a zero noise floor — three control screenshots came back
  bit-identical. At DPR 1 and 2, none of these changed the number at all: a 3-D `translate3d` on
  the sheet vs a 2-D `translate`, `will-change: transform` on the world, `backface-visibility`,
  `transform: scale()` vs `zoom`, a fractional vs a whole-pixel translate, or a marquee/zoom
  interaction. So the compositor is already re-rasterizing at the settled transform and the
  `will-change` toggle in `BoardCanvas` is doing its job. **Caveat, and it is the whole caveat:**
  headless Chrome with `--disable-gpu` rasterizes in software, so this does not settle it for a
  GPU. If it looks soft on your machine, check DevTools → Rendering → Layer borders and read the
  layer's raster scale against the board's zoom before reaching for a fix.

- **`sanitize-html`** — its standalone repo is archived into the Apostrophe monorepo, it is
  Node-oriented and untyped, and it carries a critical 2026 advisory. `marked` + DOMPurify is the
  right pair and both are current.
