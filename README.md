# The Case Board

A private, collaborative detective board for a D&D group. Pin notes and long-form markdown
articles to a shared corkboard, connect them with colored yarn, and read the same content as a
conventional wiki when you'd rather not use the board view.

The whole thing is dressed as a fantasy detective's office: cork and parchment, brass tacks, wax
seals, candlelight, and enchanted yarn that glows faintly. Pinning a note looks like pinning a
note.

## Status

**Design phase.** The architecture is written and committed; no application code yet.
See [`docs/architecture.md`](docs/architecture.md) for the full design.

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

Not yet scaffolded — see the build order in
[§10 of the architecture](docs/architecture.md#10-stack-layout-and-build-order). The first thing
built is the markdown offset projection layer, because every pin depends on it.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — access model, anchoring algorithm, data model,
  realtime, animation architecture, hosting
