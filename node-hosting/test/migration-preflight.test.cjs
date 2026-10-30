'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {checkDatabase,category}=require('../scripts/check-db.cjs');
const {inspect,run}=require('../scripts/inspect-d1-schema.cjs');
test('read-only DB check succeeds without exposing credentials or running writes',async()=>{
 const queries=[],logs=[],warnings=[];let closed=false;
 const code=await checkDatabase({env:{RD_DB_PASSWORD:'secret!'},makePool:()=>({
  async query(sql){queries.push(sql);return [[{ok:1}]]},async end(){closed=true}}),
  log:msg=>logs.push(msg),warn:msg=>warnings.push(msg)});
 assert.equal(code,0);assert.deepEqual(queries,['SELECT 1 AS ok']);assert.equal(closed,true);
 assert.equal(warnings.length,0);assert.doesNotMatch(logs.join(' '),/secret!/);
});
test('DB failures return category only, close pool and do not log secrets',async()=>{
 const errors=[];let closed=false;
 const code=await checkDatabase({makePool:()=>({
   async query(){const e=new Error('secretPassword@host');e.code='ER_ACCESS_DENIED_ERROR';throw e},
   async end(){closed=true}}),log:()=>{},warn:x=>errors.push(x)});
 assert.equal(code,1);assert.equal(closed,true);
 assert.match(errors[0],/authentication_rejected/);assert.doesNotMatch(errors[0],/secretPassword@host/);
 assert.equal(category({code:'ETIMEDOUT'}),'database_unreachable');
});
test('schema inspection counts tables without importing or returning contents',()=>{
 const dump=`PRAGMA foreign_keys=OFF;\nCREATE TABLE "users" (id INTEGER);\nCREATE TABLE IF NOT EXISTS students (id INTEGER);\nCREATE UNIQUE INDEX idx_students ON students(id);\nCREATE TRIGGER fix AFTER INSERT ON students BEGIN SELECT 1; END;`;
 assert.deepEqual(inspect(dump),{
  tables:2,indexes:1,triggers:1,views:0,
  note:'Inventory only. SQLite DDL and triggers must be ported and tested before MariaDB import.'
 });
 assert.throws(()=>inspect("CREATE TABLE x(a TEXT);\nINSERT INTO x VALUES ('private student');"),/contains_data_use_no_data_export/);
 const messages=[];
 assert.equal(run(['node','script','secret.sql'],()=>("CREATE TABLE x(a);\nINSERT INTO x VALUES ('secret');"),()=>{},m=>messages.push(m)),1);
 assert.equal(messages[0],'D1 schema inspection: contains_data_use_no_data_export');
});
