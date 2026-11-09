-- Version history: a snapshot of every board that changed, once an hour.
--
-- pg_cron runs `take_board_snapshots` at the top of each hour. A board whose
-- content is unchanged since its last snapshot gets none: the comparison is a
-- hash that ignores `version` and `updated_at`, so a write that lands back where
-- it started is not a change.
--
-- Retention, applied after every run by `prune_board_snapshots`:
--   - the last 24 hours keep every hourly snapshot;
--   - older days keep only their last snapshot (days are UTC);
--   - days older than 30 are dropped;
--   - a board's newest snapshot is always kept, however old.
--
-- The table has RLS on and no policies, so clients reach it only through the two
-- RPCs at the bottom, which check membership and hide dm-only and unrevealed rows
-- (see `visible_snapshot_content`).

create extension if not exists pg_cron;

create table public.board_snapshots (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.boards (id) on delete cascade,
  taken_at     timestamptz not null default now(),
  content      jsonb not null,
  content_hash text not null,
  item_count   integer not null,
  string_count integer not null
);

create index board_snapshots_board_idx
  on public.board_snapshots (board_id, taken_at desc);

alter table public.board_snapshots enable row level security;

-- Whole rows, as `select *` would read them, so the client's mapper reads a
-- snapshot exactly as it reads a live board.
create or replace function public.board_content(p_board uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(to_jsonb(i) order by i.id)
         from public.items i where i.board_id = p_board),
      '[]'::jsonb),
    'strings', coalesce(
      (select jsonb_agg(to_jsonb(s) order by s.id)
         from public.strings s where s.board_id = p_board),
      '[]'::jsonb)
  )
$$;

create or replace function public.board_content_hash(p_content jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(e - 'version' - 'updated_at' order by e ->> 'id')
         from jsonb_array_elements(p_content -> 'items') e),
      '[]'::jsonb),
    'strings', coalesce(
      (select jsonb_agg(e - 'version' - 'updated_at' order by e ->> 'id')
         from jsonb_array_elements(p_content -> 'strings') e),
      '[]'::jsonb)
  )::text)
$$;

create or replace function public.prune_board_snapshots(p_now timestamptz default now())
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.board_snapshots s
  using (
    select id,
           row_number() over (
             partition by board_id, (taken_at at time zone 'UTC')::date
             order by taken_at desc
           ) as in_day,
           row_number() over (
             partition by board_id
             order by taken_at desc
           ) as newest
    from public.board_snapshots
  ) ranked
  where s.id = ranked.id
    and ranked.newest > 1
    and (
      (s.taken_at < p_now - interval '24 hours' and ranked.in_day > 1)
      or s.taken_at < p_now - interval '30 days'
    )
$$;

create or replace function public.take_board_snapshots(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board uuid;
  v_content jsonb;
  v_hash text;
  v_last text;
  v_taken integer := 0;
begin
  for v_board in select b.id from public.boards b loop
    v_content := public.board_content(v_board);
    v_hash := public.board_content_hash(v_content);

    select s.content_hash into v_last
    from public.board_snapshots s
    where s.board_id = v_board
    order by s.taken_at desc
    limit 1;

    if v_last is not distinct from v_hash then
      continue;
    end if;

    -- An empty board with no history has nothing worth going back to.
    if v_last is null
       and jsonb_array_length(v_content -> 'items') = 0
       and jsonb_array_length(v_content -> 'strings') = 0 then
      continue;
    end if;

    insert into public.board_snapshots
      (board_id, taken_at, content, content_hash, item_count, string_count)
    values
      (v_board, p_now, v_content, v_hash,
       jsonb_array_length(v_content -> 'items'),
       jsonb_array_length(v_content -> 'strings'));
    v_taken := v_taken + 1;
  end loop;

  perform public.prune_board_snapshots(p_now);
  return v_taken;
end;
$$;

-- Not callable by clients: only the cron job and the dashboard run these.
revoke execute on function public.board_content(uuid) from public, anon, authenticated;
revoke execute on function public.board_content_hash(jsonb) from public, anon, authenticated;
revoke execute on function public.prune_board_snapshots(timestamptz) from public, anon, authenticated;
revoke execute on function public.take_board_snapshots(timestamptz) from public, anon, authenticated;

-- What a caller may see of a snapshot. A dm sees everything. Anyone else sees
-- what the live select policies would have shown them then, minus anything that
-- is dm-only or unrevealed *now*: hiding an item later must hide its history too,
-- and a restore must never offer to write back a row the caller cannot see.
create or replace function public.visible_snapshot_content(p_content jsonb, p_dm boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_dm then p_content else jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(e)
         from jsonb_array_elements(p_content -> 'items') e
        where e ->> 'visibility' = 'shared'
          and (e ->> 'reveal_at' is null or (e ->> 'reveal_at')::timestamptz <= now())
          and not exists (
            select 1 from public.items i
            where i.id = (e ->> 'id')::uuid
              and (i.visibility = 'dm' or (i.reveal_at is not null and i.reveal_at > now()))
          )),
      '[]'::jsonb),
    'strings', coalesce(
      (select jsonb_agg(e)
         from jsonb_array_elements(p_content -> 'strings') e
        where e ->> 'visibility' = 'shared'
          and not exists (
            select 1 from public.strings st
            where st.id = (e ->> 'id')::uuid and st.visibility = 'dm'
          )),
      '[]'::jsonb)
  ) end
$$;

revoke execute on function public.visible_snapshot_content(jsonb, boolean) from public, anon, authenticated;

-- Counts are of what the caller can see, so they do not reveal how many hidden
-- things a board holds.
create or replace function public.list_board_snapshots(p_board uuid)
returns table (id uuid, taken_at timestamptz, item_count integer, string_count integer)
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_dm boolean;
begin
  if not public.is_member(p_board) then
    raise exception 'not a member of this board';
  end if;
  v_dm := public.is_dm(p_board);

  return query
    select s.id, s.taken_at,
           case when v_dm then s.item_count
                else jsonb_array_length(public.visible_snapshot_content(s.content, false) -> 'items') end,
           case when v_dm then s.string_count
                else jsonb_array_length(public.visible_snapshot_content(s.content, false) -> 'strings') end
    from public.board_snapshots s
    where s.board_id = p_board
    order by s.taken_at desc;
end;
$$;

create or replace function public.get_board_snapshot(p_snapshot uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_board uuid;
  v_content jsonb;
begin
  select s.board_id, s.content into v_board, v_content
  from public.board_snapshots s
  where s.id = p_snapshot;

  if v_board is null or not public.is_member(v_board) then
    raise exception 'snapshot not found';
  end if;

  return public.visible_snapshot_content(v_content, public.is_dm(v_board));
end;
$$;

revoke execute on function public.list_board_snapshots(uuid) from public;
revoke execute on function public.get_board_snapshot(uuid) from public;
grant execute on function public.list_board_snapshots(uuid) to authenticated;
grant execute on function public.get_board_snapshot(uuid) to authenticated;

-- `cron.schedule` with a name replaces a job of the same name, so re-running
-- this migration does not stack a second one.
select cron.schedule(
  'board-snapshots',
  '0 * * * *',
  $job$select public.take_board_snapshots()$job$
);
