-- Additive only, like 0002: reasoned about but never executed, so nothing here
-- moves a row.

-- Default '{}' and no CHECK on keys or types: the client parser is the sole
-- authority and supplies defaults, so an old row reads today's defaults.
alter table public.items
  add column if not exists options jsonb not null default '{}'::jsonb;

-- `jsonb_typeof`, not a bare `options = '{}'`: this arm admits `'[]'`/`'null'`,
-- which the parser coerces to defaults.
alter table public.items
  drop constraint if exists items_options_check;

alter table public.items
  add constraint items_options_check check (
    kind = 'article'
    or jsonb_typeof(options) <> 'object'
    or options = '{}'::jsonb
  );
