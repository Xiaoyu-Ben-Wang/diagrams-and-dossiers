# The demo site

This branch is the built board, served by GitHub Pages at
<https://xiaoyu-ben-wang.github.io/dossiers-and-diagrams/>. It is generated,
not edited: nothing here is a source file.

## Publishing an update

From the source branch, with the working tree in the state you want to publish:

```
npm run build -- --base=/dossiers-and-diagrams/
cp -r dist/* /path/to/a/checkout/of/this/branch/
touch .nojekyll && git add -A && git commit -m "Demo: <what changed>" && git push
```

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
`--base=/dossiers-and-diagrams/`. The router reads that base back off
`import.meta.env.BASE_URL` (`src/app/router.ts`), which is what lets the board
be found at `/dossiers-and-diagrams/` rather than at `/`.
