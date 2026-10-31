import test from 'node:test';
import assert from 'node:assert/strict';
import {createBehaviorAdjustment} from '../web/behavior-adjustment.js';

test('changing adjustment rule immediately enables submit with an already selected student',async()=>{
 const previousDocument=globalThis.document;
 const handlers=new Map();
 const student={id:42,student_no:'ST-42',full_name:'Student Test'};
 const controls={
  '#adjustmentSearch':{value:''},
  '#adjustmentReason':{value:'Details preserved'},
  '#adjustmentRule':{value:''},
  '#adjustmentSubmit':{disabled:true},
  '#adjustmentRecordForm':{}
 };
 let mounts=0,previewRemoved=0;
 const checkbox={dataset:{adjustmentStudent:'42'},checked:false,
  addEventListener(type,listener){handlers.set('student:'+type,listener)}};
 const fakeDocument={
  querySelector(selector){
   if(selector==='.score-adjust-preview')return {remove(){previewRemoved++}};
   const item=controls[selector];
   if(item){
    item.addEventListener=(type,listener)=>handlers.set(selector+':'+type,listener);
    return item;
   }
   return null;
  },
  querySelectorAll(selector){
   return selector==='[data-adjustment-student]'?[checkbox]:[];
  }
 };
 let previewRequests=0;
 const screen=createBehaviorAdjustment({
  api:async path=>{
   if(path.startsWith('/api/students?'))return {items:[student]};
   if(path==='/api/affairs/behavior/approved-adjustments')
    return {items:[{id:5,name:'Positive adjustment',points:10}]};
   if(path==='/api/affairs/behavior/adjust/preview'){
    previewRequests++;
    return {all_eligible:false,items:[],rule:{points:10}};
   }
   throw Error('Unexpected request: '+path);
  },
  mount:html=>{
   mounts++;
   controls['#adjustmentSubmit'].disabled=
    /id="adjustmentSubmit" disabled/.test(html);
  },
  safeRun:fn=>fn(),
  toast:()=>{},
  rooms:()=>[{id:8,label:'Class 8'}],
  getRoomId:()=>8,setRoomId:()=>{},
  getTab:()=> 'adjustment',
  escapeHtml:x=>String(x)
 });
 try{
  globalThis.document=fakeDocument;
  await screen.load();
  assert.equal(controls['#adjustmentSubmit'].disabled,true);

  // Select the student BEFORE selecting the rule, reproducing the old bug.
  checkbox.checked=true;
  handlers.get('student:change')({currentTarget:checkbox});
  assert.equal(controls['#adjustmentSubmit'].disabled,true);
  const beforeRuleChange=mounts;

  controls['#adjustmentRule'].value='5';
  handlers.get('#adjustmentRule:change')();
  assert.equal(controls['#adjustmentSubmit'].disabled,false);
  assert.equal(mounts,beforeRuleChange,'rule changes should not redraw the student list');
  assert.equal(controls['#adjustmentReason'].value,'Details preserved');
  assert.equal(previewRemoved,1);

  let prevented=false;
  await handlers.get('#adjustmentRecordForm:submit')({preventDefault(){prevented=true}});
  assert.equal(prevented,true,'enabled button reaches validation API');
  assert.equal(previewRequests,1);
  const afterPreview=mounts;

  // The user changes the rule again: stale preview is removed and button
  // state is updated without losing the selected pupil.
  controls['#adjustmentRule'].value='';
  handlers.get('#adjustmentRule:change')();
  assert.equal(controls['#adjustmentSubmit'].disabled,true);
  assert.equal(mounts,afterPreview);
  assert.equal(previewRemoved,2);
  controls['#adjustmentRule'].value='5';
  handlers.get('#adjustmentRule:change')();
  assert.equal(controls['#adjustmentSubmit'].disabled,false);
  checkbox.checked=false;
  handlers.get('student:change')({currentTarget:checkbox});
  assert.equal(controls['#adjustmentSubmit'].disabled,true,'no student selected');
 }finally{
  globalThis.document=previousDocument;
 }
});
