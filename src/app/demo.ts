/**
 * The board that opens when you have no board.
 *
 * Seed data, kept apart from everything that reasons about it: `App.tsx` is
 * about how the board behaves, and this is only about what is on it the first
 * time. When boards become real and arrive from a server, this module is what
 * gets deleted — nothing else should have to change.
 *
 * What is on it is a case file in progress, not a sampler: four documents, the
 * pictures somebody brought to the table, and the margin notes and tacks that
 * connect them. It is deliberately crowded. A demo board is the only board
 * anybody sees before they have made one, so it doubles as the place a bug in
 * any of the drawing shows up first — and a board with one of everything, spaced
 * politely apart, hides exactly the bugs a board is prone to. Sheets overlap a
 * post-it; a string crosses a page; the same note is tied to two things and a
 * label hangs along the rope rather than at its middle. None of that is
 * decoration, and all of it is load-bearing when something regresses.
 *
 * Deliberately not every kind in equal numbers, but *some of each with a
 * description and some without*, because the board draws those two cases
 * differently: a tack with something written on it wears a ring, and a note
 * with something written on it is the whole point of a note. Two of the four
 * pages hang straight, one is swung and one is rolled up; every picture has a
 * different damaged border and one is drawn `contain`. A demo where everything
 * looks the same is a demo that shows nothing.
 *
 * The dates are campaign dates, and the epoch is when the party started
 * keeping notes. Sessions are a fortnight apart, which is the unit a new
 * entity's date label is counted in.
 *
 * The one state still missing is an *anchored* pin — a tack through a word
 * rather than into the cork — and it is missing for a real reason rather than
 * an oversight. An anchor is a quote plus character offsets into an article's
 * flat text, and the flat text only exists once the markdown has been rendered
 * and the DOM walked, which has not happened at seed time. Writing stale
 * offsets would open the board reporting every pin as repaired after an edit
 * that never happened. See `docs/feature-queue-archive-2026-10-05.md` #10.
 */

import type { BoardState } from '../board/store'
import { POST_IT_COLORS } from '../board/tuning'
import { DEFAULT_SLACK, YARN_COLOR } from '../board/yarn'
import { DEFAULT_ARTICLE_OPTIONS } from '../model/article-options'
import { newArticle, newFreePin, newImage, newNote } from '../model/create'
import type { BoardEntity, StringLink } from '../model/types'
import { COIN_RUBBING, MARSH_MAP, TORN_LEAF } from './demo-pictures'

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
@[The Black Coin] was rubbed onto paper before anyone
thought to ask why.
`

export const ARTICLE_TITLE = 'The Drowned Bell'

/**
 * The demo page's id.
 *
 * Fixed rather than generated, and it stays fixed now that a board can hold
 * more than one page: it is what a string tied to the page is keyed by and what
 * an anchored pin stores, so a reload has to land on the same page — and so
 * does anyone who wrote the id down while chasing a bug.
 */
export const ARTICLE_ID = 'the-drowned-bell'

export const SECOND_ARTICLE_ID = 'the-harbormasters-ledger'

export const THIRD_ARTICLE_ID = 'the-ferrymans-account'

export const FOURTH_ARTICLE_ID = 'the-sea-ghosts-manifest'

/**
 * The pages the board opens with, in the order they are laid out.
 *
 * Four rather than one, and rather than two. One page cannot show what changed
 * — a projection shared between pages and a projection per page are the same
 * program — and two only just can. Four is where per-page width, per-page
 * tilt, and a page that has been rolled up are all on screen at once, which is
 * the configuration a board of several documents actually is.
 *
 * Deliberately different widths, and deliberately different lengths. The pages
 * reflow differently under the same edit, which is the thing a per-article
 * width has to prove.
 */
export const ARTICLE_IDS = [
  ARTICLE_ID,
  SECOND_ARTICLE_ID,
  THIRD_ARTICLE_ID,
  FOURTH_ARTICLE_ID,
] as const

export const SECOND_ARTICLE_TITLE = "The Harbormaster's Ledger"

export const SECOND_MARKDOWN = `# The Harbormaster's Ledger

**Recovered from the Sea Ghost**, water-stained, three leaves torn out.

- Twelve sailings between the festival and the new moon
- Four of them entered in a second hand
- The fourth name is scratched through, not struck out

> "Kestrel. Kestrel. *Kestrel.*" — the same word, three times,
> in three inks.

