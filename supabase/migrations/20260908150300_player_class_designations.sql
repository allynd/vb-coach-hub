-- Coach Hub 15.03 — replace graduation years with current class designations.
-- Existing 2026-27 roster mapping requested by the owner:
--   2027 -> SR, 2028 -> JR, 2029 -> SO, 2030 -> FR

update public.players
set grad_year = case trim(grad_year)
  when '2027' then 'SR'
  when '2028' then 'JR'
  when '2029' then 'SO'
  when '2030' then 'FR'
  else upper(trim(grad_year))
end
where grad_year is not null
  and trim(grad_year) <> ''
  and (
    trim(grad_year) in ('2027','2028','2029','2030')
    or upper(trim(grad_year)) in ('FR','SO','JR','SR')
  );

-- Keep the exact safety snapshots aligned too, so a restore does not reintroduce
-- the old numeric graduation-year values before the next full sync.
update public.team_snapshots ts
set snapshot = jsonb_set(
  ts.snapshot,
  '{players}',
  coalesce((
    select jsonb_agg(
      case p->>'gradYear'
        when '2027' then jsonb_set(p,'{gradYear}','"SR"'::jsonb,true)
        when '2028' then jsonb_set(p,'{gradYear}','"JR"'::jsonb,true)
        when '2029' then jsonb_set(p,'{gradYear}','"SO"'::jsonb,true)
        when '2030' then jsonb_set(p,'{gradYear}','"FR"'::jsonb,true)
        else p
      end
    )
    from jsonb_array_elements(ts.snapshot->'players') p
  ), '[]'::jsonb),
  true
)
where jsonb_typeof(ts.snapshot->'players')='array';
