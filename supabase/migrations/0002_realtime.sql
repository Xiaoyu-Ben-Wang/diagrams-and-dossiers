-- Live interaction, part one: authorization for ephemeral traffic, the write
-- paths identity editing needs, and the version columns the concurrency guards
-- were designed around but never got.
--
-- Never add `ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY`: it fails
-- with `42501 must be owner of table messages`, aborting the transaction and
-- silently skipping every later statement — including the `create policy` lines
-- below, which then appear to have been written and do nothing. The table
-- already has RLS enabled and the `realtime` schema is locked down. Create the
-- policies directly.

-- ---------------------------------------------------------------------------
-- Realtime: who may send and receive on a board's channels
-- ---------------------------------------------------------------------------
--
-- Topics are `board:<uuid>:public` and `board:<uuid>:dm`. A client chooses its
-- own topic string and `config: { private: true }` does not validate it, so the
-- id is regex-guarded before the cast: an unguarded `::uuid` on a malformed
-- topic raises inside the policy, and a throwing policy is a denial of service
-- on your own channel rather than a clean refusal.
create or replace function public.topic_board_id()
returns uuid
language sql
stable
as $$
  select case
    when split_part(realtime.topic(), ':', 2)
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(realtime.topic(), ':', 2)::uuid
  end
$$;

revoke execute on function public.topic_board_id() from public;
grant execute on function public.topic_board_id() to authenticated;

-- Both directions, and both channels. A select policy is what lets a client
-- *receive*; with only the insert policy, sends succeed, nothing arrives, and
-- there is no error anywhere to explain it.
create policy realtime_board_public_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.is_member(public.topic_board_id())
  );

create policy realtime_board_public_write on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.is_member(public.topic_board_id())
  );

create policy realtime_board_dm_read on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.is_dm(public.topic_board_id())
  );

create policy realtime_board_dm_write on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.is_dm(public.topic_board_id())
  );

-- ---------------------------------------------------------------------------
-- profiles: close the self-promotion hole
-- ---------------------------------------------------------------------------
--
-- The comment in 0001 says `can_create_boards` is not client-updatable, but
-- `profiles_update_own` only checks `user_id`, so a member could
-- `update profiles set can_create_boards = true` on their own row — and that
-- flag is the sole gate on `create_board`. Column grants enforce it where the
-- policy could not, and unlike a trigger they cannot be re-broken by a later
-- refactor. `redeem_creator_invite` is `security definer` and so is unaffected.
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- members: let people rename themselves and pick a colour
-- ---------------------------------------------------------------------------
--
-- Identity editing (name, anonymous or not) and the per-member colour both write
-- this table, and there is no update path at all today — `join_board` is the
-- only way a name ever lands.
--
-- The column grants are not optional. A bare update policy plus table-level
-- UPDATE would let a member run `update members set role = 'owner'` on
-- themselves, which defeats the "no insert policy, so the role cannot be chosen
-- by the client" invariant a few lines below it in 0001.
create policy members_update_self on public.members
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke update on public.members from authenticated;
grant update (display_name, color) on public.members to authenticated;

-- Belt and braces on top of the grants: a later refactor that widens the grant
-- still cannot move a member to another board or change their role.
create or replace function public.enforce_member_invariants()
returns trigger
language plpgsql
as $$
begin
  if new.board_id <> old.board_id
     or new.user_id <> old.user_id
     or new.role <> old.role
     or new.joined_via is distinct from old.joined_via
     or new.created_at <> old.created_at then
    raise exception 'immutable column on members';
  end if;
  return new;
end;
$$;

create trigger members_invariants
  before update on public.members
  for each row execute function public.enforce_member_invariants();

-- ---------------------------------------------------------------------------
-- strings and groups: make `version` real
-- ---------------------------------------------------------------------------
--
-- `items` and `articles` force `version := old.version + 1` on every update, and
-- a caller filters on the version it read. `strings` had no version column at
-- all and no `updated_at`, so there was no write predicate to build the yarn
-- race on, and no `updated_at > lastSeen` for catch-up to query. `groups` had
-- the column and nothing ever moved it — which is worse than not having it,
-- because the guard it implies is silently decorative.
alter table public.strings
  add column version    integer not null default 1,
  add column updated_at timestamptz not null default now();

create or replace function public.enforce_string_invariants()
returns trigger
language plpgsql
as $$
begin
  if new.board_id <> old.board_id or new.created_by is distinct from old.created_by then
    raise exception 'immutable column on strings';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.enforce_group_invariants()
returns trigger
language plpgsql
as $$
begin
  if new.board_id <> old.board_id or new.created_by is distinct from old.created_by then
    raise exception 'immutable column on groups';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger groups_invariants
  before update on public.groups
  for each row execute function public.enforce_group_invariants();
