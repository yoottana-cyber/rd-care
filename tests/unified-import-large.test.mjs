import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareRows,csvRows,ROSTER_PREVIEW_CHUNK,ROSTER_COMMIT_CHUNK} from '../web/unified-import.js';

test('single CSV can contain 1750 students while all server requests are bounded',()=>{
 const rooms=Array.from({length:18},(_,i)=>({id:i+1,label:'ม.1/'+(i+1)}));
 const lines=['classroom,roll_no,student_no,full_name,username,password'];
 for(let i=0;i<1750;i++){
  const room=1+Math.floor(i/100),roll=1+(i%100);
  lines.push(['ม.1/'+room,roll,'S'+String(i+1).padStart(6,'0'),
   'นักเรียน '+(i+1),'',''].join(','));
 }
 const prepared=prepareRows(csvRows(lines.join('\n')),rooms);
 assert.equal(prepared.length,1750);
 assert.equal(prepared.filter(x=>x.status==='ready').length,1750);
 assert.equal(ROSTER_PREVIEW_CHUNK,25);
 assert.equal(ROSTER_COMMIT_CHUNK,1);
 assert.equal(Math.ceil(1750/ROSTER_PREVIEW_CHUNK),70);
 assert.equal(Math.ceil(1750/ROSTER_COMMIT_CHUNK),1750);
 assert.equal(prepared.at(-1).values.source_row,1751);
});

test('browser import only displays 80 preview rows at once and can continue after transient failures',()=>{
 const ui=readFileSync(new URL('../web/unified-import.js',import.meta.url),'utf8');
 assert.match(ui,/ROSTER_VIEW_PAGE_SIZE=80/);
 assert.match(ui,/filtered\.slice\(\(previewPage-1\)\*ROSTER_VIEW_PAGE_SIZE/);
 assert.match(ui,/unifiedPrevPage/);
 assert.match(ui,/unifiedNextPage/);
 assert.match(ui,/unifiedIssueRows/);
 assert.match(ui,/chunks\(allowed,ROSTER_PREVIEW_CHUNK\)/);
 assert.match(ui,/chunks\(selected,ROSTER_COMMIT_CHUNK\)/);
 assert.match(ui,/consecutiveErrors>=3/);
 assert.match(ui,/status='uncertain'/);
 assert.match(ui,/timeoutMs:30000/);
});

test('import backend rejects oversized requests before reading D1',()=>{
 const code=readFileSync(new URL('../worker/src/unified-roster.js',import.meta.url),'utf8');
 assert.match(code,/const max=commit\?1:25/);
 assert.match(code,/if\(rows\.length<1\|\|rows\.length>max\)/);
 assert.match(code,/await commitOne\(env,user,raw,plan/);
 assert.doesNotMatch(code,/for\(let i=0;i<rows\.length;i\+\+\)/);
});


test('roster-only can use the original six columns without requiring valid account credentials',()=>{
 const raw=csvRows('classroom,roll_no,student_no,full_name,username,password\nม.1/1,1,0001,นักเรียน ทดสอบ,BAD USER,123');
 const rooms=[{label:'ม.1/1'}];
 assert.equal(prepareRows(raw,rooms)[0].status,'error');
 assert.equal(prepareRows(raw,rooms,{rosterOnly:true})[0].status,'ready');
 const ui=readFileSync(new URL('../web/unified-import.js',import.meta.url),'utf8');
 assert.match(ui,/id="unifiedRosterOnly" checked/);
 assert.match(ui,/เปลี่ยนโหมดนำเข้าแล้ว/);
 assert.match(ui,/rosterOnly:accountMode==='roster_only'/);
});
