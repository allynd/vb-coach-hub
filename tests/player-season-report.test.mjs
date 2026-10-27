import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPlayerSeasonReport} from '../player-season-report.mjs';

const summarize=(events,id)=>{
  const mine=id?events.filter(e=>e.playerId===id):events;
  const total=type=>mine.filter(e=>e.type===type).reduce((n,e)=>n+(e.kind==='season_adjustment'?Number(e.adjustmentDelta)||0:1),0);
  const K=total('attack_kill'),E=total('attack_error'),ATTEMPTS=total('attack_attempt'),ATT=K+E+ATTEMPTS;
  const D=total('dig');
  return {K,E,ATTEMPTS,ATT,HIT:ATT?(K-E)/ATT:0,D,BS:0,BA:0,BE:0,ACE:total('serve_ace'),A:total('set_assist'),PASS:0};
};
const team={id:'club',name:'Raptors',season:'2026',teamType:'club'};
const player={id:'p1',teamId:'club',firstName:'Alex',lastName:'Smith'};
const other={id:'p2',teamId:'club',firstName:'Taylor',lastName:'Jones'};
const sample={
  teams:[team,{id:'school',name:'School',season:'2026'}],players:[player,other],
  games:[
    {id:'m1',teamId:'club',date:'2026-11-01',opponent:'Wolves',eventName:'Frostbit',eventRound:'Pool Play',complete:true,sets:[{set:1,home:25,away:20},{set:2,home:25,away:21}],setLineups:{'1':{slots:['p1']},'2':{slots:['p1']}},rosterSnapshot:[{playerId:'p1'}]},
    {id:'m2',teamId:'club',date:'2026-11-02',opponent:'Hawks',eventName:'Frostbit',complete:true,manualRecord:true,manualSetsWon:1,manualSetsLost:2,sets:[{set:1,home:1,away:2}],rosterSnapshot:[{playerId:'p1'}]},
    {id:'m3',teamId:'club',date:'2026-11-03',opponent:'Falcons',complete:false,sets:[],rosterSnapshot:[]},
    {id:'m4',teamId:'school',date:'2026-11-03',opponent:'Other team',complete:true,sets:[{home:25,away:20}]}
  ],
  events:[
    {id:'k1',gameId:'m1',teamId:'club',set:1,playerId:'p1',type:'attack_kill'},
    {id:'d1',gameId:'m1',teamId:'club',set:2,playerId:'p1',type:'dig'},
    {id:'d2',gameId:'m2',teamId:'club',set:1,playerId:'p2',type:'dig'},
    {id:'k2',gameId:'m4',teamId:'school',set:1,playerId:'p1',type:'attack_kill'},
    {id:'adj',kind:'season_adjustment',teamId:'club',playerId:'p1',type:'attack_kill',adjustmentDelta:2}
  ]
};
test('every team match has one chronological row, even without player events',()=>{
 const report=buildPlayerSeasonReport(sample,{teamId:'club',playerId:'p1'},summarize);
 assert.deepEqual(report.matches.map(m=>m.id),['m1','m2','m3']);
 assert.equal(report.matches[0].stats.SP,2);
 assert.equal(report.matches[0].stats.K,1);
 assert.equal(report.matches[1].result,'L');
 assert.equal(report.matches[2].result,'In progress');
 assert.equal(report.matches[2].participation,'No appearance recorded');
});
test('season total includes adjustments without attributing them to a match',()=>{
 const report=buildPlayerSeasonReport(sample,{teamId:'club',playerId:'p1'},summarize);
 assert.equal(report.seasonStats.K,3);
 assert.equal(report.matches.reduce((n,m)=>n+m.stats.K,0),1);
 assert.equal(report.adjustmentStats.K,2);
 assert.equal(report.seasonStats.SP,2);
});
test('no unrelated team events or other players enter selected total',()=>{
 const r=buildPlayerSeasonReport(sample,{teamId:'club',playerId:'p1'},summarize);
 assert.equal(r.seasonStats.D,1);
 assert.equal(r.matches.length,3);
 assert.match(r.filename,/Raptors-2026-Alex-Smith/);
});
test('validates team selection and supports empty seasons',()=>{
 assert.throws(()=>buildPlayerSeasonReport(sample,{teamId:'school',playerId:'p1'},summarize));
 const clean={teams:[team],players:[player],games:[],events:[]};
 const r=buildPlayerSeasonReport(clean,{teamId:'club',playerId:'p1'},summarize);
 assert.equal(r.matches.length,0);
 assert.equal(r.seasonStats.SP,0);
});
