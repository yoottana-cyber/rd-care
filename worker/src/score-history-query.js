import {caseTypeSql} from './score-ledger.js';
/** Combined scored entries and unscored warnings, with consistent pagination. */
export function historySql(canDelete=true){
 const scoredDelete=canDelete?`CASE WHEN b.recorded_by=? AND NOT EXISTS (
   SELECT 1 FROM truancy_behavior_links l WHERE l.behavior_record_id=b.id
  ) THEN 1 ELSE 0 END`:'0';
 const warnedDelete=canDelete?'CASE WHEN i.recorded_by=? AND i.source_timetable_id IS NULL THEN 1 ELSE 0 END':'0';
 return `SELECT * FROM (
 SELECT b.id,b.points,b.reason,b.created_at,b.recorded_by,b.affairs_category,
  ${caseTypeSql('b')} AS score_type,
  COALESCE(ar.name,adj.name,CASE WHEN b.affairs_category='adjustment' THEN 'ปรับพฤติกรรม'
   WHEN b.points>0 THEN 'ทำความดี' ELSE 'บันทึกความผิด' END) AS action_name,
  u.display_name AS teacher_name,
  ${scoredDelete} AS can_delete,0 AS warning_no
 FROM behavior_records b JOIN users u ON u.id=b.recorded_by
 LEFT JOIN affairs_behavior_rules ar ON ar.id=b.affairs_rule_id
 LEFT JOIN affairs_adjustment_rules adj ON adj.id=b.adjustment_rule_id
 WHERE b.student_id=? AND b.deleted_at IS NULL
 UNION ALL
 SELECT -i.id AS id,0 AS points,i.reason,i.created_at,i.recorded_by,i.affairs_category,
  'behavior' AS score_type,r.name AS action_name,u.display_name AS teacher_name,
  ${warnedDelete} AS can_delete,i.warning_no
 FROM behavior_incidents i JOIN users u ON u.id=i.recorded_by
 JOIN affairs_behavior_rules r ON r.id=i.affairs_rule_id
 WHERE i.student_id=? AND i.deleted_at IS NULL AND i.points_applied=0
 ) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`;
}
