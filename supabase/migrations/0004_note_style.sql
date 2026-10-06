-- Additive only, and never executed against a real Postgres: nothing here moves
-- a row, so it is safe to run blind, but verify before relying on it.

alter table public.items
  add column if not exists style text not null default 'plain';

-- This list must match `NOTE_STYLES` in `src/model/types.ts`; an unknown value
-- there falls back to `plain`, so drift is survivable but visible only here.
alter table public.items
  drop constraint if exists items_style_check;

alter table public.items
  add constraint items_style_check
  check (style in ('plain', 'ruled', 'grid', 'dog-eared', 'taped'));

alter table public.items
  drop constraint if exists items_style_columns_check;

alter table public.items
  add constraint items_style_columns_check check (
    kind = 'note' or style = 'plain'
  );
