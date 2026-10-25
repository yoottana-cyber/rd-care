// Admin-only global search. Uses bound parameters and never returns credentials.
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
function fail(code,message){throw Object.assign(new Error(message),{code})}
export function normalizeStudentSearch(value){
 if(typeof value!=='string')fail(400,'คำค้นต้องเป็นข้อความ');
 if(/[\u0000-\u001f\u007f]/.test(value))fail(400,'คำค้นมีอักขระที่ไม่รองรับ');
 const query=value.trim().replace(/\s+/g,' ');
 if(query.length<2||query.length>60)fail(400,'กรุณาพิมพ์คำค้น 2–60 ตัวอักษร');
 return query.toLowerCase();
}
export async function searchStudents(req,env,user){
 if(user?.role!=='admin')fail(403,'เฉพาะผู้ดูแลระบบ');
 const input=new URL(req.url).searchParams.get('q')||'';
 const q=normalizeStudentSearch(input);
 const rows=await env.DB.prepare(`SELECT s.id,s.student_no,s.full_name,s.roll_no,s.classroom_id,
  c.label AS classroom_label,s.active
  FROM students s
  JOIN classrooms c ON c.id=s.classroom_id
  WHERE instr(lower(s.student_no),?)>0 OR instr(lower(s.full_name),?)>0
     OR instr(lower(c.label),?)>0
  ORDER BY s.active DESC,c.grade,c.room,s.roll_no,s.id LIMIT 20`
 ).bind(q,q,q).all();
 return respond({items:rows.results});
}
