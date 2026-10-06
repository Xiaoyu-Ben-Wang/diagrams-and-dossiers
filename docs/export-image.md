# Exporting the board as a PNG

A design, and now partly an implementation. Written 5 October 2026 on the
`export-image` branch before any of it was built.

**Built and probed.** `export-image.ts` (planning, 15 tests),
`export-image-dom.ts` (clone surgery and the SVG, 16 tests), `export-png.ts`
(raster, download, clipboard), `ExportImageDialog.tsx` (9 tests), and the wiring
— `data-testid="board-world"`, `SHADOW` exported from `ImageCard`, the button in
the board-file section, `App`'s render handler. `/tmp/yarn2/export-image.js`
passes every check it makes.

Three things the probe settled that the design could not, all now in the code:

- **The stylesheet must be escaped for XML.** Tailwind v4 emits
  `@property { syntax: "<color>" }`, and one unescaped `<` inside `<style>`
  makes the document malformed: the browser refuses to decode it with a bare
  `EncodingError` and no explanation. An `XMLSerializer` round trip will not
  catch this; a `DOMParser` will, and there is a test that parses the document.
- **A blob URL taints the canvas; a data URI does not.** Any SVG containing a
  `foreignObject` — even a plain `<p>` with no styles and no images — comes back
  from `toBlob` with `SecurityError: Tainted canvases may not be exported` when
  it was loaded through `blob:`, and comes back clean through `data:`. This is
  the whole reason `html-to-image` builds data URIs, and the reason it is not a
  dependency here: the mechanism is four lines.
- **The `.tack-enter` animation is not a problem**, which was the risk most
  likely to bite. Tacks export drawn, verified by an A/B (render the board,
  render it again with the tacks hidden, diff the pixels) rather than by
  matching brass, because the folder's tan passes most brass predicates.

`clip-path` torn edges and picture `drop-shadow`s both rasterise correctly
inside the `foreignObject`, which was the make-or-break check. **Safari remains
unverified** — the only browser this repo has ever been driven in is Chrome
under puppeteer. Read `docs/architecture.md` §7b first if you
have not: why the canvas is home-made shapes the whole of this.

The ask: a PNG of the board, with a choice of background colour and of
resolution, in the manner of Excalidraw's export dialog.

**The design adds no dependency.** Five runtime dependencies today (`react`,
`react-dom`, `marked`, `dompurify`, `lucide-react`); none of the options below
adds a sixth, and §3 says what would have to be true for one to be worth it.

## 1. The seam the board already gives us

`BoardCanvas` renders, inside one viewport div:

```
backdrop (GridLayer, viewport space)      ← excluded
world div  (transform: translate3d(…) scale(zoom))   ← THIS is the board
marquee                                   ← excluded
overlay   (Palette, ImageCaption, EdgePicker)   ← excluded
ZoomReadout                               ← excluded
```

Everything the export must **not** contain is already outside the world div.
`PinTooltip`, `ContextMenu`, `MarkdownToolbar`, `PaperEditor` and `Legend` are
outside `BoardCanvas` entirely, some through a portal. So "how is each piece of
chrome excluded" has one structural answer: **it is never cloned.**

Two changes are needed to make that seam usable:

- `BoardCanvas` gains a `worldRef` on the world div — it has no ref, id or
  testid today.
- The clone is stripped of the chrome that lives *inside* the world, because
  selection state is per-entity and therefore inside it:

  | chrome | how it is removed |
  |---|---|
  | `.post-it-tools`, `.post-it-resize`, `.post-it-close` | by selector — note the close X is always rendered, not selection-gated, and is easy to miss |
  | `.image-resize`, `.image-rotate`, `.image-rotate-stem`, `.article-resize`, `.sheet-close`, `.paper-close` | by selector |
  | `.tack.is-selected`, `.post-it.is-selected`, `.parchment.ring-2.ring-brass/70` | strip `is-selected` and the two ring classes |
  | a picture's brass rim — an **inline** `filter` on `.image-shadow` | export `IMAGE_SHADOW` from `ImageCard.tsx` and rewrite `style.filter` on the clone |
  | `data-selected` on `.paper-disclosure` | `removeAttribute` |
  | `[data-testid="yarn-halo"]`, `[data-testid="live-yarn"]`, `.yarn-bead` | by selector, or a `display: none !important` rule in the export reset sheet |
  | a `.string-note` holding nothing but `.string-note-prompt` (the "+ note" hint) | remove the element |

