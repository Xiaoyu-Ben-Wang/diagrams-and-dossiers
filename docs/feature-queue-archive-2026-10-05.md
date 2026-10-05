# Feature queue — archive, 5 October 2026

The contents of `FEATURES.md`'s queue as it stood when it was cleared. Kept whole
rather than deleted: nineteen items is a lot of context, several of them carry the reasoning for a
decision as well as the work, and the file's own rule is that the next person should not have to
wonder why something is no longer there.

Nothing here is being worked on. If you want one of these back, move the item — text and all —
into `FEATURES.md`'s queue. Do not read this file as a plan.

---

## Queued

### 1. Stick a post-it to an article, a string, or an anchor
Asked for: *"Allow users to stick these post-its to articles, yarn, or anchors."*

The pad currently only makes free notes on the cork. Dropping one onto something should attach it:

- **Onto an article's text** → the note becomes an anchored pin, which is what `pinAt` already
  builds. The drop point needs the same `caretRangeThroughPins` treatment `handlePinDrop` uses,
  since the note being dragged is itself under the cursor.
- **Onto an anchor** → the note joins that pin, rather than starting a new one.
- **Onto a string** → the note hangs on the yarn. `StringLink` already has `label` / `labelAt` and
  `StringNote` already renders one, so this is mostly deciding whether a second note on a string
  is allowed and where it lands.

The shape of the answer is that a note stops being one kind and becomes a placement: the same
paper, stuck to whatever is under it. Worth doing now that articles are entities: "onto an
article" is where most of the work is, and a drop has an article id to belong to.

### 2. Theme colour tokens with one vocabulary
Asked for: *"For the preference themes, build out a css color library that share the same variable
names, i.e. primary, secondary, etc."*

Today the themes are a set of named ramps (`--color-cork-500`, `--color-parchment-200`,
`--color-brass`, `--color-wax`) and every component names the *material* it wants — which is why a
light theme has to redefine `--color-board-ink` to stop the chrome vanishing (`index.css`, top).
That works for the two themes that exist and will not survive a third.

The ask is a semantic layer over them: `--color-primary`, `--color-secondary`, `--color-surface`,
`--color-ink`, `--color-accent`… defined identically by every theme, with the material ramps
becoming the *values* a theme assigns rather than the names components use. Then a component asks
for `primary` and every theme answers.

Two things to be careful of, both learned the hard way already:

- **Some surfaces are not chrome.** The parchment ramp is also every sheet's background, so a
  token that means "background" cannot be the same one that means "page". The existing comment
  about `--color-board-ink` is the scar from exactly this.
- **Contrast is per-pair.** A theme is a set of decisions about *pairs* (ink on surface, accent on
  surface), not about single colours. Whatever the tokens are, they should make the pairs
  checkable.

### 3. Finish breaking up `App.tsx`
2451 lines when this started, 1985 now. The refactor got it to 1824 and the board-file work put a
chunk back, so the honest reading is that it has not moved. This one is not just a move: the
measurement layer left (`useArticleViews.ts`, 365 lines) and `ArticleSheet` now renders its own
markdown, but the comments explaining the per-article plumbing were added in the same place the
singleton code was removed, so the net line count barely moved. The status strip (the `Legend` row plus the counts) is the next
obvious block, and the hooks are the larger prize — `useStringDrag`, `usePinDrop`,
`useArticleResize` are all still inline.

### 4. There is no way to make a page
The model, the descriptor and the board all handle any number of articles, and the demo seeds four
— but nothing in the UI creates one, so a board is stuck with whatever it opened with. Importing a
board file can now bring pages in, which is not the same thing: you still cannot make one. Every other
kind has a pad in `BoardPalette`, and `PalettePad` is already generic (label, icon, ghost, onDrop),
so this is a third pad plus an `onDropArticle` that builds `newArticle` centred on the drop. The
glyph and the drag ghost are the actual work; the pad is not.

### 5. Four article options are parsed and read by nothing
`titleBar`, `paper`, `typeScale`, `collapsible` and `acceptsPins` all round-trip through
`parseArticleOptions` and change nothing: the sheet hardcodes parchment at the normal scale, always
draws its tab, always offers the roll-up, and always accepts a pin. `width`, `editable` and
`collapsed` are the three that are read. The comment on `ArticleOptions` now says which is which.
This matters more now than it did with one page, because per-article configuration is exactly what
a board of several pages is for — and `acceptsPins` in particular is the difference between "this
handout is pinned" and "this one is not", which is a real thing to want.

