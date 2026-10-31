'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {
 checkLoginInput,kindInfo,sessionHash,tokenFromAuthorization,
 verifyAccountPassword,login,me,logout
}=require('../src/staging-auth-service.cjs');
const {d1PasswordHash}=require('../src/d1-password-compat.cjs');

test('all role areas exist, and portal role must be explicit',()=>{
 assert.equal(kindInfo('staff').account,'users');
 assert.equal(kindInfo('portal').sessions,'portal_sessions');
 assert.throws(()=>kindInfo('unknown'),e=>e.status===400);
 assert.deepEqual(checkLoginInput({username:' STAGETEST ',password:'a',remember:true},'staff'),{
  username:'stagetest',password:'a',role:null,remember:true
 });
 assert.throws(()=>checkLoginInput({username:'studenT',password:'aaa'},'portal'),e=>e.status===400);
 assert.throws(()=>checkLoginInput({username:'x',password:'aaa'},'staff'),e=>e.status===400);
 assert.throws(()=>checkLoginInput({username:'test',password:'x'.repeat(513)},'staff'),e=>e.status===400);
});
test('D1 PBKDF2 fake and true password evaluation works',async()=>{
 const salt='rd2$'+randomBytes(16).toString('hex');
 const password='synthetic-password-6.4';
 const hash=await d1PasswordHash(password,salt);
 const row={password_salt:salt,password_hash:hash};
 assert.equal(await verifyAccountPassword(password,row),true);
 assert.equal(await verifyAccountPassword('wrong-password',row),false);
 assert.equal(await verifyAccountPassword(password,null),false);
});
test('Bearer token format and hash do not expose raw token',()=>{
 const token='a'.repeat(64);
 assert.match(sessionHash(token),/^[a-f0-9]{64}$/);
 assert.notEqual(sessionHash(token),token);
 assert.equal(tokenFromAuthorization('Bearer '+token),token);
 assert.equal(tokenFromAuthorization('bearer '+token),null);
 assert.equal(tokenFromAuthorization('Bearer abc'),null);
 assert.equal(tokenFromAuthorization('Bearer '+token+' extra'),null);
});
function fakeConnection(){
 const now=Math.floor(Date.now()/1000);
 const user={id:4,username:'fake_teacher',display_name:'Fake Teacher',role:'teacher',active:1,password_salt:'rd2$'+('a'.repeat(32)),password_hash:null};
 const attempts=new Map(),sessions=new Map();
 const sqls=[];
 const conn={sqls,
  async execute(sql,params=[]){
   sqls.push({sql,params});
   if(sql.startsWith('SELECT failures,locked_until FROM'))return [[attempts.get(params[0])].filter(Boolean)];
   if(sql.startsWith('SELECT id,username,display_name,role,password_salt,password_hash,active FROM'))return [[params[0]===user.username?user:null].filter(Boolean)];
   if(sql.startsWith('INSERT INTO `login_attempts`')){
    attempts.set(params[0],{failures:params[1],locked_until:params[2]});
    return [{affectedRows:1}];
   }
   if(sql.startsWith('DELETE FROM `login_attempts`')){attempts.delete(params[0]);return [{affectedRows:1}]}
   if(sql.startsWith('INSERT INTO `sessions`')){
    sessions.set(params[0],{user_id:params[1],expires_at:params[2]});return [{affectedRows:1}];
   }
   if(sql.startsWith('SELECT a.id,a.username,a.display_name,a.role,a.active FROM `sessions`')){
    const session=sessions.get(params[0]);return [[session?.expires_at>params[1]?user:null].filter(Boolean)];
   }
   if(sql.startsWith('SELECT 1 AS assigned FROM student_affairs_assignments'))return [[]];
   if(sql.startsWith('DELETE FROM `sessions`')){sessions.delete(params[0]);return [{affectedRows:1}]}
   throw new Error('unexpected query '+sql);
  }
 };
 return {conn,user,attempts,sessions};
}
test('service creates token hash only, authenticates and revokes teacher session',async()=>{
 const {conn,user,attempts,sessions}=fakeConnection();
 const password='test-auth-service-password';user.password_hash=await d1PasswordHash(password,user.password_salt);
 await assert.rejects(()=>login(conn,{kind:'staff',body:{username:user.username,password:'incorrect'}}),e=>e.status===401);
 assert.equal(attempts.get(user.username).failures,1);
 const response=await login(conn,{kind:'staff',body:{username:user.username,password}});
 assert.equal(response.user.role,'teacher');
 assert.equal(response.expires_in,28800);
 assert.equal(attempts.has(user.username),false);
 const auth={kind:'staff',authorization:'Bearer '+response.token};
 assert.equal((await me(conn,auth)).user.student_affairs,0);
 assert.equal(sessions.size,1);
 assert.equal(sessions.has(response.token),false); // hashes only
 assert.deepEqual(await logout(conn,auth),{ok:true});
 await assert.rejects(()=>me(conn,auth),e=>e.status===401);
 assert.equal(sessions.size,0);
});
test('five invalid passwords temporarily lock a fake account',async()=>{
 const {conn,user}=fakeConnection();
 user.password_hash=await d1PasswordHash('password-is-different',user.password_salt);
 for(let i=0;i<5;i++){
  await assert.rejects(()=>login(conn,{kind:'staff',body:{username:user.username,password:'incorrect'}}),e=>e.status===401);
 }
 await assert.rejects(()=>login(conn,{kind:'staff',body:{username:user.username,password:'password-is-different'}}),e=>e.status===429);
});
