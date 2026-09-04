# Coach Hub — Supabase Setup

Coach Hub remains offline-first on each device, but Supabase adds accounts and shared cloud data.

## 1. Let the database migration deploy

This repo now contains:

`supabase/migrations/20260904114500_initial_coach_hub_cloud.sql`

If the Supabase GitHub integration is configured to deploy migrations from `main`, confirm that migration succeeds in Supabase before testing cloud features.

If the integration is not applying migrations automatically, use the Supabase CLI workflow (`supabase link` + `supabase db push`) rather than manually maintaining a separate schema.

The migration creates:

- `profiles`
- `teams`
- `team_members`
- `players`
- `matches`
- `sets`
- `lineups`
- `substitutions`
- `stat_events`

It also enables Row Level Security and defines the initial roles:

- `owner`
- `coach`
- `scorekeeper`
- `viewer`

## 2. Configure the browser client

Open `supabase-config.js` and fill in:

```js
export const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_...';
```

Find both values in Supabase **Connect** (or **Settings → API Keys**).

### Security warning

Use only the **publishable** browser key.

Never put a Supabase secret key or legacy `service_role` key in this repo. Coach Hub is a public browser application; the database is protected with RLS instead of hiding the publishable key.

## 3. Configure Auth URLs

In Supabase go to **Authentication → URL Configuration**.

Set the production Site URL to:

`https://allynd.github.io/vb-coach-hub/`

Add the same URL to the allowed Redirect URLs.

This is important if email confirmation is enabled because Supabase uses the Site URL as the default destination after account confirmation.

## 4. Test account creation

After GitHub Pages deploys Coach Hub v11:

1. Open Coach Hub online.
2. Confirm the build badge shows `v11`.
3. Open **Team**.
4. Find **Cloud & Accounts**.
5. Create a test coach account.
6. If email confirmation is enabled, confirm the account from the email and return to Coach Hub.
7. Sign in.

## 5. Test the first cloud team

While signed in:

1. Choose an existing local team.
2. Open **Team → Cloud & Accounts**.
3. Tap **Upload / Refresh Active Team**.
4. Coach Hub creates the cloud team, adds the current account as `owner`, and uploads the roster.
5. Confirm the team appears under **My Cloud Teams**.

On another browser/device, sign into the same account and use **Download** to pull that team and roster onto the device.

This first phase deliberately syncs only team metadata and roster data. Match, set, lineup, substitution, and stat-event synchronization will be added after account/team access is verified.

## 6. Current data ownership model

- **IndexedDB** remains the local/offline working database.
- **Supabase** becomes the shared cloud/canonical database as sync coverage expands.
- The app is still usable without internet.
- Cloud operations require connectivity.

## Next phase

Once account creation and team/roster upload/download are verified, the next implementation should add:

1. Coach invitations and team membership management.
2. Cloud match/set/lineup synchronization.
3. Event-level stat synchronization with offline queues.
4. Realtime updates for multiple coaches.
5. Cloud-backed deletion tombstones so deletes propagate cleanly to offline devices.
6. Full CSV/report exports from normalized cloud/local data.
