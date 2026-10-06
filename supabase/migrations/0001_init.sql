-- Never add `ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY`: it fails
-- with `42501 ...`, aborting the transaction and skipping every later statement.
--
-- `security definer` functions pin `search_path = ''`: without it a caller can
-- shadow `public.members` with their own table.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.generate_token()
returns text
language sql
volatile
as $$
  select translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_')
$$;

-- `can_create_boards` is granted only by creator invites; without it you can
-- join boards but not mint your own.
create table public.profiles (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  display_name       text,
  can_create_boards  boolean not null default false,
  created_at         timestamptz not null default now()
);

-- Each token column is an independent link: NULL disables that link without
-- disturbing the others.
create table public.boards (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  owner_id    uuid not null references auth.users (id) on delete cascade,
  view_token  text unique,
  edit_token  text unique,
  dm_token    text unique,
  created_at  timestamptz not null default now()
);

create index boards_view_token_idx on public.boards (view_token) where view_token is not null;
create index boards_edit_token_idx on public.boards (edit_token) where edit_token is not null;
create index boards_dm_token_idx   on public.boards (dm_token)   where dm_token   is not null;

create table public.members (
  board_id     uuid not null references public.boards (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  role         text not null default 'viewer'
                 check (role in ('viewer', 'editor', 'dm', 'owner')),
  display_name text,
  color        text,
  joined_via   text,
  created_at   timestamptz not null default now(),
  primary key (board_id, user_id)
);

-- Soft, cooperative revocation: someone determined can clear storage and rejoin;
-- rotating the link is the real remedy.
create table public.board_blocks (
  board_id   uuid not null references public.boards (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create table public.creator_invites (
  token      text primary key,
  note       text,
  created_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.articles (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.boards (id) on delete cascade,
  title       text not null,
  slug        text not null,
  body_md     text not null default '',
  visibility  text not null default 'shared' check (visibility in ('shared', 'dm')),
  reveal_at   timestamptz,
  board_x     double precision not null default 0,
  board_y     double precision not null default 0,
  version     integer not null default 1,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (board_id, slug)
);

create index articles_board_idx on public.articles (board_id);

-- A thing on the board is located EITHER by a board position OR by a text
-- anchor, never both.
create table public.items (
  id             uuid primary key default gen_random_uuid(),
  board_id       uuid not null references public.boards (id) on delete cascade,
  kind           text not null default 'note'
                   check (kind in ('note', 'article_ref', 'image')),
  title          text,
  body_md        text not null default '',
  color          text,
  visibility     text not null default 'shared' check (visibility in ('shared', 'dm')),
  reveal_at      timestamptz,

  board_x        double precision,
  board_y        double precision,
  article_id     uuid references public.articles (id) on delete cascade,
  anchor         jsonb,

  status         text not null default 'theory'
                   check (status in ('theory', 'confirmed', 'disproven')),
  date_label     text,
  occurred_at    timestamptz,
  date_precision text check (date_precision in ('year', 'month', 'day', 'exact')),
  date_inherit   boolean not null default true,

  z_index        integer not null default 0,
  version        integer not null default 1,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint items_location_check check (
    (article_id is not null and anchor is not null)
    or (board_x is not null and board_y is not null)
  )
);

create index items_board_idx    on public.items (board_id);
create index items_article_idx  on public.items (article_id) where article_id is not null;
create index items_timeline_idx on public.items (board_id, occurred_at) where occurred_at is not null;

create table public.groups (
  id             uuid primary key default gen_random_uuid(),
  board_id       uuid not null references public.boards (id) on delete cascade,
  name           text not null,
  color          text not null default 'amber',
  visibility     text not null default 'shared' check (visibility in ('shared', 'dm')),
  date_label     text,
  occurred_at    timestamptz,
  date_precision text check (date_precision in ('year', 'month', 'day', 'exact')),
  version        integer not null default 1,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index groups_board_idx on public.groups (board_id);

create table public.group_items (
  group_id uuid not null references public.groups (id) on delete cascade,
  item_id  uuid not null references public.items (id) on delete cascade,
  primary key (group_id, item_id)
);

create table public.strings (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.boards (id) on delete cascade,
  from_item  uuid not null references public.items (id) on delete cascade,
  to_item    uuid not null references public.items (id) on delete cascade,
  color      text not null default 'crimson',
  style      text not null default 'solid' check (style in ('solid', 'dashed', 'double')),
  label      text,
  visibility text not null default 'shared' check (visibility in ('shared', 'dm')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint strings_no_self_loop check (from_item <> to_item)
);

create index strings_board_idx on public.strings (board_id);

-- Run with the definer's rights (to read `members` past the caller's policy);
-- execute is revoked from PUBLIC below so only authenticated callers may use them.
create or replace function public.is_member(b uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.board_id = b and m.user_id = (select auth.uid())
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
    select 1 from public.members m
    where m.board_id = b
      and m.user_id = (select auth.uid())
      and m.role in ('editor', 'dm', 'owner')
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
    select 1 from public.members m
    where m.board_id = b
      and m.user_id = (select auth.uid())
      and m.role in ('dm', 'owner')
  )
$$;

revoke execute on function public.is_member(uuid) from public;
revoke execute on function public.is_editor(uuid) from public;
revoke execute on function public.is_dm(uuid)     from public;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_editor(uuid) to authenticated;
grant execute on function public.is_dm(uuid)     to authenticated;

alter table public.profiles        enable row level security;
alter table public.boards          enable row level security;
alter table public.members         enable row level security;
alter table public.board_blocks    enable row level security;
alter table public.creator_invites enable row level security;
alter table public.articles        enable row level security;
alter table public.items           enable row level security;
alter table public.groups          enable row level security;
alter table public.group_items     enable row level security;
alter table public.strings         enable row level security;

-- `can_create_boards` is deliberately not client-updatable: only the redemption
-- RPC may grant it, or anyone could self-promote.
create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy boards_select_member on public.boards
  for select to authenticated using (public.is_member(id));

create policy boards_update_owner on public.boards
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- There is deliberately NO insert policy: joining happens only through the
-- join_board RPC, so the role cannot be chosen by the client.
create policy members_select_fellow on public.members
  for select to authenticated using (public.is_member(board_id));

create policy members_delete_dm on public.members
  for delete to authenticated using (public.is_dm(board_id));

-- No policies at all means no client access.
create policy creator_invites_no_client on public.creator_invites
  for select to authenticated using (false);

create policy articles_select on public.articles
  for select to authenticated
  using (
    public.is_member(board_id)
    and (visibility = 'shared' or public.is_dm(board_id))
    and (reveal_at is null or reveal_at <= now())
  );

create policy articles_insert on public.articles
  for insert to authenticated
  with check (public.is_editor(board_id) and created_by = (select auth.uid()));

create policy articles_update on public.articles
  for update to authenticated
  using (public.is_editor(board_id))
  with check (public.is_editor(board_id));

create policy articles_delete on public.articles
  for delete to authenticated using (public.is_editor(board_id));

create policy items_select on public.items
  for select to authenticated
  using (
    public.is_member(board_id)
    and (visibility = 'shared' or public.is_dm(board_id))
    and (reveal_at is null or reveal_at <= now())
  );

create policy items_insert on public.items
  for insert to authenticated
  with check (public.is_editor(board_id) and created_by = (select auth.uid()));

create policy items_update on public.items
  for update to authenticated
  using (public.is_editor(board_id))
  with check (public.is_editor(board_id));

create policy items_delete on public.items
  for delete to authenticated using (public.is_editor(board_id));

create policy groups_select on public.groups
  for select to authenticated
  using (public.is_member(board_id) and (visibility = 'shared' or public.is_dm(board_id)));

create policy groups_insert on public.groups
  for insert to authenticated
  with check (public.is_editor(board_id) and created_by = (select auth.uid()));

create policy groups_update on public.groups
  for update to authenticated
  using (public.is_editor(board_id))
  with check (public.is_editor(board_id));

create policy groups_delete on public.groups
  for delete to authenticated using (public.is_editor(board_id));

create policy group_items_select on public.group_items
  for select to authenticated
  using (exists (
    select 1 from public.groups g
    where g.id = group_id and public.is_member(g.board_id)
      and (g.visibility = 'shared' or public.is_dm(g.board_id))
  ));

create policy group_items_write on public.group_items
  for all to authenticated
  using (exists (
    select 1 from public.groups g where g.id = group_id and public.is_editor(g.board_id)
  ))
  with check (exists (
    select 1 from public.groups g where g.id = group_id and public.is_editor(g.board_id)
  ));

create policy strings_select on public.strings
  for select to authenticated
  using (public.is_member(board_id) and (visibility = 'shared' or public.is_dm(board_id)));

create policy strings_insert on public.strings
  for insert to authenticated
  with check (public.is_editor(board_id) and created_by = (select auth.uid()));

create policy strings_update on public.strings
  for update to authenticated
  using (public.is_editor(board_id))
  with check (public.is_editor(board_id));

create policy strings_delete on public.strings
  for delete to authenticated using (public.is_editor(board_id));

-- Policies alone cannot stop a member moving a row to another board, forging
-- authorship, or pinning `version` so concurrency never triggers.
create or replace function public.enforce_item_invariants()
returns trigger
language plpgsql
as $$
begin
  if new.board_id <> old.board_id
     or new.created_by is distinct from old.created_by
     or new.kind <> old.kind
     or new.article_id is distinct from old.article_id then
    raise exception 'immutable column on items';
  end if;

  -- Version is owned by the database: a client that could set it would defeat
  -- optimistic concurrency. Callers filter on the version they read.
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger items_invariants
  before update on public.items
  for each row execute function public.enforce_item_invariants();

create or replace function public.enforce_article_invariants()
returns trigger
language plpgsql
as $$
begin
  if new.board_id <> old.board_id or new.created_by is distinct from old.created_by then
    raise exception 'immutable column on articles';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger articles_invariants
  before update on public.articles
  for each row execute function public.enforce_article_invariants();

create or replace function public.enforce_string_invariants()
returns trigger
language plpgsql
as $$
begin
  if new.board_id <> old.board_id or new.created_by is distinct from old.created_by then
    raise exception 'immutable column on strings';
  end if;
  return new;
end;
$$;

create trigger strings_invariants
  before update on public.strings
  for each row execute function public.enforce_string_invariants();

create or replace function public.redeem_creator_invite(p_token text, p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.creator_invites ci
    where ci.token = p_token and ci.revoked_at is null
  ) then
    raise exception 'invalid or revoked invite';
  end if;

  insert into public.profiles (user_id, display_name, can_create_boards)
  values (v_user, p_display_name, true)
  on conflict (user_id) do update
    set can_create_boards = true,
        display_name = coalesce(excluded.display_name, public.profiles.display_name);
end;
$$;

create or replace function public.create_board(p_name text, p_slug text)
returns table (board_id uuid, view_token text, edit_token text, dm_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_board uuid;
  v_view text := public.generate_token();
  v_edit text := public.generate_token();
  v_dm   text := public.generate_token();
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.user_id = v_user and p.can_create_boards
  ) then
    raise exception 'not permitted to create boards';
  end if;

  insert into public.boards (name, slug, owner_id, view_token, edit_token, dm_token)
  values (p_name, p_slug, v_user, v_view, v_edit, v_dm)
  returning id into v_board;

  insert into public.members (board_id, user_id, role, joined_via)
  values (v_board, v_user, 'owner', 'creator');

  return query select v_board, v_view, v_edit, v_dm;
end;
$$;

-- The token decides the role, so the caller cannot choose privilege; re-redeeming
-- an existing link never downgrades an owner.
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
  on conflict (board_id, user_id) do update
    set display_name = coalesce(excluded.display_name, public.members.display_name);

  return query
    select m.board_id, m.role from public.members m
    where m.board_id = v_board and m.user_id = v_user;
end;
$$;

revoke execute on function public.redeem_creator_invite(text, text) from public;
revoke execute on function public.create_board(text, text)           from public;
revoke execute on function public.join_board(text, text)             from public;
grant execute on function public.redeem_creator_invite(text, text) to authenticated;
grant execute on function public.create_board(text, text)           to authenticated;
grant execute on function public.join_board(text, text)             to authenticated;
