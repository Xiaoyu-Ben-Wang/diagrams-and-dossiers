-- Upload quotas, so one person cannot run up the R2 bill.
--
-- The Worker calls `reserve_upload` with the uploader's own session before it
-- writes a new object to R2. The function checks the caller may edit the board,
-- checks their recent uploads against the limits below, and records the upload.
-- A picture R2 already holds costs nothing and never reaches this.
--
-- Limits are per user and per IP address. Anonymous users are free to mint, so
-- the IP limit is the one that holds against someone clearing their storage to
-- get a fresh account; the per-user limits stop one account flooding a board.
-- The IP comes from the Worker (`CF-Connecting-IP`). A client calling this RPC
-- directly can pass any IP, but that only spends its own quota: nothing reaches
-- R2 except through the Worker.

create table public.image_uploads (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  board_id   uuid not null references public.boards (id) on delete cascade,
  ip         text,
  bytes      integer not null check (bytes > 0),
  created_at timestamptz not null default now()
);

create index image_uploads_user_idx on public.image_uploads (user_id, created_at);
create index image_uploads_ip_idx on public.image_uploads (ip, created_at) where ip is not null;

-- No policies: only the functions below touch it.
alter table public.image_uploads enable row level security;

create or replace function public.reserve_upload(
  p_board uuid,
  p_bytes integer,
  p_ip text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Per user.
  c_user_per_hour   constant integer := 30;
  c_user_per_day    constant integer := 100;
  c_user_bytes_day  constant bigint  := 200 * 1024 * 1024;
  -- Per IP address.
  c_ip_per_day      constant integer := 200;
  c_ip_bytes_day    constant bigint  := 400 * 1024 * 1024;

  v_user uuid := (select auth.uid());
  v_hour integer;
  v_day integer;
  v_bytes bigint;
begin
  if v_user is null then
    return 'not_signed_in';
  end if;
  if not public.is_editor(p_board) then
    return 'not_allowed';
  end if;
  if p_bytes is null or p_bytes <= 0 then
    return 'bad_size';
  end if;

  -- One reservation at a time per user, so two parallel uploads cannot both
  -- squeeze under the limit.
  perform pg_advisory_xact_lock(hashtext(v_user::text));

  select count(*) filter (where u.created_at > now() - interval '1 hour'),
         count(*),
         coalesce(sum(u.bytes), 0)
    into v_hour, v_day, v_bytes
  from public.image_uploads u
  where u.user_id = v_user and u.created_at > now() - interval '1 day';

  if v_hour >= c_user_per_hour or v_day >= c_user_per_day
     or v_bytes + p_bytes > c_user_bytes_day then
    return 'limit';
  end if;

  if p_ip is not null then
    select count(*), coalesce(sum(u.bytes), 0)
      into v_day, v_bytes
    from public.image_uploads u
    where u.ip = p_ip and u.created_at > now() - interval '1 day';

    if v_day >= c_ip_per_day or v_bytes + p_bytes > c_ip_bytes_day then
      return 'limit';
    end if;
  end if;

  insert into public.image_uploads (user_id, board_id, ip, bytes)
  values (v_user, p_board, p_ip, p_bytes);
  return 'ok';
end;
$$;

revoke execute on function public.reserve_upload(uuid, integer, text) from public, anon;
grant execute on function public.reserve_upload(uuid, integer, text) to authenticated;

-- The log only needs the last day; keep two.
create or replace function public.prune_image_uploads()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.image_uploads where created_at < now() - interval '2 days'
$$;

revoke execute on function public.prune_image_uploads() from public, anon, authenticated;

select cron.schedule(
  'image-upload-log-prune',
  '17 3 * * *',
  $job$select public.prune_image_uploads()$job$
);
