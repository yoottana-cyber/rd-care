'use strict';
// RD CONNECT migration release gate. NOT a launch switch.
// All declared capabilities must be externally verified before a cutover.
// Until then this check intentionally returns NO_GO; it cannot be bypassed
// by setting an environment flag or by installing schema-only triggers.
const STAGING_DATABASE='ratsadaa_connect';
const LIVE_READINESS={
 service:'RD CONNECT Node.js migration',
 environment:'isolated-node-staging',
 approval:'not_granted',
 release_state:'NO_GO'
};
const REQUIRED_CAPABILITIES=Object.freeze([
 ['auth_staff','Teacher/Admin authentication, session revocation, persistence'],
 ['auth_portal','Separate student/guardian authentication and isolation'],
 ['roles','Homeroom, subject, student-affairs, student and guardian authorization'],
 ['attendance_daily','Daily homeroom attendance and advisor coverage'],
 ['attendance_period','Subject timetable and per-period attendance'],
 ['late_qr','Permanent QR late arrival and auto-approval'],
 ['behavior','Incidents, truancy penalties, deletion/restoration rules'],
 ['merit','Separate good-deed points and behavior adjustments'],
 ['portal_read','Student/guardian own records, attendance and behavior history'],
 ['student_affairs','Student affairs workflow, reminders and dashboard'],
 ['push','Web Push subscriptions, notification flow and deep links'],
 ['imports','Idempotent student/guardian/staff import and safe updates'],
 ['reporting','Exports, school statistics and data integrity reports'],
 ['backup','Verified database backup and tested restoration'],
 ['migration','Verified D1 export and MariaDB migration/delta reconciliation'],
 ['frontend','PWA routing, session persistence and mobile workflows'],
 ['observability','Error logging, audit trail and health monitoring'],
 ['security','Authorization and abuse tests for all exposed API routes']
].map(([key,description])=>Object.freeze({key,description})));
const NO_GO_REASONS=Object.freeze([
 'public_node_auth_and_school_apis_not_ported',
 'student_activities_and_push_not_migrated',
 'd1_to_mariadb_data_migration_not_verified',
 'backup_restore_and_cutover_rollback_not_tested',
 'security_and_user_acceptance_not_signed_off'
]);
const TEST_GATE_KEYS=Object.freeze([
 'RD_TRIGGER_LAB_ALLOW_DDL','RD_TRIGGER_LAB_ALLOW_RACE',
 'RD_TRIGGER_LAB_ALLOW_LOCK','RD_TRIGGER_LAB_ALLOW_WRITE',
 'RD_TRIGGER_LAB_ALLOW_RETRY'
]);
function assertStagingEnvironment(env){
 if(env.RD_DB_NAME!==STAGING_DATABASE)throw Error('release_wrong_staging_db');
 const left=String(env.RD_TRIGGER_LAB_DB_NAME||'');
 if(left===STAGING_DATABASE)throw Error('release_lab_aliases_staging');
 const enabled=TEST_GATE_KEYS.filter(key=>env[key]!=null&&String(env[key]).length>0);
 if(enabled.length)throw Error('release_temporary_test_flag_present');
 return true;
}
function evaluateSnapshot(snapshot){
 if(!snapshot||snapshot.db!==STAGING_DATABASE)throw Error('release_wrong_staging_db');
 if(snapshot.tables!==63||snapshot.fks!==119)
  throw Error('release_staging_schema_mismatch');
 if(snapshot.triggers!==0)throw Error('release_staging_trigger_inventory_changed');
 if(snapshot.views!==0)throw Error('release_staging_views_unexpected');
 if(snapshot.verified_empty_tables!==63)throw Error('release_staging_not_empty');
 // Correct schema is ONLY an operational inventory, not proof of readiness.
 return {database:snapshot.db,structural_baseline_ok:true,
  tables:snapshot.tables,foreign_keys:snapshot.fks,
  installed_business_triggers:snapshot.triggers,
  verified_empty_tables:snapshot.verified_empty_tables};
}
function assessReadiness({env,snapshot,http}={}){
 if(env)assertStagingEnvironment(env);
 const inventory=snapshot?evaluateSnapshot(snapshot):null;
 if(!http||http.health?.status!==503||
    http.health?.body?.error!=='migration_not_ready'||
    http.auth?.status!==501||
    http.auth?.body?.error!=='endpoint_not_migrated'||
    http.timetable?.status!==501||
    http.timetable?.body?.error!=='endpoint_not_migrated'||
    http.transport?.status!==200||
    http.transport?.body?.migration_ready!==false||
    http.transport?.body?.login_enabled!==false)
  throw Error('release_public_gate_not_closed');
 // Deliberate permanent NO_GO until the capabilities are actually
 // implemented, data migration audited and readiness evidence attached.
 return {status:'NO_GO',production_ready:false,
  ...LIVE_READINESS,staging_inventory:inventory,
  required_capabilities:REQUIRED_CAPABILITIES.length,
  verified_production_capabilities:0,
  pending_capabilities:REQUIRED_CAPABILITIES.map(x=>x.key),
  reasons:[...NO_GO_REASONS]};
}
module.exports={STAGING_DATABASE,LIVE_READINESS,REQUIRED_CAPABILITIES,
 NO_GO_REASONS,TEST_GATE_KEYS,assertStagingEnvironment,evaluateSnapshot,assessReadiness};
