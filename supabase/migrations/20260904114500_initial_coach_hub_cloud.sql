-- Coach Hub cloud foundation
-- Accounts + shared teams + normalized volleyball data.
-- Local IndexedDB remains the offline working copy; these tables are the cloud canonical store.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teams (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  school text,
  level text,
  season text,
  logo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.team_members (
  team_id text not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','coach','scorekeeper','viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.players (
  id text primary key,
  person_id text,
  team_id text not null references public.teams(id) on delete cascade,
  first_name text,
  last_name text,
  jersey text,
  position text,
  secondary_position text,
  height text,
  grad_year text,
  dominant_hand text,
  notes text,
  photo_path text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.matches (
  id text primary key,
  team_id text not null references public.teams(id) on delete cascade,
  opponent text not null,
  match_date date,
  location text,
  site_type text check (site_type is null or site_type in ('home','away','neutral')),
  conference_type text check (conference_type is null or conference_type in ('conference','nonconference')),
  complete boolean not null default false,
  manual_record boolean not null default false,
  manual_sets_won integer,
  manual_sets_lost integer,
  current_set integer not null default 1,
  home_score integer not null default 0,
  away_score integer not null default 0,
  roster_snapshot jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz
);

create table if not exists public.sets (
  match_id text not null references public.matches(id) on delete cascade,
  team_id text not null references public.teams(id) on delete cascade,
  set_number integer not null,
  home_score integer not null default 0,
  away_score integer not null default 0,
  manual_aggregate boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (match_id, set_number)
);

create table if not exists public.lineups (
  match_id text not null references public.matches(id) on delete cascade,
  team_id text not null references public.teams(id) on delete cascade,
  set_number integer not null,
  serve_receive text not null default 'serve' check (serve_receive in ('serve','receive')),
  slots jsonb not null default '[]'::jsonb,
  current_slots jsonb not null default '[]'::jsonb,
  liberos jsonb not null default '[]'::jsonb,
  libero_replacements jsonb not null default '{}'::jsonb,
  submitted_by uuid references auth.users(id) on delete set null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (match_id, set_number)
);

create table if not exists public.substitutions (
  id text primary key,
  team_id text not null references public.teams(id) on delete cascade,
  match_id text not null references public.matches(id) on delete cascade,
  set_number integer not null,
  slot integer,
  sub_type text not null,
  outgoing_player_id text references public.players(id) on delete set null,
  incoming_player_id text references public.players(id) on delete set null,
  previous_libero_replacement text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.stat_events (
  id text primary key,
  team_id text not null references public.teams(id) on delete cascade,
  match_id text not null references public.matches(id) on delete cascade,
  set_number integer not null,
  player_id text references public.players(id) on delete set null,
  event_type text not null,
  score_impact integer not null default 0,
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists team_members_user_id_idx on public.team_members(user_id);
create index if not exists players_team_id_idx on public.players(team_id);
create index if not exists matches_team_id_idx on public.matches(team_id);
create index if not exists sets_team_id_idx on public.sets(team_id);
create index if not exists lineups_team_id_idx on public.lineups(team_id);
create index if not exists substitutions_team_id_idx on public.substitutions(team_id);
create index if not exists substitutions_match_id_idx on public.substitutions(match_id);
create index if not exists stat_events_team_id_idx on public.stat_events(team_id);
create index if not exists stat_events_match_id_idx on public.stat_events(match_id);
create index if not exists stat_events_player_id_idx on public.stat_events(player_id);

-- Security-definer helpers prevent recursive RLS checks against team_members.
create or replace function public.is_team_member(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = (select auth.uid())
  );
$$;

create or replace function public.team_role(p_team_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select tm.role
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.can_manage_team(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.team_role(p_team_id) in ('owner','coach'), false);
$$;

create or replace function public.can_score_team(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.team_role(p_team_id) in ('owner','coach','scorekeeper'), false);
$$;

revoke all on function public.is_team_member(text) from public;
revoke all on function public.team_role(text) from public;
revoke all on function public.can_manage_team(text) from public;
revoke all on function public.can_score_team(text) from public;
grant execute on function public.is_team_member(text) to authenticated;
grant execute on function public.team_role(text) to authenticated;
grant execute on function public.can_manage_team(text) to authenticated;
grant execute on function public.can_score_team(text) to authenticated;

-- Updated-at triggers.
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists teams_set_updated_at on public.teams;
create trigger teams_set_updated_at before update on public.teams for each row execute function public.set_updated_at();
drop trigger if exists team_members_set_updated_at on public.team_members;
create trigger team_members_set_updated_at before update on public.team_members for each row execute function public.set_updated_at();
drop trigger if exists players_set_updated_at on public.players;
create trigger players_set_updated_at before update on public.players for each row execute function public.set_updated_at();
drop trigger if exists matches_set_updated_at on public.matches;
create trigger matches_set_updated_at before update on public.matches for each row execute function public.set_updated_at();
drop trigger if exists sets_set_updated_at on public.sets;
create trigger sets_set_updated_at before update on public.sets for each row execute function public.set_updated_at();
drop trigger if exists lineups_set_updated_at on public.lineups;
create trigger lineups_set_updated_at before update on public.lineups for each row execute function public.set_updated_at();
drop trigger if exists substitutions_set_updated_at on public.substitutions;
create trigger substitutions_set_updated_at before update on public.substitutions for each row execute function public.set_updated_at();
drop trigger if exists stat_events_set_updated_at on public.stat_events;
create trigger stat_events_set_updated_at before update on public.stat_events for each row execute function public.set_updated_at();

-- Lock down exposed tables to authenticated users, then let RLS decide row access.
revoke all on public.profiles, public.teams, public.team_members, public.players, public.matches, public.sets, public.lineups, public.substitutions, public.stat_events from anon;
revoke all on public.profiles, public.teams, public.team_members, public.players, public.matches, public.sets, public.lineups, public.substitutions, public.stat_events from authenticated;
grant select, insert, update, delete on public.profiles, public.teams, public.team_members, public.players, public.matches, public.sets, public.lineups, public.substitutions, public.stat_events to authenticated;

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.sets enable row level security;
alter table public.lineups enable row level security;
alter table public.substitutions enable row level security;
alter table public.stat_events enable row level security;

-- Profiles: each user owns their own profile.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated
using ((select auth.uid()) = user_id);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert to authenticated
with check ((select auth.uid()) = user_id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Teams: members can read. Only the owner can create/update/delete team metadata.
drop policy if exists teams_select_members on public.teams;
create policy teams_select_members on public.teams for select to authenticated
using (owner_id = (select auth.uid()) or public.is_team_member(id));
drop policy if exists teams_insert_owner on public.teams;
create policy teams_insert_owner on public.teams for insert to authenticated
with check (owner_id = (select auth.uid()));
drop policy if exists teams_update_owner on public.teams;
create policy teams_update_owner on public.teams for update to authenticated
using (owner_id = (select auth.uid()))
with check (owner_id = (select auth.uid()));
drop policy if exists teams_delete_owner on public.teams;
create policy teams_delete_owner on public.teams for delete to authenticated
using (owner_id = (select auth.uid()));

-- Team membership: all team members can see the roster of coaches; only the owner manages it.
drop policy if exists team_members_select_team on public.team_members;
create policy team_members_select_team on public.team_members for select to authenticated
using (public.is_team_member(team_id) or user_id = (select auth.uid()) or exists (
  select 1 from public.teams t where t.id = team_id and t.owner_id = (select auth.uid())
));
drop policy if exists team_members_insert_owner on public.team_members;
create policy team_members_insert_owner on public.team_members for insert to authenticated
with check (exists (
  select 1 from public.teams t where t.id = team_id and t.owner_id = (select auth.uid())
));
drop policy if exists team_members_update_owner on public.team_members;
create policy team_members_update_owner on public.team_members for update to authenticated
using (exists (
  select 1 from public.teams t where t.id = team_id and t.owner_id = (select auth.uid())
))
with check (exists (
  select 1 from public.teams t where t.id = team_id and t.owner_id = (select auth.uid())
));
drop policy if exists team_members_delete_owner on public.team_members;
create policy team_members_delete_owner on public.team_members for delete to authenticated
using (exists (
  select 1 from public.teams t where t.id = team_id and t.owner_id = (select auth.uid())
));

-- Players: all members can read; owners/coaches manage roster data.
drop policy if exists players_select_team on public.players;
create policy players_select_team on public.players for select to authenticated
using (public.is_team_member(team_id));
drop policy if exists players_insert_manage on public.players;
create policy players_insert_manage on public.players for insert to authenticated
with check (public.can_manage_team(team_id));
drop policy if exists players_update_manage on public.players;
create policy players_update_manage on public.players for update to authenticated
using (public.can_manage_team(team_id)) with check (public.can_manage_team(team_id));
drop policy if exists players_delete_manage on public.players;
create policy players_delete_manage on public.players for delete to authenticated
using (public.can_manage_team(team_id));

-- Match/stat tables: all members can read; owners/coaches/scorekeepers can score/edit.
drop policy if exists matches_select_team on public.matches;
create policy matches_select_team on public.matches for select to authenticated using (public.is_team_member(team_id));
drop policy if exists matches_insert_score on public.matches;
create policy matches_insert_score on public.matches for insert to authenticated with check (public.can_score_team(team_id));
drop policy if exists matches_update_score on public.matches;
create policy matches_update_score on public.matches for update to authenticated using (public.can_score_team(team_id)) with check (public.can_score_team(team_id));
drop policy if exists matches_delete_score on public.matches;
create policy matches_delete_score on public.matches for delete to authenticated using (public.can_score_team(team_id));

drop policy if exists sets_select_team on public.sets;
create policy sets_select_team on public.sets for select to authenticated using (public.is_team_member(team_id));
drop policy if exists sets_insert_score on public.sets;
create policy sets_insert_score on public.sets for insert to authenticated with check (public.can_score_team(team_id));
drop policy if exists sets_update_score on public.sets;
create policy sets_update_score on public.sets for update to authenticated using (public.can_score_team(team_id)) with check (public.can_score_team(team_id));
drop policy if exists sets_delete_score on public.sets;
create policy sets_delete_score on public.sets for delete to authenticated using (public.can_score_team(team_id));

drop policy if exists lineups_select_team on public.lineups;
create policy lineups_select_team on public.lineups for select to authenticated using (public.is_team_member(team_id));
drop policy if exists lineups_insert_score on public.lineups;
create policy lineups_insert_score on public.lineups for insert to authenticated with check (public.can_score_team(team_id));
drop policy if exists lineups_update_score on public.lineups;
create policy lineups_update_score on public.lineups for update to authenticated using (public.can_score_team(team_id)) with check (public.can_score_team(team_id));
drop policy if exists lineups_delete_score on public.lineups;
create policy lineups_delete_score on public.lineups for delete to authenticated using (public.can_score_team(team_id));

drop policy if exists substitutions_select_team on public.substitutions;
create policy substitutions_select_team on public.substitutions for select to authenticated using (public.is_team_member(team_id));
drop policy if exists substitutions_insert_score on public.substitutions;
create policy substitutions_insert_score on public.substitutions for insert to authenticated with check (public.can_score_team(team_id));
drop policy if exists substitutions_update_score on public.substitutions;
create policy substitutions_update_score on public.substitutions for update to authenticated using (public.can_score_team(team_id)) with check (public.can_score_team(team_id));
drop policy if exists substitutions_delete_score on public.substitutions;
create policy substitutions_delete_score on public.substitutions for delete to authenticated using (public.can_score_team(team_id));

drop policy if exists stat_events_select_team on public.stat_events;
create policy stat_events_select_team on public.stat_events for select to authenticated using (public.is_team_member(team_id));
drop policy if exists stat_events_insert_score on public.stat_events;
create policy stat_events_insert_score on public.stat_events for insert to authenticated with check (public.can_score_team(team_id));
drop policy if exists stat_events_update_score on public.stat_events;
create policy stat_events_update_score on public.stat_events for update to authenticated using (public.can_score_team(team_id)) with check (public.can_score_team(team_id));
drop policy if exists stat_events_delete_score on public.stat_events;
create policy stat_events_delete_score on public.stat_events for delete to authenticated using (public.can_score_team(team_id));
