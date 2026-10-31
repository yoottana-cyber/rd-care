// Pure, offline-only cross-file guard for RD CONNECT's five-room pilot.
// No credentials, student names or IDs are returned to any result or log.
// This does NOT replace the server's authenticated import preflight.
export const PILOT_ROOM_COUNT=5;
const norm=v=>String(v??'').trim();
const key=v=>norm(v).toLowerCase();
function addIssue(issues,code,detail){
 if(issues.length<60)issues.push({code,detail});
}
export function validatePilotImportBundle({
 selectedRooms=[],rooms=[],roster=[],advisors=[],portal={items:[],errors:[]}
}={}){
 const issues=[],warnings=[],catalog=new Set(rooms.map(r=>r.label));
 const chosen=new Set(selectedRooms);
 if(selectedRooms.length!==PILOT_ROOM_COUNT||chosen.size!==PILOT_ROOM_COUNT||
   [...chosen].some(label=>!catalog.has(label)))
  addIssue(issues,'room_selection','ต้องเลือกห้องเรียนที่มีจริงจำนวน 5 ห้อง โดยไม่ซ้ำกัน');
 const counts=new Map([...chosen].map(label=>[label,{students:0,advisors:0,portals:0,guardians:0}]));
 const studentIds=new Map(),portalIds=new Set();
 const rosterUsernames=new Set();
 for(const item of roster){
  const x=item?.values||{},room=norm(x.classroom),no=key(x.student_no),username=key(x.username);
  if(item.message||item.status==='error')
   addIssue(issues,'student_format','ไฟล์ทะเบียนนักเรียน แถว '+(x.source_row||'?')+': '+(item.message||'รูปแบบไม่ถูกต้อง'));
  if(!chosen.has(room))
   addIssue(issues,'student_scope','ทะเบียนนักเรียน แถว '+(x.source_row||'?')+' อยู่นอก 5 ห้องที่เลือก');
  if(no&&studentIds.has(no))
   addIssue(issues,'student_duplicate','เลขประจำตัวนักเรียนซ้ำในไฟล์ทะเบียน (แถว '+(x.source_row||'?')+')');
  else if(no)studentIds.set(no,room);
  if(username&&rosterUsernames.has(username))
   addIssue(issues,'student_username_duplicate','Username นักเรียนซ้ำในไฟล์ทะเบียน');
  else if(username)rosterUsernames.add(username);
  if(counts.has(room))counts.get(room).students++;
 }
 for(const item of advisors){
  const x=item?.values||{},room=norm(x.classroom);
  if(item.message||item.status==='error')
   addIssue(issues,'advisor_format','ไฟล์ครูที่ปรึกษา แถว '+(x.source_row||'?')+': '+(item.message||'รูปแบบไม่ถูกต้อง'));
  if(!chosen.has(room))
   addIssue(issues,'advisor_scope','ครูที่ปรึกษา แถว '+(x.source_row||'?')+' อยู่นอก 5 ห้องที่เลือก');
  if(counts.has(room))counts.get(room).advisors++;
 }
 for(const problem of portal.errors||[]){
  addIssue(issues,'portal_format','ไฟล์บัญชี แถว '+(problem.source_row||'?')+': '+problem.message);
 }
 for(const x of portal.items||[]){
  const no=key(x.student_no),room=studentIds.get(no);
  if(portalIds.has(no))addIssue(issues,'portal_duplicate','มีบัญชีนักเรียนซ้ำในไฟล์บัญชี');
  portalIds.add(no);
  if(!room||!chosen.has(room))
   addIssue(issues,'portal_scope','ไฟล์บัญชี แถว '+(x.source_row||'?')+' ไม่มีเลขประจำตัวตรงกับทะเบียนใน 5 ห้องที่เลือก');
  else{
   counts.get(room).portals++;
   if(x.guardian_username)counts.get(room).guardians++;
   if(!x.student_password)
    warnings.push('บัญชีนักเรียนแถว '+x.source_row+' ไม่มีรหัสผ่าน: ต้องยืนยันว่ามีบัญชีเดิมแล้ว');
   if(x.guardian_username&&!x.guardian_password)
    warnings.push('ผู้ปกครองแถว '+x.source_row+' ไม่มีรหัสผ่าน: ต้องยืนยันว่ามีบัญชีเดิมแล้ว');
  }
 }
 for(const no of studentIds.keys())
  if(!portalIds.has(no))addIssue(issues,'portal_missing','มีนักเรียนในไฟล์ทะเบียนที่ไม่อยู่ในไฟล์บัญชี');
 for(const [room,n] of counts){
  if(!n.students)addIssue(issues,'room_empty','ห้อง '+room+' ไม่มีนักเรียนในไฟล์');
  if(!n.advisors)addIssue(issues,'advisor_missing','ห้อง '+room+' ไม่มีครูที่ปรึกษาในไฟล์');
  if(n.advisors>2)addIssue(issues,'advisor_overflow','ห้อง '+room+' มีครูที่ปรึกษาเกิน 2 คน');
  if(n.portals!==n.students)addIssue(issues,'portal_not_matching','ห้อง '+room+' จำนวนบัญชีไม่ตรงกับทะเบียน');
  if(n.guardians<n.students)
   warnings.push('ห้อง '+room+' มีข้อมูลผู้ปกครองเพียง '+n.guardians+'/'+n.students+
    ' คน ควรตรวจความสัมพันธ์ที่ยืนยันแล้ว');
 }
 if(!roster.length)addIssue(issues,'no_students','ไฟล์ทะเบียนนักเรียนว่าง');
 if(!advisors.length)addIssue(issues,'no_advisors','ไฟล์ครูที่ปรึกษาว่าง');
 if(!(portal.items||[]).length)addIssue(issues,'no_portal','ไฟล์บัญชีนักเรียน/ผู้ปกครองว่าง');
 return {
  ok:issues.length===0,
  issues,warnings:warnings.slice(0,40),
  totalStudents:roster.length,totalAdvisors:advisors.length,totalAccounts:(portal.items||[]).length,
  rooms:[...counts].map(([label,n])=>({label,...n}))
 };
}
