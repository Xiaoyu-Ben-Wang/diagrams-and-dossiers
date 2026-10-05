# The Case Board

A private, collaborative detective board for a D&D group. Pin notes and long-form markdown
articles to a shared corkboard and connect them with red yarn.

The whole thing is dressed as a fantasy detective's office: cork and parchment, brass tacks, wax
seals, candlelight, and enchanted yarn that glows faintly. Pinning a note looks like pinning a
note.

## Status

**Phase 1, in progress.** The architecture is written and committed, and the front-end core is
built: text anchoring, yarn, the camera, and the chronology ribbon.

A demo board renders a real markdown article where you can pin any word, drag yarn between pins,
scrub the campaign chronology, and watch pins find their way back when you edit the article
around them.

Not yet built: accounts, persistence, realtime, and case files.
See [`docs/architecture.md`](docs/architecture.md) for the full design.

## What it does

- **Articles** — long-form markdown, rendered as parchment pinned to the board
- **Pins** — attach a note to *any position inside* an article; the pin finds its way back to the
  right words even after the article is edited
- **Yarn** — draw strings between pins, with realistic sag and physics; click one to select it and
  drag its bead to tighten or loosen it
- **Case files** — lasso items to move them together, or save a named, datable group
- **Timeline** — scrub the campaign chronology and the board flies to that moment; press play for
  a "previously on…" recap
- **DM layer** — a separate link that reveals content players cannot see, enforced in the database

## Access

Google-Docs-style links, for trusted groups. Each board mints up to three:

| Link | Grants |
|---|---|
| View | read-only |
| Edit | read + write |
| DM | edit, plus DM-only content and link management |

A separate **creator invite** grants the right to create boards of your own.

Anyone with a link is in, and can pass it on — revocation means rotating the link. That's a
deliberate trade for a close group, not a public app. See
[§1 of the architecture](docs/architecture.md#1-access-model--link-based-capability-granting).

## Hosting

Runs at **$0/month** on Cloudflare Pages (app) and the Supabase free tier (Postgres, auth,
realtime), with a small Cloudflare Worker on a cron trigger to keep the free database from
pausing after 7 days idle.

## Stack

React 19 · TypeScript · Vite · Tailwind v4 · Supabase · `motion` · CodeMirror 6

## Development

```bash
npm install
npm run dev        # the demo board at localhost:5173
npm test           # 567 tests
npm run typecheck
```

**Navigation is Miro-shaped:**

| Gesture | Does |
|---|---|
| Scroll | Zoom, anchored at the cursor |
| Right-drag or middle-drag | Pan |
| Right-click a pin | Write on it |
| Left-click a word | Pin it |
| Drag tack → tack | Run yarn |
| Middle-drag a pin, note or the paper | Move that thing, rather than the board |
| Click a string | Select it; drag its arrow up or down to tighten or loosen it |
| Drag a pin onto other words | Re-pin it to those words; onto the cork, and it is pulled out |
| Drop or paste an image file | Pin the picture up where it lands |
| Select a picture or the page, then drag the ↻ handle | Swing it up to 45° about its pin |
| Click a picture | Open its border bar — clean, burnt, stamped, torn, deckled, scalloped, scorched, frayed, nibbled, chipped |
| Drag a selected picture's corner | Resize it, keeping its shape and its pin |
| Right-click a picture, or select it and press Delete | Take it off the board |

**Try the thesis:** click a word in the article to pin it, then press *Insert a sentence above*.
The pin moves with its words and stays brass-coloured. Press *Delete the pinned sentence* and the
pin goes red and drops into the loose-pins tray rather than silently landing somewhere wrong.

Right-drag and right-click share a button, so they're told apart by travel: a press that moves
more than 5px pans, one that doesn't opens the note.

**Try the yarn:** drag from one brass tack to another. The string trails your cursor with spring
lag, then sags.

**Try the chronology:** each pin you place lands a session later than the last. Scrub the tape, or
press *Play recap* to walk the campaign a session at a time. Pins the party wouldn't know about yet
dim out. Yarn does not: a faded line on a chunky tack still reads, but a 2px one at that opacity is
simply gone, and a board whose strings vanish is worse than one that shows a connection early.

### Where things live

| Path | What it is |
|---|---|
| `src/markdown/projection.ts` | What an "offset" means. Both sides of the system use this, so they cannot disagree. |
| `src/anchors/create.ts` | Turning a click into an anchor, including word snapping. |
| `src/anchors/resolve.ts` | The resolution ladder: exact → windowed → global → orphaned. |
| `src/anchors/dom.ts` | The bridge to real DOM nodes, and the block-separator rule. |
| `src/board/BoardCanvas.tsx` | The infinite canvas: wheel zoom, right/middle pan, context clicks. |
| `src/board/yarn.ts` | Rope sag, bezier control points, the slack↔sag inverse, springs. |
| `src/board/yarn-style.ts` | Wool geometry: the strand fan, its noise field, and the geometry cache. |
| `src/board/camera.ts` | The board/screen transform and fit-bounds framing. |
| `src/board/PinEditor.tsx` | The note card behind a pin. |
| `src/board/timeline.ts` | Ordering, scrubbing, and session clustering. |
| `src/board/TimelineRibbon.tsx` | The tape strip. |
| `src/theme/motes.ts` | Dust and candle flicker, as pure simulation. |
| `src/App.tsx` | The demo board. |

Start with `projection.ts` — everything else depends on the definition it sets.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — access model, anchoring algorithm, data model,
  realtime, animation architecture, hosting