### 6. A swung page's anchor rectangles are measured against its bounding box
Found by a browser probe, not by the suite. `rangeToContainerRects` converts a range's client rects
into article space by subtracting the *container's* bounding box — and for a rotated sheet that box
is the box around the page rather than the page. Measured: a mark lands within 2px of its words at
0°, and ~15px off at 12.9° in the probe's setup, growing with the angle. It is well under
`SNAP_RADIUS` so strings still tie, and it is **not** new — the board tilted pages long before it
had two — but it is the reason a tilted page's tacks read as slightly loose. The fix is to divide
the page's own transform out of the measurement rather than working in bounding-box space.

### 7. `zIndex` is declared on every entity and applied nowhere
The store's comment used to claim the board's z-order was `zIndex` applied at render; it is not, and
the comment now says so. Paint order is the order the layers render in, which puts every page below
every tack, note and picture. That is right most of the time and wrong the moment a post-it should
sit *under* a page. Small, but it needs a decision about whether z-order is per-entity or per-layer.

### 8. An article that forbids editing cannot be moved either
`store.updateEntities` gates *every* change — move, rotate, resize, roll up — on `can('edit')`,
and for an article that reads `options.editable`. The descriptor still advertises `movable: true`
and `rotatable: true`. Nothing sets `editable: false` today, so the disagreement is unreachable
from the UI, but it is the kind of thing that becomes a bug report the first time someone turns the
option off. Either the store learns `move` as a separate action, or the descriptor stops claiming
those capabilities for a sealed page.

### 9. Fold `articles` into `items`
The client half is done; this is the schema half, and the sequence is written at the foot of
`supabase/migrations/0002_entity_columns.sql`. It now records two things that would have aborted
the fold as it was first written down: `items_image_columns_check` requires `rotation = 0` on every
non-image row, which a tilted page violates, and `items.kind` has to admit `'article'` *before* any
row is copied rather than after. It also corrects a claim that the location check needed relaxing —
it is a plain `OR` and already admits a board-placed page. The column `ArticleOptions` needed is
added additively by `0003_article_options.sql`.

This one has to be written where it can be **run**: it moves rows, and doing that blind is how a
migration ends up quietly destructive.

### 10. A seeded anchored pin cannot know where its words are yet
`demoBoard()` seeds free pins, notes, pages, pictures and yarn — and no *anchored* pins, which is
the one thing the demo board does not show. The reason is a real gap rather than an oversight: an anchor is a quote
plus character offsets into the article's **flat text**, and flat text only exists once the
markdown has been rendered and the DOM walked. `createAnchor` needs it, and at seed time there is
no DOM.

The consequence is visible if a pin is seeded anyway: the offsets are stale, the exact rung misses,
and the pin resolves as `repaired` — so the board opens reporting that pins were *repaired after an
edit* when nothing has been edited, and the footer says so.

Two ways out, and the second is probably right: seed the quote with no offsets and let the first
resolution place it (which needs a way to write the result back, or the pin re-searches forever),
or re-create the anchors once, after the pages have been measured for the first time. Either is a
small piece of bootstrap machinery — the kind that only a board that arrives pre-populated needs.

### 18. A board file carries its pictures inline
Export writes the whole board as one JSON document, and an image entity's `src` is a data URI, so
a board with photographs in it is a single file of many megabytes — slow to write, slow to parse,
and impossible to inspect. The demo does not show this because its three pictures are small
inline SVGs. Options, in increasing order of work: cap and warn; write a zip with the pictures as
separate entries; or store pictures by reference the way a real backend would. Worth deciding
before anybody exports a board with a scanned handout on it.

### 19. Date labels are stamped at creation and never revisited
`dateLabel` is editable on a pin now, but what the board *assigns* by itself is still wrong in two
ways, both found while wiring that up:

- **The labels never re-derive.** They are computed once, at creation, from a count of what is
  already on the board (`nextDateLabel`, `App.tsx`). Delete a pin and nothing closes the gap: place
  three, delete the middle one, and the third still reads "Session 15" over a board with two pins
  on it. Re-deriving is not simply "renumber everything" either — once a label has been edited by
  hand it must not be overwritten, so this needs a flag for "assigned" versus "written".
- **The same printed line counts two different populations.** Pins count pins
  (`state.entities.filter(isPin).length`), while notes and pictures count *every* entity
  (`state.entities.length`). So a "Session 14" on a tack and a "Session 14" on a post-it are not
  the same number of anything. One of the two is a bug; which one depends on whether a note is
  meant to be dated by what was pinned before it.

Worth doing with the chronology rather than before it, since a real date field
(`occurredAt` + `datePrecision`, both already in the model) would make the derived label a
formatted string rather than a counter.


---

## From the library survey

A survey of candidate dependencies was run; the report is summarised in `docs/architecture.md`
§7b and the decisions below. **The headline was that most libraries would be a downgrade** — the
home-made parts are the domain model, not wheel reinvention.

