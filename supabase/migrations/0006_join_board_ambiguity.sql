-- `join_board` never worked. It declares `returns table (board_id uuid, role text)`,
-- which makes `board_id` and `role` PL/pgSQL variables for the whole body — and
-- then names `board_id` again as the conflict target of the upsert. Postgres
-- cannot tell the output parameter from the column and refuses the call outright:
--
--   42702  column reference "board_id" is ambiguous
--
-- So every board link failed at the door, which is the whole of the join. Nothing
-- caught it because nothing had called the function until now: the schema was
-- applied and never exercised.
--
-- Fixed by naming the constraint instead of the columns. `on conflict on
-- constraint` takes no expression list, so there is nothing left to be ambiguous
-- about — and it says what was meant more plainly than the column list did.

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
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select b.id,
         case
           when b.dm_token   = p_token then 'dm'
           when b.edit_token = p_token then 'editor'
           when b.view_token = p_token then 'viewer'
         end
    into v_board, v_role
  from public.boards b
  where p_token in (b.view_token, b.edit_token, b.dm_token)
  limit 1;

  if v_board is null then
    raise exception 'invalid invite link';
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
