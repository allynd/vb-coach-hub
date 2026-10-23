import test from 'node:test';
import assert from 'node:assert/strict';
import {realtimeStateFor} from '../sheet-ops.mjs';

test('only an acknowledged Supabase subscription is live',()=>{
  assert.equal(realtimeStateFor('SUBSCRIBED'),'live');
  assert.equal(realtimeStateFor('CONNECTING'),'connecting');
  assert.equal(realtimeStateFor(undefined),'connecting');
});

test('connection failures fall back to polling instead of reporting live',()=>{
  for(const status of ['TIMED_OUT','CHANNEL_ERROR','CLOSED'])
    assert.equal(realtimeStateFor(status),'failed');
});
