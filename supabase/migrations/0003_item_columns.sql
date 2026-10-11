-- Live interaction, part two: the columns the client needs to round-trip an
-- entity, and the completed fold of `articles` into `items`.
--
-- The client made an article an entity on the board (it is a member of
-- `BoardEntity`, it carries a board point, a rotation and article options), so
-- `items` is its home and the separate `articles` table is now unused. The
-- fold was half-done in 0001, which widened `items.kind` to include 'article'
-- and allowed `options` there, while leaving `items.article_id` pointing at the
-- `articles` table. That is repointed below. `articles` is left in place rather
-- than dropped: dropping it is a separate, destructive change with nothing to
-- gain while there is no data.

-- ---------------------------------------------------------------------------
-- The article fold
-- ---------------------------------------------------------------------------
--
-- A pin anchored to an article now references another `items` row. This is why
-- the delete cascades and there is no `set null`: `items_location_check` demands
-- `article_id + anchor` or `board_x + board_y`, so a pin whose article is gone
-- cannot be represented at all. The client has to cascade too.
alter table public.items drop constraint items_article_id_fkey;

alter table public.items add constraint items_article_id_fkey
  foreign key (article_id) references public.items (id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Columns the client round-trips
-- ---------------------------------------------------------------------------
--
-- `nudge` is deliberately absent. It is a manual offset for an entity whose real
-- position is derived (`src/model/types.ts`), a local correction to a
-- measurement — sharing it would move everyone's pins based on a layout that
-- measures differently on their machine.
--
-- These cannot live in `items.options`: `items_options_check` permits a
-- non-empty object only when `kind = 'article'`, and widening that would put two
-- unrelated shapes in one jsonb and lose the CHECKs.
alter table public.items
  add column font_scale double precision not null default 1,
  add column tilt       double precision not null default 0,
  add column font       text not null default 'system',
  add column frame      text;

alter table public.strings
  add column label_at double precision not null default 0.5;

-- `NOTE_FONTS` in `src/model/types.ts`; an unrecognised value there falls back
-- to the system hand, so drift is survivable but visible only here.
alter table public.items
  add constraint items_font_check
  check (font in ('system', 'special-elite', 'courier-prime', 'kalam', 'rock-salt'));

-- `IMAGE_FRAMES` is ["none", "polaroid"] and absent means none, so 'none' is
-- stored as NULL rather than as a third value.
alter table public.items
  add constraint items_frame_check
  check (frame is null or (kind = 'image' and frame = 'polaroid'));

alter table public.strings
  add constraint strings_label_at_check check (label_at >= 0 and label_at <= 1);

alter table public.items
  add constraint items_note_columns_check check (
    kind = 'note' or (font_scale = 1 and tilt = 0 and font = 'system')
  );

-- ---------------------------------------------------------------------------
-- Which columns belong to which kind
-- ---------------------------------------------------------------------------
--
-- `items_image_columns_check` said every non-image row must have null
-- `width`/`height` and zero `rotation`. That was wrong for two kinds: a note
-- stores its own footprint (it is resized by dragging), and an article swings
-- about its pin within ±45 like an image does. Split into one constraint per
-- group of columns so the drift is legible.
alter table public.items drop constraint items_image_columns_check;
alter table public.items drop constraint items_image_footprint_check;

alter table public.items
  add constraint items_dimension_columns_check check (
    case kind
      when 'image' then src is not null and width is not null and height is not null
      when 'note'  then src is null and width is not null and height is not null
      else              src is null and width is null and height is null
    end
  );

alter table public.items
  add constraint items_footprint_positive_check check (
    (width is null or width > 0) and (height is null or height > 0)
  );

alter table public.items
  add constraint items_rotation_columns_check check (
    kind in ('image', 'article') or rotation = 0
  );

alter table public.items
  add constraint items_edge_seed_columns_check check (
    kind = 'image' or edge_seed = 0
  );
