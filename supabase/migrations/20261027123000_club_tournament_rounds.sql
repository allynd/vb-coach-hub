-- Club tournament rounds for match/pool/bracket result organization.
-- Requires the earlier 20261027110000_club_team_formats.sql migration.
-- Safe to re-run; changes no existing team, match or classification.
alter table public.matches
  add column if not exists event_round text;
-- Existing table: existing RLS and Data API permissions remain unchanged.
