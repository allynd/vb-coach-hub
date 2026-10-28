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
  })),/permission denied/);
  await assert.rejects(writeWithSchemaFallback('matches',{id:'m1'},async()=>({
    error:cacheError('id','matches')
  })),/Could not find/);
});
