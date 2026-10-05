/**
 * The board that opens when you have no board.
 *
 * Seed data, kept apart from everything that reasons about it: `App.tsx` is
 * about how the board behaves, and this is only about what is on it the first
 * time. When boards become real and arrive from a server, this module is what
 * gets deleted — nothing else should have to change.
 *
 * The dates are campaign dates, and the epoch is when the party started
 * keeping notes. Sessions are a fortnight apart so the chronology ribbon has
 * something to space out.
 */

/** The page the demo board starts with. */
export const INITIAL_MARKDOWN = `# The Drowned Bell

**Session 12** — 3rd of Eleint, 1492 DR

The party returned to Saltmarsh with the bell they pulled from the
Sea Ghost. Molgar the Pale paid the ferryman in
silver and said nothing at all about the water.

## What we know

- The bell rings at low tide, though no hand touches it
- Three dockworkers have gone missing since the harvest festival
- The harbormaster's ledger lists a fourth name, scratched out

> "The tide keeps what it takes," the ferryman said.

The Black Coin came up twice: once from the ferryman,
and once in the ledger, in a hand nobody recognised.
`

export const ARTICLE_TITLE = 'The Drowned Bell'

/**
 * The article the demo board renders.
 *
 * A fixed id rather than a generated one because there is exactly one article
 * and pins must be able to name it — an anchored pin stores `articleId`, and
 * that has to survive a reload once persistence lands.
 */
export const ARTICLE_ID = 'the-drowned-bell'

/** When the campaign began. Dates on the board count forward from here. */
export const CAMPAIGN_EPOCH = Date.UTC(2026, 0, 10)

/** How far apart two sessions are, which is what spaces the chronology out. */
export const SESSION_GAP_MS = 14 * 24 * 60 * 60 * 1000

/**
 * The number of the first session the board knows about.
 *
 * Not zero, because the party had been at sea for eleven of them before anyone
 * thought to write anything down — and a board whose first note is "Session 1"
 * is a board with no history.
 */
export const FIRST_SESSION = 12
