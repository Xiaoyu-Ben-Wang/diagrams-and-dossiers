import type { BoardState } from "../board/store";
import { POST_IT_COLORS } from "../board/tuning";
import { DEFAULT_SLACK, YARN_COLOR } from "../board/yarn";
import { DEFAULT_ARTICLE_OPTIONS } from "../model/article-options";
import { newArticle, newFreePin, newImage, newNote } from "../model/create";
import type { BoardEntity, StringLink } from "../model/types";
import { COIN_RUBBING, MARSH_MAP, TORN_LEAF } from "./demo-pictures";
// `?inline` keeps a data: URL: a board file rejects a plain asset path.
import catSrc from "./cat.png?inline";

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
`;

export const ARTICLE_TITLE = "The Drowned Bell";

// Fixed, not generated: strings and anchored pins are keyed by this id across reloads.
export const ARTICLE_ID = "the-drowned-bell";

export const SECOND_ARTICLE_ID = "the-harbormasters-ledger";

export const THIRD_ARTICLE_ID = "the-ferrymans-account";

export const FOURTH_ARTICLE_ID = "the-sea-ghosts-manifest";

export const ARTICLE_IDS = [
  ARTICLE_ID,
  SECOND_ARTICLE_ID,
  THIRD_ARTICLE_ID,
  FOURTH_ARTICLE_ID,
] as const;

export const SECOND_ARTICLE_TITLE = "The Harbormaster's Ledger";

export const SECOND_MARKDOWN = `# The Harbormaster's Ledger

**Recovered from the Sea Ghost**, water-stained, three leaves torn out.

- Twelve sailings between the festival and the new moon
- Four of them entered in a second hand
- The fourth name is scratched through, not struck out

> "Kestrel. Kestrel. *Kestrel.*" — the same word, three times,
> in three inks.

Whoever kept this book wanted one of those names read.`;

export const THIRD_ARTICLE_TITLE = "The Ferryman's Account";

export const THIRD_MARKDOWN = `# The Ferryman's Account

**Taken at the ferry dock**, the morning after the bell came up.

> "I rowed him out at slack water. He had a chest with him and
> would not let me touch it. Coming back the chest was gone, and
> the coin was on the seat where it had been."

