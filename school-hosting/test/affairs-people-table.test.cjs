'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const code=fs.readFileSync(path.resolve(__dirname,'../../web/affairs-people-table.js'),'utf8');
const url='data:text/javascript;base64,'+Buffer.from(code).toString('base64');
test('Node24 school-host advisor table has all 48 rows and allows a staff head',async()=>{
 const {advisorManagementMarkup,resolveTeacherId,teacherLabel,teacherChoiceLabel}=await import(url);
 const teachers=[{id:10,username:'staff10',display_name:'ครูฝ่ายกิจการ',role:'staff',active:1},
  {id:11,username:'teacher11',display_name:'ครูที่ปรึกษา',role:'teacher',active:1}];
 const rooms=Array.from({length:48},(_,i)=>({id:i+1,label:'ม.'+(Math.floor(i/8)+1)+'/'+(i%8+1),
  grade:Math.floor(i/8)+1,advisor_user_id:i===0?10:null,advisor2_user_id:null}));
 const p=advisorManagementMarkup({teachers,rooms,heads:[{grade:1,teacher_user_id:10}]});
 assert.equal((p.markup.match(/data-affairs-advisor="\d+"/g)||[]).length,48);
 assert.equal((p.markup.match(/data-affairs-head="\d+"/g)||[]).length,6);
 assert.equal(resolveTeacherId(teacherChoiceLabel(teachers[0],p.teachers),p.teachers),10);
 assert.equal(teacherLabel(teachers[0]),'ครูฝ่ายกิจการ');
 assert.doesNotMatch(p.markup,/@staff10|@teacher11|\(@/);
 assert.match(p.markup,/พิมพ์ชื่อครู/);
 const api=fs.readFileSync(path.resolve(__dirname,'../../worker/src/student-affairs.js'),'utf8');
 assert.match(api,/role IN \('teacher','staff'\) AND active=1 AND deleted_at IS NULL/);
});
