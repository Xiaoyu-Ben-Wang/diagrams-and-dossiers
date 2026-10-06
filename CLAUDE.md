# Working on Dossiers & Diagrams

## Check the feature queue first

**[`FEATURES.md`](./FEATURES.md) is the queue of things asked for and not yet done.** Read it at
the start of a session. It holds the specific requests, with the context needed to pick one up
without reconstructing the conversation — and, at the bottom, the things that have already been
decided against, so they do not get re-litigated.

When a new feature is requested, add it to the queue rather than only holding it in the
conversation. Move an item out when it is done.

## Where things are

| | |
|---|---|
| `docs/architecture.md` | the design, and the reasoning behind it. §7b is why the canvas is home-made. |
| `FEATURES.md` | what has been asked for and not done |
| `src/model/` | the entity union, the kind registry, article options |
| `src/anchors/` | text anchoring: the quote/position selectors and the resolution ladder |
| `src/board/` | the canvas: camera, gestures, yarn, edges, and the entity components |
| `supabase/migrations/` | the schema. Designed for, not yet wired. |

## How this codebase wants to be worked on

- **Verify in a browser.** The unit suite is 612 tests under jsdom, which has no layout engine. Real
  bugs live in the seams between measurement and rendering and jsdom cannot see them: the
  `pointer-events` bug that stopped a string being dragged from a pin, the marquee band that
  selected correctly and was then cleared by the browser's trailing click, and a 1.31× scale error
  in `rangeToContainerRects` that put every pin 140px from its word were all invisible to 490
  passing tests. Probe scripts driving real mouse input live in `/tmp/yarn2/`.
- **A failing probe is as likely to be the probe.** Off-screen coordinates, a cached canvas rect
  that went stale when the editor opened, and pressing a circular element's bounding-box corner
  have each cost more time than the bug being chased. Check the harness before the code.
- **Comments are for what the code cannot say.** One or two lines, only where deleting them
  would let somebody break something without noticing: a browser or jsdom quirk, a value pinned
  in another file, an ordering that matters. No history, no rationale essays, no restating the
  code. The decision and the alternative it was chosen over belong in the commit message,
  which is where they can be read without opening the file.
- **Do not add a dependency without a reason that survives being written down.** Four runtime
  dependencies; `FEATURES.md` records what was considered and rejected, and why.
