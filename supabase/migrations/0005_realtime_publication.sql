-- `postgres_changes` delivers nothing for a table that is not in the publication,
-- and says nothing about it either — the subscription simply never fires. RLS on
-- the table is still what filters what a given subscriber receives.
--
-- The guard is because `add table` raises if the table is already a member, which
-- would make this migration fail on a project where it had been added by hand.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'items'
  ) then
    alter publication supabase_realtime add table public.items;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'strings'
  ) then
    alter publication supabase_realtime add table public.strings;
  end if;
end
$$;
