import {formatThaiDate} from './thai-date.js';
// RD CONNECT teacher dashboard: assigned homerooms and daily progress.
// Presentation only. All room-scoping and counts are authorized by the API.
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function summarizeDailyRooms(items){
 const rooms=Array.isArray(items)?items:[];
 const meaningful=rooms.filter(r=>Number(r.students)>0);
 const complete=meaningful.filter(r=>Number(r.checked)>=Number(r.students));
 const waiting=meaningful.filter(r=>Number(r.checked)<Number(r.students));
 return {rooms:rooms.length,withStudents:meaningful.length,complete:complete.length,
  waiting:waiting.length,pupils:meaningful.reduce((n,r)=>n+Number(r.students),0)};
}
export function teacherDailyWorkMarkup(result,{date='',unavailable=false}={}){
 const rows=Array.isArray(result?.items)?result.items:[];
 const stats=summarizeDailyRooms(rows);
 if(unavailable)return '<section class="card rd-teacher-today" aria-label="งานเช็กชื่อของครู">'+
  '<h3>📋 งานเช็กชื่อของฉัน</h3>'+
  '<p class="warn" role="status">ยังโหลดสถานะการเช็กชื่อรายห้องไม่ได้ กรุณากดดูข้อมูลล่าสุดอีกครั้ง ข้อมูลสรุปส่วนนี้อาจยังไม่ครบ</p>'+
  '</section>';
 const cards=rows.map(room=>{
  const total=Math.max(0,Number(room.students)||0);
  const checked=Math.min(total,Math.max(0,Number(room.checked)||0));
  const pending=total-checked,done=total>0&&pending===0;
  const title=total===0?'ไม่มีนักเรียนที่ลงทะเบียนในวันที่เลือก':done?'เช็กชื่อครบแล้ว':
   pending===total?'ยังไม่ได้เช็กชื่อ':'เหลือ '+pending+' คน';
  const kind=total===0?'empty':done?'complete':'pending';
  return '<article class="rd-teacher-room rd-teacher-room-'+kind+'">'+
   '<div class="rd-teacher-room-header"><strong>'+esc(room.label)+'</strong>'+
    '<span class="rd-teacher-room-state">'+esc(title)+'</span></div>'+
   '<div class="rd-teacher-room-progress"><progress max="'+Math.max(total,1)+'" value="'+checked+
    '" aria-label="เช็กชื่อ '+checked+' จาก '+total+' คน"></progress>'+
    '<span>'+checked+' / '+total+' คน</span></div>'+
   '<button type="button" class="button '+(done?'secondary':'')+'" data-daily-room="'+Number(room.id)+
    '" aria-label="เปิดเช็กชื่อห้อง '+esc(room.label)+'">'+
    (done?'ตรวจสอบหรือแก้ไข':'เปิดเช็กชื่อ')+'</button></article>';
 }).join('');
 return '<section class="card rd-teacher-today" aria-label="งานเช็กชื่อของครู">'+
  '<div class="rd-teacher-today-heading"><div><h3>📋 งานเช็กชื่อของฉัน</h3>'+
  '<p class="muted">เฉพาะห้องที่ได้รับมอบหมายเป็นครูที่ปรึกษา • วันที่ '+esc(formatThaiDate(date))+
  ' • ข้อมูลที่บันทึกบนเซิร์ฟเวอร์</p></div>'+
  '<span class="rd-teacher-today-counter" role="status">'+stats.complete+' / '+stats.withStudents+
  ' ห้องเช็กครบ</span></div>'+
  (cards?'<div class="rd-teacher-rooms">'+cards+'</div>':
    '<p class="muted">บัญชีนี้ยังไม่ได้รับมอบหมายเป็นครูที่ปรึกษาประจำห้อง หากเป็นครูผู้สอนสามารถเข้าเมนูเช็กชื่อรายคาบได้</p>')+
  '<p class="rd-teacher-today-note">ตัวเลขนับนักเรียนที่มีรายการเช็กชื่อแล้ว ไม่ได้ตัดสินว่ามาเรียนทุกคน • หากข้อมูลรายห้องไม่ตรง ให้เปิดตรวจสอบรายชื่อก่อนแก้ไข</p>'+
 '</section>';
}
