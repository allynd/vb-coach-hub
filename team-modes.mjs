/** Teams created before Club mode default to the unchanged School format. */
export function teamType(team) {
  return team?.teamType === 'club' || team?.team_type === 'club' ? 'club' : 'school';
}
export function isClubTeam(team) { return teamType(team) === 'club'; }
export function clubMatchResult(sets) {
  let won=0,lost=0;
  for (const set of Array.isArray(sets)?sets:[]) {
    const a=Number(set.home),b=Number(set.away);
    if(!Number.isFinite(a)||!Number.isFinite(b)||a===b)continue;
    if(a>b)won++;else lost++;
  }
  return {won,lost,done:won>=2||lost>=2};
}
export function validClubManualResult(won,lost){
  const w=Number(won),l=Number(lost);
  return Number.isInteger(w)&&Number.isInteger(l)&&w>=0&&l>=0 &&
    (w===2&&l<=1 || l===2&&w<=1);
}
