-- Coach Hub 15.01 — owner membership management
-- Keep role changes/removals behind constrained security-definer functions.

create or replace function public.update_team_member_role(
  p_team_id text,
  p_user_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and t.owner_id = (select auth.uid())
      and t.deleted_at is null
  ) then
    raise exception 'Only the team owner can change member roles';
  end if;

  if p_role not in ('coach','scorekeeper','viewer') then
    raise exception 'Invalid member role';
  end if;

  select tm.role into v_current_role
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.user_id = p_user_id;

  if v_current_role is null then
    raise exception 'Team member not found';
  end if;

  if v_current_role = 'owner' then
    raise exception 'The team owner role cannot be changed here';
  end if;

  update public.team_members
  set role = p_role
  where team_id = p_team_id
    and user_id = p_user_id;
end;
$$;

create or replace function public.remove_team_member(
  p_team_id text,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and t.owner_id = (select auth.uid())
      and t.deleted_at is null
  ) then
    raise exception 'Only the team owner can remove members';
  end if;

  select tm.role into v_current_role
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.user_id = p_user_id;

  if v_current_role is null then
    raise exception 'Team member not found';
  end if;

  if v_current_role = 'owner' then
    raise exception 'The team owner cannot be removed';
  end if;

  delete from public.team_members
  where team_id = p_team_id
    and user_id = p_user_id;
end;
$$;

revoke all on function public.update_team_member_role(text,uuid,text) from public;
revoke all on function public.remove_team_member(text,uuid) from public;
grant execute on function public.update_team_member_role(text,uuid,text) to authenticated;
grant execute on function public.remove_team_member(text,uuid) to authenticated;
