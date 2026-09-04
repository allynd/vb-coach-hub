-- Coach Hub 14.00 full cloud sync foundation
-- Adds an exact per-team safety snapshot plus private media storage for team logos/player photos.

create table if not exists public.team_snapshots (
  team_id text primary key references public.teams(id) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists team_snapshots_updated_by_idx on public.team_snapshots(updated_by);

drop trigger if exists team_snapshots_set_updated_at on public.team_snapshots;
create trigger team_snapshots_set_updated_at
before update on public.team_snapshots
for each row execute function public.set_updated_at();

revoke all on public.team_snapshots from anon;
revoke all on public.team_snapshots from authenticated;
grant select, insert, update, delete on public.team_snapshots to authenticated;

alter table public.team_snapshots enable row level security;

drop policy if exists team_snapshots_select_team on public.team_snapshots;
create policy team_snapshots_select_team
on public.team_snapshots for select to authenticated
using (public.is_team_member(team_id));

drop policy if exists team_snapshots_insert_manage on public.team_snapshots;
create policy team_snapshots_insert_manage
on public.team_snapshots for insert to authenticated
with check (public.can_manage_team(team_id));

drop policy if exists team_snapshots_update_manage on public.team_snapshots;
create policy team_snapshots_update_manage
on public.team_snapshots for update to authenticated
using (public.can_manage_team(team_id))
with check (public.can_manage_team(team_id));

drop policy if exists team_snapshots_delete_manage on public.team_snapshots;
create policy team_snapshots_delete_manage
on public.team_snapshots for delete to authenticated
using (public.can_manage_team(team_id));

-- Private team media bucket. Images are intentionally not public because player photos
-- may be identifying; access follows the same team membership rules as the database.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'team-media',
  'team-media',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Object paths always start with the Coach Hub team id:
--   <team_id>/team-logo.ext
--   <team_id>/players/<player_id>.ext
-- storage.foldername(name)[1] is therefore the team id.

drop policy if exists coach_hub_team_media_select on storage.objects;
create policy coach_hub_team_media_select
on storage.objects for select to authenticated
using (
  bucket_id = 'team-media'
  and public.is_team_member((storage.foldername(name))[1])
);

drop policy if exists coach_hub_team_media_insert on storage.objects;
create policy coach_hub_team_media_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'team-media'
  and public.can_manage_team((storage.foldername(name))[1])
);

drop policy if exists coach_hub_team_media_update on storage.objects;
create policy coach_hub_team_media_update
on storage.objects for update to authenticated
using (
  bucket_id = 'team-media'
  and public.can_manage_team((storage.foldername(name))[1])
)
with check (
  bucket_id = 'team-media'
  and public.can_manage_team((storage.foldername(name))[1])
);

drop policy if exists coach_hub_team_media_delete on storage.objects;
create policy coach_hub_team_media_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'team-media'
  and public.can_manage_team((storage.foldername(name))[1])
);
