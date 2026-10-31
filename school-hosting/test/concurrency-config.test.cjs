'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {LEVELS,NUMBER_OF_ROOMS,NUMBER_OF_TEACHERS,STUDENTS_PER_ROOM,
 schoolToday,isolatedFile,summary}=require('../concurrency-test.cjs');
test('load-test caps at 50 teachers and never generates a school-hosted URL',()=>{
 assert.deepEqual(LEVELS,[5,20,50]);
 assert.equal(NUMBER_OF_ROOMS,48);
 assert.equal(NUMBER_OF_TEACHERS,50);
 assert.equal(STUDENTS_PER_ROOM,20);
 assert.match(schoolToday(),/^\d{4}-\d{2}-\d{2}$/);
});
test('synthetic database path cannot point at live school database',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rd-connect-load-lab-'));
 try{
  const file=path.join(root,'lab.sqlite');
  assert.equal(isolatedFile(root,file),file);
  assert.throws(()=>isolatedFile(root,'/home/ratsadaa/rd-connect-private/rd-connect.sqlite'),
   /school_load_live_db_guard/);
  assert.throws(()=>isolatedFile(root,path.join(root,'nested','file.sqlite')),
   /school_load_live_db_guard/);
  fs.writeFileSync(file,'synthetic');
  assert.throws(()=>isolatedFile(root,file),/school_load_live_db_guard/);
 }finally{fs.rmSync(root,{force:true,recursive:true})}
});
test('load latency percentile helpers are deterministic',()=>{
 assert.deepEqual(summary([101,10,20,40,35]),{p50:35,p95:101,max:101});
});
