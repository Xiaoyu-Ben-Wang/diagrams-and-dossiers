-- Additive only, and never executed against a real Postgres: nothing here moves
-- a row, so it is safe to run blind, but verify before relying on it.

-- The client's `MAX_SLACK` is (8 / 3) * MAX_SAG_RATIO^2 with MAX_SAG_RATIO at
-- 0.55; a database cannot import that constant, so this literal is the copy that drifts.
alter table public.strings
  add column if not exists slack double precision not null default 0.18;

alter table public.strings
  drop constraint if exists strings_slack_check;

alter table public.strings
  add constraint strings_slack_check check (slack >= 0 and slack <= 0.8067);

alter table public.items
  drop constraint if exists items_kind_check;

alter table public.items
  add constraint items_kind_check
  check (kind in ('pin', 'note', 'article_ref', 'image'));

alter table public.items
  add column if not exists src       text,
  add column if not exists width     double precision,
  add column if not exists height    double precision,
  add column if not exists rotation  double precision not null default 0,
  add column if not exists edge      text not null default 'clean',
  add column if not exists edge_seed integer not null default 0;

alter table public.items
  drop constraint if exists items_rotation_check;

alter table public.items
  add constraint items_rotation_check check (rotation >= -45 and rotation <= 45);

-- This list must match `src/board/edges.ts`; an unknown value there falls back
-- to `clean`, so drift is survivable but visible only here.
alter table public.items
  drop constraint if exists items_edge_check;

alter table public.items
  add constraint items_edge_check
  check (edge in ('clean', 'burnt', 'stamped', 'torn', 'deckled',
                  'scalloped', 'scorched', 'frayed', 'nibbled', 'chipped'));

alter table public.items
  drop constraint if exists items_image_columns_check;

alter table public.items
  add constraint items_image_columns_check check (
    kind = 'image'
    or (src is null and width is null and height is null
        and rotation = 0 and edge_seed = 0)
  );

alter table public.items
  drop constraint if exists items_image_footprint_check;

alter table public.items
  add constraint items_image_footprint_check check (
    kind <> 'image'
    or (src is not null and width is not null and height is not null
        and width > 0 and height > 0)
  );

alter table public.articles
  add column if not exists rotation double precision not null default 0;

alter table public.articles
  drop constraint if exists articles_rotation_check;

alter table public.articles
  add constraint articles_rotation_check check (rotation >= -45 and rotation <= 45);
