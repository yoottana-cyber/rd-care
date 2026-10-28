// Read-only current roster counts. Admin authentication is enforced by adminRoutes.
export async function studentStatisticsEndpoint(env){
 const sql=[
  'SELECT c.id,c.grade,c.room,c.label,',
  'COALESCE(SUM(CASE WHEN s.active=1 THEN 1 ELSE 0 END),0) AS student_count,',
  'COALESCE(SUM(CASE WHEN s.active=0 THEN 1 ELSE 0 END),0) AS inactive_count',
  'FROM classrooms c',
  'LEFT JOIN students s ON s.classroom_id=c.id AND s.deleted_at IS NULL',
  'GROUP BY c.id,c.grade,c.room,c.label ORDER BY c.grade,c.room'
 ].join(' ');
 const {results}=await env.DB.prepare(sql).all();
 return Response.json({items:(results||[]).map(r=>({
  id:Number(r.id),grade:Number(r.grade),room:Number(r.room),label:r.label,
  student_count:Number(r.student_count)||0,inactive_count:Number(r.inactive_count)||0
 }))},{headers:{'cache-control':'no-store'}});
}
