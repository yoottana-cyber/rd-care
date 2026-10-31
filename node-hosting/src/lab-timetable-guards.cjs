'use strict';
// Stage 7.9: MariaDB D1-parity timetable guards for DISPOSABLE lab only.
// Mirrors the original D1 timetable_clash_insert/update overlap predicates.
// IMPORTANT: plain EXISTS does not guarantee no overlaps under concurrent
// INSERT/UPDATE, even when one offline transaction test passes.
// Race tests and appropriate locking are required before production use.
const {LAB_DATABASE}=require('./lab-guardian-update-guards.cjs');
const {
 EXPECTED:GUARDIAN_EXPECTED,checkTriggerSet:checkGuardianSet
}=require('./lab-guardian-update-guards.cjs');
const {assertEmpty}=require('../scripts/check-lab-guardian-updates.cjs');

const TIMETABLE_TRIGGERS=Object.freeze([
 {
  name:'timetable_clash_insert',event:'INSERT',
  sql:`CREATE TRIGGER timetable_clash_insert
BEFORE INSERT ON timetable
FOR EACH ROW
BEGIN
  IF NEW.active = 1 AND EXISTS (
    SELECT 1 FROM timetable t
    WHERE t.active = 1
      AND t.day_of_week = NEW.day_of_week
      AND (
        t.classroom_id = NEW.classroom_id
        OR t.teacher_user_id = NEW.teacher_user_id
      )
      AND t.period <= COALESCE(NEW.end_period, NEW.period)
      AND COALESCE(t.end_period, t.period) >= NEW.period
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'TIMETABLE_OVERLAP';
  END IF;
END`
 },
 {
  name:'timetable_clash_update',event:'UPDATE',
  sql:`CREATE TRIGGER timetable_clash_update
BEFORE UPDATE ON timetable
FOR EACH ROW
BEGIN
  IF NEW.active = 1 AND EXISTS (
    SELECT 1 FROM timetable t
    WHERE t.id <> OLD.id
      AND t.active = 1
      AND t.day_of_week = NEW.day_of_week
      AND (
        t.classroom_id = NEW.classroom_id
        OR t.teacher_user_id = NEW.teacher_user_id
      )
      AND t.period <= COALESCE(NEW.end_period, NEW.period)
      AND COALESCE(t.end_period, t.period) >= NEW.period
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'TIMETABLE_OVERLAP';
  END IF;
END`
 }
]);
const TIMETABLE_EXPECTED=Object.freeze({
 timetable_clash_insert:{event:'INSERT',words:[
  'NEW.active = 1','t.active = 1','t.day_of_week = NEW.day_of_week',
  't.classroom_id = NEW.classroom_id','t.teacher_user_id = NEW.teacher_user_id',
  't.period <= COALESCE(NEW.end_period, NEW.period)',
  'COALESCE(t.end_period, t.period) >= NEW.period','TIMETABLE_OVERLAP'
 ]},
 timetable_clash_update:{event:'UPDATE',words:[
  'NEW.active = 1','t.id <> OLD.id','t.active = 1',
  't.day_of_week = NEW.day_of_week','t.classroom_id = NEW.classroom_id',
  't.teacher_user_id = NEW.teacher_user_id',
  't.period <= COALESCE(NEW.end_period, NEW.period)',
  'COALESCE(t.end_period, t.period) >= NEW.period','TIMETABLE_OVERLAP'
 ]}
});
function verifyTrigger(t){
 const guardian=Object.prototype.hasOwnProperty.call(GUARDIAN_EXPECTED,t.TRIGGER_NAME)
  ?GUARDIAN_EXPECTED[t.TRIGGER_NAME]:null;
 const timetable=Object.prototype.hasOwnProperty.call(TIMETABLE_EXPECTED,t.TRIGGER_NAME)
  ?TIMETABLE_EXPECTED[t.TRIGGER_NAME]:null;
 const expected=guardian||timetable;
 if(!expected||t.ACTION_TIMING!=='BEFORE'||
    t.EVENT_OBJECT_TABLE!==(guardian?guardian.table:'timetable')||
    t.EVENT_MANIPULATION!==(guardian?guardian.event:timetable.event)||
    !(guardian?guardian.statement:timetable.words).every(text=>
      String(t.ACTION_STATEMENT).includes(text)))
  throw Error('lab_trigger_metadata_mismatch');
}
async function inspectSet(conn,expectedCount){
 if(![3,4,5].includes(expectedCount))throw Error('lab_trigger_count_invalid');
 const [[db]]=await conn.execute('SELECT DATABASE() AS db');
 if(db?.db!==LAB_DATABASE)throw Error('lab_database_mismatch');
 const [rows]=await conn.execute(
  'SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING,ACTION_STATEMENT '+
  'FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()'
 );
 if(rows.length!==expectedCount)throw Error('lab_unexpected_trigger_count');
 const names=new Set();
 for(const t of rows){
  verifyTrigger(t);
  if(names.has(t.TRIGGER_NAME))throw Error('lab_duplicate_trigger');
  names.add(t.TRIGGER_NAME);
 }
 const allNames=[...Object.keys(GUARDIAN_EXPECTED),...Object.keys(TIMETABLE_EXPECTED)];
 if(allNames.slice(0,expectedCount).some(n=>!names.has(n)))
  throw Error('lab_missing_guard');
 return {database:LAB_DATABASE,installed_triggers:expectedCount,
  guardian_triggers:3,timetable_triggers:expectedCount-3};
}
async function preflight(conn){
 // Explicitly validate exactly the three known, already-working guards.
 await checkGuardianSet(conn,3);
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
 await assertEmpty(conn); // all 63 tables, including accounts and schedules
 return inspectSet(conn,3);
}
module.exports={LAB_DATABASE,TIMETABLE_TRIGGERS,TIMETABLE_EXPECTED,
 verifyTrigger,inspectSet,preflight,assertEmpty};
