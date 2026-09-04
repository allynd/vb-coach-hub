-- Coach Hub 15.00 — team invitations and membership
-- Invite tokens are never stored in plaintext. Only a SHA-256 hash is stored.

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id text not null references public.teams(id) on delete cascade,
  role text not null check (role in ('coach','scorekeeper','viewer')),
  invited_email text,
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz
);

create index if not exists team_invites_team_id_idx on public.team_invites(team_id);
create index if not exists team_invites_expires_at_idx on public.team_invites(expires_at);

alter table public.team_invites enable row level security;
revoke all on public.team_invites from anon, authenticated;
grant select on public.team_invites to authenticated;

-- Owners may view invitations for teams they own.
drop policy if exists team_invites_select_owner on public.team_invites;
create policy team_invites_select_owner on public.team_invites
for select to authenticated
using (exists (
  select 1 from public.teams t
  where t.id = team_id
    and t.owner_id = (select auth.uid())
));

-- Create an invitation. The raw token is returned once and only its hash is stored.
create or replace function public.create_team_invite(
  p_team_id text,
  p_role text,
  p_invited_email text default null,
  p_expires_hours integer default 168
)
returns table(invite_id uuid, invite_token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if not exists (
    select 1 from public.teams t
    where t.id = p_team_id
      and t.owner_id = (select auth.uid())
  ) then
    raise exception 'Only the team owner can create invitations';
  end if;

  if p_role not in ('coach','scorekeeper','viewer') then
    raise exception 'Invalid invitation role';
  end if;

  if p_expires_hours < 1 or p_expires_hours > 720 then
    raise exception 'Invitation expiration must be between 1 and 720 hours';
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');
  v_expires := now() + make_interval(hours => p_expires_hours);

  insert into public.team_invites (
    team_id, role, invited_email, token_hash, created_by, expires_at
  ) values (
    p_team_id,
    p_role,
    nullif(lower(trim(p_invited_email)), ''),
    encode(digest(v_token, 'sha256'), 'hex'),
    (select auth.uid()),
    v_expires
  ) returning id into v_id;

  return query select v_id, v_token, v_expires;
end;
$$;

-- Preview a valid invitation from possession of its secret token.
-- This is intentionally available before login so a new coach can see what they were invited to.
create or replace function public.preview_team_invite(p_token text)
returns table(team_id text, team_name text, invite_role text, email_required boolean, expires_at timestamptz)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select i.team_id,
         t.name,
         i.role,
         (i.invited_email is not null),
         i.expires_at
  from public.team_invites i
  join public.teams t on t.id = i.team_id
  where i.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and i.revoked_at is null
    and i.accepted_at is null
    and i.expires_at > now()
    and t.deleted_at is null
  limit 1;
$$;

-- Accept a valid invitation using the currently authenticated account.
create or replace function public.accept_team_invite(p_token text)
returns table(team_id text, team_name text, member_role text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_invite public.team_invites%rowtype;
  v_email text;
  v_existing_role text;
  v_team_name text;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  select * into v_invite
  from public.team_invites i
  where i.token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and i.revoked_at is null
    and i.accepted_at is null
    and i.expires_at > now()
  for update;

  if not found then
    raise exception 'This invitation is invalid, expired, already used, or revoked';
  end if;

  v_email := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  if v_invite.invited_email is not null and lower(v_invite.invited_email) <> v_email then
    raise exception 'This invitation was created for a different email address';
  end if;

  select tm.role into v_existing_role
  from public.team_members tm
  where tm.team_id = v_invite.team_id
    and tm.user_id = (select auth.uid());

  if v_existing_role is null then
    insert into public.team_members(team_id, user_id, role)
    values (v_invite.team_id, (select auth.uid()), v_invite.role);
    v_existing_role := v_invite.role;
  end if;

  update public.team_invites
  set accepted_by = (select auth.uid()), accepted_at = now()
  where id = v_invite.id;

  select t.name into v_team_name from public.teams t where t.id = v_invite.team_id;
  return query select v_invite.team_id, v_team_name, v_existing_role;
end;
$$;

create or replace function public.revoke_team_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id text;
begin
  select i.team_id into v_team_id from public.team_invites i where i.id = p_invite_id;
  if v_team_id is null then raise exception 'Invitation not found'; end if;

  if not exists (
    select 1 from public.teams t
    where t.id = v_team_id
      and t.owner_id = (select auth.uid())
  ) then
    raise exception 'Only the team owner can revoke invitations';
  end if;

  update public.team_invites set revoked_at = now()
  where id = p_invite_id and accepted_at is null;
end;
$$;

-- Safe member directory for the Team screen. Auth email is exposed only to teammates.
create or replace function public.list_team_members(p_team_id text)
returns table(user_id uuid, email text, display_name text, member_role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public, auth
as $$
  select tm.user_id,
         u.email::text,
         p.display_name,
         tm.role,
         tm.created_at
  from public.team_members tm
  join auth.users u on u.id = tm.user_id
  left join public.profiles p on p.user_id = tm.user_id
  where tm.team_id = p_team_id
    and public.is_team_member(p_team_id)
  order by case tm.role when 'owner' then 0 when 'coach' then 1 when 'scorekeeper' then 2 else 3 end,
           coalesce(p.display_name, u.email);
$$;

revoke all on function public.create_team_invite(text,text,text,integer) from public;
revoke all on function public.preview_team_invite(text) from public;
revoke all on function public.accept_team_invite(text) from public;
revoke all on function public.revoke_team_invite(uuid) from public;
revoke all on function public.list_team_members(text) from public;

grant execute on function public.create_team_invite(text,text,text,integer) to authenticated;
grant execute on function public.preview_team_invite(text) to anon, authenticated;
grant execute on function public.accept_team_invite(text) to authenticated;
grant execute on function public.revoke_team_invite(uuid) to authenticated;
grant execute on function public.list_team_members(text) to authenticated;
