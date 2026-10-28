import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 DEFAULT_SCHOOL_SETTINGS,validateSchoolSettings,getLateCutoffTime,
 schoolSettingsRoutes
} from '../worker/src/school-settings.js';
import {lateGateOpen} from '../worker/src/late-qr.js';
import {createSchoolSettings} from '../web/school-settings.js';
const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const path='/api/admin/school-settings';
const request=(method='GET',body)=>new Request('https://rd.test'+path,{method,
 ...(body?{body:JSON.stringify(body),headers:{'content-type':'application/json'}}:{})});
const admin={id:11,role:'admin'};
function mockDb(initial=DEFAULT_SCHOOL_SETTINGS){
 let settings={...initial},batchCalls=[],calls=[];
 let history=[];
 const db={
  prepare(sql){
   const item={sql,args:[]};calls.push(item);
   return {
    bind(...args){item.args=args;return this},
    async first(){
     if(sql.includes('late_cutoff_time FROM school_settings'))return {late_cutoff_time:settings.late_cutoff_time};
     if(sql.includes('FROM school_settings WHERE id=1'))return {...settings};
     return null;
    },
    async all(){
     return {results:history.map((row,i)=>({...row,id:i+1,actor_name:'ผู้ดูแลระบบ',
      created_at:'2026-10-28 01:00:00'}))};
    }
   };
  },
  async batch(stmts){
   batchCalls.push(stmts);
   const update=calls.findLast(c=>c.sql.startsWith('UPDATE school_settings'));
   const old={...settings};
   settings={school_name:update.args[0],academic_year:update.args[1],semester:update.args[2],
    semester_start_date:update.args[3],semester_end_date:update.args[4],
    school_start_time:update.args[5],late_cutoff_time:update.args[6],
    first_period_start_time:update.args[7],period_duration_minutes:update.args[8],
    lunch_after_period:update.args[9],lunch_break_minutes:update.args[10],
    between_period_break_minutes:update.args[11],updated_by:update.args[12]};
   history=[{previous_value:JSON.stringify(old),next_value:JSON.stringify(settings)}];
   return stmts.map(()=>({meta:{changes:1}}));
  }
 };
 return {DB:db,calls,batchCalls,get:()=>settings};
}
test('defaults are explicit but not silently applied to existing student data',()=>{
 assert.equal(DEFAULT_SCHOOL_SETTINGS.school_name,'โรงเรียนรัษฎา');
 assert.equal(DEFAULT_SCHOOL_SETTINGS.late_cutoff_time,'08:00');
 assert.equal(DEFAULT_SCHOOL_SETTINGS.first_period_start_time,'08:30');
 assert.equal(DEFAULT_SCHOOL_SETTINGS.period_duration_minutes,50);
 assert.equal(DEFAULT_SCHOOL_SETTINGS.lunch_after_period,0);
 assert.equal(DEFAULT_SCHOOL_SETTINGS.lunch_break_minutes,0);
 assert.equal(DEFAULT_SCHOOL_SETTINGS.between_period_break_minutes,0);
 assert.equal(DEFAULT_SCHOOL_SETTINGS.semester_start_date,null);
 const ddl=file('worker/migrations/0024_school_settings.sql');
 assert.match(ddl,/CREATE TABLE IF NOT EXISTS school_settings/);
 assert.match(ddl,/CREATE TABLE IF NOT EXISTS school_settings_history/);
 assert.match(ddl,/INSERT OR IGNORE INTO school_settings\(id\) VALUES\(1\)/);
 assert.doesNotMatch(ddl,/DELETE FROM (students|attendance_daily|timetable)/);
});
test('settings validation rejects invalid dates, time ordering, unknown keys and malformed names',async()=>{
 const good={...DEFAULT_SCHOOL_SETTINGS,school_start_time:'07:40',
  late_cutoff_time:'08:15',semester_start_date:'2026-11-01',
  semester_end_date:'2027-04-01'};
 assert.deepEqual(validateSchoolSettings(good),good);
 for(const bad of [
  {school_name:'<script>'},{academic_year:2400},{semester:3},
  {school_start_time:'14:30'},{late_cutoff_time:'07:20'},
  {late_cutoff_time:'08:60'},{semester_start_date:'2026-02-30'},
  {semester_start_date:'2026-11-01',semester_end_date:null},
  {semester_start_date:'2027-04-02',semester_end_date:'2027-04-01'},
  {first_period_start_time:'04:00'},{first_period_start_time:'22:00'},
  {first_period_start_time:'18:00',period_duration_minutes:50},
  {period_duration_minutes:55},{period_duration_minutes:35},
  {period_duration_minutes:'45'},
  {lunch_after_period:10,lunch_break_minutes:60},
  {lunch_after_period:4,lunch_break_minutes:0},
  {lunch_after_period:0,lunch_break_minutes:60},
  {lunch_after_period:4,lunch_break_minutes:181},
  {lunch_after_period:5,lunch_break_minutes:14},
  {lunch_after_period:4,lunch_break_minutes:'60'},
  {between_period_break_minutes:31},
  {between_period_break_minutes:-1},
  {lunch_after_period:9,lunch_break_minutes:180,between_period_break_minutes:30,
   first_period_start_time:'18:00'},
  {extra_flag:true}
 ]){
  await assert.rejects(async()=>validateSchoolSettings({...good,...bad}),{code:400});
 }
 await assert.rejects(async()=>validateSchoolSettings({late_cutoff_time:'08:20'}),{code:400});
});
test('non-admin cannot read or write any school-wide settings',async()=>{
 const env=mockDb(),body={...DEFAULT_SCHOOL_SETTINGS};
 for(const role of ['teacher','staff','student','guardian']){
  const user={id:9,role};
  await assert.rejects(()=>schoolSettingsRoutes(request(),env,user,path),{code:403});
  await assert.rejects(()=>schoolSettingsRoutes(request('POST',body),env,user,path),{code:403});
 }
 assert.equal(env.calls.length,0);
});
test('admin reads current settings and audited history without changes',async()=>{
 const env=mockDb();
 const response=await schoolSettingsRoutes(request(),env,admin,path);
 const data=await response.json();
 assert.equal(data.settings.school_name,'โรงเรียนรัษฎา');
 assert.deepEqual(data.history,[]);
 assert.equal(env.batchCalls.length,0);
});
test('admin saves a change atomically with history and audit, repeated identical saves are idempotent',async()=>{
 const env=mockDb();
 const changed={...DEFAULT_SCHOOL_SETTINGS,academic_year:2570,semester:1,
  school_start_time:'07:30',late_cutoff_time:'08:10',
  first_period_start_time:'09:00',period_duration_minutes:45,
  lunch_after_period:4,lunch_break_minutes:60,between_period_break_minutes:5};
 const response=await schoolSettingsRoutes(request('POST',changed),env,admin,path);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.settings.late_cutoff_time,'08:10');
 assert.equal(data.settings.academic_year,2570);
 assert.equal(data.settings.first_period_start_time,'09:00');
 assert.equal(data.settings.period_duration_minutes,45);
 assert.equal(data.settings.lunch_after_period,4);
 assert.equal(data.settings.lunch_break_minutes,60);
 assert.equal(data.settings.between_period_break_minutes,5);
 assert.equal(env.batchCalls.length,1);
 assert.equal(env.batchCalls[0].length,3);
 assert.ok(env.calls.some(x=>x.sql.includes("school_settings_history")));
 assert.ok(env.calls.some(x=>x.sql.includes("school_settings_updated")));
 assert.equal(await getLateCutoffTime(env),'08:10');
 assert.deepEqual(env.batchCalls[0].length,3);
 const again=await schoolSettingsRoutes(request('POST',changed),env,admin,path);
 assert.equal((await again.json()).unchanged,true);
 assert.equal(env.batchCalls.length,1);
});
test('late QR uses the chosen Bangkok cutoff, with 08:00 still the default',()=>{
 const at=t=>new Date('2026-10-28T'+t+':00+07:00');
 assert.equal(lateGateOpen(at('08:00')),false);
 assert.equal(lateGateOpen(at('08:01')),true);
 assert.equal(lateGateOpen(at('08:05'),'08:10'),false);
 assert.equal(lateGateOpen(at('08:11'),'08:10'),true);
 const qr=file('worker/src/late-qr.js');
 assert.match(qr,/await getLateCutoffTime\(env\)/);
 assert.match(qr,/await openGate\(env\)/);
 assert.match(qr,/cutoff_time:await getLateCutoffTime\(env\)/);
});
test('admin navigation, mobile PWA and printable QR reflect the settings without opening write permissions',()=>{
 const app=file('web/app.js'),nav=file('web/navigation-ui.js'),
  page=file('web/school-settings.js'),gate=file('web/late-gate.js'),
  shell=file('web/sw.js'),html=file('web/index.html');
 assert.match(app,/state\.user\?\.role!=='admin'/);
 assert.match(app,/schoolSettings\.load\(\)/);
 assert.match(nav,/pages:\[[^\]]*'schoolSettings'/);
 for(const name of ['schoolSettingsForm','schoolSetting_academic_year','schoolSetting_school_start_time',
  'schoolSetting_late_cutoff_time','schoolSettingsReload']){
  if(name==='schoolSetting_academic_year'||name==='schoolSetting_school_start_time'||name==='schoolSetting_late_cutoff_time'){
   assert.match(page,/schoolSetting_\$\{name\}/);continue;
  }
  assert.ok(page.includes(name),name);
 }
 assert.match(page,/\/api\/admin\/school-settings/);
 assert.match(page,/data-school-jump="studentAffairs"/);
 assert.match(gate,/state\.qr\?\.cutoff_time/);
 assert.match(shell,/rd-care-shell-v98/);
 assert.match(shell,/school-settings\.js/);
 assert.match(shell,/period-clock\.js/);
 assert.match(page,/period_duration_minutes/);
 assert.match(page,/first_period_start_time/);
 assert.match(page,/rdPeriodClockPreview/);
 assert.match(page,/lunch_after_period/);
 assert.match(page,/lunch_break_minutes/);
 assert.match(page,/between_period_break_minutes/);
 assert.match(html,/school-settings\.css/);
 const client=createSchoolSettings({api:async()=>{},mount:()=>{},safeRun:fn=>fn(),toast:()=>{},navigate:()=>{}});
 assert.equal(typeof client.load,'function');
});
