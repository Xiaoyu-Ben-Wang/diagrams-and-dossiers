-- A board you made can be deleted.
--
-- Until now nothing could delete one: `boards` had a select policy and an update
-- policy and nothing else, so RLS refused every delete and the library's Delete
-- only ever removed the local copy. The row stayed, with everything on it, for as
-- long as the project lived.
--
-- The cascades were always there and need nothing adding: `members`, `board_blocks`,
-- `articles`, `items`, `strings` and `groups` all reference `boards (id) on delete
-- cascade`, `items.article_id` cascades from `items` so a page takes its pins, and
-- `group_items` cascades from both sides.
--
-- Owner only, and the token is not a door to this: someone who arrived by an edit
-- link is a member with edit rights, and deleting the board out from under the
-- others is not one of them.
--
-- Irreversible, and there is no tombstone: another device keeps whatever copy it
-- already holds in IndexedDB until somebody removes it there.

create policy boards_delete_owner on public.boards
  for delete to authenticated
  using (owner_id = (select auth.uid()));
