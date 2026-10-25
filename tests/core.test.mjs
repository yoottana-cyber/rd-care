import test from 'node:test';
import assert from 'node:assert/strict';
import {validDate,weekday,validateEntries,cleanText,validUsername} from '../worker/src/core.js';
test('dates valid including leap year',()=>{
 assert.equal(validDate('2026-02-30'),false);
 assert.equal(validDate('2028-02-29'),true);
 assert.equal(weekday('2026-10-26'),1);
});
test('bulk attendance is complete, unique and validated',()=>{
 const ids=new Set([1,2]);
 assert.equal(validateEntries([{student_id:1,status:'present'},{student_id:2,status:'absent'}],ids),true);
 assert.equal(validateEntries([{student_id:1,status:'present'}],ids),false);
 assert.equal(validateEntries([{student_id:1,status:'present'},{student_id:1,status:'late'}],ids),false);
 assert.equal(validateEntries([{student_id:1,status:'delete'},{student_id:2,status:'present'}],ids),false);
});
test('input checks',()=>{
 assert.equal(validUsername('teacher.01'),true);
 assert.equal(validUsername('a'),false);
 assert.equal(cleanText(' test ',5),'test');
});
