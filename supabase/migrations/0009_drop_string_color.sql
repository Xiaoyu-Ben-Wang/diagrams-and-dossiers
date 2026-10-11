-- A string no longer carries a colour of its own.
--
-- Every string on a board is strung with the same wool, chosen once in preferences,
-- so `strings.color` stopped being read the moment that landed and would only ever
-- hold its default. The palette it named lives in the client now, twice over — lit
-- for a bright board and lifted for a dark one — which is the other reason it cannot
-- be a column: the value depends on the theme in front of the reader, not on the row.
--
-- The column was `not null default 'crimson'`, so nothing ever depended on it being
-- absent, and dropping it loses only which of five wools a string used to be drawn in.

alter table public.strings
  drop column color;
