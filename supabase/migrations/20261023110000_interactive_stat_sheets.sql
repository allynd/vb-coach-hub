-- Apply in the same Supabase project used by Coach Hub.
-- A separate append-only log prevents one statkeeper's whole-team snapshot from
-- replacing another statkeeper's independent taps or undo operations.
create table if not exists public.sheet_stat_ops (
  id text primary key,
  team_id text not null,
  match_id text not null,
  event_id text not null,
  action text not null check (action in ('add','delete')),
  payload jsonb not null default '{}'::jsonb,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists sheet_stat_ops_match_order
  on public.sheet_stat_ops(team_id,match_id,created_at,id);
create index if not exists sheet_stat_ops_event
  on public.sheet_stat_ops(match_id,event_id);
alter table public.sheet_stat_ops enable row level security;
drop policy if exists "Team members can read sheet ops" on public.sheet_stat_ops;
create policy "Team members can read sheet ops"
on public.sheet_stat_ops for select to authenticated
using (exists (
  select 1 from public.team_members m
  where m.team_id = sheet_stat_ops.team_id and m.user_id = (select auth.uid())
));
drop policy if exists "Team statkeepers can add sheet ops" on public.sheet_stat_ops;
create policy "Team statkeepers can add sheet ops"
on public.sheet_stat_ops for insert to authenticated
with check (
  user_id = (select auth.uid()) and
  exists (
    select 1 from public.team_members m
    where m.team_id = sheet_stat_ops.team_id and m.user_id = (select auth.uid())
      and m.role in ('owner','coach','scorekeeper')
  )
);
grant select, insert on public.sheet_stat_ops to authenticated;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sheet_stat_ops'
  ) then
    alter publication supabase_realtime add table public.sheet_stat_ops;
  end if;
end $$;
