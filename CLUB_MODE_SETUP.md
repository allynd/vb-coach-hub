# Club Mode — v15.39

All pre-existing teams are **School** teams automatically. School match scoring, statistics, and 45-second stream overlays stay unchanged.

## One-time Supabase migration
Before running Full Sync, Update Team, or restoring club team data after upgrading, run `supabase/migrations/20261027110000_club_team_formats.sql` in Supabase SQL Editor. GitHub Pages deploys the app but **cannot apply database migrations**. The migration adds default-School team type and optional tournament/event name to matches, preserving all existing records.

## Club mode
Set Team Type to **Club** when creating a team. Club tracked and stream-only matches use **best of three**, ending as soon as one team wins two sets (2–0 or 2–1). Stream timeout notices expire after **20 seconds** for club, versus **45 seconds** for School.

Club Games groups matches by tournament and match day. Give multiple matches the same tournament name even if played on different dates; use the tournament's **+ Match** control for the next match.

When adding a player, choose **Add from an existing team** to select any School or Club player. This makes a new team roster entry with the same career identity, maintaining separate team/season totals and combined career totals.

To protect historical scoring, changing School/Club type is blocked for teams with existing matches. Create a separate team instead.
