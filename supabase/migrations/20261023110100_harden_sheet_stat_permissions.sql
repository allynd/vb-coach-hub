-- Coach Hub 15.32: least-privilege Data API access for collaborative stat operations.
-- Safe to run after the stat-sheet table already exists; does not change stored rows.
-- Remove possible inherited/public/default access. RLS remains enabled.
revoke all privileges on table public.sheet_stat_ops from public, anon, authenticated;

-- Stat operations are an append-only log. A scorekeeper can read and add,
-- but may not directly update or delete historical operations.
grant select, insert on table public.sheet_stat_ops to authenticated;

-- Backend service credentials are server-only and intentionally retain full access.
-- Never use a service_role key in browser code.
grant select, insert, update, delete on table public.sheet_stat_ops to service_role;
