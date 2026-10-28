import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {schoolTermRoutes,selectedTerm} from '../worker/src/school-terms.js';
const code=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const path='/api/admin/term-snapshots';
const admin={id:1,role:'admin'};
const settings={academic_year:2569,semester:2,semester_start_date:null,semester_end_date:null};
function fakeEnv({saved=false}={}){
 const queries=[],batch=[];
 const env={DB:{
  prepare(sql){
   const query={sql,args:[]};queries.push(query);
   return {
    bind(...args){query.args=args;return this},
    async first(){
     if(sql.includes('FROM school_settings'))return settings;
     if(sql.includes('FROM school_term_snapshots')){
      return saved?{academic_year:2569,semester:2,snapshot_date:'2026-10-28',
       captured_at:'2026-10-28 01:00:00',captured_by:'Admin'}:null;
     }
     return null;
    },
    async all(){
     if(sql.includes('FROM classrooms c ORDER BY'))return {results:[
      {id:1,grade:1,room:1,label:'ม.1/1',students:3,lessons:2}
     ]};
     return {results:[]};
    }
   };
  },
  async batch(items){batch.push(items);return items.map(()=>({results:[],meta:{changes:1}}))}
 }};
 return {env,queries,batch};
}
const req=(method='GET',suffix='',body=null)=>new Request(
 'https://rd.test'+path+suffix,{method,...(body?{body:JSON.stringify(body)}:{})});
test('term query allows current and historical year only when requested',()=>{
 assert.deepEqual(selectedTerm(new URLSearchParams(),settings),{year:2569,semester:2});
 assert.deepEqual(selectedTerm(new URLSearchParams('year=2568&semester=1'),settings),{year:2568,semester:1});
 for(const query of ['year=abc','semester=3','year=02569']){
  assert.throws(()=>selectedTerm(new URLSearchParams(query),settings),{code:400});
 }
});
test('teacher and staff cannot read, snapshot, or list student room data',async()=>{
 const {env,queries}=fakeEnv();
 for(const role of ['teacher','staff','guardian','student']){
  await assert.rejects(
   ()=>schoolTermRoutes(req(),env,{id:3,role},path),{code:403});
  await assert.rejects(
   ()=>schoolTermRoutes(req('POST','',{academic_year:2569,semester:2,confirm:true}),
     env,{id:3,role},path),{code:403});
 }
 assert.equal(queries.length,0);
});
test('admin sees live preview without writing or reading other student data',async()=>{
 const {env,batch,queries}=fakeEnv();
 const result=await schoolTermRoutes(req(),env,admin,path);
 const body=await result.json();
 assert.equal(body.view.preview,true);
 assert.equal(body.view.rooms[0].students,3);
 assert.equal(body.view.rooms[0].lessons,2);
 assert.equal(body.view.year,2569);
 assert.deepEqual(body.view.students,[]);
 assert.equal(batch.length,0);
 assert.ok(queries.some(x=>x.sql.includes('student_enrollments')));
});
test('previous term cannot be silently displayed as current preview',async()=>{
 const {env}=fakeEnv();
 await assert.rejects(()=>schoolTermRoutes(req('GET','?year=2568&semester=1'),
  env,admin,path),{code:404});
});
test('snapshot creation is confirmed, scoped to configured year/term and atomic',async()=>{
 const {env,queries,batch}=fakeEnv();
 for(const body of [{academic_year:2569,semester:2},{academic_year:2568,semester:2,confirm:true},
  {academic_year:2569,semester:2,confirm:true,extra:1}]){
  await assert.rejects(()=>schoolTermRoutes(req('POST','',body),env,admin,path),
   {code:body.academic_year===2568?409:400});
 }
 assert.equal(batch.length,0);
 await schoolTermRoutes(req('POST','',{academic_year:2569,semester:2,confirm:true}),env,admin,path);
 assert.equal(batch.length,1);
 assert.equal(batch[0].length,4);
 const commits=queries.map(q=>q.sql).filter(sql=>sql.includes('INSERT INTO school_term_'));
 assert.equal(commits.length,3);
 assert.ok(commits.some(sql=>sql.includes('student_enrollments')));
 assert.ok(commits.some(sql=>sql.includes('FROM timetable t WHERE t.active=1')));
 assert.ok(queries.some(q=>q.sql.includes('school_term_snapshot_created')));
});
test('capture contains INSERT SELECT only, never writes to current timetable or enrollment history',()=>{
 const source=code('worker/src/school-terms.js'),migration=code('worker/migrations/0025_school_term_snapshots.sql');
 assert.doesNotMatch(source,/UPDATE\s+(timetable|students|student_enrollments|attendance_period)/i);
 assert.doesNotMatch(source,/DELETE\s+FROM\s+(timetable|students|student_enrollments|attendance_period)/i);
 assert.doesNotMatch(migration,/DROP TABLE|ALTER TABLE/i);
 for(const name of ['school_term_snapshots','school_term_roster','school_term_lessons']){
  assert.ok(migration.includes(name),name);
 }
});
test('term viewer and school settings link remain restricted to admin navigation',()=>{
 const app=code('web/app.js'),navigation=code('web/navigation-ui.js'),
  ui=code('web/term-snapshots.js'),shell=code('web/sw.js'),settings=code('web/school-settings.js');
 assert.match(app,/if\(tab==='termSnapshots'\)/);
 assert.match(app,/termSnapshots\.load\(\)/);
 assert.match(app,/state\.user\?\.role!=='admin'/);
 assert.match(navigation,/'termSnapshots'/);
 assert.match(settings,/data-school-jump="termSnapshots"/);
 assert.match(ui,/\/api\/admin\/term-snapshots/);
 assert.match(ui,/data-term-room/);
 assert.match(ui,/!window\.confirm/);
 assert.match(shell,/rd-care-shell-v86/);
 assert.match(shell,/term-snapshots\.js/);
});
