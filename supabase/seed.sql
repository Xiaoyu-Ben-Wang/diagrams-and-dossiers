-- Bootstrap.
--
-- There is no signup screen and no first-user-is-admin rule, so the very first
-- creator invite has to be minted out of band. Run this once after
-- `supabase db reset` and note the token it prints:
--
--   psql "$DATABASE_URL" -f supabase/seed.sql
--
-- Then visit /c/<token> to claim it. From there the app mints board links
-- itself — this is the only token that ever needs to be handled manually.

insert into public.creator_invites (token, note)
values (public.generate_token(), 'bootstrap invite — rotate or revoke after use')
returning token;
