# Diagrams & Dossiers

A private, collaborative detective board for a D&D group. Long-form markdown articles are pinned
to a corkboard, notes go on tacks, and red yarn runs between them — dressed as a fantasy
detective's office, because that is what it is.

**[Open the demo board →](https://xiaoyu-ben-wang.github.io/diagrams-and-dossiers/demo)**

## Development

```bash
pnpm install
pnpm dev
pnpm test
```

## Deploying

A static bundle behind a Cloudflare Worker, configured in `wrangler.jsonc`. Workers serves `dist/`
at the root, and `not_found_handling: "single-page-application"` is what lets a reloaded
`/b/<id>` or a pasted `/j/<token>` reach the app instead of 404ing. Do not add a
`public/_redirects` — Workers reads it, and rejects the SPA rule as an infinite loop.

Workers Builds, connected to this repository:

| Setting        | Value                 |
| -------------- | --------------------- |
| Build command  | `pnpm build`          |
| Deploy command | `npx wrangler deploy` |

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as **build** variables. Vite inlines
them into the bundle, so a runtime variable or `wrangler secret put` is silently useless: the build
succeeds, and boards fall back to one device, with no share link to give anyone.

From a machine:

```bash
npx wrangler login   # once
pnpm build
pnpm exec wrangler deploy
```

### Pictures (R2)

Pictures dropped on a board that lives on the server are uploaded through the Worker
(`worker/`) into an R2 bucket and served from `/images/<board>/<sha256>.<ext>`. Local
boards, the dev server and the GitHub Pages build have no Worker, so their pictures stay
inline as data URLs. Once per account:

```bash
pnpm exec wrangler r2 bucket create diagrams-and-dossiers-images
```

Then set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as **runtime** variables on the
Worker (same values as the `VITE_` build variables). The Worker uses them to ask Supabase
whether the uploader can edit the board. `keep_vars` in `wrangler.jsonc` stops a deploy
from wiping them.

### Database

Apply `supabase/migrations` in order (`supabase db push`, or paste each into the SQL
editor). `0011` adds private/shared boards; `0012` needs the `pg_cron` extension, which
it enables, and schedules an hourly snapshot job for version history.

`wrangler` is a devDependency so the deploy runs on the version this repository was tested
against, and `pnpm exec wrangler deploy --dry-run` checks the configuration without deploying.

The GitHub Pages deployment is the other one, and it serves from a subpath, so it is built with a
different `base`. The two are not interchangeable: a Pages build handed to the Worker asks for its
assets under `/diagrams-and-dossiers/` and renders a blank page.
