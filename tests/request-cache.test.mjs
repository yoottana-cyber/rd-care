import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestCache} from '../web/request-cache.js';

test('parallel requests for same roster share one in-flight lookup', async()=>{
  const cache=createRequestCache();
  let calls=0, release;
  const gate=new Promise(resolve=>{release=resolve});
  const load=async()=>{calls++;await gate;return {items:[1,2,3]}};
  const a=cache.get('students:1',load);
  const b=cache.get('students:1',load);
  release();
  const [first,second]=await Promise.all([a,b]);
  assert.equal(calls,1);
  assert.equal(first,second);
  const third=await cache.get('students:1',load);
  assert.equal(calls,1);
  assert.equal(third,first);
});

test('TTL refreshes old reference data',async()=>{
  let t=1000,calls=0;
  const cache=createRequestCache({now:()=>t,ttlMs:100});
  const load=async()=>++calls;
  assert.equal(await cache.get('timetable:1:date',load),1);
  t+=99;
  assert.equal(await cache.get('timetable:1:date',load),1);
  t+=1;
  assert.equal(await cache.get('timetable:1:date',load),2);
});

test('failed lookups are not cached and clear removes prior data',async()=>{
  const cache=createRequestCache();
  await assert.rejects(cache.get('students:1',async()=>{throw Error('network')}),/network/);
  assert.equal(await cache.get('students:1',async()=>1),1);
  cache.clear();
  assert.equal(await cache.get('students:1',async()=>2),2);
  cache.invalidate('students:1');
  assert.equal(await cache.get('students:1',async()=>3),3);
});
