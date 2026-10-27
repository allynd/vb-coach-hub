/** A tournament is scoped to a club team; the same event name can span dates. */
export const CLUB_ROUNDS = ['Pool Play','Round of 16','Quarterfinal','Semifinal','Final','Consolation','Placement','Other'];

export function tournamentKey(name) {
  const normalized=String(name||'').trim().toLocaleLowerCase();
  return normalized ? 'name:'+normalized : 'unassigned:';
}
export function tournamentName(game) {
  return String(game?.eventName||'').trim() || 'Unassigned tournament';
}
export function matchOutcome(game){
  if(!game?.complete)return '';
  if(game.manualRecord){
    const won=Number(game.manualSetsWon),lost=Number(game.manualSetsLost);
    return won>lost?'W':lost>won?'L':'';
  }
  let won=0,lost=0;
  for(const set of Array.isArray(game.sets)?game.sets:[]){
    if(Number(set.home)>Number(set.away))won++;
    else if(Number(set.away)>Number(set.home))lost++;
  }
  return won>lost?'W':lost>won?'L':'';
}
export function tournamentRecord(games) {
  const summary={matches:games.length,completed:0,wins:0,losses:0,pending:0,setsWon:0,setsLost:0};
  for(const game of games){
    if(!game.complete){summary.pending++;continue;}
    summary.completed++;
    const result=matchOutcome(game);
    if(result==='W')summary.wins++;
    else if(result==='L')summary.losses++;
    if(game.manualRecord){
      summary.setsWon+=Math.max(0,Number(game.manualSetsWon)||0);
      summary.setsLost+=Math.max(0,Number(game.manualSetsLost)||0);
    }else{
      for(const set of game.sets||[]){
        if(Number(set.home)>Number(set.away))summary.setsWon++;
        else if(Number(set.away)>Number(set.home))summary.setsLost++;
      }
    }
  }
  return summary;
}
export function groupClubTournaments(games) {
  const grouped=new Map();
  for(const game of games||[]){
    const key=tournamentKey(game.eventName);
    if(!grouped.has(key))grouped.set(key,{key,name:tournamentName(game),games:[]});
    grouped.get(key).games.push(game);
  }
  const result=[...grouped.values()];
  for(const group of result) {
    group.games.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')) || String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    const dates=group.games.map(g=>g.date).filter(Boolean).sort();
    group.firstDate=dates[0]||'';
    group.lastDate=dates[dates.length-1]||'';
    group.record=tournamentRecord(group.games);
  }
  return result.sort((a,b)=>b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
}
export function clubRoundLabel(round) {
  const value=String(round||'').trim();
  return CLUB_ROUNDS.includes(value)?value:'Unassigned';
}
export function groupClubRounds(games) {
  const grouped=new Map();
  for(const game of games||[]){
    const name=clubRoundLabel(game.eventRound);
    if(!grouped.has(name))grouped.set(name,[]);
    grouped.get(name).push(game);
  }
  const order=[...CLUB_ROUNDS,'Unassigned'];
  return [...grouped].sort((a,b)=>order.indexOf(a[0])-order.indexOf(b[0]));
}
