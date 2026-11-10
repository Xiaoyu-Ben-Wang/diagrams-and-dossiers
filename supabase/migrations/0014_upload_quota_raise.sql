-- More generous upload limits than 0013 set. Only the numbers change:
-- per user 60 an hour, 300 and 500 MB a day; per IP 500 and 1 GB a day.

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
  c_user_per_hour   constant integer := 60;
  c_user_per_day    constant integer := 300;
  c_user_bytes_day  constant bigint  := 500 * 1024 * 1024;
  -- Per IP address.
  c_ip_per_day      constant integer := 500;
  c_ip_bytes_day    constant bigint  := 1024 * 1024 * 1024;

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
