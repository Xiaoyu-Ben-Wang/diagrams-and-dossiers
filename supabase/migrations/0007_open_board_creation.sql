-- Any browser that opens the app may make its own boards.
--
-- The gate was the only thing standing between a new browser and a board of its
-- own, and it held: `profiles.can_create_boards` is set by exactly one thing,
-- `redeem_creator_invite`, and nothing creates a profile row otherwise — so a fresh
-- anonymous user has no row at all, `create_board`'s check finds nothing to match,
-- and the board stays on one machine with no share link. Nothing said so; the
-- library only offers "No share link from this device". On the deployed origin that
-- meant nobody could make the first board.
--
-- `create_board` is deliberately not touched. The gate stays and is simply
-- satisfied from the moment a user exists, and the invite machinery is left in
-- place, unused: this is a personal board shared with friends, and an invite-only
-- door is the wrong shape for it.
--
-- The trigger has to be on `auth.users` rather than on `public.profiles`, because
-- nothing creates a profile row today and so there is no row for a profiles trigger
-- to fire on. That makes this trigger load-bearing: a user created without it firing
-- is indistinguishable, to `create_board`, from a user who was refused. The backfill
-- below is the repair, and is safe to re-run.

create or replace function public.on_user_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, can_create_boards)
  values (new.id, true)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.on_user_created();

-- Everyone who already exists. The app mints an anonymous user per browser and most
-- of them have no profile row at all, so this cannot be an update: the row itself is
-- what carries the entitlement, and several users have none to update.
insert into public.profiles (user_id, can_create_boards)
select u.id, true from auth.users u
on conflict (user_id) do update set can_create_boards = true;
