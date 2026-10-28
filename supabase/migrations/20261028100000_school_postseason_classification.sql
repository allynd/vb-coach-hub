-- Coach Hub 15.43 — allow School Post Season match classification in Supabase.
-- Existing conference / nonconference records and team/season stats are unchanged.
-- Safe to rerun. Applies to the original public.matches table, not new tables.
alter table public.matches drop constraint if exists matches_conference_type_check;
alter table public.matches add constraint matches_conference_type_check
  check (conference_type is null or conference_type in ('conference','nonconference','postseason'));
-- Existing RLS policies and grants remain intact.
