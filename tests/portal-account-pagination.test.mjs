import test from 'node:test';
import assert from 'node:assert/strict';
import {createPortalAdmin} from '../web/portal-admin.js';
import {pageWindow,portalListUrl,fetchPortalRows,PORTAL_PAGE_SIZES} from '../web/portal-table.js';
import {portalAdminRoutes} from '../worker/src/portal.js';
import {readFileSync} from 'node:fs';

test('admin table offers 10, 25, 50, 100, and all, with correct page ranges',()=>{
 assert.deepEqual(PORTAL_PAGE_SIZES,['10','25','50','100','all']);
 assert.deepEqual(pageWindow(205,2,'25'),{page:2,pages:9,total:205,first:26,last:50,hasPrev:true,hasNext:true});
 assert.deepEqual(pageWindow(205,1,'all'),{page:1,pages:1,total:205,first:1,last:205,hasPrev:false,hasNext:false});
 assert.deepEqual(pageWindow(0,1,'10'),{page:1,pages:1,total:0,first:0,last:0,hasPrev:false,hasNext:false});
 assert.ok(portalListUrl('accounts',{role:'guardian',page:4,limit:50,query:'แม่นักเรียน'})
  .includes('role=guardian'));
 assert.throws(()=>portalListUrl('students'),/Invalid/);
});
test('all selection streams every page without old 3000/4000 record limit',async()=>{
 const calls=[],total=4900;
 const api=async url=>{
  const u=new URL(url,'https://school.test');calls.push(u);
  const page=Number(u.searchParams.get('page'));
  const count=Math.min(250,total-(page-1)*250);
  return{total,page,items:Array.from({length:count},(_,i)=>({id:(page-1)*250+i+1})),
   has_more:page*250<total};
 };
 const progress=[];
 const data=await fetchPortalRows(api,'links',{pageSize:'all',onProgress:(n,t)=>progress.push([n,t])});
 assert.equal(data.items.length,4900);
 assert.equal(data.total,4900);
 assert.equal(calls.length,20);
 assert.equal(calls[0].searchParams.get('limit'),'250');
 assert.deepEqual(progress.at(-1),[4900,4900]);
});
test('role-limited admin listing queries never truncate accounts or links',async()=>{
 const calls=[];
 const env={DB:{prepare(sql){
  const call={sql,args:[]};calls.push(call);
  return{bind(...args){
   call.args=args;return{
    first:async()=>({n:7250}),
    all:async()=>({results:[{id:1,role:'student',student_no:'00001'}]})
   };
  }};
 }}};
 const staff={id:3,role:'admin'};
 const url='https://school.test/api/admin/portal/accounts?role=student&limit=100&page=5&q=000';
 const result=await portalAdminRoutes(new Request(url),env,staff,'/api/admin/portal/accounts');
 assert.equal(result.status,200);
 const payload=await result.json();
 assert.equal(payload.total,7250);
 assert.equal(payload.limit,100);
 assert.equal(payload.page,5);
 assert.equal(payload.items[0].student_no,'00001');
 assert.equal(payload.has_more,true);
 assert.ok(calls.some(x=>x.sql.includes('LIMIT ? OFFSET ?')&&x.args.at(-2)===100&&x.args.at(-1)===400));
 assert.ok(calls.some(x=>x.sql.includes('a.role=?')&&x.args.includes('student')));
 const links=await portalAdminRoutes(new Request('https://school.test/api/admin/portal/links?limit=100&page=1'),
  env,staff,'/api/admin/portal/links');
 assert.equal((await links.json()).total,7250);
 assert.ok(calls.some(x=>x.sql.includes('FROM guardian_student_links l')&&x.sql.includes('LIMIT ? OFFSET ?')));
 const source=readFileSync(new URL('../worker/src/portal.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/ORDER BY a.role,a.id DESC LIMIT 3000/);
 assert.doesNotMatch(source,/ORDER BY l.guardian_account_id,l.student_id LIMIT 4000/);
});
test('student, guardian and relationship lists are admin-only',async()=>{
 for(const role of ['teacher','staff']){
  await assert.rejects(()=>portalAdminRoutes(new Request('https://school.test/api/admin/portal/accounts'),
   {DB:{prepare(){throw Error('Should not touch DB')}}},{id:8,role},'/api/admin/portal/accounts'),
   {code:403});
 }
});
test('admin screens are separated, preserve bulk import, and include full-list controls',async()=>{
 const saved=globalThis.document;
 globalThis.document={querySelector:()=>null,querySelectorAll:()=>[]};
 try{
  const api=async url=>{
   const p=new URL(url,'https://school.test'),role=p.searchParams.get('role');
   if(p.pathname.endsWith('/summary'))return{student_accounts:3200,guardian_accounts:1500,links:7200,students_without_guardian:25};
   if(p.pathname.endsWith('/room-status'))return{items:[]};
   if(p.pathname==='/api/admin/students')return{items:[]};
   if(p.pathname.endsWith('/links'))return{items:[{guardian_account_id:4,student_id:5,guardian_name:'คุณแม่',
    guardian_username:'mom001',full_name:'นักเรียน ก',student_no:'00001',classroom_label:'ม.1/1'}],total:7200,page:1};
   return {items:role==='guardian'?[{id:4,role:'guardian',active:1,display_name:'ผู้ปกครอง',
    username:'mom001'}]:[{id:5,role:'student',active:1,display_name:'นักเรียน',username:'00001'}],
    total:role==='guardian'?1500:3200,page:1};
  };
  const rooms=[{id:1,label:'ม.1/1'}];
  async function htmlFor(view){
   let html='';
   const admin=createPortalAdmin({view,api,mount:h=>{html=h},toast:()=>{},rooms,safeRun:fn=>fn()});
   await admin.load();
   return html;
  }
  const student=await htmlFor('student'),guardian=await htmlFor('guardian'),links=await htmlFor('links');
  assert.match(student,/สร้างบัญชีนักเรียน/);
  assert.match(student,/id="portalRosterImporter"/);
  assert.doesNotMatch(student,/id="portalCreateGuardian"/);
  assert.match(guardian,/id="portalCreateGuardian"/);
  assert.doesNotMatch(guardian,/id="portalCreateStudent"/);
  assert.match(links,/id="portalLink"/);
  assert.match(links,/id="portalGuardianLookup"/);
  assert.doesNotMatch(links,/id="portalRosterImporter"/);
  for(const html of [student,guardian,links]){
   for(const label of ['10 แถว','25 แถว','50 แถว','100 แถว','ทั้งหมด'])
    assert.ok(html.includes(label),label);
   assert.match(html,/id="portalPageSize"/);
   assert.match(html,/id="portalPrevious"/);
   assert.match(html,/id="portalNext"/);
   assert.match(html,/id="portalListSearch"/);
  }
 }finally{globalThis.document=saved}
});
