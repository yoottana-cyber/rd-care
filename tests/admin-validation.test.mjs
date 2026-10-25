import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStudentInput, validatePersonnelInput } from '../worker/src/admin-validation.js';

const sample={student_no:'DEMO0001',classroom_id:1,roll_no:7,full_name:'นักเรียนตัวอย่าง'};

test('student input only permits expected fields and trims values',()=>{
 const result=validateStudentInput({...sample,full_name:' นักเรียนตัวอย่าง ',student_no:' DEMO0001 ',role:'admin'});
 assert.deepEqual(result,{student_no:'DEMO0001',classroom_id:1,roll_no:7,full_name:'นักเรียนตัวอย่าง',active:1});
});
test('new students, transfers and archive require valid classroom, roll and state',()=>{
 for(const invalid of [
  {...sample,classroom_id:0},{...sample,roll_no:0},{...sample,roll_no:101},
  {...sample,full_name:''},{...sample,student_no:''},
  {...sample,active:'0'},{...sample,full_name:'x'.repeat(121)},
  {...sample,student_no:'x'.repeat(41)},{...sample,student_no:'x\n'}
 ]) assert.throws(()=>validateStudentInput(invalid));
 assert.equal(validateStudentInput({...sample,active:false}).active,0);
});
test('personnel updates cannot modify roles or use invalid active values',()=>{
 const update=validatePersonnelInput({display_name:' ครูตัวอย่าง ',active:false,role:'admin',password:'ignore'});
 assert.deepEqual(update,{display_name:'ครูตัวอย่าง',active:0});
 for(const b of [{display_name:'',active:1},{display_name:'teacher',active:'0'},
                 {display_name:'x'.repeat(101),active:1},{display_name:'teacher',active:3}])
  assert.throws(()=>validatePersonnelInput(b));
});
