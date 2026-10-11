-- A pin marked onto a picture: a third location beside a text anchor and a board point.
-- The spot is a fraction of the picture's photo box rather than a board coordinate, which is
-- what lets a mark ride out the picture being moved, resized and swung with nothing rewritten.

alter table public.items
  add column image_id uuid,
  add column spot_u double precision,
  add column spot_v double precision;

-- Cascades like `items.article_id` in 0003, and for the same reason: there is no `set null`,
-- because a mark with no picture is a location the CHECK below cannot represent. The client
-- cascades too, so peers are told rather than left guessing.
alter table public.items
  add constraint items_image_id_fkey
  foreign key (image_id) references public.items (id) on delete cascade;

create index items_image_idx on public.items (image_id) where image_id is not null;

alter table public.items
  add constraint items_spot_check check (
    (spot_u is null and spot_v is null)
    or (spot_u >= 0 and spot_u <= 1 and spot_v >= 0 and spot_v <= 1)
  );

-- A fraction is a pair: a mark carries both numbers or neither, and each is in range.
alter table public.items
  add constraint items_mark_columns_check check (
    kind = 'pin'
    or (image_id is null and spot_u is null and spot_v is null)
  );

-- The location rule, now three-way. The original was an OR, which is satisfied by a row
-- claiming *two* locations at once — exclusivity was the client's discipline and not the
-- schema's, which is not what "the CHECK enforces it" in the architecture doc claimed. This
-- is a real XOR, so the third location could not quietly become a fourth.
--
-- Pre-flight, before applying: this must come back 0, or the constraint will refuse to apply.
--   select count(*) from public.items
--    where (article_id is not null)::int + (board_x is not null)::int
--        + (image_id is not null)::int > 1;
alter table public.items drop constraint items_location_check;
alter table public.items
  add constraint items_location_check check (
    (
      article_id is not null
      and anchor is not null
      and board_x is null
      and board_y is null
      and image_id is null
      and spot_u is null
      and spot_v is null
    )
    or (
      image_id is not null
      and spot_u is not null
      and spot_v is not null
      and article_id is null
      and anchor is null
      and board_x is null
      and board_y is null
    )
    or (
      board_x is not null
      and board_y is not null
      and article_id is null
      and anchor is null
      and image_id is null
      and spot_u is null
      and spot_v is null
    )
  );
