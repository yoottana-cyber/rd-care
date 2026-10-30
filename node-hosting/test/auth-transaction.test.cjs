'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {preflight,smokeTest,run}=require('../scripts/check-auth-transaction.cjs');
const {hashTemporaryPassword,matchesTemporaryPassword}=require('../src/test-auth-crypto.cjs');
const temporary={username:'rdst_nonreal_test_user',password:'2d1a1f9a117d08f423461488db0f1329',salt:'a'.repeat(32),tokenHash:'b'.repeat(64)};
function connection({nonempty='',wrongDb=false}={}){
 let user=null,session=null,transacting=false,rolledBack=false;
 const sqls=[];
 return {
  sqls, get rolledBack(){return rolledBack},
  async execute(sql,params=[]){
   sqls.push({sql,params});
   if(sql==='SELECT DATABASE() AS db')return [[{db:wrongDb?'not_stage':'ratsadaa_connect'}]];
   if(sql.includes('information_schema.TABLES'))return [[...['users','sessions','students','portal_accounts'].map(TABLE_NAME=>({TABLE_NAME,ENGINE:'InnoDB'}))]];
   if(sql.startsWith('SELECT 1 FROM `')){
    const table=sql.match(/FROM `([^`]+)`/)[1];
    return [[table===nonempty?{exists:1}:null].filter(Boolean)];
   }
   if(sql.startsWith('INSERT INTO users')){user={id:5,username:params[0],role:params[2],password_salt:params[3],password_hash:params[4]};return [{insertId:5}]}
   if(sql.startsWith('SELECT id,role,password_salt,password_hash FROM users'))return [user?[user]:[]];
   if(sql.startsWith('INSERT INTO sessions')){session={token_hash:params[0],user_id:params[1]};return [{affectedRows:1}]}
   if(sql.startsWith('SELECT user_id FROM sessions'))return [session?[session]:[]];
   if(sql.startsWith('SELECT 1 FROM users WHERE username='))return [user?[{exists:1}]:[]];
   if(sql.startsWith('SELECT 1 FROM sessions WHERE token_hash='))return [session?[{exists:1}]:[]];
   throw new Error('Unexpected SQL: '+sql);
  },
  async beginTransaction(){transacting=true},
  async rollback(){assert.equal(transacting,true);user=null;session=null;rolledBack=true},
  release(){}
 };
}
test('strong password hash validates correct and rejects wrong value',async()=>{
 const hashed=await hashTemporaryPassword(temporary.password,temporary.salt);
 assert.match(hashed,/^[a-f0-9]{64}$/);
 assert.equal(await matchesTemporaryPassword(temporary.password,temporary.salt,hashed),true);
 assert.equal(await matchesTemporaryPassword('incorrect-password-of-sufficient-length',temporary.salt,hashed),false);
 assert.equal(await matchesTemporaryPassword(temporary.password,temporary.salt,'bad-value'),false);
});
test('test account and token are rolled back, no data rows remain',async()=>{
 const c=connection();
 assert.equal(await smokeTest(c,{makeCredentials:()=>temporary}),true);
 assert.equal(c.rolledBack,true);
 assert.ok(c.sqls.some(x=>x.sql.startsWith('INSERT INTO users')));
 assert.ok(c.sqls.some(x=>x.sql.startsWith('INSERT INTO sessions')));
 assert.ok(c.sqls.every(x=>!x.sql.includes(temporary.password)));
});
test('refuse wrong database or nonempty existing users without a write',async()=>{
 for(const opts of [{wrongDb:true},{nonempty:'users'},{nonempty:'students'},{nonempty:'portal_accounts'},{nonempty:'sessions'}]){
  const c=connection(opts);
  await assert.rejects(()=>preflight(c),/^Error: staging_/);
  assert.ok(c.sqls.every(x=>!x.sql.startsWith('INSERT')));
 }
});
test('console output does not leak passwords or account identifiers on failure',async()=>{
 const warnings=[],logs=[];const c=connection({nonempty:'students'});let released=false,closed=false;
 c.release=()=>{released=true};
 const status=await run({makePool:()=>({getConnection:async()=>c,end:async()=>{closed=true}}),log:v=>logs.push(v),warn:v=>warnings.push(v)});
 assert.equal(status,1);assert.ok(released&&closed);
 assert.equal(warnings.length,1);assert.match(warnings[0],/staging_database_not_empty/);
 assert.doesNotMatch(warnings[0]+logs.join(' '),/rdst_nonreal_test_user|2d1a1f/);
});
