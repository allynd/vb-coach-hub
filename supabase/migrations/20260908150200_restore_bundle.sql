-- Coach Hub 15.02 — reliable shared-team restore
-- Consolidates the multi-table restore into one membership-checked RPC so an invited
-- coach does not fail because one of several independent RLS reads is evaluated differently.

create or replace function public.get_team_restore_bundle(p_team_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := (select auth.uid());
  v_bundle jsonb;
begin
  if v_uid is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = v_uid
  ) and not exists (
    select 1
    from public.teams t
    where t.id = p_team_id
      and t.owner_id = v_uid
  ) then
    raise exception 'You do not have access to this team';
  end if;

  if not exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.deleted_at is null
  ) then
    raise exception 'Team not found';
  end if;

  select jsonb_build_object(
    'team', (
      select to_jsonb(t)
      from public.teams t
      where t.id = p_team_id and t.deleted_at is null
    ),
    'players', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at, p.id)
      from public.players p
      where p.team_id = p_team_id and p.deleted_at is null
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.match_date, m.created_at, m.id)
      from public.matches m
      where m.team_id = p_team_id and m.deleted_at is null
    ), '[]'::jsonb),
    'sets', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.match_id, s.set_number)
      from public.sets s
      where s.team_id = p_team_id and s.deleted_at is null
    ), '[]'::jsonb),
    'lineups', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.match_id, l.set_number)
      from public.lineups l
      where l.team_id = p_team_id and l.deleted_at is null
    ), '[]'::jsonb),
    'substitutions', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.created_at, s.id)
      from public.substitutions s
      where s.team_id = p_team_id and s.deleted_at is null
    ), '[]'::jsonb),
    'stat_events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at, e.id)
      from public.stat_events e
      where e.team_id = p_team_id and e.deleted_at is null
    ), '[]'::jsonb),
    'snapshot', (
      select ts.snapshot
      from public.team_snapshots ts
      where ts.team_id = p_team_id
    )
  ) into v_bundle;

  return v_bundle;
end;
$$;

revoke all on function public.get_team_restore_bundle(text) from public;
grant execute on function public.get_team_restore_bundle(text) to authenticated;
