import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import worker from '../worker/src/worker.js';
import {bangkokToday} from '../worker/src/core.js';

test('advisor center uses a collection selector and absence review restricts classroom choices',()=>{
 const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 assert.ok(app.includes("$$('[data-advisor-review]').forEach"));
 assert.doesNotMatch(app,/(?<!\$)\$\('\[data-advisor-review\]'\)\.forEach/);
 assert.ok(app.includes('roomOptions(advisorOnly=false)'));
 assert.ok(app.includes('filters({date:false,advisorOnly:true})'));
 assert.ok(app.includes("r.advisor_user_id===state.user.id"));
});

function envFor(role){
 const statements=[],date=bangkokToday();
 const db={
  prepare(sql){
   const entry={sql,args:[]};statements.push(entry);
   return {bind(...args){entry.args=args;return {
    async first(){
     if(sql.includes('FROM sessions s'))return {id:7,username:'teacher',role,active:1};
     throw Error('Unexpected query: '+sql);
    },
    async all(){
     if(sql.includes('SELECT id FROM classrooms WHERE advisor_user_id'))return {results:[{id:2},{id:4}]};
     throw Error('Unexpected query: '+sql);
    }
   }}};
  },
  async batch(items){return items.map(()=>({results:[{total:0}]}))}
 };
 return {env:{DB:db},statements,date};
}
test('dashboard teacher alert badge only counts advisor-owned classes, not every taught class',async()=>{
 const {env,statements,date}=envFor('teacher');
 const res=await worker.fetch(new Request('https://rd.test/api/dashboard?date='+date,
  {headers:{Authorization:'Bearer '+'b'.repeat(64)}}),env);
 assert.equal(res.status,200);
 const query=statements.find(item=>item.sql.includes('FROM attendance_alerts al'));
 assert.ok(query);
 assert.match(query.sql,/c\.advisor_user_id=\?/);
 assert.deepEqual(query.args,[date,2,4,7]);
 assert.match(query.sql,/NOT EXISTS\(SELECT 1 FROM attendance_daily d/);
});
test('staff dashboard retains school-wide task counts',async()=>{
 const {env,statements,date}=envFor('admin');
 const res=await worker.fetch(new Request('https://rd.test/api/dashboard?date='+date,
  {headers:{Authorization:'Bearer '+'b'.repeat(64)}}),env);
 assert.equal(res.status,200);
 const query=statements.find(item=>item.sql.includes('FROM attendance_alerts al'));
 assert.ok(query);
 assert.doesNotMatch(query.sql,/AND c\.advisor_user_id=\?/);
 assert.deepEqual(query.args,[date]);
});