Two judgement calls, stated because they are calls rather than facts: the
**page tab and disclosure caret stay** (they carry the title, which is board
information, and a board exported without titles loses more than it gains), and
`.anchor-mark` stays (it is always on, not selection-gated).

## 2. Bounds and resolution

- **Bounds are the whole board**, defined by the existing
  `frameTargets(entities, entityContext)` — the same definition zoom-to-fit uses,
  so "everything" cannot mean two things. It already handles rotated sheets
  (`sweptBounds`) and gives pins a real footprint (`frameBounds`, ±`PIN_RADIUS`)
  rather than a point.
  `frameTargets` is currently private to `App.tsx`; extract it (with `NO_RECTS`)
  to `src/board/frame.ts` so both callers share it and it can be unit-tested.
  Use the **ungated** version — `App`'s opening-frame memo gates on
  `pageRects.length > 0`, which would export nothing from a notes-only board.
  Inflate the union by `EXPORT_MARGIN` (48 board px) for shadows, pin tags and
  yarn sag. That is an approximation: tags hang ~30px down-right and yarn sags
  below the straight line. The probe compares an exported edge against a
  screenshot; if it crops, raise the margin.
- **Resolution is device pixels per board pixel**, independent of screen DPR — a
  2× export on a 1× screen is still 2×. Offer 0.5/1/2/3, default 2, and never
  multiply by `devicePixelRatio`, which double-applies on a HiDPI screen.
- **A canvas has a hard maximum.** Budget `MAX_EXPORT_PIXELS = 32_000_000` and
  `MAX_EXPORT_EDGE = 12_000`, and *clamp the scale* rather than refusing:
  `planExport` returns the effective scale and a `clamped` flag, and the dialog
  says "2.3× — 3× would be 13500px wide". A 3000×2000 board at 3× is 54 Mpx and
  ~216 MB of canvas, so this is the default path on a big board, not an edge
  case. (The 32 Mpx figure is a guess and should be measured; see §7.)

## 3. How the pixels get made

### (a) Hand-rolled `<foreignObject>` → `<img>` → canvas — recommended

Build an SVG of the output size; put the collected CSS in a `<style>`, an
optional background `<rect>`, and a `<foreignObject>` holding the prepared
clone. Serialise with `XMLSerializer`, blob-URL it, `await image.decode()`,
`ctx.drawImage`, `canvas.toBlob`.

The exotic parts of this board — `clip-path` torn edges, `drop-shadow`,
rotated sheets, `color-mix()`, `::before` leaves — are all delegated to the
browser's own renderer, which is the only thing on the board that already draws
them correctly.

What would normally break, and why it does not here:

