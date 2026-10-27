-- Adds club format with safe defaults for all existing school teams.
-- Run once in Supabase SQL Editor before running cloud sync on version 15.39.
alter table public.teams add column if not exists team_type text not null default 'school';
update public.teams set team_type='school'
where team_type is null or team_type not in ('school','club');
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname='teams_team_type_check'
    and conrelid='public.teams'::regclass
  ) then
    alter table public.teams add constraint teams_team_type_check
      check (team_type in ('school','club'));
  end if;
end $$;
alter table public.matches add column if not exists event_name text;
-- No new tables or changed RLS/grants. Existing records remain school.
