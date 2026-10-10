-- The last two client fields with no column. `items` gained the note and image
-- typography in 0003 from the schema notes rather than from a diff of
-- `BoardEntity`, which missed that an image also carries `alt` and `fit`.

alter table public.items
  add column alt text,
  add column fit text not null default 'cover';

-- `IMAGE_FITS` in `src/model/types.ts`; an unrecognised value there falls back
-- to `cover`, so drift is survivable but visible only here.
alter table public.items
  add constraint items_fit_check check (fit in ('cover', 'contain'));

alter table public.items
  add constraint items_alt_fit_columns_check check (
    kind = 'image' or (alt is null and fit = 'cover')
  );
