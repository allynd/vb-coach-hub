import test from 'node:test';
import assert from 'node:assert/strict';
import {timestamp,playbackWindow,embedUrl} from '../film-playback.mjs';
test('timestamps format minutes and hours',()=>{assert.equal(timestamp(277.2),'4:37');assert.equal(timestamp(3602),'1:00:02');assert.equal(timestamp(0),'0:00');});
test('full recording plays with lead-in and trailing context',()=>{assert.deepEqual(playbackWindow(277,287),{start:274,end:289});assert.deepEqual(playbackWindow(1,2),{start:0,end:4});});
test('trimmed local sample seeks relative to original timeline and clamps at file end',()=>{assert.deepEqual(playbackWindow(277,287,277,60),{start:0,end:12});assert.deepEqual(playbackWindow(330,336,277,60),{start:50,end:60});});
test('unavailable moments and invalid inputs never silently seek another play',()=>{for(const args of [[270,280,277,60],[337,338,277,60],[NaN,1],[1,0],[-1,2],[1,2,-1]])assert.throws(()=>playbackWindow(...args));});
test('YouTube embeds use validated ID and context timestamps',()=>{assert.match(embedUrl('ugW5_-zfJKY',277,287),/start=274&end=289/);assert.throws(()=>embedUrl('javascript:alert(1)',1,2));});
