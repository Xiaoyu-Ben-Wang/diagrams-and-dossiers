-- A board is private or shared, and its owner decides which.
--
-- Shared means the board's own address, /b/<id>, opens for anyone who has it:
-- `open_board` makes them an editor on the way in, with no join screen. Private
-- means only the owner gets in. Everyone who joined keeps their `members` row
-- while the board is private, so sharing it again lets them straight back in.
--
-- The switch lives in `is_member`, which every select policy, every write policy
-- (through `is_editor`/`is_dm`) and both realtime channels already ask. Turning a
-- board private therefore closes reads, writes and the live channel in one place.
--
-- One gap: Realtime authorizes broadcast and presence when a client joins the
-- channel, so someone already connected keeps seeing cursors and presence until
-- they reconnect. Row changes (`postgres_changes`) are checked per event and stop
-- at once.
--
-- Boards that exist already start shared: until now every board was open to its
-- edit link, and those links are in people's hands.

alter table public.boards
  add column shared boolean not null default false;

update public.boards set shared = true;

create or replace function public.is_member(b uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.boards bo on bo.id = m.board_id
    where m.board_id = b
      and m.user_id = (select auth.uid())
      and (m.role = 'owner' or bo.shared)
  )
$$;

create or replace function public.is_editor(b uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.boards bo on bo.id = m.board_id
    where m.board_id = b
      and m.user_id = (select auth.uid())
      and m.role in ('editor', 'dm', 'owner')
      and (m.role = 'owner' or bo.shared)
  )
$$;

create or replace function public.is_dm(b uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    join public.boards bo on bo.id = m.board_id
    where m.board_id = b
      and m.user_id = (select auth.uid())
      and m.role in ('dm', 'owner')
      and (m.role = 'owner' or bo.shared)
  )
$$;

-- The old token links are a second door onto the same board, so they close with
-- the board too. The owner can always use their own.
create or replace function public.join_board(p_token text, p_display_name text default null)
returns table (board_id uuid, role text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_board uuid;
  v_role text;
  v_shared boolean;
  v_owner uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select b.id,
         case
           when b.dm_token   = p_token then 'dm'
           when b.edit_token = p_token then 'editor'
           when b.view_token = p_token then 'viewer'
         end,
         b.shared,
         b.owner_id
    into v_board, v_role, v_shared, v_owner
  from public.boards b
  where p_token in (b.view_token, b.edit_token, b.dm_token)
  limit 1;

  if v_board is null then
    raise exception 'invalid invite link';
  end if;

  if not v_shared and v_owner <> v_user then
    raise exception 'this board is private';
  end if;

  if exists (
    select 1 from public.board_blocks bb
    where bb.board_id = v_board and bb.user_id = v_user
  ) then
    raise exception 'access to this board has been revoked';
  end if;

  insert into public.members (board_id, user_id, role, display_name, joined_via)
  values (v_board, v_user, v_role, p_display_name, 'link')
  on conflict on constraint members_pkey do update
    set display_name = coalesce(excluded.display_name, public.members.display_name);

  return query
    select m.board_id, m.role from public.members m
    where m.board_id = v_board and m.user_id = v_user;
end;
$$;

-- The door for /b/<id>. A member walks straight in; anyone else is let in as an
-- editor only while the board is shared. The board's name comes back with the
-- role because a newcomer has no other way to read it before they are a member.
create or replace function public.open_board(p_board uuid, p_display_name text default null)
returns table (board_id uuid, role text, name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_shared boolean;
  v_owner uuid;
  v_name text;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select b.shared, b.owner_id, b.name
    into v_shared, v_owner, v_name
  from public.boards b
  where b.id = p_board;

  -- One message for "no such board" and "private": telling them apart would let
  -- anyone probe which ids exist.
  if v_owner is null or (not v_shared and v_owner <> v_user) then
    raise exception 'board not found or private';
  end if;

  if exists (
    select 1 from public.board_blocks bb
    where bb.board_id = p_board and bb.user_id = v_user
  ) then
    raise exception 'access to this board has been revoked';
  end if;

  insert into public.members (board_id, user_id, role, display_name, joined_via)
  values (p_board, v_user, 'editor', p_display_name, 'open')
  on conflict on constraint members_pkey do update
    set display_name = coalesce(excluded.display_name, public.members.display_name);

  return query
    select m.board_id, m.role, v_name from public.members m
    where m.board_id = p_board and m.user_id = v_user;
end;
$$;

revoke execute on function public.open_board(uuid, text) from public;
grant execute on function public.open_board(uuid, text) to authenticated;
