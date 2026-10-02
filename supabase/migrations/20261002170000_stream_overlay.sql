-- Coach Hub 15.15 — read-only live stream scoreboard feed
-- The scoring device is authenticated. Streamlabs reads only a tiny broadcast JSON
-- through a long random token; it never receives Coach Hub account/team access.

create table if not exists public.stream_overlays (
  team_id text primary key references public.teams(id) on delete cascade,
  match_id text,
  token text not null unique,
  enabled boolean not null default true,
  state jsonb not null default '{}'::jsonb,
  opponent_logo_path text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stream_overlays_token_idx on public.stream_overlays(token);

drop trigger if exists stream_overlays_set_updated_at on public.stream_overlays;
create trigger stream_overlays_set_updated_at
before update on public.stream_overlays
for each row execute function public.set_updated_at();

-- No direct table access. Authenticated scoring devices and anonymous overlay viewers
-- both go through narrowly-scoped security-definer RPCs below.
revoke all on public.stream_overlays from anon;
revoke all on public.stream_overlays from authenticated;
alter table public.stream_overlays enable row level security;

create or replace function public.set_stream_overlay(
  p_team_id text,
  p_match_id text,
  p_token text,
  p_state jsonb,
  p_opponent_logo_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.stream_overlays;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not (
    public.can_score_team(p_team_id)
    or exists (
      select 1 from public.teams t
      where t.id = p_team_id and t.owner_id = v_uid and t.deleted_at is null
    )
  ) then
    raise exception 'You do not have permission to publish this team';
  end if;

  if p_token is null or length(p_token) < 24 then
    raise exception 'Overlay token is invalid';
  end if;

  insert into public.stream_overlays (
    team_id, match_id, token, enabled, state, opponent_logo_path, updated_by
  )
  values (
    p_team_id, p_match_id, p_token, true, coalesce(p_state,'{}'::jsonb), p_opponent_logo_path, v_uid
  )
  on conflict (team_id) do update set
    match_id = excluded.match_id,
    token = excluded.token,
    enabled = true,
    state = excluded.state,
    opponent_logo_path = excluded.opponent_logo_path,
    updated_by = excluded.updated_by,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'team_id', v_row.team_id,
    'match_id', v_row.match_id,
    'token', v_row.token,
    'enabled', v_row.enabled,
    'opponent_logo_path', v_row.opponent_logo_path,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.get_stream_overlay_admin(p_team_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.stream_overlays;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not (
    public.can_score_team(p_team_id)
    or exists (
      select 1 from public.teams t
      where t.id = p_team_id and t.owner_id = v_uid and t.deleted_at is null
    )
  ) then
    raise exception 'You do not have permission to manage this overlay';
  end if;

  select * into v_row
  from public.stream_overlays
  where team_id = p_team_id;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'team_id', v_row.team_id,
    'match_id', v_row.match_id,
    'token', v_row.token,
    'enabled', v_row.enabled,
    'state', v_row.state,
    'opponent_logo_path', v_row.opponent_logo_path,
    'updated_at', v_row.updated_at
  );
end;
$$;

create or replace function public.disable_stream_overlay(p_team_id text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not (
    public.can_score_team(p_team_id)
    or exists (
      select 1 from public.teams t
      where t.id = p_team_id and t.owner_id = v_uid and t.deleted_at is null
    )
  ) then
    raise exception 'You do not have permission to manage this overlay';
  end if;

  update public.stream_overlays
  set enabled = false, updated_by = v_uid, updated_at = now()
  where team_id = p_team_id;
end;
$$;

create or replace function public.get_stream_overlay(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when so.team_id is null then null
    else so.state || jsonb_build_object(
      'enabled', so.enabled,
      'feedUpdatedAt', so.updated_at
    )
  end
  from public.stream_overlays so
  where so.token = p_token
    and so.enabled = true
  limit 1;
$$;

revoke all on function public.set_stream_overlay(text,text,text,jsonb,text) from public;
revoke all on function public.get_stream_overlay_admin(text) from public;
revoke all on function public.disable_stream_overlay(text) from public;
revoke all on function public.get_stream_overlay(text) from public;

grant execute on function public.set_stream_overlay(text,text,text,jsonb,text) to authenticated;
grant execute on function public.get_stream_overlay_admin(text) to authenticated;
grant execute on function public.disable_stream_overlay(text) to authenticated;
grant execute on function public.get_stream_overlay(text) to anon, authenticated;
