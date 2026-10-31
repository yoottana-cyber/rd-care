'use strict';
// Stage 7.5: isolated trigger-lab only. Original D1 guardian link INSERT guard.
// Important: this is a FIRST parity checkpoint; UPDATE and account role-change
// bypasses are not yet protected. Never use this in production.
const {getLabConfig,LAB_DATABASE}=require('../scripts/check-trigger-lab.cjs');
const SQL=`CREATE TRIGGER guardian_link_role_guard
BEFORE INSERT ON guardian_student_links
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM portal_accounts pa
    WHERE pa.id = NEW.guardian_account_id AND pa.role = 'guardian'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'guardian_account_required';
  END IF;
END`;
const EXPECTED_NAME='guardian_link_role_guard';
function fail(code){throw Error(code)}
async function labTriggerMetadata(conn,expectedCount){
 const [[db]]=await conn.execute('SELECT DATABASE() AS db');
 if(db?.db!==LAB_DATABASE)fail('lab_database_mismatch');
 const [triggers]=await conn.execute(
  "SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()"
 );
 if(triggers.length!==expectedCount)fail('lab_unexpected_trigger_count');
 if(expectedCount===1){
  const t=triggers[0];
  if(t.TRIGGER_NAME!==EXPECTED_NAME||t.EVENT_OBJECT_TABLE!=='guardian_student_links'||
     t.EVENT_MANIPULATION!=='INSERT'||t.ACTION_TIMING!=='BEFORE'||
     !String(t.ACTION_STATEMENT).includes('guardian_account_required')||
     !String(t.ACTION_STATEMENT).includes("pa.role = 'guardian'"))
   fail('lab_guardian_trigger_mismatch');
 }
 return {database:LAB_DATABASE,installed_triggers:triggers.length};
}
async function labEmptyAccounts(conn){
 const tables=['users','classrooms','students','portal_accounts','guardian_student_links'];
 for(const table of tables){
  const [found]=await conn.execute('SELECT 1 AS present FROM `'+table+'` LIMIT 1');
  if(found.length)fail('lab_contains_existing_data');
 }
}
async function makeConnection({env=process.env,driver}={}){
 const config=getLabConfig(env); // forbids use of school's RD_DB_* credentials/name
 const mysql=driver||require('mysql2/promise');
 return mysql.createPool(config);
}
module.exports={SQL,EXPECTED_NAME,LAB_DATABASE,labTriggerMetadata,labEmptyAccounts,makeConnection};
