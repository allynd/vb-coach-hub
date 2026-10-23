// Player participation for kills/digs/individual blocks per set across match, season, career.
// A roster or a designated libero alone is NOT proof a player took the court.
// Count distinct (match, set) combinations supported by a player stat/appearance
// event, a completed/started lineup, or a recorded substitution.
const positiveSet = value => {
  const n=Number(value);
  return Number.isInteger(n)&&n>0 ? n : null;
};
export function playedSetsForPlayer(games=[],events=[],playerIds=[],onlySet=null){
  const ids=new Set(playerIds||[]);
  if(!ids.size)return new Set();
  const byGame=new Map();
  for(const e of events||[]){
    if(!e?.gameId)continue;
    const n=positiveSet(e.set);
    if(!n)continue;
    if(!byGame.has(e.gameId))byGame.set(e.gameId,[]);
    byGame.get(e.gameId).push(e);
  }
  const played=new Set();
  for(const game of games||[]){
    if(!game?.id)continue;
    const matchEvents=byGame.get(game.id)||[];
    const recorded=new Set();
    if(game.manualRecord){
      const total=Math.min(25,Math.max(0,Math.floor(Number(game.manualSetsWon)||0)+Math.floor(Number(game.manualSetsLost)||0)));
      for(let n=1;n<=total;n++)recorded.add(n);
    }else{
      for(const [i,s] of (game.sets||[]).entries()){
        const n=positiveSet(s.set)||i+1;
        recorded.add(n);
      }
      if(!game.complete && ((Number(game.homeScore)||0)>0||(Number(game.awayScore)||0)>0
        ||matchEvents.some(e=>Number(e.set)===Number(game.currentSet)))){
        const n=positiveSet(game.currentSet);
        if(n)recorded.add(n);
      }
    }
    // Explicit player stat events are sufficient evidence even when the
    // scoreboard or historical lineup information is incomplete.
    for(const e of matchEvents){
      const n=positiveSet(e.set);
      if(!n)continue;
      if(ids.has(e.playerId) || ids.has(e.outgoingPlayerId) || ids.has(e.incomingPlayerId)){
        recorded.add(n);
        if(onlySet==null||n===Number(onlySet))played.add(game.id+':'+n);
      }
    }
    for(const [key,lineup] of Object.entries(game.setLineups||{})){
      const n=positiveSet(key);
      if(!n || !recorded.has(n) || (onlySet!=null && n!==Number(onlySet)))continue;
      const participants=[
        ...(lineup.slots||[]),...(lineup.currentSlots||[]),
        ...Object.values(lineup.liberoReplacements||{}),
        ...(lineup.substitutions||[]).flatMap(s=>[s.outgoingPlayerId,s.incomingPlayerId])
      ];
      if(participants.some(id=>ids.has(id)))played.add(game.id+':'+n);
    }
  }
  return played;
}
export function withPerSetRates(stats,games,events,playerIds,onlySet=null){
  const SP=playedSetsForPlayer(games,events,playerIds,onlySet).size;
  return {
    ...stats,SP,
    KPS:SP?(Number(stats.K)||0)/SP:null,
    DPS:SP?(Number(stats.D)||0)/SP:null,
    BPS:SP?((Number(stats.BS)||0)+(Number(stats.BA)||0))/SP:null
  };
}
export function formatPerSetRate(value){
  return value==null||!Number.isFinite(value)?'—':value.toFixed(2);
}
