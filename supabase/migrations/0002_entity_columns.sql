-- The columns the client model gained after 0001.
--
-- 0001 was written from `docs/architecture.md`, and for a while the two agreed.
-- They stopped agreeing when the board grew pictures and started tilting sheets:
-- the client's `ImageEntity` now carries a source, a measured footprint, an
-- angle and a generated border, and `ArticleEntity` carries an angle — none of
-- which had a column. `strings.slack` had been missing since the beginning: the
-- architecture doc lists it, the migration never got it, and the client has
-- been storing a slack on every string all along.
--
-- This migration is ADDITIVE ONLY, and deliberately so. It is unverified: there
-- is no Postgres and no container runtime in the environment it was written in,
-- so it has been reasoned about but never executed. Anything that moves rows
-- around belongs in a migration that can be run and checked, and nothing here
-- touches a row.
--
-- In particular it does NOT fold `articles` into `items`, which the plan called
-- for. That fold is right, but it belongs with the change that makes an article
-- an entity on the client — a thing the board does not do yet, since it still
-- has exactly one page held in component state. Writing the fold now would put
-- the schema ahead of the client, which is the same class of mistake as the
-- drift this migration exists to repair. See the note at the foot of this file
-- for what the fold will have to do when it comes.

-- ---------------------------------------------------------------------------
-- Strings: the slack the client already stores
-- ---------------------------------------------------------------------------

-- How much rope hangs between two pins. The ceiling is the client's `MAX_SLACK`
-- — (8 / 3) * MAX_SAG_RATIO^2 with MAX_SAG_RATIO at 0.55 — past which a string
-- sags more than its own length and the geometry stops meaning anything. Kept
-- as a literal because a database cannot import a TypeScript constant; if that
-- pair of numbers changes, this constraint is the thing that silently disagrees.
alter table public.strings
  add column if not exists slack double precision not null default 0.18;

alter table public.strings
  drop constraint if exists strings_slack_check;

alter table public.strings
  add constraint strings_slack_check check (slack >= 0 and slack <= 0.8067);

-- ---------------------------------------------------------------------------
-- Items: the pin kind, and what a picture is
-- ---------------------------------------------------------------------------

-- The client has four kinds: a pin, a note, an article and an image. 0001 had
-- three, and its `note` did double duty for what the client now calls a pin —
-- a tack through a word in the article, which is a different thing from a
-- post-it in the cork and is edited differently. `article_ref` stays for now:
-- it is how 0001 places a *reference* to an article, and it keeps meaning that
-- until the article itself becomes an item.
alter table public.items
  drop constraint if exists items_kind_check;

alter table public.items
  add constraint items_kind_check
  check (kind in ('pin', 'note', 'article_ref', 'image'));

-- A picture. `src` is a data URI rather than a storage path: the board has no
-- upload endpoint, and a photograph that dies with the browser tab that dropped
-- it is not one worth pinning up. `width` and `height` are the BOARD footprint
-- measured from the decoded file and scaled to fit — never the file's own pixel
-- dimensions, which for a photograph off a phone are larger than the article it
-- sits beside.
alter table public.items
  add column if not exists src       text,
  add column if not exists width     double precision,
  add column if not exists height    double precision,
  add column if not exists rotation  double precision not null default 0,
  add column if not exists edge      text not null default 'clean',
  add column if not exists edge_seed integer not null default 0;

-- The angle a sheet hangs at, about the pin at its top-centre. Bounded the way
-- the client bounds it: past 45 degrees a pinned sheet stops reading as pinned.
alter table public.items
  drop constraint if exists items_rotation_check;

alter table public.items
  add constraint items_rotation_check check (rotation >= -45 and rotation <= 45);

-- The edge forms in `src/board/edges.ts`. A style the client does not know
-- falls back to `clean` there, so an unknown value here is survivable — but it
-- would mean the two lists had drifted, and this is where that shows up.
alter table public.items
  drop constraint if exists items_edge_check;

alter table public.items
  add constraint items_edge_check
  check (edge in ('clean', 'burnt', 'stamped', 'torn', 'deckled',
                  'scalloped', 'scorched', 'frayed', 'nibbled', 'chipped'));

-- Only a picture carries a picture's columns. Without this a note could hold a
-- footprint and a border style, which nothing would read and nothing would
-- clear — the kind of row that looks fine until something loops over the
-- images and finds one that is not one.
alter table public.items
  drop constraint if exists items_image_columns_check;

alter table public.items
  add constraint items_image_columns_check check (
    kind = 'image'
    or (src is null and width is null and height is null
        and rotation = 0 and edge_seed = 0)
  );

-- A picture has a footprint and a note does not; the reverse of the above, so
-- an image cannot be written without the size everything downstream measures
-- from. `edge` is excluded because it has a not-null default of 'clean'.
alter table public.items
  drop constraint if exists items_image_footprint_check;

alter table public.items
  add constraint items_image_footprint_check check (
    kind <> 'image'
    or (src is not null and width is not null and height is not null
        and width > 0 and height > 0)
  );

-- ---------------------------------------------------------------------------
-- Articles: the angle the page hangs at
-- ---------------------------------------------------------------------------

alter table public.articles
  add column if not exists rotation double precision not null default 0;

alter table public.articles
  drop constraint if exists articles_rotation_check;

alter table public.articles
  add constraint articles_rotation_check check (rotation >= -45 and rotation <= 45);

-- ---------------------------------------------------------------------------
-- What the fold will have to do, when an article becomes an item
-- ---------------------------------------------------------------------------
--
-- Written down here because it is the part of this schema most likely to be got
-- wrong, and because doing it blind — with no database to run it against — is
-- how a migration like this ends up quietly destructive. It is a sequence, not
-- a set of independent steps:
--
--  1. Every `articles` row becomes an `items` row with `kind = 'article'`,
--     KEEPING ITS ID, so the `article_id` columns that point at it still point
--     at it after step 3. Its board position, visibility, reveal_at and version
--     carry over; its `slug` does not, because the wiki is gone and a URL-safe
--     page name has meant nothing since.
--  2. `items.kind` gains `'article'`. The location check has to be relaxed or
--     re-expressed first: an article is placed by `board_x`/`board_y` and, being
--     an entity, must stop being the one kind exempt from the XOR.
--  3. `items.article_id` changes its target from `public.articles` to
--     `public.items`, and anchored pins keep their anchors — the ids survived
--     step 1, so the reference still resolves.
--  4. `article_ref` items are re-examined rather than copied. Each pointed at an
--     article that is now an item in the same table, so a reference and the
--     thing it references are the same row's neighbours; most become redundant
--     and should be deleted by hand, with any pins anchored to them re-pointed
--     first. This is the step that must not be automated.
--  5. Only then drop `public.articles`, its indexes, its policies and
--     `enforce_article_invariants`. The `items` trigger covers the same ground
--     once the articles are items.
