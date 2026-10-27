import test from 'node:test';
import assert from 'node:assert/strict';
import {teamType,isClubTeam,clubMatchResult,validClubManualResult} from '../team-modes.mjs';
test('legacy teams remain School',()=>assert.equal(teamType({name:'Raiders'}),'school'));
test('new Club team is recognized',()=>assert.equal(isClubTeam({teamType:'club'}),true));
test('best-of-3 finishes 2-0',()=>{
 const s=clubMatchResult([{home:25,away:20},{home:25,away:23}]);
 assert.deepEqual(s,{won:2,lost:0,done:true});
});
test('best-of-3 continues at 1-1 and ends at 2-1',()=>{
 assert.equal(clubMatchResult([{home:25,away:20},{home:20,away:25}]).done,false);
 assert.deepEqual(clubMatchResult([{home:25,away:20},{home:20,away:25},{home:15,away:11}]),{won:2,lost:1,done:true});
});
test('only completed club manual results are valid',()=>{
 for(const [w,l] of [[2,0],[2,1],[1,2],[0,2]])assert.equal(validClubManualResult(w,l),true);
 for(const [w,l] of [[1,0],[1,1],[3,1],[2,2],[1,3]])assert.equal(validClubManualResult(w,l),false);
});
