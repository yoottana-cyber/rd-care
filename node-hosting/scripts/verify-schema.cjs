'use strict';
// Explicit, read-only schema inspection on the *staging* MariaDB database.
// No SQL data rows, password hashes, table content, or credentials are printed.
// This script does NOT approve production use; the business-rule triggers are not ported.
const {openPool}=require('../src/database.cjs');
const {category}=require('./check-db.cjs');

const CHECKS=Object.freeze({
  total_tables:63,
  total_foreign_keys:119,
  total_triggers:0,
  end_date_type:'varchar(10)',
  unique_indexes:2
});

async function readSchema(pool){
  const [[tableCount],[fkCount],[triggerCount],[endDate],[idxCount]]=await Promise.all([
    pool.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE'"),
    pool.query("SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='FOREIGN KEY'"),
    pool.query("SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()"),
    pool.query("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_enrollments' AND COLUMN_NAME='end_date'"),
    pool.query("SELECT COUNT(DISTINCT INDEX_NAME) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_enrollments' AND NON_UNIQUE=0 AND INDEX_NAME IN ('uq_student_current_enrollment','uq_room_current_roll')")
  ]);
  return {
    total_tables:Number(tableCount[0]?.n),
    total_foreign_keys:Number(fkCount[0]?.n),
    total_triggers:Number(triggerCount[0]?.n),
    end_date_type:String(endDate[0]?.t??'').toLowerCase(),
    unique_indexes:Number(idxCount[0]?.n)
  };
}

function differences(actual,expected=CHECKS){
  return Object.keys(expected).filter(name=>actual[name]!==expected[name]);
}

async function verifySchema({env=process.env,makePool=openPool,log=console.log,warn=console.error}={}){
  let pool;
  try{
    pool=makePool(env);
    const actual=await readSchema(pool);
    const failures=differences(actual);
    log('RD CONNECT MariaDB staging schema (read-only): '+JSON.stringify(actual));
    if(failures.length){
      warn('SCHEMA CHECK FAILED: mismatch in '+failures.join(', ')+'.');
      return 1;
    }
    log('SCHEMA CHECK OK: tables, foreign keys, indexes and column type match staging baseline.');
    log('NOTICE: 0 triggers means attendance/behavior/Push business rules are NOT yet ported. Do not use with real student data.');
    return 0;
  }catch(error){
    warn('SCHEMA CHECK FAILED ('+category(error)+').');
    return 1;
  }finally{
    if(pool){try{await pool.end()}catch{}}
  }
}

if(require.main===module){
  verifySchema().then(code=>{process.exitCode=code;},()=>{console.error('SCHEMA CHECK FAILED (unknown).');process.exitCode=1;});
}
module.exports={CHECKS,readSchema,differences,verifySchema};
