# The demo site

This branch is the built board, served by GitHub Pages at
<https://xiaoyu-ben-wang.github.io/diagrams-and-dossiers/>. It is generated,
not edited: nothing here is a source file.

## The layout

The app is not at this branch's root. `demo/index.html` is the app, the `assets`
it names are at the root, and the root `index.html` is a redirect to `./demo` —
which is why the build's base is the site root and not `/demo/`. Do not flatten
this: `cp -r dist/*` at the root would put the app back at `/` and undo the
`/demo` address.

## Publishing an update

The source is the `demo-source` branch, which follows `main`. The demo is `main`
built with `VITE_LOCAL_ONLY=true`: boards stay in the browser, there is no
sharing or join link, and the board list says so. The Supabase variables are
blanked as well, so the project's address is not in the bundle at all —
`.env.local` would otherwise put it there.

```
VITE_LOCAL_ONLY=true VITE_SUPABASE_URL= VITE_SUPABASE_PUBLISHABLE_KEY= \
  pnpm exec vite build --base=/diagrams-and-dossiers/ --outDir <out>
cd /path/to/a/checkout/of/this/branch/
rm -rf assets demo/index.html
cp -r <out>/assets assets
cp <out>/index.html demo/index.html
cp <out>/favicon.svg favicon.svg
touch .nojekyll && git add -A
git commit --no-verify -m "Demo: <what changed>" && git push
```

`--no-verify` matters: the repository's pre-commit hook runs Prettier over
staged `.js` and `.css`, and on this branch that reflows the minified bundle.

Two files here are not the build's and must be left alone: the root `index.html`
(the redirect) and `404.html`, which sends a deep link to `/demo` rather than to
the root. The build's own `404.html` points at the root; copying it over costs a
hop through the redirect.

Push it sparingly. Pages serves this branch directly — there is no workflow, so
an update costs no Actions minutes, but every push is a rebuild of the site and
a fresh link for anyone looking at it.

## Settings

Pages must be set to **Deploy from a branch → `demo` → `/` (root)**. If it is
set to "GitHub Actions" instead, GitHub builds via a workflow and this branch is
ignored. `.nojekyll` is what stops the Jekyll build, which is the only slow part
of a branch deploy.

## The base path

The site is served from a subpath, so the build carries
`--base=/diagrams-and-dossiers/`. The router reads that base back off
`import.meta.env.BASE_URL` (`src/app/router.ts`), which is what lets the board
be found at `/diagrams-and-dossiers/` rather than at `/`.
