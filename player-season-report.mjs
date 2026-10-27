import {withPerSetRates} from './player-set-rates.mjs';

const seasonEvent = (e,teamId,gameIds,playerId)=>
  e?.playerId===playerId && (gameIds.has(e.gameId) ||
    (e.kind==='season_adjustment' && e.teamId===teamId));

function gameOutcome(game){
  if(!game.complete)return 'In progress';
  if(game.manualRecord){
    const a=Number(game.manualSetsWon)||0,b=Number(game.manualSetsLost)||0;
    return a>b?'W':b>a?'L':'—';
  }
  const sets=Array.isArray(game.sets)?game.sets:[];
  const w=sets.filter(s=>Number(s.home)>Number(s.away)).length;
  const l=sets.filter(s=>Number(s.away)>Number(s.home)).length;
  return w>l?'W':l>w?'L':'—';
}
function setsResult(game){
  if(game.manualRecord)return `${Number(game.manualSetsWon)||0}-${Number(game.manualSetsLost)||0}`;
  let won=0,lost=0;
  for(const s of game.sets||[]){
    if(Number(s.home)>Number(s.away))won++;
    else if(Number(s.away)>Number(s.home))lost++;
  }
  return `${won}-${lost}`;
}
function scoreDetails(game){
  if(game.manualRecord)return 'Aggregate result only';
  return (game.sets||[]).map(s=>`${s.home}-${s.away}`).join(' | ')||'—';
}
/**
 * Pure, team-season-scoped report data. One row per match, including zero-stat
 * matches, so the player season ledger never silently omits a game.
 * Season adjustments remain separate to reconcile season totals with match rows.
 */
export function buildPlayerSeasonReport(state,{teamId,playerId},summarize){
  const team=(state.teams||[]).find(t=>t.id===teamId);
  const player=(state.players||[]).find(p=>p.id===playerId&&p.teamId===teamId);
  if(!team||!player)throw Error('Choose a player on the current team to export their season.');
  const games=(state.games||[]).filter(g=>g.teamId===teamId)
    .sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')) ||
      String(a.createdAt||'').localeCompare(String(b.createdAt||'')) || String(a.id).localeCompare(String(b.id)));
  const gameIds=new Set(games.map(g=>g.id));
  const events=(state.events||[]).filter(e=>seasonEvent(e,teamId,gameIds,playerId));
  const matches=games.map(game=>{
    const matchEvents=(state.events||[]).filter(e=>e.gameId===game.id);
    const stats=withPerSetRates(summarize(matchEvents,playerId),[game],matchEvents,[playerId]);
    const onRoster=(game.rosterSnapshot||[]).some(p=>(typeof p==='string'?p:p.playerId)===playerId);
    const hasEvents=matchEvents.some(e=>e.playerId===playerId || e.incomingPlayerId===playerId || e.outgoingPlayerId===playerId);
    return {
      id:game.id,date:game.date||'',opponent:game.opponent||'Opponent',
      tournament:game.eventName||'',round:game.eventRound||'',
      result:gameOutcome(game),sets:setsResult(game),setScores:scoreDetails(game),
      participation:stats.SP>0?'Played':hasEvents?'Recorded event':onRoster?'On roster (no appearance recorded)':'No appearance recorded',
      stats
    };
  });
  const seasonStats=withPerSetRates(summarize(events,playerId),games,events,[playerId]);
  const adjustments=events.filter(e=>e.kind==='season_adjustment');
  const adjustmentStats=adjustments.length?
    withPerSetRates(summarize(adjustments,playerId),[],adjustments,[playerId]):null;
  return {
    team,player,seasonStats,matches,adjustmentStats,
    filename:[team.name,team.season,player.firstName,player.lastName,'season-match-breakdown']
      .filter(Boolean).join('-')+'.xlsx'
  };
}
