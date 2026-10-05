# Feature queue

Things asked for and not yet done. **Check this file at the start of a session** — see
`CLAUDE.md`.

This is a working queue, not a roadmap: `docs/architecture.md` §12 is the plan and §13 is the
candidate list. What lives here is the specific things a person asked for, with enough context
that whoever picks one up does not have to reconstruct the conversation.

Move an item out when it is done. If it turns out to be a bad idea, say why in the commit rather
than deleting it silently — the next person will wonder.

---

## In flight

### Article resize and close — built, verifying
A page can be dragged wider by its right edge and rolled up by its close button. The resize keeps
the pin at the top-centre by taking half the change off `paperPos.x` (`resizePaper` in `App.tsx`);
the close rolls the page up to its tab rather than deleting it, because the pins anchored into its
text have nowhere else to be.

`/tmp/yarn2/article-probe.js` covers it. Last run: 7/9, with the two failures traced to the probe's
viewport being too narrow — opening the editor shifts the board right and pushed the buttons
off-screen, where `centre()` clamped and silently missed. Re-run with a wider viewport.

---

## Queued

### 1. Descriptions on strings
Asked for: *"connecting strings are also able to have a description… render them almost looking
like a sticky note pinned by a pin, or strung along the line of a string. Allow the user to slide
it to any position along the length of the string, and it moves according when the string gets
moved too."*

`StringLink` already carries a `label?: string` (see `src/model/types.ts`) and the migration has
the column — it is simply never rendered or edited. Work:

- Add `labelAt: number` (0..1 along the curve) beside it.
- Render, when `label` is non-empty, a small note-shaped chip at `pointOnYarn(from, to, labelAt,
  slack)` — it follows automatically, because the endpoints are recomputed every render.
- Drag it along the string to set `labelAt`; the nearest-point maths is already in
  `distanceToYarn` / `pointOnYarn` in `src/board/yarn.ts`.
- Editing the text should reuse the pin-editor pattern (`src/board/PinEditor.tsx`).

### 2. A richer demo board
Asked for: *"at least 2 articles, a few stickies, multiple yarns and pins, some with descriptions,
some without."*

**Blocked on #3** — there is one article and it is held in component state as a singleton, so a
second one cannot exist yet. Once articles are entities, seed them in `src/app/demo.ts`, which is
where the demo content already lives and is written to be the first thing deleted.

### 3. Articles as entities (plan Stage 3)
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

### 4. Double-click the rotate handle to flatten
Asked for: *"when double clicking the 'rotater pin', reset it back to flat."*

Both `ImageCard`'s rotate handle and the page's. Note that `useRotateDrag` calls
`preventDefault()` on `pointerdown`, which suppresses the compatibility mouse events — `dblclick`
may never arrive. Detecting it from two `pointerdown`s inside a few hundred milliseconds is the
reliable route.

### 5. Finish breaking up `App.tsx`
2451 lines when this started, 1731 now. The status strip (the `Legend` row plus the counts) is the
next obvious block, and the hooks are the larger prize — `useArticleProjection`, `useStringDrag`,
`usePinDrop` are all still inline.

---

## From the library survey

A survey of candidate dependencies was run; the report is summarised in `docs/architecture.md`
§7b and the decisions below. **The headline was that most libraries would be a downgrade** — the
home-made parts are the domain model, not wheel reinvention.

### 6. Adopt `@floating-ui/react` for the tooltip and context menu
The one clear win found. `PinTooltip.tsx` (292 lines) and `ContextMenu.tsx` (277 lines), plus 577
lines of tests, are hand-rolled portal + measure-after-mount + clamp-to-viewport + reposition.
`@floating-ui/react` 0.27.20 (2026-07-11, MIT, React 19 peer) owns that, and its `autoUpdate` is
exactly the fix for the stale-anchor-rect-under-zoom bug the tooltip's own comments describe
fighting. Keep the trigger in `BoardCanvas` — the library should own *where a menu sits*, not
*when it opens*.

### 7. Add the missing fuzzy rung to `resolve.ts`
`docs/architecture.md` §2 claims tier 3 does bitap via `diff-match-patch`. **It does not** —
`resolve.ts` is a plain `indexOf`. The gap is real: if the *quoted words themselves* are edited,
every tier misses and the pin orphans.

Hypothesis's ladder is the same ladder, with one rung more: exact `indexOf` → **approximate match
with an edit-distance budget** → score candidates by `50·quoteSim + 20·prefixSim + 20·suffixSim +
2·proximityToHint`. Roughly 60–120 lines against the existing resolver, borrowing the structure and
starting constants. Prefer hand-rolling the matcher over vendoring `hypothesis/client` (BSD-2, no
npm package, and it anchors against a live DOM where this anchors against flat text).

### 8. Fix three doc drifts
Found while surveying, all real:

- §2 claims bitap that does not exist (see #7).
- §8 describes a `motion` library that is imported nowhere and is not a dependency. The section is
  an architecture for something unbuilt; either build it or rewrite the section.
- §2 and `anchors/types.ts` frame the resolution ladder as the W3C model. It is not — the spec
  treats TextPosition and TextQuote as independent alternatives and says a consumer MUST pick one,
  without saying how. The ladder is a **Hypothesis client convention**, which is a stronger thing
  to be implementing than a spec, and the docs should say so.

### 9. Build the minimap
Named in §7b as the genuine thing lost by not using a graph library. Roughly 80 lines on top of
`camera.ts`'s existing `unionRect` / `boardToScreen` / `isVisible`. **Build, do not buy** — no
library supplies one without the coordinate model this board rejected.

### 10. Undo/redo, as an inverse-op stack over `BoardChange`
The change union already describes every mutation (`entity/upsert`, `entity/delete`,
`string/upsert`, `string/delete`), and an inverse is the same shape. Roughly 80 lines, no
dependency. `zundo` is stale and drags in zustand; `immer` patches are the alternative but
`updateEntities` runs once per pointermove during a drag and the store is allocation-light on
purpose — measure before adopting.

### 11. Accessibility on the board
A real gap. `react-aria` and friends supply *collection* patterns that assume things have an
order; a free-form 2D transform has no pattern to borrow. The work is design, not a dependency:
a roving-focus model over entities, arrow-key nudging, a keyboard connections view. `PinTooltip`
already does the `role="tooltip"` / deterministic-id part well — follow it.

### 12. Consider Yjs, later
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
- **Virtualisation, in any form** — a pan/zoom camera is a transform, not a scroll. And
  `content-visibility: auto` imposes size containment, so `getBoundingClientRect` returns the
  placeholder and every pin on the article would silently land at zero size.
