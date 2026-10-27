import test from 'node:test';
import assert from 'node:assert/strict';
import {tournamentKey,groupClubTournaments,tournamentRecord,matchOutcome,clubRoundLabel,groupClubRounds} from '../club-tournaments.mjs';
const match=(id,eventName,date,sets,extra={})=>({id,eventName,date,complete:true,sets,...extra});
test('same tournament name groups multi-day matches case-insensitively',()=>{
 const games=[
   match('a',' Frostbit Festival ','2026-11-14',[{home:25,away:22},{home:25,away:20}]),
   match('b','frostbit festival','2026-11-15',[{home:18,away:25},{home:25,away:22},{home:15,away:12}]),
   match('c','Rochester Cup','2026-12-01',[{home:20,away:25},{home:20,away:25}])
 ];
 const groups=groupClubTournaments(games);
 assert.equal(groups.length,2);
 assert.equal(groups.find(x=>x.key===tournamentKey('Frostbit Festival')).games.length,2);
 assert.equal(groups[0].name,'Rochester Cup');
});
test('record counts wins, losses, manual set results and in-progress matches',()=>{
 const games=[
   match('a','Frostbit','2026-11-01',[{home:25,away:20},{home:25,away:21}]),
   match('b','Frostbit','2026-11-01',[],{manualRecord:true,manualSetsWon:1,manualSetsLost:2}),
   {id:'c',eventName:'Frostbit',date:'2026-11-01',complete:false,sets:[]}
 ];
 assert.deepEqual(tournamentRecord(games),{matches:3,completed:2,wins:1,losses:1,pending:1,setsWon:3,setsLost:2});
});
test('unfinished and tied matches do not invent results',()=>{
 assert.equal(matchOutcome({complete:false,sets:[{home:25,away:20}]}),'');
 assert.equal(matchOutcome({complete:true,sets:[{home:25,away:20},{home:20,away:25}]}),'');
});
test('bracket groups show only recorded rounds, without inventing seeding',()=>{
 const games=[
   {id:'a',eventRound:'Quarterfinal'},{id:'b',eventRound:'Pool Play'},
   {id:'c',eventRound:'Semifinal'},{id:'d',eventRound:''}
 ];
 assert.deepEqual(groupClubRounds(games).map(([name])=>name),['Pool Play','Quarterfinal','Semifinal','Unassigned']);
 assert.equal(clubRoundLabel('Unknown'),'Unassigned');
});
