# Diagrams & Dossiers — Architecture

A private, collaborative "detective board" for a D&D group. Players pin notes and long-form
markdown articles to a shared corkboard, connect them with colored yarn, and read the same
content on a shared board. The visual target is a
*fantasy detective's office* — cork, parchment, brass tacks, wax seals, candlelight — where every
interaction animates as a physical object.

**The hard problem, and the one everything else depends on:** a pin must still land on the right
words after the article it's attached to has been edited. Section 2 is the answer, and the rest
of the system is arranged around it.

---

## Design decisions

| Area | Decision | Why |
|---|---|---|
| Access | Link-based, Google-Docs style: view / edit / DM links per board | No accounts; anyone with the link is in. Trust system for close groups. |
| Board creation | Separate creator invite link | Holding it grants the right to create boards and mint their links |
| DM secrets | Third link type; `visibility` column + RLS on every content table | Built in from day one — retrofitting permissions is invasive |
| Hosting | $0 free tiers (Supabase + Cloudflare) | Comfortably covers a D&D group; see §9 |
| Dates | Free-text label + hidden sortable date | Supports homebrew calendars and vague dates, still orders a timeline |
| Grouping | Transient multi-select *and* persistent "case files" | Quick moves and durable, datable collections are different needs |
| Timeline | Camera fly-to on scrub, plus auto-play recap | Turns campaign chronology into a second navigation axis |
| Conflict | Last-write-wins + version guard; CRDT deliberately deferred | 4–8 people editing occasionally don't have a CRDT-shaped problem |

---

## 1. Access model — link-based, capability-granting

### Two kinds of link

1. **Creator invite** (`/c/<token>`) — grants `can_create_boards`. Redeem it, then create your own
   boards and receive a set of share links for each.
2. **Board links** — each board mints up to **three** tokens, each independently rotatable:

   | Link | Grants | Shared with |
   |---|---|---|
   | **View link** | read-only | the whole table |
   | **Edit link** | read + write pins, yarn, articles | players |
   | **DM link** | edit + see DM-only content + rotate links | only the DM |

   The DM link falls out of the same mechanism for free, replacing what would otherwise be a
   bolt-on "DM role." Rotating the edit link revokes edit access without invalidating viewing.

### The token is a door, not a credential

Redeeming a token calls a `security definer` RPC that writes a real `members` row recording the
granted role. Every request *after* that is authorized by ordinary RLS against that membership —
the token never appears in a JWT or in any subsequent query.

This is the load-bearing decision. It keeps authorization in exactly one place (Postgres
policies) rather than scattered across token checks in application code, and it's what lets the
DM-secrets guarantee survive link-based access.

```sql
profiles(user_id → auth.users PK, display_name, can_create_boards bool, created_at)

boards(id, name, slug, owner_id, view_token, edit_token, dm_token, created_at)
  -- each token: 16 random bytes, base64url, unique-indexed, NULL = that link disabled

members(board_id, user_id, role: viewer|editor|dm|owner,
        display_name, color, joined_via, created_at,
        PRIMARY KEY (board_id, user_id))

board_blocks(board_id, user_id, reason, created_at)   -- soft per-person revocation

creator_invites(token PK, note, created_by, revoked_at, created_at)
```

Three RPCs, all `security definer` with `search_path` pinned:

- `redeem_creator_invite(token)` → sets `profiles.can_create_boards`
- `create_board(name)` → requires `can_create_boards`; returns the three links
- `join_board(token)` → resolves token to board + role, refuses if blocked, upserts `members`

### Identity without accounts