### 11. Adopt `@floating-ui/dom` for the tooltip and context menu
The one clear win found — and smaller than it first looked. `ContextMenu.tsx` and `PinTooltip.tsx`
*already* do the hard parts: flip, a tail pointer, clamping, keyboard nav, focus restore on
unmount, and they are tested (577 test lines between them). The genuine gap is narrower: neither
re-positions when the camera moves, which is precisely the bug their own comments describe
fighting.

So the adoption is `@floating-ui/dom` **1.8.0, 8 KB gzip, zero peer dependencies** — call
`computePosition` + `autoUpdate` inside the existing components and keep the markup, the keyboard
handling and the focus behaviour. `@floating-ui/react` (31 KB) is only worth it for the hooks and
the portal, which are not what is missing. Do **not** reach for Radix or Base UI for this: both
take over focus and want a declarative trigger, which fits poorly with one menu per pin.

Narrower than it was: a pin with a description now wears a tag on the board
(`entities/Tack.tsx`), so the hover card is only reached by a pin that has a quote and no note of
its own. The two components that still need this are the context menu and that remainder.

### 12. Add the missing fuzzy rung to `resolve.ts`
`docs/architecture.md` §2 claims tier 3 does bitap via `diff-match-patch`. **It does not** —
`resolve.ts` is a plain `indexOf`. The gap is real: if the *quoted words themselves* are edited,
every tier misses and the pin orphans.

Hypothesis's ladder is the same ladder, with one rung more: exact `indexOf` → **approximate match
with an edit-distance budget** → score candidates by `50·quoteSim + 20·prefixSim + 20·suffixSim +
2·proximityToHint`. Roughly 60–120 lines against the existing resolver, borrowing the structure and
starting constants. Prefer hand-rolling the matcher over vendoring `hypothesis/client` (BSD-2, no
npm package, and it anchors against a live DOM where this anchors against flat text).

### 13. Fix three doc drifts
Found while surveying, all real:

- §2 claims bitap that does not exist (see #11).
- §8 describes a `motion` library that is imported nowhere and is not a dependency. The section is
  an architecture for something unbuilt; either build it or rewrite the section.
- §2 and `anchors/types.ts` frame the resolution ladder as the W3C model. It is not — the spec
  treats TextPosition and TextQuote as independent alternatives and says a consumer MUST pick one,
  without saying how. The ladder is a **Hypothesis client convention**, which is a stronger thing
  to be implementing than a spec, and the docs should say so.

### 14. Build the minimap — or take the `react-zoom-pan-pinch` spike
§7b named four things genuinely lost by not using a graph library: **a minimap, viewport culling,
keyboard navigation, and a selection model.** The first three are buildable: `camera.ts` already
has `unionRect` / `boardToScreen` / `isVisible`, and `isVisible` is written *and tested* but never
wired into rendering — that wiring is the whole "AABB culling pass".

But the library survey corrected itself on one point, and it is worth recording because it is the
first thing that has actually answered §7b's list: **`react-zoom-pan-pinch` v4** (rewritten in
April 2026) ships `<MiniMap>`, `<Virtualize>` — a 2-D spatial culling component, which appears to
be the only one in any maintained library — and keyboard navigation, and it uses the *same*
direct-DOM-transform architecture `BoardCanvas` already uses by hand. It lacks a controlled
camera (its API is imperative) and has no `contextmenu` handling, so the right-drag-pans vs
right-click-opens-the-editor discrimination would have to be rebuilt on it.

**So: spike it, gated on two things — that the right-click travel discrimination survives, and
that React 19.3 behaves (its peer range is `*` and its CI runs React 18).** Keep `camera.ts`'s
`Camera` type as the boundary so the store never learns about the library's own transform shape.
If the spike fails, build the minimap by hand; it is about 80 lines.

### 15. Undo/redo, as an inverse-op stack over `BoardChange`
The change union already describes every mutation (`entity/upsert`, `entity/delete`,
`string/upsert`, `string/delete`), and an inverse is the same shape. Roughly 80 lines, no
dependency. `zundo` is stale and drags in zustand; `immer` patches are the alternative but
`updateEntities` runs once per pointermove during a drag and the store is allocation-light on
purpose — measure before adopting.

### 16. Accessibility on the board
A real gap. `react-aria` and friends supply *collection* patterns that assume things have an
order; a free-form 2D transform has no pattern to borrow. The work is design, not a dependency:
a roving-focus model over entities, arrow-key nudging, a keyboard connections view. `PinTooltip`
already does the `role="tooltip"` / deterministic-id part well — follow it.

### 17. Consider Yjs, later
The only library found that would subsume **both** the anchoring ladder and the `transport.ts`
seam: anchored text lives in a `Y.Text`, relative positions survive edits by construction rather
than by being re-found, and a deleted position resolves to `null` — which maps onto the orphaned
state honestly. It is a rewrite of the document layer, not a swap. Revisit when realtime is
actually built.

---