Whoever kept this book wanted one of those names read.`

export const THIRD_ARTICLE_TITLE = "The Ferryman's Account"

/**
 * Shorter than the first two on purpose, and the reason is the camera rather
 * than the fiction. The opening view frames everything on the board, so the
 * board's bounding box decides how large the text opens — and on a wide screen
 * the *height* is what binds. This page sits in the lower row, where every line
 * of it pushes the whole board down; written as long as the session notes it
 * would open every page a third smaller. Kept to the length the layout can
 * afford.
 */
export const THIRD_MARKDOWN = `# The Ferryman's Account

**Taken at the ferry dock**, the morning after the bell came up.

> "I rowed him out at slack water. He had a chest with him and
> would not let me touch it. Coming back the chest was gone, and
> the coin was on the seat where it had been."

Pressed on which dock he used, he named all three and then none.
All three are on @[The Saltmarsh Map], and none of them agree
with @[The Harbormaster's Ledger] about the tide.

He said *Kestrel* once, and **Sea Ghost** twice, quieter the
second time.`

export const FOURTH_ARTICLE_TITLE = "The Sea Ghost's Manifest"

export const FOURTH_MARKDOWN = `# The Sea Ghost's Manifest

**Cargo taken on at Leilon**, three days before the new moon.

- Twelve crates of salt, consigned to the harbormaster
- Four barrels, unmarked, consigned to nobody
- One chest, listed only as *sundries*

The mate's hand is steady until the third entry, where it is not.`

/**
 * Where each page lies, in board px.
 *
 * The pages are the board's furniture, so their layout is fixed here and
 * everything else is arranged around it. Two across the top and two down, but
 * not a grid: the camera frames everything on the board when it opens, so the
 * board's bounding box is what decides how large the text opens, and the
 * shape that wastes least of a wide screen is a wide one. The second row
 * therefore holds the shortest document and the rolled-up one — a strip needs
 * almost no height — rather than repeating the row above it.
 *
 * No two pages share an x, for the reason the `POINTS` table gives below.
 */
const PAGE_AT = {
  [ARTICLE_ID]: { x: 0, y: 0 },
  [SECOND_ARTICLE_ID]: { x: 880, y: -70 },
  [THIRD_ARTICLE_ID]: { x: 60, y: 780 },
  [FOURTH_ARTICLE_ID]: { x: 980, y: 800 },
} as const

/** The width each page opens at. Narrower as the documents get more private. */
const PAGE_WIDTH = {
  [ARTICLE_ID]: DEFAULT_ARTICLE_OPTIONS.width,
  [SECOND_ARTICLE_ID]: 520,
  [THIRD_ARTICLE_ID]: 500,
  [FOURTH_ARTICLE_ID]: 560,
} as const

/**
 * A campaign date, `session` sessions in.
 *
 * The board stores a stamp and a label rather than a formatted date, because
 * the campaign's calendar is not this one: "3rd of Eleint" is a fact about the
 * fiction, and a formatter that turned the timestamp into a Gregorian string
 * would be inventing a second, wrong answer.
 */
function dateAt(session: number): { occurredAt: number; dateLabel: string } {
  return {
    occurredAt: CAMPAIGN_EPOCH + session * SESSION_GAP_MS,
    dateLabel: `Session ${session}, 1492 DR`,
  }
}

/**
 * A constructor's default, overridden to a state only a gesture reaches.
 *
 * `newArticle` opens a page hanging straight and `newNote` cuts a square of
 * paper, because that is what those things are before anyone has touched them.
 * The demo's job is to show the states a board arrives at through use — a page
 * swung 3 degrees, a note stretched to fit a long sentence — so the seed has to
 * move past the default. Written as a named helper rather than a spread at each
 * call site so that "the demo is allowed to look used, not new" is said once,
 * where someone reading `demoBoard` will see it.
 */
function used<T extends object>(entity: T, overrides: Partial<T>): T {
  return { ...entity, ...overrides }
}

/**
 * The pages, on their own.
 *
 * Split out from `demoBoard` because it is the part a test wants: the pages are
 * what the board's behaviour is *about* — where a pin anchors, which projection
 * a quote resolves against, which page a tilt belongs to — and the notes and
 * string lying around them are content, which only gets in the way of counting
 * things. Exported rather than rebuilt in the test file so there is one
 * definition of the demo pages.
 *
 * The fourth is rolled up (`collapsed`). That is a page with its body hidden and
 * only its tab showing, and it is here because the demo is the only place a
 * person meets that state before they make it themselves: a `collapsed` page is
 * still a page — it can be selected, moved, tied to and opened — and a board of
 * them is not a board of empty sheets.
 */
export function demoPages(): BoardEntity[] {
  return [
    newArticle(PAGE_AT[ARTICLE_ID], INITIAL_MARKDOWN, ARTICLE_TITLE, {
      ...DEFAULT_ARTICLE_OPTIONS,
      width: PAGE_WIDTH[ARTICLE_ID],
    }, { id: ARTICLE_ID }),
    // The one swung page. It is here rather than on one of the others because
    // this is the sheet a string is tied to from the margin, and a tack's
    // place on a tilted page is measured through the page's own transform —
    // the seam `docs/feature-queue-archive-2026-10-05.md` #6 is about. Negative is anticlockwise.
    used(
      newArticle(
        PAGE_AT[SECOND_ARTICLE_ID],
        SECOND_MARKDOWN,
        SECOND_ARTICLE_TITLE,
        { ...DEFAULT_ARTICLE_OPTIONS, width: PAGE_WIDTH[SECOND_ARTICLE_ID] },
        { id: SECOND_ARTICLE_ID },
      ),
      { rotation: -3.4 },
    ),
    // Left hanging straight, like the first. Two of the four page states are
    // "square", so the two that are not — swung, rolled up — read as choices
    // somebody made rather than as the board's only look.
    newArticle(
      PAGE_AT[THIRD_ARTICLE_ID],
      THIRD_MARKDOWN,
      THIRD_ARTICLE_TITLE,
      { ...DEFAULT_ARTICLE_OPTIONS, width: PAGE_WIDTH[THIRD_ARTICLE_ID] },
      { id: THIRD_ARTICLE_ID },
    ),
    used(
      newArticle(
        PAGE_AT[FOURTH_ARTICLE_ID],
        FOURTH_MARKDOWN,
        FOURTH_ARTICLE_TITLE,
        {
          ...DEFAULT_ARTICLE_OPTIONS,
          width: PAGE_WIDTH[FOURTH_ARTICLE_ID],
          collapsed: true,
        },
        { id: FOURTH_ARTICLE_ID },
      ),
      { rotation: -1.6 },
    ),
  ]
}

/**
 * Where everything that is not a page lies, in board px.
 *
 * Pulled out to one table because the layout is a single composition and it is
 * read by eye in the browser, not derived: nobody can tell from a call site
 * whether `{ x: 1620, y: 40 }` collides with a page. The names say what the
 * thing is; the numbers say where it was put, and the only way to know if that
 * was right is to look at the board.
 *
 * No two of these share an x, and neither does any page. That is not tidiness:
 * two things at the same x are two things stacked in a column, and a demo where
 * a misplaced entity lands on top of another one looks the same as a demo where
 * it is where it belongs. `demoBoard`'s own test asserts the spread, so the
 * rule is enforced rather than remembered.
 */
const POINTS = {
  /* Down the left margin, in the order they were written. */
  price: { x: -360, y: 30 },
  missing: { x: -490, y: 240 },
  blank: { x: -370, y: 450 },
  fourth: { x: -540, y: 660 },
  map: { x: -660, y: 900 },
  tide: { x: -390, y: 1180 },
  /* Over the first page's lower corner — see the note on `ebb`. */
  ebb: { x: 640, y: 620 },
  /* Under the ledger, where the second row of pages left a hole. */
  ferryman: { x: 1020, y: 940 },
  blankToo: { x: 1180, y: 1120 },
  leaf: { x: 1420, y: 1180 },
  /* The right-hand column: what was brought to the table, then the tacks. */
  rubbing: { x: 1700, y: 40 },
  kestrel: { x: 1500, y: 300 },
  ink: { x: 1640, y: 410 },
  loose: { x: 1540, y: 520 },
  seal: { x: 1680, y: 630 },
  quiet: { x: 1560, y: 740 },
  name: { x: 1480, y: 850 },
  burned: { x: 1660, y: 960 },
  quietToo: { x: 1520, y: 1080 },
} as const

/**
 * What is on the board the first time it is opened.
 *
 * A function rather than a constant so each call builds fresh entities: a
 * literal array would be one object shared by every store ever created from it,
 * and the first in-place edit would be visible in the next test. It is also why
 * the strings are built here from the notes' own ids rather than from constants
 * — the ids are minted on the line above them.
 *
 * The board is laid out the way someone would have laid it out by hand: the
 * pages across the middle, the things written about them down the left margin,
 * the loose tacks off to the right, the things that were brought to the table
 * wherever they would not cover anything up, and the yarn crossing between them
 * all. That is not decoration. A board whose demo content all sits at the
 * origin hides exactly the bugs the layout would show — a string tied to the
 * wrong page, a tack resolved against the wrong sheet — because everything
 * overlaps and a misplacement is invisible.
 *
 * The three pictures are the only place the demo exercises `ImageCard`: the
 * torn, burnt and deckled borders, the swing about the pin, and the `contain`
 * fit. Without them a whole kind of entity, and the whole of `edges.ts`, is
 * reachable only by dragging a file in.
 */
export function demoBoard(): BoardState {
  const [bell, ledger, account, manifest] = demoPages()

  /* The margin: what the party has written down about the documents. */
  const price = newNote(POINTS.price, {
    ...dateAt(12),
    color: POST_IT_COLORS[0],
    bodyMd: 'He named a price before anyone asked him. Ask who paid it.',
  })
  const missing = newNote(POINTS.missing, {
    ...dateAt(13),
    color: POST_IT_COLORS[1],
    bodyMd: 'Three dockworkers, all since the festival. Get the names.',
  })
  // No description: what a note looks like before anyone has written on it.
  const blank = newNote(POINTS.blank, { ...dateAt(13), color: POST_IT_COLORS[2] })
  // A note carrying more than a post-it's worth, so its own size is in play:
  // the square of paper is a default, and a real board has notes stretched to
  // fit the sentence. `newNote` cuts the default square; this one is dragged
  // wider, which is the only way a note's `width`/`height` are ever set.
  const fourth = used(
    newNote(POINTS.fourth, {
      ...dateAt(13),
      color: POST_IT_COLORS[3],
      // The one status on the board that is not `theory`. Status is stored and
      // round-trips, but nothing draws it yet — see the queue archive — so this is
      // here to keep the schema honest rather than to change the picture.
      status: 'confirmed',
      bodyMd: 'The fourth name is scratched, not struck. A different hand, and a different knife.',
    }),
    { width: 210, height: 150 },
  )
  const tide = newNote(POINTS.tide, {
    ...dateAt(14),
    color: POST_IT_COLORS[0],
    bodyMd: 'Low tide twice a day. The bell rings at one of them.',
  })
  const blankToo = newNote(POINTS.blankToo, { ...dateAt(14), color: POST_IT_COLORS[1] })
  const ferryman = newNote(POINTS.ferryman, {
    ...dateAt(15),
    color: POST_IT_COLORS[2],
    bodyMd: 'The ferryman knew the chest before he saw it.',
  })
  // Deliberately lying across the first page's lower corner rather than beside
  // it. A post-it stuck *over* a sheet is the ordinary case on a real board,
  // and it is the one that tells you whether the layers are ordered right — a
  // note hidden behind the paper is invisible here and only here.
  const ebb = newNote(POINTS.ebb, {
    ...dateAt(15),
    color: POST_IT_COLORS[3],
    bodyMd: 'It came up on the ebb. Nothing comes up on the ebb.',
  })

  /* The right-hand side: tacks in the cork, and what was brought to the table. */
  const kestrel = newFreePin(POINTS.kestrel, {
    ...dateAt(13),
    bodyMd: 'Kestrel is a ship. The Sea Ghost was a ship.',
  })
  const ink = newFreePin(POINTS.ink, {
    ...dateAt(14),
    bodyMd: 'Three inks in one entry — three people wrote in this book.',
  })
  // No description, the other way round from the note above: a tack with
  // nothing on it, which is what most tacks on a board are.
  const loose = newFreePin(POINTS.loose, dateAt(14))
  const seal = newFreePin(POINTS.seal, {
    ...dateAt(15),
    bodyMd: 'The coin is a seal, not money. Somebody’s mark.',
  })
  const quiet = newFreePin(POINTS.quiet, dateAt(15))
  const name = newFreePin(POINTS.name, {
    ...dateAt(16),
    bodyMd: 'Nobody writes their own name last.',
  })
  const burned = newFreePin(POINTS.burned, {
    ...dateAt(16),
    bodyMd: 'Ask the harbormaster what he burned.',
  })
  // A DM-only tack: the board's owner sees it, a player's board would not. It
  // is here because the visibility column is real and the demo is all one
  // viewer — the day there is a second, this is the entity that proves the
  // filter is wired rather than merely declared.
  const quietToo = newFreePin(POINTS.quietToo, {
    ...dateAt(16),
    visibility: 'dm',
    bodyMd: 'He is lying about the third dock. Do not say so yet.',
  })

  const map = used(
    newImage(POINTS.map, MARSH_MAP, { width: 320, height: 240 }, {
      title: 'The Saltmarsh Map',
      alt: 'A hand-drawn map of the Saltmarsh approaches',
      edge: 'torn',
      bodyMd: 'The drowned road runs to the third dock.',
    }),
    { rotation: -6 },
  )
  const rubbing = used(
    newImage(POINTS.rubbing, COIN_RUBBING, { width: 220, height: 220 }, {
      title: 'The Black Coin',
      alt: 'A charcoal rubbing of the Black Coin',
      edge: 'burnt',
      // `contain`, so the round rubbing is not cropped square by `cover` — the
      // whole point of the picture is the device in the middle of it.
      fit: 'contain',
      bodyMd: 'Rubbed from the coin while the harbormaster was out.',
    }),
    { rotation: 7 },
  )
  const leaf = used(
    newImage(POINTS.leaf, TORN_LEAF, { width: 300, height: 200 }, {
      title: 'The Ledger Leaf',
      alt: 'One of the ledger’s torn-out leaves',
      edge: 'deckled',
      bodyMd: 'A leaf from the ledger — the hand changes halfway down.',
    }),
    { rotation: -8 },
  )

  const strings: StringLink[] = [
    {
      id: 'yarn-price',
      from: price.id,
      to: bell.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: 'solid',
      label: 'Molgar paid him',
      labelAt: 0.25,
      visibility: 'shared',
    },
    {
      id: 'yarn-missing',
      from: missing.id,
      to: ledger.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: 'solid',
      // No label: a string that just says "these two are connected" is a thing
      // a board is mostly made of.
      labelAt: 0.5,
      visibility: 'shared',
    },
    {
      id: 'yarn-ink',
      from: kestrel.id,
      to: ink.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: 'solid',
      labelAt: 0.5,
      visibility: 'shared',
    },
    {
      // The label sits off the middle, because a tag hanging dead centre is the
      // one position it can be read from — and a board where every tag is at the
      // middle is a board whose labels were never moved.
      id: 'yarn-fourth',
      from: fourth.id,
      to: ledger.id,
      slack: 0.3,
      color: YARN_COLOR,
      style: 'solid',
      label: 'a third hand',
      labelAt: 0.12,
      visibility: 'shared',
    },
    {
      id: 'yarn-account',
      from: ferryman.id,
      to: account.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: 'solid',
      label: 'he never opened it',
      labelAt: 0.3,
      visibility: 'shared',
    },
    {
      // A tack tied to a document. It used to run from the ferryman note to
      // this tack, which said nothing: the note is already tied to his
      // statement, and a second string from the same note to a tack picked out
      // for the rhyme rather than for a reason is a line that has to be
      // explained. Tied to the manifest it earns its place — the barrels are
      // "consigned to nobody", which is what the tack is about.
      id: 'yarn-sundries',
      from: name.id,
      to: manifest.id,
      slack: 0.1,
      color: YARN_COLOR,
      style: 'solid',
      label: 'consigned to nobody',
      labelAt: 0.5,
      visibility: 'shared',
    },
    {
      id: 'yarn-tide',
      from: tide.id,
      to: bell.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: 'solid',
      label: 'which of the two?',
      labelAt: 0.16,
      visibility: 'shared',
    },
    {
      id: 'yarn-burned',
      from: burned.id,
      to: manifest.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: 'solid',
      label: 'the third entry',
      labelAt: 0.5,
      visibility: 'shared',
    },
    {
      // The loosest string on the board, deliberately: the map is a long way
      // from the account, and a rope that slack over that distance is a rope
      // that sags into everything between. It is the case `sagFor` has to get
      // right, and the one a too-stiff string would draw flat.
      id: 'yarn-map',
      from: map.id,
      to: account.id,
      slack: 0.45,
      color: YARN_COLOR,
      style: 'solid',
      label: 'all three docks',
      labelAt: 0.5,
      visibility: 'shared',
    },
    {
      id: 'yarn-ebb',
      from: ebb.id,
      to: bell.id,
      slack: 0.12,
      color: YARN_COLOR,
      style: 'solid',
      labelAt: 0.5,
      visibility: 'shared',
    },
    {
      id: 'yarn-leaf',
      from: leaf.id,
      to: ledger.id,
      slack: 0.36,
      color: YARN_COLOR,
      style: 'solid',
      label: 'the missing entries',
      labelAt: 0.2,
      visibility: 'shared',
    },
    {
      id: 'yarn-ink-ledger',
      from: ink.id,
      to: ledger.id,
      slack: 0.24,
      color: YARN_COLOR,
      style: 'solid',
      labelAt: 0.5,
      visibility: 'shared',
    },
  ]

  return {
    entities: [
      bell,
      ledger,
      account,
      manifest,
      price,
      missing,
      blank,
      fourth,
      tide,
      blankToo,
      ferryman,
      ebb,
      kestrel,
      ink,
      loose,
      seal,
      quiet,
      name,
      burned,
      quietToo,
      map,
      rubbing,
      leaf,
    ],
    strings,
  }
}

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
