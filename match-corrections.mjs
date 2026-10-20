// Shared set selection and score-neutral team stat corrections.
export function correctionSetNumbers(game, events = []) {
  const numbers = new Set();
  if (game?.manualRecord) {
    // Manual matches store a single aggregate W-L entry, not individual set scores.
    const played = Math.min(25, Math.max(0, Math.floor(Number(game.manualSetsWon) || 0) + Math.floor(Number(game.manualSetsLost) || 0)));
    for (let n = 1; n <= played; n++) numbers.add(n);
  } else {
    (game?.sets || []).forEach((s, i) => numbers.add(Number(s.set) || i + 1));
    if (game && !game.complete) numbers.add(Number(game.currentSet) || 1);
  }
  for (const event of events) {
    const n = Number(event.set);
    if (Number.isInteger(n) && n > 0) numbers.add(n);
  }
  if (!numbers.size) numbers.add(1);
  return [...numbers].sort((a, b) => a - b);
}

export function opponentMissedServeCount(events, gameId, setNo) {
  return events.filter(e => e.gameId === gameId && Number(e.set) === Number(setNo) && e.type === 'opp_serve_error' && !e.playerId).length;
}

export function changeOpponentMissedServes(events, game, setNo, requestedCount, createId) {
  const target = Number(requestedCount);
  if (String(requestedCount).trim() === '' || !Number.isSafeInteger(target) || target < 0 || target > 250) throw new RangeError('Enter a whole number of missed serves between 0 and 250.');
  if (!Number.isInteger(Number(setNo)) || Number(setNo) <= 0) throw new RangeError('Select a valid set.');
  const previous = opponentMissedServeCount(events, game.id, setNo);
  const change = target - previous;
  if (change > 0) {
    for (let i = 0; i < change; i++) {
      events.push({id:createId(),kind:'stat',gameId:game.id,teamId:game.teamId,playerId:null,type:'opp_serve_error',set:Number(setNo),scoreImpact:0,correction:true,createdAt:new Date().toISOString()});
    }
  } else if (change < 0) {
    const candidates = events.map((e, index) => ({e,index}))
      .filter(({e}) => e.gameId === game.id && Number(e.set) === Number(setNo) && e.type === 'opp_serve_error' && !e.playerId)
      .sort((a,b) => Number(!!b.e.correction) - Number(!!a.e.correction) || b.index - a.index)
      .slice(0, -change)
      .sort((a,b) => b.index - a.index);
    for (const {index} of candidates) events.splice(index,1);
  }
  return change;
}
