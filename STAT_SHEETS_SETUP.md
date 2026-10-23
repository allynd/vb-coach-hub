# Interactive Stat Sheets (Coach Hub 15.31)

The new **Sheets** navigation item is an alternative to Game Day stat buttons and the classic match-correction stepper. It recreates the four sheets in `Stat Template.pdf`: Serving, Serve Receive, Hitting/Setting, and Defense/Blocking.

## Features
- Tap a cell in a player's row to add a stat tally. Scores are never modified by a sheet tap, so it is safe to record from film after scores have already been entered.
- Select any existing match, including stream-only and manually recorded results, and the set to review.
- All match roster players are shown automatically; open **Players** to hide nonparticipants. Hiding is a local display preference, not a deletion.
- **Undo my last stat** deletes this device's most recent sheet-added event, including an opponent missed serve logged for another set. Undo is propagated to other statkeepers.
- Foot Fault counts toward serve errors, and a Two-Hand Push/Tip counts toward non-kill/non-error hitting attempts. OOS (non-setter) is its own event type.
- Block errors increment by 0.5 to match the existing correction workflow.
- Page 1 counts opponent missed serves by rotation I–VI for the selected set. Page 2 counts opponent missed serves by set. They share the same underlying team event, so they are never added twice automatically.
- Additional Notes are local per match, set, and sheet. Notes do not sync between devices.

## Required Supabase setup for collaborative sessions

1. Apply `supabase/migrations/20261023_interactive_stat_sheets.sql` in the **same Supabase project** currently configured for Coach Hub. This is necessary for the new realtime table and row-level security rules. GitHub Pages deployment does not run SQL migrations.
2. Each statkeeper signs in from the app. The team owner invites each person through **Team Sharing** as **Coach** or **Scorekeeper** (Viewer may read but cannot add entries).
3. The owner must have synced the team and match to the cloud. Additional statkeepers accept the invite and restore/download that team to their device before opening Sheets.
4. All statkeepers open the **same match** and their chosen stat sheet. Divide the groups manually (e.g. serving, passing, hitting/setting, defense/blocking) so different people do not count the same play twice.
5. The status should read **Live sync active**. Each tap is immediately saved locally, uploaded as an immutable operation, and delivered by Supabase Realtime. A 12-second reconciliation poll covers dropped realtime notifications.
6. If signed out, offline, or not yet added to the cloud team, entries are stored locally and queued. Reopen the same sheet after signing in/reconnecting to send them. Watch for the live sync status before concluding collaboration is active.

## Important distinctions
- Collaboration applies to taps/undo recorded with **Interactive Stat Sheets**. The legacy Game Day live scoreboard and other classic match fields do not yet use an all-fields realtime protocol.
- Regular **Full Sync** remains a team backup mechanism; the sheet operation log is replayed on full upload and restore, so it cannot be erased by an older snapshot. Avoid editing match scores/lineups simultaneously on different devices.
- Closing the stat sheet does not lose locally saved entries. Offline operations are queued; if the cloud setup is incomplete, an entry exists only on that local device.
- Stat sheets on phones scroll horizontally like an actual stat sheet; a tablet in landscape is recommended for quickly accessing all columns.

## Verification checklist
1. Save a manually recorded match score, then open **Games > Add / Correct Stats > Use Interactive Stat Sheets**.
2. Enter an Ace, Serve Receive 3, Tip, Block Error, and an Opponent Missed Serve in Set 2. Check that the match score is unchanged and that season totals include the relevant events.
3. Undo the last entry while on Set 1; verify that the Set 2 entry is removed.
4. Hide a player, change tabs, and confirm the hidden player remains hidden while their stats remain untouched.
5. On a second signed-in team member's device, open the same match. Tap different columns on both devices; verify totals combine and neither entry disappears after refresh, cloud restore, or a full sync.
6. Use a classic correction to delete an entry created in the new sheets. Confirm it remains deleted after the other device reconnects.
7. Disconnect one device, enter stats, reconnect and tap **Sync now**. Verify they appear on the other device and are not duplicated.
