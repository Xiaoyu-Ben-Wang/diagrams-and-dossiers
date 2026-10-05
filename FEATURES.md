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
paper, stuck to whatever is under it. Worth doing *after* articles are entities (#3), because
"onto an article" is where most of the work is.

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

### 3. A richer demo board
Asked for: *"at least 2 articles, a few stickies, multiple yarns and pins, some with descriptions,
some without."*

**Blocked on #4** — there is one article and it is held in component state as a singleton, so a
second one cannot exist yet. Once articles are entities, seed them in `src/app/demo.ts`, which is
where the demo content already lives and is written to be the first thing deleted.

### 4. Articles as entities (plan Stage 3)
The last big piece of the approved plan and the prerequisite for #2. Today the article is
`paperPos` / `paperTilt` / `paperWidth` / `source` in `App.tsx` with one `articleRef` and one
`projectionRef`. Making it an `ArticleEntity` means:

- **Per-article anchor projection.** This is the load-bearing change, not a move: each page needs
  its own `projection`, and `EntityContext.articleToBoard` has to answer for an article *id*
  rather than for "the" page.
- `PAPER_WIDTH` becomes a per-article option (the field already exists in `ArticleOptions`).
- The ResizeObserver re-resolves that article, which the pure idempotent resolver already supports.
- Then the `articles` table folds into `items` — the sequence is written at the foot of
  `supabase/migrations/0002_entity_columns.sql`, including the step that must not be automated.

### 5. Finish breaking up `App.tsx`
2451 lines when this started, 1731 now. The status strip (the `Legend` row plus the counts) is the
next obvious block, and the hooks are the larger prize — `useArticleProjection`, `useStringDrag`,
`usePinDrop` are all still inline.

---

## From the library survey

A survey of candidate dependencies was run; the report is summarised in `docs/architecture.md`
§7b and the decisions below. **The headline was that most libraries would be a downgrade** — the
home-made parts are the domain model, not wheel reinvention.

### 6. A known collision: the border bar and the palette
**A live bug, reproducible.** `edge-probe.js` is 15/16: with a picture selected near the bottom-left,
the border bar's first swatches are under the palette and cannot be clicked. The picture re-selects
instead, which re-rolls its edge — so the crop looks like it simply did not take.

Lowering the palette's `z-index` does not fix it, and that is the interesting part: the picker is
inside the world layer, which is a *transformed* element and therefore its own stacking context, so
no `z-index` on the picker can lift it above a sibling of that layer. The palette has to be above the
board (it is chrome) and the picker has to be above the palette (it is the thing being used), and
those two cannot both be true while one of them is inside the transform.

The fix is to stop positioning floating UI inside the world layer — which is what `PinTooltip` and
`ContextMenu` already do, and what the `@floating-ui/dom` adoption below would formalise. The edge
picker should move to viewport space with the rest, converting the picture's board bounds through
the camera at render. Worth doing together with that adoption rather than as a third mechanism.

### 7. Adopt `@floating-ui/dom` for the tooltip and context menu
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

### 8. Add the missing fuzzy rung to `resolve.ts`
`docs/architecture.md` §2 claims tier 3 does bitap via `diff-match-patch`. **It does not** —
`resolve.ts` is a plain `indexOf`. The gap is real: if the *quoted words themselves* are edited,
every tier misses and the pin orphans.

Hypothesis's ladder is the same ladder, with one rung more: exact `indexOf` → **approximate match
with an edit-distance budget** → score candidates by `50·quoteSim + 20·prefixSim + 20·suffixSim +
2·proximityToHint`. Roughly 60–120 lines against the existing resolver, borrowing the structure and
starting constants. Prefer hand-rolling the matcher over vendoring `hypothesis/client` (BSD-2, no
npm package, and it anchors against a live DOM where this anchors against flat text).

### 9. Fix three doc drifts
Found while surveying, all real:

- §2 claims bitap that does not exist (see #7).
- §8 describes a `motion` library that is imported nowhere and is not a dependency. The section is
  an architecture for something unbuilt; either build it or rewrite the section.
- §2 and `anchors/types.ts` frame the resolution ladder as the W3C model. It is not — the spec
  treats TextPosition and TextQuote as independent alternatives and says a consumer MUST pick one,
  without saying how. The ladder is a **Hypothesis client convention**, which is a stronger thing
  to be implementing than a spec, and the docs should say so.

### 10. Build the minimap — or take the `react-zoom-pan-pinch` spike
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

### 11. Undo/redo, as an inverse-op stack over `BoardChange`
The change union already describes every mutation (`entity/upsert`, `entity/delete`,
`string/upsert`, `string/delete`), and an inverse is the same shape. Roughly 80 lines, no
dependency. `zundo` is stale and drags in zustand; `immer` patches are the alternative but
`updateEntities` runs once per pointermove during a drag and the store is allocation-light on
purpose — measure before adopting.

### 12. Accessibility on the board
A real gap. `react-aria` and friends supply *collection* patterns that assume things have an
order; a free-form 2D transform has no pattern to borrow. The work is design, not a dependency:
a roving-focus model over entities, arrow-key nudging, a keyboard connections view. `PinTooltip`
already does the `role="tooltip"` / deterministic-id part well — follow it.

### 13. Consider Yjs, later
The only library found that would subsume **both** the anchoring ladder and the `transport.ts`
seam: anchored text lives in a `Y.Text`, relative positions survive edits by construction rather
than by being re-found, and a deleted position resolves to `null` — which maps onto the orphaned
state honestly. It is a rewrite of the document layer, not a swap. Revisit when realtime is
actually built.

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
  #9.)
- **`content-visibility: auto`** — it imposes size containment, so `getBoundingClientRect` returns
  the placeholder and every pin on the article would silently land at zero size. It also does not
  reduce DOM cost, clips descendants, and establishes a positioning containing block.
- **`sanitize-html`** — its standalone repo is archived into the Apostrophe monorepo, it is
  Node-oriented and untyped, and it carries a critical 2026 advisory. `marked` + DOMPurify is the
  right pair and both are current.
