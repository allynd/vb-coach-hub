# Coach Hub — Supabase Setup

Coach Hub remains offline-first on each device. Supabase adds accounts, cloud backup/restore, and the shared data layer needed for multi-coach use.

## 1. Apply the database migrations

This repo currently contains:

- `supabase/migrations/20260904114500_initial_coach_hub_cloud.sql`
- `supabase/migrations/20260904140000_full_cloud_sync.sql`

Apply both migrations to the production Supabase project in order. If the GitHub integration is configured to deploy migrations from `main`, confirm both succeed before testing 14.00. Otherwise use the normal Supabase CLI workflow (`supabase link` + `supabase db push`).

The initial migration creates:

- `profiles`
- `teams`
- `team_members`
- `players`
- `matches`
- `sets`
- `lineups`
- `substitutions`
- `stat_events`

The 14.00 migration adds:

- `team_snapshots` — exact per-team JSON safety snapshot
- private `team-media` Storage bucket — team logos and player photos
- Storage RLS policies tied to Coach Hub team membership

The role model is:

- `owner`
- `coach`
- `scorekeeper`
- `viewer`

## 2. Browser client configuration

`supabase-config.js` contains the project's Supabase URL and **publishable** browser key.

Never put a Supabase secret key or legacy `service_role` key in this public repository. Coach Hub relies on Row Level Security instead.

## 3. Authentication URLs

In Supabase open **Authentication → URL Configuration**.

Use:

`https://allynd.github.io/vb-coach-hub/`

for the Site URL and add the same URL to allowed Redirect URLs.

Coach Hub also explicitly supplies that URL when sending signup confirmation emails.

## 4. Full Sync in Coach Hub 14.00

After the app shows build `14.00`:

1. Sign into **Team → Cloud & Accounts**.
2. Keep the desired local team active.
3. Export a normal Coach Hub backup before the first migration.
4. Tap **Full Sync Active Team**.
5. Confirm the completion message lists players, matches, sets, substitutions, and stat events.
6. Confirm the team appears under **My Cloud Teams**.

Full Sync uploads:

- team metadata
- roster/player profiles
- manual and stat-tracked matches
- set scores
- submitted/current lineups
- libero assignments and replacement state
- substitution history
- stat events
- conference/non-conference classification
- home/away/neutral and venue information
- team logo
- player photos
- an exact JSON safety snapshot of the team's non-image local state

## 5. Restore test

On another browser/device signed into the same account:

1. Open **Team → Cloud & Accounts**.
2. Choose **Restore** beside the cloud team.
3. Coach Hub replaces only that team's local copy.
4. Other teams stored on the device remain untouched.

The restored team should include roster, matches, stats, lineups, substitutions, logo, and player photos.

## 6. Current synchronization model

14.00 is intentionally a **full-team snapshot sync**, not yet a realtime multi-writer engine.

- IndexedDB is still the local/offline working database.
- **Full Sync Active Team** makes the cloud copy match the active local team.
- **Restore** replaces that team's local copy with the last successful cloud state.
- Cloud operations require connectivity.
- Normal stat entry remains fully usable offline.

Do not have two coaches independently edit the same team and then both press Full Sync yet. Conflict-aware multi-coach synchronization is the next phase.

## Next phase

The next cloud phase should add:

1. Coach invitations and membership management.
2. Per-record sync metadata/tombstones.
3. Offline sync queue.
4. Conflict-aware event synchronization.
5. Realtime updates for multiple coaches.
6. Professional CSV/report exports.


## October 30, 2026 Data API grant changes

Every new `public` table created by a future migration must explicitly declare access for API roles. Do not automatically give `anon` access to team/player/stat tables. Enable RLS and define per-team policies.

```sql
-- After CREATE TABLE public.your_table (...):
ALTER TABLE public.your_table ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.your_table FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.your_table TO authenticated;
-- Add UPDATE/DELETE only if the feature requires them, with appropriate RLS policies.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.your_table TO service_role;
```

### Interactive stat-sheet migration history

The original `20261023_interactive_stat_sheets.sql` file was renamed to
`20261023110000_interactive_stat_sheets.sql` to meet the Supabase CLI's
14-digit timestamp convention. A second migration
`20261023110100_harden_sheet_stat_permissions.sql` tightens the existing grants.

If the original SQL was pasted into SQL Editor, it may not appear in
`supabase_migrations.schema_migrations`. Verify the actual database state and
migration history before using `supabase db push`; do not run `db reset` on
production or mark unapplied migrations as applied. The hardening SQL is safe to
run on the existing populated `sheet_stat_ops` table without deleting rows.
