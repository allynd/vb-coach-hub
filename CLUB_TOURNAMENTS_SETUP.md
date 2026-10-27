# Club Tournaments — v15.40

## What changes
Club teams use a tournament directory rather than one long match list. Choose a tournament to see its overall match record, match results by day, team stat totals, bracket/pool rounds, and tournament-only player statistics. Club match types are no longer classified as Conference, Non-Conference, or Post Season; all results contribute to the single Club season.

Select a **Tournament / Event** and **Tournament Round** when creating or editing a Club match. Round choices: Pool Play, Round of 16, Quarterfinal, Semifinal, Final, Consolation, Placement, Other. The bracket view groups actual saved results by the round chosen. It **does not** generate a seeded bracket, advancement, opponents, or schedule automatically. School classifications and school match views are unchanged.

All existing Club matches are kept and grouped using their saved tournament names. Matches without a tournament are shown under **Unassigned tournament**; existing matches without a round appear under **Unassigned** in the round view.

## Database step before cloud synchronization
Apply the existing `supabase/migrations/20261027110000_club_team_formats.sql` first if not already applied. Then apply `supabase/migrations/20261027123000_club_tournament_rounds.sql` in Supabase SQL Editor. These add columns to existing tables, without changing historical stats or records. GitHub Pages **does not** execute SQL, so cloud sync needs this manual step.
