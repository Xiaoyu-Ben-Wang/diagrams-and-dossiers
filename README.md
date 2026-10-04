# The Case Board

A private, collaborative detective board for a D&D group. Pin notes and long-form markdown
articles to a shared corkboard, connect them with colored yarn, and read the same content as a
conventional wiki when you'd rather not use the board view.

The whole thing is dressed as a fantasy detective's office: cork and parchment, brass tacks, wax
seals, candlelight, and enchanted yarn that glows faintly. Pinning a note looks like pinning a
note.

## Status

**Phase 1, in progress.** The architecture is written and committed, and the load-bearing piece
— text anchoring — is built and tested. A demo board renders a real markdown article where you
can pin any word, edit the article around it, and watch the pin find its way back.

Not yet built: accounts, persistence, realtime, yarn, the timeline. See
[`docs/architecture.md`](docs/architecture.md) for the full design.

## What it does

- **Articles** — long-form markdown, rendered as parchment pinned to the board
- **Pins** — attach a note to *any position inside* an article; the pin finds its way back to the
  right words even after the article is edited
- **Yarn** — draw colored strings between pins, with realistic sag and physics
- **Case files** — lasso items to move them together, or save a named, datable group
- **Timeline** — scrub the campaign chronology and the board flies to that moment; press play for
  a "previously on…" recap
- **Wiki view** — the same content as a readable wiki, with backlinks
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
npm test           # 48 tests over the anchoring layer
npm run typecheck
```

**Try the thesis:** click a word in the article to pin it, then press *Insert a sentence above*.
The pin moves with its words and stays brass-coloured. Press *Delete the pinned sentence* and the
pin goes red and drops into the loose-pins tray rather than silently landing somewhere wrong.

### Where things live

| Path | What it is |
|---|---|
| `src/markdown/projection.ts` | What an "offset" means. Both sides of the system use this, so they cannot disagree. |
| `src/anchors/create.ts` | Turning a click into an anchor, including word snapping. |
| `src/anchors/resolve.ts` | The resolution ladder: exact → windowed → global → orphaned. |
| `src/anchors/dom.ts` | The bridge to real DOM nodes, and the block-separator rule. |
| `src/App.tsx` | The demo board. |

Start with `projection.ts` — everything else depends on the definition it sets.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — access model, anchoring algorithm, data model,
  realtime, animation architecture, hosting
