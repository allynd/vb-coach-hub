import test from 'node:test';
import assert from 'node:assert/strict';
import {missingOptionalColumn, writeWithSchemaFallback} from '../cloud-schema-compat.mjs';

const cacheError = (column,table) => ({code:'PGRST204',message:"Could not find the '"+column+"' column of '"+table+"' in the schema cache"});

test('recognizes only optional fields on the correct table', () => {
  assert.equal(missingOptionalColumn(cacheError('event_round','matches'),'matches',{event_round:'Final'}),'event_round');
  assert.equal(missingOptionalColumn(cacheError('id','matches'),'matches',{id:'m1'}),null);
  assert.equal(missingOptionalColumn(cacheError('team_type','teams'),'matches',{team_type:'club'}),null);
  assert.equal(missingOptionalColumn({code:'42703',message:'column "event_name" of relation "matches" does not exist'},'matches',{event_name:'Cup'}),'event_name');
  assert.equal(missingOptionalColumn({code:'42703',message:'column matches.event_round does not exist'},'matches',{event_round:'Final'}),'event_round');
});

test('retries without sequential missing optional columns, preserving the original row and other stats', async () => {
  const row = {id:'m1',team_id:'t1',event_name:'Cup',event_round:'Final',home_score:25};
  const writes = [];
  let skipped;
  await writeWithSchemaFallback('matches',[row],async data=>{
    writes.push(data);
    if (writes.length===1) return {error:cacheError('event_round','matches')};
    if (writes.length===2) return {error:cacheError('event_name','matches')};
    return {data:[]};
  },fields=>{skipped=fields});
  assert.equal(writes.length,3);
  assert.deepEqual(skipped,['event_round','event_name']);
  assert.deepEqual(writes[2],[{id:'m1',team_id:'t1',home_score:25}]);
  assert.equal(row.event_round,'Final');
  assert.equal(row.event_name,'Cup');
});

test('team updates work on old schema without lying about optional metadata', async () => {
  const source={name:'Club',team_type:'club'};
  let saved;
  await writeWithSchemaFallback('teams',source,async data=>{
    if ('team_type' in data) return {error:cacheError('team_type','teams')};
    saved=data;return {data:[]};
  });
  assert.deepEqual(saved,{name:'Club'});
  assert.deepEqual(source,{name:'Club',team_type:'club'});
});

test('permissions failures and missing required columns still stop sync', async () => {
  await assert.rejects(writeWithSchemaFallback('matches',{id:'m1'},async()=>({
    error:{code:'42501',message:'permission denied for table matches'}
  })),error=>error.code==='42501' && /permission denied/.test(error.message));
  await assert.rejects(writeWithSchemaFallback('matches',{id:'m1'},async()=>({
    error:cacheError('id','matches')
  })),error=>error.code==='PGRST204' && /Could not find/.test(error.message));
});

test('school post-season match sync survives old SQL constraint without losing original classifications', async () => {
  const rows=[
    {id:'g1',conference_type:'conference',home_score:25},
    {id:'g2',conference_type:'postseason',home_score:25},
    {id:'g3',conference_type:'nonconference',home_score:25}
  ];
  let sent=[];
  let skipped=[];
  await writeWithSchemaFallback('matches',rows,async payload=>{
    sent.push(payload);
    if (payload.some(p=>p.conference_type==='postseason')) return {error:{
      code:'23514',message:'new row for relation "matches" violates check constraint "matches_conference_type_check"'
    }};
    return {data:[]};
  },columns=>skipped=columns);
  assert.equal(sent.length,2);
  assert.deepEqual(sent[1].map(r=>r.conference_type),['conference',null,'nonconference']);
  assert.equal(rows[1].conference_type,'postseason');
  assert.deepEqual(skipped,['conference_type (postseason)']);
});

test('unexpected school match constraint violations still fail',async () => {
  await assert.rejects(writeWithSchemaFallback('matches',[{id:'g1',conference_type:'postseason'}],async()=>({
    error:{code:'23514',message:'violates check constraint "matches_site_type_check"'}
  })),error=>error.code==='23514' && /matches_site_type_check/.test(error.message));
});

test('postseason and optional column fallbacks compose safely',async () => {
  const row={id:'g1',conference_type:'postseason',event_round:null,home_score:25};
  const attempts=[];
  await writeWithSchemaFallback('matches',[row],async payload=>{
    attempts.push(payload);
    if (attempts.length===1) return {error:cacheError('event_round','matches')};
    if (attempts.length===2) return {error:{code:'23514',message:'violates check constraint "matches_conference_type_check"'}};
    return {data:[]};
  });
  assert.equal(attempts.length,3);
  assert.deepEqual(attempts[2],[{id:'g1',conference_type:null,home_score:25}]);
  assert.equal(row.conference_type,'postseason');
});
