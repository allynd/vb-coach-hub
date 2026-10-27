import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeTeamCloudSnapshot} from '../team-refresh.mjs';

const remote = (games=[], events=[], players=[]) => ({games,events,players});
const state = (games=[], events=[], players=[]) => ({games,events,players,teams:[{id:'team'}]});
const game = (id, score) => ({id,teamId:'team',sets:[{set:1,home:score,away:20}]});
const stat = (id, type='dig') => ({id,gameId:'g1',teamId:'team',type});
test('first refresh adds synced records without overwriting local data', () => {
  const local=state([game('g1',25)],[stat('s1','dig')]);
  const report=mergeTeamCloudSnapshot(local,'team',remote([game('g1',24),game('g2',25)],[stat('s1','kill'),stat('s2')]));
  assert.equal(local.games.find(g=>g.id==='g1').sets[0].home,25);
  assert.equal(local.games.length,2);
  assert.equal(local.events.length,2);
  assert.equal(local.events.find(e=>e.id==='s1').type,'dig');
  assert.equal(report.addedStats,1);
  assert.equal(report.conflicts,2);
});
test('a later refresh updates unchanged cloud records', () => {
  const local=state();
  mergeTeamCloudSnapshot(local,'team',remote([game('g1',23)],[stat('s1','dig')]));
  mergeTeamCloudSnapshot(local,'team',remote([game('g1',25)],[stat('s1','kill')]));
  assert.equal(local.games[0].sets[0].home,25);
  assert.equal(local.events[0].type,'kill');
});
test('offline changes are preserved when cloud has changed too', () => {
  const local=state();
  mergeTeamCloudSnapshot(local,'team',remote([game('g1',23)]));
  local.games[0].sets[0].home=26;
  const report=mergeTeamCloudSnapshot(local,'team',remote([game('g1',25)]));
  assert.equal(local.games[0].sets[0].home,26);
  assert.equal(report.conflicts,1);
});
test('remote deletion removes previously seen, unmodified stat only', () => {
  const local=state();
  mergeTeamCloudSnapshot(local,'team',remote([game('g1',25)],[stat('s1'),stat('s2')]));
  local.events.find(e=>e.id==='s2').type='kill';
  mergeTeamCloudSnapshot(local,'team',remote([game('g1',25)],[]));
  assert.deepEqual(local.events.map(e=>e.id),['s2']);
});
test('other local teams are untouched', () => {
  const local=state([{id:'other',teamId:'elsewhere'}],[{id:'other-stat',teamId:'elsewhere',gameId:'other'}]);
  mergeTeamCloudSnapshot(local,'team',remote([game('g1',23)],[stat('s1')]));
  assert.ok(local.events.some(e=>e.id==='other-stat'));
  assert.ok(local.games.some(g=>g.id==='other'));
});
test('player photos are retained when cloud profile updates', () => {
  const local=state();
  mergeTeamCloudSnapshot(local,'team',remote([],[],[{id:'p1',teamId:'team',firstName:'A',photo:''}]));
  local.players[0].photo='data:image/png;base64,TEST';
  mergeTeamCloudSnapshot(local,'team',remote([],[],[{id:'p1',teamId:'team',firstName:'B',photo:''}]));
  assert.equal(local.players[0].firstName,'B');
  assert.equal(local.players[0].photo,'data:image/png;base64,TEST');
});