Pressed on which dock he used, he named all three and then none.
All three are on @[The Saltmarsh Map], and none of them agree
with @[The Harbormaster's Ledger] about the tide.

He said *Kestrel* once, and **Sea Ghost** twice, quieter the
second time.`;

export const FOURTH_ARTICLE_TITLE = "The Sea Ghost's Manifest";

export const FOURTH_MARKDOWN = `# The Sea Ghost's Manifest

**Cargo taken on at Leilon**, three days before the new moon.

- Twelve crates of salt, consigned to the harbormaster
- Four barrels, unmarked, consigned to nobody
- One chest, listed only as *sundries*

The mate's hand is steady until the third entry, where it is not.`;

const PAGE_AT = {
  [ARTICLE_ID]: { x: 0, y: 0 },
  [SECOND_ARTICLE_ID]: { x: 880, y: -70 },
  [THIRD_ARTICLE_ID]: { x: 60, y: 780 },
  [FOURTH_ARTICLE_ID]: { x: 980, y: 800 },
} as const;

const PAGE_WIDTH = {
  [ARTICLE_ID]: DEFAULT_ARTICLE_OPTIONS.width,
  [SECOND_ARTICLE_ID]: 520,
  [THIRD_ARTICLE_ID]: 500,
  [FOURTH_ARTICLE_ID]: 560,
} as const;

function dateAt(session: number): { occurredAt: number; dateLabel: string } {
  return {
    occurredAt: CAMPAIGN_EPOCH + session * SESSION_GAP_MS,
    dateLabel: `Session ${session}, 1492 DR`,
  };
}

function used<T extends object>(entity: T, overrides: Partial<T>): T {
  return { ...entity, ...overrides };
}

export function demoPages(): BoardEntity[] {
  return [
    newArticle(
      PAGE_AT[ARTICLE_ID],
      INITIAL_MARKDOWN,
      ARTICLE_TITLE,
      {
        ...DEFAULT_ARTICLE_OPTIONS,
        width: PAGE_WIDTH[ARTICLE_ID],
      },
      { id: ARTICLE_ID },
    ),
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
  ];
}

const POINTS = {
  price: { x: -360, y: 30 },
  missing: { x: -490, y: 240 },
  blank: { x: -370, y: 450 },
  fourth: { x: -540, y: 660 },
  map: { x: -660, y: 900 },
  tide: { x: -390, y: 1180 },
  ebb: { x: 640, y: 620 },
  ferryman: { x: 1020, y: 940 },
  blankToo: { x: 1180, y: 1120 },
  leaf: { x: 1420, y: 1180 },
  rubbing: { x: 1700, y: 40 },
  kestrel: { x: 1500, y: 300 },
  ink: { x: 1640, y: 410 },
  loose: { x: 1540, y: 520 },
  seal: { x: 1680, y: 630 },
  quiet: { x: 1560, y: 740 },
  name: { x: 1480, y: 850 },
  burned: { x: 1660, y: 960 },
  quietToo: { x: 1520, y: 1080 },
  cat: { x: 2080, y: 880 },
} as const;

export function demoBoard(): BoardState {
  const [bell, ledger, account, manifest] = demoPages();

  const price = newNote(POINTS.price, {
    ...dateAt(12),
    color: POST_IT_COLORS[0].color,
    bodyMd: "He named a price before anyone asked him. Ask who paid it.",
  });
  const missing = newNote(POINTS.missing, {
    ...dateAt(13),
    color: POST_IT_COLORS[1].color,
    style: "ruled",
    bodyMd: "Three dockworkers, all since the festival. Get the names.",
  });
  const blank = newNote(POINTS.blank, {
    ...dateAt(13),
    color: POST_IT_COLORS[2].color,
  });
  const fourth = used(
    newNote(POINTS.fourth, {
      ...dateAt(13),
      color: POST_IT_COLORS[3].color,
      // The only non-`theory` status on the board; nothing draws it yet, kept to exercise the column.
      status: "confirmed",
      bodyMd:
        "The fourth name is scratched, not struck. A different hand, and a different knife.",
    }),
    { width: 210, height: 150 },
  );
  const tide = newNote(POINTS.tide, {
    ...dateAt(14),
    color: POST_IT_COLORS[0].color,
    style: "crumpled",
    bodyMd: "Low tide twice a day. The bell rings at one of them.",
  });
  const blankToo = newNote(POINTS.blankToo, {
    ...dateAt(14),
    color: POST_IT_COLORS[1].color,
    style: "taped",
  });
  const ferryman = newNote(POINTS.ferryman, {
    ...dateAt(15),
    color: POST_IT_COLORS[2].color,
    style: "grid",
    bodyMd: "The ferryman knew the chest before he saw it.",
  });
  const ebb = newNote(POINTS.ebb, {
    ...dateAt(15),
    color: POST_IT_COLORS[3].color,
    bodyMd: "It came up on the ebb. Nothing comes up on the ebb.",
  });

  const kestrel = newFreePin(POINTS.kestrel, {
    ...dateAt(13),
    bodyMd: "Kestrel is a ship. The Sea Ghost was a ship.",
  });
  const ink = newFreePin(POINTS.ink, {
    ...dateAt(14),
    bodyMd: "Three inks in one entry — three people wrote in this book.",
  });
  const loose = newFreePin(POINTS.loose, dateAt(14));
  const seal = newFreePin(POINTS.seal, {
    ...dateAt(15),
    bodyMd: "The coin is a seal, not money. Somebody’s mark.",
  });
  const quiet = newFreePin(POINTS.quiet, dateAt(15));
  const name = newFreePin(POINTS.name, {
    ...dateAt(16),
    bodyMd: "Nobody writes their own name last.",
  });
  const burned = newFreePin(POINTS.burned, {
    ...dateAt(16),
    bodyMd: "Ask the harbormaster what he burned.",
  });
  const quietToo = newFreePin(POINTS.quietToo, {
    ...dateAt(16),
    visibility: "dm",
    bodyMd: "He is lying about the third dock. Do not say so yet.",
  });

  const map = used(
    newImage(
      POINTS.map,
      MARSH_MAP,
      { width: 320, height: 240 },
      {
        title: "The Saltmarsh Map",
        alt: "A hand-drawn map of the Saltmarsh approaches",
        edge: "torn",
        bodyMd: "The drowned road runs to the third dock.",
      },
    ),
    { rotation: -6 },
  );
  const rubbing = used(
    newImage(
      POINTS.rubbing,
      COIN_RUBBING,
      { width: 220, height: 220 },
      {
        title: "The Black Coin",
        alt: "A charcoal rubbing of the Black Coin",
        edge: "burnt",
        fit: "contain",
        bodyMd: "Rubbed from the coin while the harbormaster was out.",
      },
    ),
    { rotation: 7 },
  );
  const leaf = used(
    newImage(
      POINTS.leaf,
      TORN_LEAF,
      { width: 300, height: 200 },
      {
        title: "The Ledger Leaf",
        alt: "One of the ledger’s torn-out leaves",
        edge: "deckled",
        bodyMd: "A leaf from the ledger — the hand changes halfway down.",
      },
    ),
    { rotation: -8 },
  );

  // Off on his own, well clear of the case: the joke only works if he is not
  // standing in the middle of it.
  const cat = used(
    newImage(
      POINTS.cat,
      catSrc,
      { width: 240, height: 280 },
      {
        title: "The DM's cat (how did he get here?)",
        alt: "A cream cat staring straight down the lens",
        edge: "clean",
        bodyMd: "Nobody remembers letting him in.",
      },
    ),
    { rotation: 5 },
  );

  const strings: StringLink[] = [
    {
      id: "yarn-price",
      from: price.id,
      to: bell.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: "solid",
      label: "Molgar paid him",
      labelAt: 0.25,
      visibility: "shared",
    },
    {
      id: "yarn-missing",
      from: missing.id,
      to: ledger.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: "solid",
      labelAt: 0.5,
      visibility: "shared",
    },
    {
      id: "yarn-ink",
      from: kestrel.id,
      to: ink.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: "solid",
      labelAt: 0.5,
      visibility: "shared",
    },
    {
      id: "yarn-fourth",
      from: fourth.id,
      to: ledger.id,
      slack: 0.3,
      color: YARN_COLOR,
      style: "solid",
      label: "a third hand",
      labelAt: 0.12,
      visibility: "shared",
    },
    {
      id: "yarn-account",
      from: ferryman.id,
      to: account.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: "solid",
      label: "he never opened it",
      labelAt: 0.3,
      visibility: "shared",
    },
    {
      id: "yarn-sundries",
      from: name.id,
      to: manifest.id,
      slack: 0.1,
      color: YARN_COLOR,
      style: "solid",
      label: "consigned to nobody",
      labelAt: 0.5,
      visibility: "shared",
    },
    {
      id: "yarn-tide",
      from: tide.id,
      to: bell.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: "solid",
      label: "which of the two?",
      labelAt: 0.16,
      visibility: "shared",
    },
    {
      id: "yarn-burned",
      from: burned.id,
      to: manifest.id,
      slack: DEFAULT_SLACK,
      color: YARN_COLOR,
      style: "solid",
      label: "the third entry",
      labelAt: 0.5,
      visibility: "shared",
    },
    {
      id: "yarn-map",
      from: map.id,
      to: account.id,
      slack: 0.45,
      color: YARN_COLOR,
      style: "solid",
      label: "all three docks",
      labelAt: 0.5,
      visibility: "shared",
    },
    {
      id: "yarn-ebb",
      from: ebb.id,
      to: bell.id,
      slack: 0.12,
      color: YARN_COLOR,
      style: "solid",
      labelAt: 0.5,
      visibility: "shared",
    },
    {
      id: "yarn-leaf",
      from: leaf.id,
      to: ledger.id,
      slack: 0.36,
      color: YARN_COLOR,
      style: "solid",
      label: "the missing entries",
      labelAt: 0.2,
      visibility: "shared",
    },
    {
      id: "yarn-ink-ledger",
      from: ink.id,
      to: ledger.id,
      slack: 0.24,
      color: YARN_COLOR,
      style: "solid",
      labelAt: 0.5,
      visibility: "shared",
    },
  ];

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
      cat,
    ],
    strings,
  };
}

export const CAMPAIGN_EPOCH = Date.UTC(2026, 0, 10);

export const SESSION_GAP_MS = 14 * 24 * 60 * 60 * 1000;

// Matches the seed markdown's "Session 12"; new dates are labelled counting from it.
export const FIRST_SESSION = 12;
