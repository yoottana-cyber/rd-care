'use strict';
// Stage 7.6, disposable MariaDB LAB ONLY. Two extra UPDATE guards.
// They close single-transaction/single-writer bypasses of original D1 INSERT guard.
// Does NOT establish concurrency safety; separate interleaving tests are needed.
const {LAB_DATABASE,makeConnection,labTriggerMetadata,labEmptyAccounts}=require('./lab-guardian-guard.cjs');

const GUARDS=Object.freeze([
 {
  name:'guardian_link_role_guard_update',table:'guardian_student_links',
  sql:`CREATE TRIGGER guardian_link_role_guard_update
BEFORE UPDATE ON guardian_student_links
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM portal_accounts pa
    WHERE pa.id = NEW.guardian_account_id AND pa.role = 'guardian'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'guardian_account_required';
  END IF;
END`
 },
 {
  name:'guardian_account_role_guard_update',table:'portal_accounts',
  sql:`CREATE TRIGGER guardian_account_role_guard_update
BEFORE UPDATE ON portal_accounts
FOR EACH ROW
BEGIN
  IF OLD.role = 'guardian' AND NOT (NEW.role <=> 'guardian')
     AND EXISTS (
       SELECT 1 FROM guardian_student_links l
       WHERE l.guardian_account_id = OLD.id
     ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'linked_guardian_role_locked';
  END IF;
END`
 }
]);
const EXPECTED={
 guardian_link_role_guard:{table:'guardian_student_links',event:'INSERT',statement:["guardian_account_required","pa.role = 'guardian'"]},
 guardian_link_role_guard_update:{table:'guardian_student_links',event:'UPDATE',statement:["guardian_account_required","pa.role = 'guardian'"]},
 guardian_account_role_guard_update:{table:'portal_accounts',event:'UPDATE',statement:["linked_guardian_role_locked","guardian_student_links","OLD.id"]}
};
function assertExpectedTrigger(t){
 const key=t.TRIGGER_NAME, spec=Object.prototype.hasOwnProperty.call(EXPECTED,key)?EXPECTED[key]:null;
 if(!spec||t.EVENT_OBJECT_TABLE!==spec.table||t.EVENT_MANIPULATION!==spec.event
    ||t.ACTION_TIMING!=='BEFORE'||!spec.statement.every(s=>String(t.ACTION_STATEMENT).includes(s)))
   throw Error('lab_guardian_trigger_metadata_mismatch');
}
async function checkTriggerSet(conn,expectedCount){
 if(![1,2,3].includes(expectedCount))throw Error('lab_expected_trigger_count_invalid');
 await labTriggerMetadata(conn,1).catch(err=>{
  // The older helper can only validate 0/1; when checking 2/3, our full
  // check below validates all trigger identities instead.
  if(expectedCount===1)throw err;
  if(err?.message!=='lab_unexpected_trigger_count')throw err;
 });
 const [[current]]=await conn.execute('SELECT DATABASE() AS db');
 if(current?.db!==LAB_DATABASE)throw Error('lab_database_mismatch');
 const [rows]=await conn.execute(
  'SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING,ACTION_STATEMENT '+
  'FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'
 );
 if(rows.length!==expectedCount)throw Error('lab_unexpected_trigger_count');
 const names=new Set();
 for(const row of rows){
  assertExpectedTrigger(row);
  if(names.has(row.TRIGGER_NAME))throw Error('lab_duplicate_trigger');
  names.add(row.TRIGGER_NAME);
 }
 const expectedNames=Object.keys(EXPECTED).slice(0,expectedCount);
 if(expectedNames.some(n=>!names.has(n)))throw Error('lab_required_guard_missing');
 return {database:LAB_DATABASE,guardian_triggers:expectedCount};
}
async function preflight(conn){
 const [[current]]=await conn.execute('SELECT DATABASE() AS db');
 if(current?.db!==LAB_DATABASE)throw Error('lab_database_mismatch');
 const [[{n:tables}]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'"
 );
 const [[{n:fks}]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='FOREIGN KEY'"
 );
 const [[{n:views}]]=await conn.execute(
  "SELECT COUNT(*) AS n FROM information_schema.VIEWS WHERE TABLE_SCHEMA=DATABASE()"
 );
 if(Number(tables)!==63||Number(fks)!==119||Number(views)!==0)
  throw Error('lab_schema_mismatch');
 // Full empty check (all 63 tables) to reject unexpected school information.
 const [list]=await conn.execute(
  "SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'"
 );
 if(list.length!==63||list.some(t=>String(t.ENGINE).toUpperCase()!=='INNODB'))
  throw Error('lab_innodb_required');
 for(const row of list){
  if(!/^[a-z][a-z0-9_]{0,63}$/.test(row.TABLE_NAME))throw Error('lab_unexpected_table_name');
  const [found]=await conn.execute('SELECT 1 AS present FROM `'+row.TABLE_NAME+'` LIMIT 1');
  if(found.length)throw Error('lab_database_contains_rows');
 }
 await labEmptyAccounts(conn);
 return checkTriggerSet(conn,1);
}
module.exports={GUARDS,EXPECTED,checkTriggerSet,preflight,makeConnection,LAB_DATABASE};
