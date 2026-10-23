export function applySheetOps(state, rows) {
  state.events = Array.isArray(state.events) ? state.events : [];
  const tombstones = new Set(state.sheetStatTombstones || []);
  for (const op of rows || []) if (op.action === 'delete' && op.event_id) tombstones.add(op.event_id);
  const known = new Set(state.events.map(e => e.id));
  for (const op of rows || []) {
    if (op.action !== 'add' || !op.event_id || tombstones.has(op.event_id) || known.has(op.event_id)) continue;
    const event = op.payload?.event;
    if (!event || event.id !== op.event_id || event.gameId !== op.match_id || event.teamId !== op.team_id) continue;
    state.events.push(event);
    known.add(event.id);
  }
  if (tombstones.size) state.events = state.events.filter(e => !tombstones.has(e.id));
  state.sheetStatTombstones = [...tombstones];
  return state;
}
export async function fetchSheetOps(supabase, teamId, matchId = null) {
  const result = [];
  for (let start = 0; ; start += 1000) {
    let query = supabase.from('sheet_stat_ops')
      .select('id,team_id,match_id,event_id,action,payload,created_at')
      .eq('team_id', teamId).order('created_at', {ascending:true}).order('id', {ascending:true}).range(start,start+999);
    if (matchId) query = query.eq('match_id',matchId);
    const {data,error} = await query;
    if(error) throw error;
    result.push(...(data || []));
    if(!data || data.length < 1000) break;
  }
  return result;
}
