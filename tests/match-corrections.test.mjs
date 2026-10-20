import test from 'node:test';
import assert from 'node:assert/strict';
import { correctionSetNumbers, opponentMissedServeCount, changeOpponentMissedServes } from '../match-corrections.mjs';

const game = { id: 'match-1', teamId: 'team-1', manualRecord: true, manualSetsWon: 3, manualSetsLost: 1, complete: true, sets: [{ set: 1, home: 3, away: 1, manualAggregate: true }] };
let id = 0;
const newId = () => `test-${++id}`;

test('manual results expose every actual set, not just the aggregate result', () => {
  assert.deepEqual(correctionSetNumbers(game), [1, 2, 3, 4]);
  assert.deepEqual(correctionSetNumbers({...game, manualSetsWon: 3, manualSetsLost: 2}), [1, 2, 3, 4, 5]);
  assert.deepEqual(correctionSetNumbers({...game, manualSetsWon: 3, manualSetsLost: 0}, [{set: 2}, {set: 3}]), [1, 2, 3]);
});

test('tracked matches use their saved set numbers', () => {
  assert.deepEqual(correctionSetNumbers({sets:[{set:1},{set:2}],complete:true},[]),[1,2]);
  assert.deepEqual(correctionSetNumbers({sets:[{set:1}],currentSet:2,complete:false},[]),[1,2]);
});

test('opponent missed serves can be entered and edited separately per set without altering the score', () => {
  const events = [{id:'live-1',gameId:game.id,teamId:game.teamId,set:1,type:'opp_serve_error',playerId:null,scoreImpact:1}];
  const originalScore = structuredClone(game.sets);
  assert.equal(changeOpponentMissedServes(events,game,1,4,newId),3);
  assert.equal(changeOpponentMissedServes(events,game,3,2,newId),2);
  assert.equal(opponentMissedServeCount(events,game.id,1),4);
  assert.equal(opponentMissedServeCount(events,game.id,2),0);
  assert.equal(opponentMissedServeCount(events,game.id,3),2);
  assert.equal(events.filter(e=>e.correction).every(e=>e.scoreImpact===0),true);
  assert.deepEqual(game.sets,originalScore);

  assert.equal(changeOpponentMissedServes(events,game,1,1,newId),-3);
  assert.equal(opponentMissedServeCount(events,game.id,1),1);
  assert.equal(opponentMissedServeCount(events,game.id,3),2);
  assert.equal(events.find(e=>e.id==='live-1')?.scoreImpact,1);
  assert.equal(changeOpponentMissedServes(events,game,1,0,newId),-1);
  assert.equal(opponentMissedServeCount(events,game.id,1),0);
  assert.deepEqual(game.sets,originalScore);
});

test('invalid input is rejected and unrelated player stats survive corrections', () => {
  const events = [{id:'kill-1',gameId:game.id,teamId:game.teamId,set:2,type:'attack_kill',playerId:'player-1',scoreImpact:1}];
  for(const value of [-1,1.5,'oops','','2.2',251]) {
    assert.throws(()=>changeOpponentMissedServes(events,game,2,value,newId),RangeError);
  }
  changeOpponentMissedServes(events,game,2,2,newId);
  changeOpponentMissedServes(events,game,2,0,newId);
  assert.equal(events.length,1);
  assert.equal(events[0].id,'kill-1');
});
