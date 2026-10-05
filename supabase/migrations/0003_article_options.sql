-- Where an article's options live.
--
-- `ArticleOptions` (`src/model/article-options.ts`) is a real part of the client
-- model — width, paper, type scale, and the flags for editing, pins, the title
-- bar and rolling up — and it is parsed rather than trusted, deliberately, so a
-- stored blob can never reach state half-formed. What it has never had is a
-- column. Neither `articles` nor `items` has one, so today an article's width,
-- its paper and everything else about how it is presented would be dropped by
-- any round trip through the database while its position and body survived.
--
-- That was invisible while there was one page whose width was a constant. It is
-- not invisible now: a page is an entity, two of them can be on a board at once
-- with different widths, and the width is something the reader drags.
--
-- Additive only, like 0002, and for the same reason: this file has been reasoned
-- about and not executed, so nothing here moves a row.
--
-- On `items` rather than `articles` because that is where an article is going.
-- The fold at the foot of 0002 copies every `articles` row into `items` keeping
-- its id, and adding the column to both would be two homes for one fact — with a
-- window in between where they could disagree. Step 0 of that sequence is this
-- migration.

-- ---------------------------------------------------------------------------
-- Items: the configuration an entity carries beyond its kind
-- ---------------------------------------------------------------------------

-- A JSON object, not a column per option. Three reasons, in order of weight:
-- the options are read as one blob by one parser that is already total; they
-- are heterogeneous and mostly boolean, so columns would be a wide table of
-- nullable flags; and the set of them is expected to grow with the features
-- that read them, which is a migration each time if they are columns.
--
-- The default is `'{}'`, not a filled-in object. The parser supplies the
-- defaults, so a row written before an option existed reads as the option's
-- default rather than as a frozen copy of the defaults from the day it was
-- inserted. `{}` means "nothing configured", which is a true thing to say about
-- a row that configured nothing.
--
-- Deliberately no CHECK on the keys or the types inside. The client's parser is
-- the authority on what a valid option is, it is total by construction, and a
-- second copy of those rules in SQL is a copy that drifts — see the same
-- argument in `0002` for why `edge` gets a constraint and this does not: that
-- list is closed and this one is not.
alter table public.items
  add column if not exists options jsonb not null default '{}'::jsonb;

-- Only an article reads it, mirroring `items_image_columns_check`: a non-article
-- row may hold an empty object, or something that is not an object at all, and
-- may not hold a populated one. Without this a note could carry a page's
-- presentation — a width, a paper, a type scale — that nothing renders and
-- nothing clears, which is the kind of row that looks fine until something
-- loops over the articles and finds one that is not one.
--
-- `jsonb_typeof` rather than a bare `options = '{}'`, because `'[]'::jsonb` and
-- `'null'::jsonb` are both not-an-object and a column default does not stop a
-- writer from storing either. That arm admits them, which is deliberate: the
-- parser coerces them to defaults and loses nothing, so this is a constraint
-- about a note not carrying a page's settings rather than about the reader's
-- safety.
alter table public.items
  drop constraint if exists items_options_check;

alter table public.items
  add constraint items_options_check check (
    kind = 'article'
    or jsonb_typeof(options) <> 'object'
    or options = '{}'::jsonb
  );