- **External CSS.** An SVG loaded as an image fetches nothing. But the board is
  same-origin, so `document.styleSheets` → `cssRules` inlines the whole compiled
  Tailwind and `index.css` in about ten lines. That is *more* faithful than
  per-node computed styles: `::before` (the folded page's leaves),
  `:nth-child(3n)` post-it rotations and `color-mix()` all survive for free.
  `preferenceVariables()` is already a pure exported function and is exactly the
  `:root` variable set to stamp on the `<svg>` element.
- **Fonts.** The app is `ui-serif`, `ui-sans-serif`, `ui-monospace` throughout.
  There are no `@font-face` rules and no webfonts. Font embedding — the single
  biggest reason `html-to-image` exists — is a non-issue.
- **Pictures.** Every picture the board creates is a data URI
  (`image-file.ts` converts drops; `demo-pictures.ts` is inline SVG data URIs),
  and data URIs are same-origin, so they load and do not taint. Only an imported
  board file can carry `https://` srcs, and those are blocked by the SVG-as-image
  sandbox: they render missing, and if one loads cross-origin `toBlob` throws
  `SecurityError`. Catch it and report it; do not treat it as a v1 blocker.
- **`<textarea>`.** React sets the *property*, not an attribute, so
  `cloneNode(true)` plus `XMLSerializer` serialises a post-it's writing as an
  empty box — silently. Walk the original and the clone in parallel and set
  `cloneField.textContent = originalField.value`. Three form controls exist
  inside the world.
- **Animations.** `.tack-enter` starts at `opacity: 0` with `animation-fill-mode:
  both`. If the browser freezes an SVG-as-image at the first keyframe, **every
  tack exports invisible**. Cheap total fix: append
  `*, *::before, *::after { animation: none !important; transition: none !important }`
  after the inlined CSS. Verify it — this is exactly the kind of thing that is
  only true when observed.
- **Media queries** re-resolve against the SVG viewport, not the screen. Exactly
  one responsive class lives inside the world (`.parchment`'s `sm:px-12 sm:py-10`)
  and it only diverges below 640px of output, where the smaller padding is
  arguably the better thumbnail. Write it down; do not engineer around it.

The `Range.getClientRects()` argument in `FEATURES.md` — the reason every canvas
renderer was rejected for the live board — **does not apply here**: at capture
time every pin's position is already in the DOM, and a one-shot painter never
needs to measure text. A painter is rejected on drift and cost, not on that.

### (b) A library (`html-to-image`, `dom-to-image-more`, `modern-screenshot`)

Rejected for the first cut. Its value for a general app is computed-style
inlining, webfont embedding and image embedding; this board has no webfonts, its
pictures are already data URIs, and same-origin CSS makes whole-sheet inlining
simpler *and* faster — O(stylesheets) rather than O(elements), and a board can be
two hundred notes. Nor would it remove the DOM surgery in §1, because no library
knows to strip `.post-it-tools`.

**Fallback trigger:** if the probe shows Chrome cannot rasterise `clip-path` or
`drop-shadow` through a `foreignObject` and there is no cheap fix, adopt
`modern-screenshot` and record the reason in `FEATURES.md`. Explicitly reject
`html2canvas`, which is option (c) outsourced.

### (c) A hand-written canvas painter

Rejected. Articles are sanitised markdown with headings, lists, quotes, code,
links and mentions, laid out through four coordinate spaces. Re-implementing
that is re-implementing a browser, and every entity drifts the first time a CSS
value is retuned.

### (d) Also considered, also rejected

- **Screen capture** — needs a user-chosen surface, and captures viewport chrome.
- **A second React render into an offscreen node with export props** — the
  measurement layer (`useArticleViews`, anchor resolution, `articleToBoard`)
  would have to run twice, and the live board already renders everything (there
  is no culling), so the clone is exact and free.
- **SVG file export** — not a PNG, and a `foreignObject` SVG is not portable.

**A coupling to write down:** clone-based export depends on `BoardCanvas`
rendering *every* entity. Queue item #13 (spatial culling) would silently make
export capture only the visible subset. If culling lands, export must disable it.

## 4. Background

The board viewport paints `--board-surface` flat (`.board-canvas` sets
`background-image: none`; the cork grain is on `.app-shell`/`.cork`, which are
outside the world). So the export paints a flat fill, and the grid and candle —
viewport-space chrome — are excluded.

Choices: **Board surface** (default, from `surfaceColor()`), **White**,
**Black**, **Transparent**, **Custom** (an `<input type="color">`, no dependency).

**What transparent means here:** no background rect, so a real alpha PNG. Every
shadow on the board composes toward translucent black, so on a black viewer the
shadows vanish and on a white one they read as grey halos. That is the same
behaviour Excalidraw has, and the dialog should say so in one line rather than
pretend otherwise.

## 5. The UI

- **Trigger**: "Export image…" beside "Export board…" in the preferences panel's
  board-file section, and later a context-menu entry.
- The preferences panel is itself a modal drawer, so do not stack a second modal
  on it: `App` closes it and opens the export dialog.
- **`ExportImageDialog`**: a centred modal modelled on `PreferencesPanel` —
  `role="dialog"`, `aria-modal`, focus on open, Escape closes (with
  `stopPropagation` so the board's global keydown does not also act), backdrop
  press closes, focus restored to the trigger. Add `exportImageOpen` to the
  board's global keydown guard, which already checks
  `editingPin || contextMenu || prefsOpen || movingPin`.
- **Contents**: background swatches; resolution options with the resulting pixel
  dimensions under each; the clamped warning when the scale was reduced; an error
  in a `role="alert"`; Cancel / Download PNG.
- **While running**: disable the controls and show "Rendering…". The dialog owns
  that state and asks `App` for the work, mirroring `BoardFileSection` /
  `importBoard`: `onDownload(options): Promise<string | null>` — a reason, or
  nothing.
- **Preview** (a later cut): run the same pipeline at a small scale into an
  `<img>`, on a checkerboard so transparency reads. Honest rather than a mock,
  at the cost of a capture per change.

## 6. Files

**Add**: `src/board/frame.ts` (+ test), `src/board/export-image.ts` (+ test),
`src/board/export-image-dom.ts` (+ test), `src/board/export-png.ts` (browser
only, no unit tests), `src/board/ExportImageDialog.tsx` (+ css, + test),
optionally `src/theme/ChoiceGroup.tsx` extracted from the preferences panel.

**Change**: `BoardCanvas.tsx` (world ref), `StringLayer.tsx` (a class on the
halo rather than selecting a testid), `ImageCard.tsx` (export `IMAGE_SHADOW`),
`PreferencesPanel.tsx` (the button), `App.tsx` (`exportImageOpen`, `worldRef`,
the rects memo, `downloadBoardImage`, the keydown guard, the dialog),
`FEATURES.md`.

## 7. What the probe must settle

1. Does Chrome rasterise a `foreignObject` from a blob-URL SVG at the target
   scale, crisply?
2. **`clip-path: polygon(…)` inside a `foreignObject`** — the whole torn/burnt
   edge family depends on it, with no fallback. The most important check.
3. `filter: drop-shadow(…)` inside a `foreignObject` — every picture's shadow.
4. The `.tack-enter` animation freeze (check 4 above).
5. Do custom properties set on the `<svg>` root inherit into the
   `foreignObject`'s HTML? If not, emit a `:root { … }` rule in the injected
   stylesheet instead.
6. Tailwind v4's `@property` and `@layer` inside an SVG `<style>`.
7. Do data-URI images complete before the outer `load`? If not, pre-`decode()`.
8. The canvas ceiling on this machine — 32 Mpx is a guess; measure it.
9. **Safari is entirely unverified.** The repo's verified browser is Chrome
   through puppeteer. Say so in the commit rather than claiming cross-browser.

## 8. The first cut

Ship in this order; each step is useful on its own.

1. Extract `frameTargets` to `src/board/frame.ts`. No behaviour change.
2. `export-image.ts` — the pure planning, with tests.
3. `export-image-dom.ts` + `export-png.ts` + the world ref + a button in the
   preferences panel that immediately downloads at 2× on the board surface.
   **No dialog.** This proves the entire risky pipeline in one small diff and is
   already a useful feature.
4. The probe. Do not start step 5 until checks 1–4 and 6–8 pass.
5. `ExportImageDialog` with background, resolution and the computed dimensions.
6. Bells and whistles only if they earn it: the preview, the context-menu entry,
   a custom colour, and a "current view" bounds option.