Anonymous sign-in gives each *browser* a stable `user_id`, which is what makes attribution ("who
pinned this") and presence ("who's online") work at all. On first join we prompt once for a
display name and remember it locally. That is a name, not an account — no email, no password, no
verification.

Because authorization runs through `members`, a revoked player is genuinely revoked — unlike a
bare shared-password scheme.

### Security posture

> **Anyone holding the edit link can edit, and can pass it on.** There is no per-person
> authentication, so revocation is *cooperative*, not enforced: `board_blocks` stops accidental
> re-entry from the same browser, but someone determined can clear browser storage and rejoin.
> The real remedy is rotating the link, which locks out everyone. This is the correct trade for a
> D&D group and the wrong one for anything public.

Two things are done properly regardless, because they concern *correctness* rather than abuse:

- The **service-role key never reaches the client** — it bypasses RLS entirely, so one leak ends
  the campaign.
- All writes go through RLS-checked paths rather than trusting the UI.

### RLS helpers

```sql
create function is_viewer(b uuid) returns boolean language sql security definer stable
  set search_path = public as $$
    select exists (select 1 from members m
                   where m.board_id = b and m.user_id = auth.uid())
  $$;

-- is_editor(b): role in ('editor','dm','owner')
-- is_dm(b):     role in ('dm','owner')
```

Read policies gate on `is_viewer`, `visibility`, and `reveal_at`; write policies additionally
require `is_editor`. `reveal_at` costs nothing once `visibility` exists and gives the DM timed
reveals — a handout that appears mid-session.

### Two triggers that close real holes

RLS lets a member update *any* column on rows they can write. Without guards:

```sql
create function items_immutable() returns trigger language plpgsql as $$
begin
  if new.board_id <> old.board_id or new.created_by <> old.created_by
     or new.kind <> old.kind or new.article_id is distinct from old.article_id then
    raise exception 'immutable column';
  end if;
  if new.version < old.version then raise exception 'version must increase'; end if;
  new.updated_at := now();
  return new;
end $$;
```

The first check stops a member moving a row to another board or forging authorship. The second
stops a client writing `version = 1` forever, which would make the optimistic-concurrency guard
decorative. Mirror this trigger on `strings` and `groups`.

---

## 2. Anchoring a pin to text

A pin's location is **not** a pixel offset — pixels break the moment someone adds a sentence
above. Each pinned item instead stores a **three-tier text anchor**, modelled on the W3C Web
Annotation Data Model (the approach Hypothesis uses):

```ts
type TextAnchor = {
  quote: string        // the anchored text, snapped to word boundaries
  prefix: string       // ~32 chars of context before
  suffix: string       // ~32 chars of context after
  startOffset: number  // char offset into the article's FLAT TEXT (not HTML)
  endOffset: number
  cached?: { x: number; y: number; paperVersion: number }   // last known pixel fallback
}
```

### Offsets index text content, not HTML

Build a flat-text index by walking text nodes in document order into `(textNode, startOffset)`
pairs. Wrapping a phrase in `**bold**` or swapping the renderer then moves nothing. This is the
whole trick.

### Resolution ladder

Fast path first, then progressively more expensive repair:

1. **Position (O(1))** — slice `quote.length` chars at `startOffset`; if it equals `quote`, done.
2. **Windowed search** — look near the stored offset; cheap, catches most local edits.
3. **Quote + context scoring** — search the flat text for `quote`, score candidates by prefix and
   suffix agreement (bitap via `diff-match-patch`), take the best above a confidence threshold.
4. **Cached pixel fallback** — render **faded with a "?" tag**: "the trail is cold."
5. **Orphaned** — quote is gone. The pin survives as a loose card with a *frayed* yarn end, and
   offers "re-attach" or "leave loose."

Resolution is pure and synchronous, well under 1ms for article-sized text, so it can re-run on a
debounce after edits and on `ResizeObserver` when the paper width changes.

### Four traps that would silently break every anchor

- **Renderer-inserted whitespace.** `mdast-util-to-hast` injects `"\n"` text nodes to pretty-print
  HTML. If the projection doesn't normalize whitespace identically in the rehype plugin and in
  the DOM walker, *every* offset shifts the moment output formatting changes. `projection.ts`
  (§10) is the single source of truth for what an offset means, shared by both sides.
- **Fonts.** Resolving anchor rects before `document.fonts.ready` puts every pin in the wrong
  place, and the cause is invisible. Gate all first-resolution on font readiness.
- **Images.** Markdown images without explicit `width`/`height` reflow the article as they load,
  dragging every anchor with them. Always emit intrinsic dimensions.
- **Paper width must be locked in board space** (720px at zoom 1) so reflow is deterministic and
  zoom cannot shift an anchor. Zoom scales the whole board with one transform, so text metrics
  never change. Any renderer that lays the article out at a *different* width would re-resolve on
  resize — which is exactly why the algorithm must be pure and idempotent.

### Edge cases

- **Multi-element ranges** (across paragraph breaks, bold runs, list items) — the flat index makes
  this natural; map back to a `Range` and use `getClientRects()`, one rect per line.
- **Collapsed caret** — users *click* to pin rather than select text. Snap the caret to the
  nearest word and use that word as the quote.

---

## 3. Data model

```sql
articles(id, board_id, title, slug, body_md,
         visibility: shared|dm, reveal_at,
         board_x, board_y,               -- where the paper sits on the cork
         rotation,                       -- degrees about the pin, within +/-45
         version, created_by, created_at, updated_at)

items(id, board_id, kind: pin|note|article_ref|image,
      title, body_md, color,
      visibility: shared|dm, reveal_at,
      board_x, board_y,               -- free placement
      article_id, anchor jsonb,       -- OR anchored to text
      status: theory|confirmed|disproven,
      date_label, occurred_at, date_precision, date_inherit,
      z_index, version, created_by, created_at, updated_at,
      -- image only, and null for every other kind
      src, width, height,             -- footprint in board px, not file px
      rotation,                       -- degrees about the pin, within +/-45
      edge, edge_seed,                -- border form, and what it generates from
      CHECK ((article_id IS NOT NULL AND anchor IS NOT NULL)
          OR (board_x IS NOT NULL AND board_y IS NOT NULL)))

groups(id, board_id, name, color, visibility,
       date_label, occurred_at, date_precision, created_by)

group_items(group_id, item_id, PRIMARY KEY (group_id, item_id))   -- many-to-many

strings(id, board_id, from_item, to_item, slack, style: solid|dashed|double,
        label, visibility, created_by, created_at,
        CHECK (from_item <> to_item))
```

**A location is either a free board point or a text anchor inside an article** — never both. The
`CHECK` constraint enforces it.

**Rotation is a property of a pinned sheet, not a layout tool.** An article and an image are both
held to the board by one pin at the top-centre and swing about it, within ±45°; a note and a pin
are not rotated at all. `width`/`height` on an image are the board footprint measured from the
decoded file — never the file's own pixel dimensions, which for a photograph off a phone would be
larger than the article it sits beside.

**`edge` is generated, and `edge_seed` is what it generates from.** The geometry in
`src/board/edges.ts` is deterministic on purpose — the same seed gives the same polygon in any
process, which is what makes its cache sound and its output testable. Randomness therefore lives
in the seed, which is stored, and re-rolled when a picture is picked up. A style the client does
not recognise falls back to `clean` rather than throwing.

> **This schema lags the client in one place, deliberately.** An article is still its own table
> here, and `article_ref` still means a reference to one. The client has the same shape — a single
> page held in component state, not an entity — so the two agree. Folding `articles` into `items`
> belongs with the change that makes an article an entity on the board, and `0002_entity_columns.sql`
> carries the sequence for it, including the step that must not be automated. Doing the fold first
> would put the schema ahead of the client, which is the same drift in the other direction.

Indexes on `items(board_id)`, `items(article_id)`, `items(occurred_at)` (timeline), and a GIN
index on a `tsvector` for search.

**Dates.** A group carries its own date, and members with `date_inherit = true` and a null
`occurred_at` inherit it — set the date on the folder once, everything inside follows.

**Client-generated UUID primary keys everywhere** (`crypto.randomUUID()`), with all writes as
idempotent upserts (`on conflict (id) do update`). Without this, a retry after a network blip
duplicates a pin.

---

## 4. Realtime and conflict

| Traffic | Transport | Rate |
|---|---|---|
| Items, strings, groups created/edited/deleted | `postgres_changes` (RLS-aware) | on commit |
| In-flight drag positions | Broadcast, **ephemeral** | ~20Hz throttled |
| Cursors, lasso in progress | Broadcast, **ephemeral** | ~20Hz |
| Who's online, who's dragging what | Presence | on change |

Persisting drag positions would mean hundreds of writes per drag; broadcasting them and writing
once on drop costs one write.

### DM-safe broadcast

Secret-bearing ephemeral traffic needs **private channels**, which takes two coordinated pieces
that are each easy to half-do:

1. RLS policies on `realtime.messages`, scoped with `realtime.topic()` and filtered on
   `extension in ('broadcast','presence')`. You need **both** an insert policy (to send) *and* a
   select policy (to receive) — with only the insert policy, sends silently succeed while nothing
   ever arrives.
2. `config: { private: true }` on the client channel, which must match the sender's `is_private`
   flag or messages are dropped with no error.

Channels: `board:<id>:public` and `board:<id>:dm`.

> **Migration landmine.** `realtime.messages` already has RLS enabled and the `realtime` schema
> is locked down. Adding `ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY` to a migration
> fails with `42501 must be owner of table messages`, which **aborts the entire transaction and
> silently skips every following statement** — including your `create policy` lines. Create the
> policies directly; never try to enable RLS there.

### Realtime is not durable

A client that was offline misses events with no replay. On every `SUBSCRIBED` transition,
including reconnects, run a catch-up query filtered by `updated_at > lastSeen`, merge into the
local store, and drop the local outbox.

Two related gotchas: `payload.old` is **PK-only** under RLS, and **DELETE events are not
RLS-filtered**.

### Conflicts

- Item move/edit → last-write-wins with the `version` guard.
- Group drag → one transaction batching all member positions, plus a soft drag lock via Presence
  so two players don't fight over the same folder ("Kael is moving this").
- Article body → debounced autosave (1.5s idle) with a "yours / theirs" merge prompt on version
  conflict.

**CRDT deliberately deferred.** Yjs is a lot of machinery for a problem 4–8 people editing
occasionally will not have. Revisit only if simultaneous editing becomes genuinely painful.

---

## 5. Groups, dates, and the timeline

### Grouping — two kinds, for two different needs

- **Transient selection** — shift-click, marquee, or **lasso** (freehand; more thematic).
  Dragging any member moves the whole set, preserving relative offsets. A floating toolbar offers
  *Group into case file · Set date · Color · Align · Delete* — bulk date editing lives here.
- **Case files** — a named `groups` row rendered as a translucent parchment wash with a
  hand-drawn boundary and a manila label tab, slightly rotated. Dragging the folder moves every
  member; **collapsing** slides members inside and shrinks it to a tab. Good decluttering, and a
  satisfying animation.

### The chronology ribbon

Runs along the bottom as a strip of adding-machine tape with perforated edges and brass tick
marks. Scrubbing flies the camera to frame the items active at that moment. **Play** glides
through the campaign in order, lighting each cluster via a lantern sweep while the rest dims — a
"previously on…" recap before a session. Undated items live in an "Unsorted evidence" tray at the
head.

> Dimming via `filter: saturate()` across hundreds of elements will tank the frame rate. Dim by
> toggling a per-item **opacity** class (compositor-only) plus one moving lantern overlay.

---

## 6. Views: the board

One view today. Everything below is drawn from the same data and the same `resolveAnchor()`, so a
second renderer is a rendering decision rather than a data one — which is the property that
matters, whether or not a second renderer ever exists.

- **Board** — papers at board positions, pins, yarn. Toolbelt styled as a detective's kit:
  Select · Pin · Yarn · Lasso · Article · Eraser. Pan via space/middle-drag; zoom to cursor via
  ctrl-scroll or pinch. Middle-drag on a pin, note or paper moves that object instead of the
  camera.

Clicking a pin opens the article at that anchor.

---

## 7. Theme, animation, and sound

**Design language: "The Candlelit Case Room."** Cork on dark wood, brass fittings, parchment,
iron-gall ink, wax seals, faintly glowing yarn.

### Design tokens

```
--cork-900  #2E1F14    --parchment-100 #F7EFDD    --ink    #241A12    --brass #C9A227
--cork-500  #6B4A2F    --parchment-300 #E3D2AE    --wax    #8C2F1E
--cork-300  #8C6544    --parchment-edge #C9B48A
```

Yarn palette: crimson `#A3302B` · indigo `#2E4A7D` · emerald `#2F6B4F` · gold `#B8912F` ·
violet `#5B3A72` · bone `#D8CFB8`.

### Signature animations

1. **Placing a note** (hero) — paper falls with a curl, settling −4°→+1.5° (260ms) → brass tack
   *drives in* (scale 2.2→1 with overshoot, shadow contracts from soft blob to tight dot, paper
   recoils 3px) → dust puff (5–7 particles) → 2px board shake (90ms) + cork thunk → ink bleeds
   into the text (blur→sharp, 180ms). *Confirmed* notes get a **wax seal** variant: the stamp
   squashes down and a red ring ripples outward.
2. **Drawing yarn** — grabbing a pin's eyelet pulses a highlight ring; the free end is a
   6-segment rope trailing the cursor with ~80ms spring lag. Valid targets glow brass and the end
   is *magnetically* pulled toward any within 60px. On connect it snaps taut, relaxes into a sag,
   and a **twang ripple** travels from grab point to far pin (400ms). An invalid drop recoils like
   a snapped rubber band. Idle strings sway imperceptibly (0.5–1px, 6–9s, randomized), culled
   offscreen.
3. **Unrolling an article** — animated `clip-path` with a travelling curled bottom edge (420ms);
   blocks fade and rise on a 24ms stagger, capped at ~12 so long articles don't drag; headings
   draw an ink underline via `stroke-dashoffset`.
4. **Writing** — split CodeMirror/parchment view with a quill cursor and faint ink trail. The save
   indicator is a **wax seal that sets**: matte while unsaved, glossy highlight sweep when saved.
5. **Camera / timeline** — spring fly-to with a dolly arc for long distances; scrubbed items take
   a warm lantern glow (`mix-blend-mode: screen`); a single lantern overlay sweeps between
   clusters in play mode.
6. **Ambient** — candle flicker as **three layered radial gradients on coprime periods
   (3.7s / 6.1s / 11.3s)** animated on `opacity` only, so it never visibly loops and costs zero
   paint; ~24 dust motes on canvas with 0.3× camera parallax; a **raven** flies in and drops a
   note when another player posts, rate-limited to once per 30s so it stays special. Other
   players' cursors are brass compass needles with paper name tags.

### Sound — synthesize, don't bundle

Web Audio one-shots. Zero assets and zero network; per-event randomization so the 200th tack
doesn't sound like the first; state modulation, so a taut string twangs higher than a slack one.

- **Cork thunk** — click transient + pitched body + lowpass
- **Yarn twang** — **Karplus-Strong**: a noise burst into a delay line whose delay is set by the
  string's slack, so long droopy strings genuinely sound lower
- **Paper rustle** — three to five random micro-envelopes of bandpassed noise (2–6 kHz)
- **Unspool** — looping noise with a slow LFO on the bandpass, gain-gated by drag velocity
- **Wax seal** — soft thud + high click

Operational rules: create the `AudioContext` lazily on first `pointerdown` (creating it at load
leaves it `suspended`), generate the noise buffer once, cap at 6 concurrent voices through a
`DynamicsCompressorNode` so a bulk paste can't clip, pan by board-space x, suspend on
`document.hidden`, and give every sound a visual counterpart — sound must never be the only
feedback channel.

---

## 7b. Why not React Flow

The question is fair: this is a pan-and-zoom canvas of boxes joined by lines, which is what
[React Flow](https://reactflow.dev) is for. The honest answer has two halves.

**Nobody decided against it.** There is no trace of it in this repository — not in
`package.json`, not in a comment, not in a rejected alternative. The board was built on four
runtime dependencies (`react`, `react-dom`, `marked`, `dompurify`) and the canvas is home-made
because it was written before anyone asked. That is a real gap in the decision record, and this
section is the decision being made late rather than the decision being defended.

**What it would replace.** Measured:

| | Lines |
|---|---|
| `board/camera.ts` (pan, zoom, fit, screen↔board) | 245 |
| `board/BoardCanvas.tsx` (gestures, marquee, context, drop) | 646 |
| `board/useBoardDrag.ts` (press-vs-drag, pointer capture) | 142 |
| `board/GridLayer.tsx` | 38 |
| **Total a viewport library would own** | **~1071** |

**What it would not touch.** The parts that are actually difficult:

| | Lines |
|---|---|
| `anchors/` (quote/position selectors, the resolution ladder) | 638 |
| `board/yarn-style.ts` (seeded procedural wool) | 444 |
| `board/edges.ts` (ten generated border crops) | 735 |
| `board/yarn.ts` (sag geometry, springs) | 207 |
| `board/pivot.ts` (rotation about a pin) | 135 |
| **Total untouched** | **~2159** |

So it is roughly a third of the canvas tier and none of the domain. And the third it does cover
is the third with the most tests and the fewest bugs.

### The mismatch is at the model, not the API

React Flow's unit is a **node**: a box at an `{x, y}`, with `Handle`s on its edges, joined by
`Edge`s between those handles. Every one of the board's four kinds resists that:

- **An anchored pin has no position.** Its place is derived from a character offset in an
  article — resolved through exact → windowed → global → orphaned on every edit. It is a tack
  through a *word*, not a box at a coordinate, and its coordinate is an output of text
  measurement rather than an input. A React Flow node whose position is recomputed from a DOM
  range every time the prose changes is a node fighting the library that owns it.
- **A string is not an edge.** Its two ends are anchors, not handles; it has slack and sag
  physics; it renders as seeded strands of wool rather than a bezier. `yarnPath` is the only
  thing React Flow would still need to be told about, so the edge layer would be a custom edge
  type that bypasses most of what an edge type is for.
- **The article is a document, not a node.** 720px wide, reflowing, measured, projected, with
  four coordinate spaces (board, viewport, paper, article) between its corner and a tack. React
  Flow's viewport would be a fifth, or would have to become the only one.

### What is genuinely lost by not using it

Not nothing, and worth stating plainly:

- **A minimap.** Cheap in React Flow, absent here. On a large board this is the first thing
  anyone will ask for.
- **Virtualization at scale.** React Flow culls nodes outside the viewport. This board renders
  everything and would need its own culling (the roadmap's AABB pass).
- **Keyboard navigation and focus management** on nodes, which is a solved problem there.
- **A selection model** with the conventions people already know.

### When to revisit

Adopt it if the board's centre of gravity moves from *a document with things pinned to it*
toward *a graph of boxes* — or the moment a minimap and viewport culling are needed and the
1,071 lines above start being maintained rather than inherited. The seam to adopt it through
already exists: `board/camera.ts` is the only module that knows what a viewport is, and
`BoardCanvas` is the only one that reads a gesture.

## 8. Animation architecture — one writer per property

Three engines (physics, motion library, ambient CSS) will fight if allowed to. The rules:

- **One writer per property per element.** Physics owns `translate3d` on an *outer* wrapper;
  `motion` owns `opacity`/`scale`/`rotate` on an *inner* card. Different elements, so neither can
  clobber the other. `motion`'s `drag` prop must never touch a pin — it wants to own `transform`.
- **Never let `motion` own x/y on a physics element.** `MotionValue.set()` batches into motion's
  *next* frame while the canvas strokes in the *current* one, so a dragged string visibly
  rubber-bands by a frame. Use direct `el.style.transform` for anything physics or canvas reads.
  `MotionValue` is fine for UI chrome the solver never touches.
- **The canvas reads solver state, not the DOM.** Pin transform and yarn path are computed from
  the same post-step values in the same tick. Never call `getBoundingClientRect()` inside the rAF
  loop — that's forced synchronous layout every frame.
- **One clock.** A single rAF loop with a fixed-timestep accumulator, running only while
  something moves. Pause on `document.visibilityState === 'hidden'` and reset the accumulator on
  resume so nothing explodes. Never `setState` per frame.

### Reduced motion

`<MotionConfig reducedMotion="user">` at the root disables transform and layout animations while
*keeping* opacity — exactly the right degradation, for free — plus a reactive
`useSyncExternalStore` media hook and a persisted in-app override for the code paths we own (skip
the rope simulation, hold the candle steady, make camera moves instant jumps).

**Never "just slow animations down."** Slow parallax is worse for vestibular sensitivity than
fast motion; snap instead.

### Performance budget

- `transform` and `opacity` are compositor-only and unlimited — that is the entire animation
  vocabulary.
- `clip-path` repaints its subtree per frame → only for the small parchment unroll.
- **Never animate `filter` or SVG filters.** `feTurbulence` re-rasterizes every frame. Bake cork
  and paper textures once at load into an offscreen canvas or a single compressed WebP.
- Keep composited layers under ~60 and simultaneously animating elements under ~80.
- Add `will-change: transform` on `pointerdown`, remove on `pointerup`. Setting it across the
  whole pin set allocates hundreds of layers and is slower than no hint at all.

> Cull pins by board-space AABB at render time rather than virtualizing. Avoid
> `content-visibility: auto` on anything whose rect you cache — it makes `getBoundingClientRect()`
> return skipped-layout values.

---

## 9. Hosting and cost

**$0/month.**

| Piece | Service | Notes |
|---|---|---|
| App | Cloudflare Pages | Unlimited requests, free TLS, deploy on push |
| Postgres + Auth + Realtime + Storage | Supabase free | 500MB DB, 1GB storage, 50k MAU, 2M realtime messages, 200 concurrent — a D&D group uses a rounding error of this |
| Keepalive | Cloudflare Worker + Cron Trigger | Free; lives in the same repo |

**The one real catch:** Supabase pauses free projects after **7 days of inactivity**, leaving the
board dead until manually restored. Fix: a ~10-line Worker pinging the database every 3 days.

> Deliberately a *Cloudflare* cron rather than a GitHub Actions scheduled workflow: GitHub
> **disables scheduled workflows on private repos after 60 days of inactivity** — precisely the
> failure being guarded against, on precisely a private repo.

**Upgrade path** if it ever matters: Supabase Pro ($25/mo) removes pausing; a Hetzner CX23
(~€5.50/mo + €0.50 IPv4 + 19% VAT) self-hosts everything. The schema is plain Postgres and the app
is static, so migrating later is a weekend, not a rewrite.

---

## 10. Stack, layout, and build order

### Stack

Vite · React 19 · TypeScript · Tailwind v4.

Markdown via a **`unified` pipeline** — `remark-parse` → `remark-gfm` →
`remark-rehype` → `rehype-sanitize` → `rehype-react` — rather than `react-markdown` as the
primary renderer, because the anchor-index plugin must run *before* sanitize and that requires
direct control of the pipeline.

CodeMirror 6 for the editor. `motion` for enter/exit and layout. `@use-gesture/react` for camera
gestures only. Zustand for UI state — **never for board positions**. No physics engine: the rope
solver is ~40 lines, and a general engine would be slower and harder to keep in sync with the
anchor solver.

Deliberately excluded: `@react-spring/web`, GSAP, `markdown-it`.

### Layout

```
diagrams-and-dossiers/
├─ docs/architecture.md
├─ supabase/migrations/*.sql
├─ worker/                          ← keepalive cron
├─ src/
│  ├─ markdown/projection.ts        ← LAYER 1: what an offset means. Build first.
│  ├─ markdown/rehypeAnchorIndex.ts ← runs BEFORE rehype-sanitize
│  ├─ anchors/resolve.ts            ← fast-path → windowed → global → fuzzy → orphan
│  ├─ board/clock.ts                ← the single rAF loop
│  ├─ board/                        ← camera, items, yarn, groups, selection, timeline
│  ├─ realtime/                     ← channels, presence, catch-up sync
│  ├─ theme/                        ← tokens, textures, audio, motion specs
│  └─ app/
├─ e2e/
└─ public/textures/
```

### Build order

This sequence matters — the anchoring layer is the load-bearing wall.

1. **`projection.ts` + `rehypeAnchorIndex` + the DOM index**, with unit tests against adversarial
   markdown (nested lists, tables, code fences, wikilinks, footnote backlinks, CRLF). Build this
   before any UI exists.
2. Anchor create / resolve / orphan, exercised on a bare page with a fake article. No styling.
3. Schema + RLS + link-token RPCs, plus the CI leak test below.
4. Board store + clock + pin transforms, then strings on canvas.
5. Realtime broadcast, presence, catch-up, drag commit.
6. Motion layer, ambient effects, audio. Theme last.

---

## 11. Testing

Unit tests on pure functions with fixtures — the highest-value tests in the project:

- Insertion above the anchor → pin still lands on the same words
- Quoted text deleted → correctly orphaned, not silently misplaced
- Phrase wrapped in `**bold**` → offsets unchanged (the entire point of flat-text offsets)
- Paragraph split / text moved across a list boundary
- Caret collapsed mid-word → snaps to the word
- Whitespace normalization matches between the rehype plugin and the DOM walker

**A CI security test with teeth:** authenticate as a `viewer` and as a player, then assert zero
rows returned for `visibility = 'dm'`, and that a viewer's write is rejected. An automated leak
test is the only thing that keeps the DM layer honest as the schema evolves.

**Playwright acceptance test for the thesis:** pin a note to a paragraph, edit the article above
it, assert the pin still lands on the right words. Plus: draw yarn and reload; group-drag moves
every member; a view-link session cannot write; timeline scrub flies the camera.

---

## 12. Roadmap

- **Phase 0** — Private repo, Vite/React/TS scaffold, CI, Supabase project + first migration,
  link-token RPCs, deploy pipeline.
- **Phase 1 — vertical slice (the risky part).** One board, one seeded article, markdown render,
  click-to-pin producing a *real text anchor*, a note card, one yarn string, live sync between two
  browsers, and full animation for place-note / draw-yarn / unroll-article. Nothing else.
- **Phase 2 — breadth.** Case files and multi-select, marquee + lasso, DM link and timed reveals,
  theory/confirmed/disproven, dates and bulk date editing.
- **Phase 3 — timeline.** Chronology ribbon with scrub and auto-play, full-text search.
- **Phase 4 — polish.** Ambient and sound, export (board PNG + markdown vault), mobile/tablet
  read-and-quick-note, orphan re-attach UI, session history scrubber.

---

## 13. Candidate features

1. **DM link** *(part of the access model)* — secrets in the same board, invisible to players at
   the database level.
2. **Theory vs. confirmed** — charcoal pencil, wax seal, or crossed out in red. Flavor that also
   encodes real information state.
3. **Implicit threads** — auto-detect two articles mentioning the same entity and draw a *faint*
   strand the board "wants"; click to promote it to real yarn.
4. **Entity hover cards** — `[[Molgar the Pale]]` renders with a hover card everywhere it appears.
5. **Timed reveals** — `reveal_at` makes a handout appear mid-session on cue.
6. **"Previously on…" recap** — the timeline's auto-play; the feature players will use every
   session.
7. **Full-text search** across articles and notes via Postgres `tsvector`.
8. **Export** — the board as a poster PNG for the table, and the campaign as an
   Obsidian-compatible markdown vault, so nobody's notes are hostage to this app.
9. **Version history scrubber** — "the board remembers": drag back through time to see the board
   as it stood after each session.

---

## 14. Risks

1. **Anchor drift is the top risk.** Mitigated by the resolution ladder and orphan UX, but it is
   what Phase 1 exists to prove. If it cannot be made solid, the concept weakens.
2. **Scope.** This is a large app for a side project; the vertical-slice discipline is what keeps
   it from becoming a graveyard of half-built subsystems.
3. **Low-end devices at the table.** Tablets are the likely real device; the performance budget
   and reduced-motion path are not polish, they are what makes it usable.
4. **Link-based access has no per-person enforcement** — accepted deliberately; see §1.
5. **Supabase free-tier pause** — mitigated by the Worker cron.
