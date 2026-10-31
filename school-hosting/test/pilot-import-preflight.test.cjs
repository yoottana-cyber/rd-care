'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
async function validator(){
 const code=fs.readFileSync(path.resolve(__dirname,'../../web/pilot-import-validation.js'),'utf8');
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const rooms=Array.from({length:6},(_,i)=>({id:i+1,label:'ม.1/'+(i+1)}));
const selected=rooms.slice(0,5).map(r=>r.label);
function good(){
 const roster=selected.map((room,i)=>({
  values:{classroom:room,student_no:'SYN-'+(i+1),username:'teststu'+(i+1),source_row:i+2},
  status:'ready',message:''
 }));
 const advisors=selected.map((room,i)=>({
  values:{classroom:room,username:'teacher'+(i+1),source_row:i+2},
  status:'ready',message:''
 }));
 const portal={items:selected.map((_,i)=>({
  student_no:'SYN-'+(i+1),student_username:'teststu'+(i+1),
  student_password:'sufficient-synthetic-only',guardian_username:'guardian'+(i+1),
  guardian_password:'synthetic-guardian-password',source_row:i+2
 })),errors:[]};
 return {rooms,selectedRooms:selected,roster,advisors,portal};
}
test('exactly five rooms with complete advisor, student and linked guardian files pass locally',async()=>{
 const {validatePilotImportBundle}=await validator();
 const result=validatePilotImportBundle(good());
 assert.equal(result.ok,true);
 assert.equal(result.totalStudents,5);
 assert.equal(result.totalAdvisors,5);
 assert.equal(result.totalAccounts,5);
 assert.equal(result.issues.length,0);
 assert.equal(result.rooms.length,5);
 assert.equal(result.rooms.every(r=>r.students===1&&r.advisors===1&&r.portals===1&&r.guardians===1),true);
});
test('outside-room data and unknown guardian/student keys block the pilot',async()=>{
 const {validatePilotImportBundle}=await validator();
 const fixture=good();
 fixture.roster[0].values.classroom='ม.1/6';
 fixture.portal.items[1].student_no='UNKNOWN';
 const result=validatePilotImportBundle(fixture);
 assert.equal(result.ok,false);
 assert.ok(result.issues.some(x=>x.code==='student_scope'));
 assert.ok(result.issues.some(x=>x.code==='portal_scope'));
 assert.ok(result.issues.some(x=>x.code==='portal_missing'));
});
test('pilot refuses fewer than 5 rooms and missing advisor roster',async()=>{
 const {validatePilotImportBundle}=await validator();
 const fixture=good();
 fixture.selectedRooms=selected.slice(0,4);
 fixture.advisors=[];
 const result=validatePilotImportBundle(fixture);
 assert.equal(result.ok,false);
 assert.ok(result.issues.some(x=>x.code==='room_selection'));
 assert.ok(result.issues.some(x=>x.code==='advisor_missing'));
 assert.ok(result.issues.some(x=>x.code==='no_advisors'));
});
test('never returns passwords, full names or student IDs in results',async()=>{
 const {validatePilotImportBundle}=await validator();
 const fixture=good();
 const secret='synthetic-topsecret-DO-NOT-PRINT';
 fixture.portal.items[0].student_password=secret;
 fixture.portal.items[0].guardian_password=secret;
 fixture.portal.items[0].student_no='NOT-IN-ROSTER';
 const result=validatePilotImportBundle(fixture);
 const serialized=JSON.stringify(result);
 assert.equal(serialized.includes(secret),false);
 assert.equal(serialized.includes('NOT-IN-ROSTER'),false);
 assert.equal(serialized.includes('teststu1'),false);
 assert.equal(serialized.includes('guardian1'),false);
 assert.equal(result.ok,false);
});
test('missing new-account passwords trigger warnings, not a false claim of existing account status',async()=>{
 const {validatePilotImportBundle}=await validator();
 const fixture=good();
 fixture.portal.items[0].student_password='';
 fixture.portal.items[0].guardian_password='';
 const result=validatePilotImportBundle(fixture);
 assert.equal(result.ok,true); // Can't know the database account status offline.
 assert.ok(result.warnings.some(x=>x.includes('ไม่มีรหัสผ่าน')));
});
