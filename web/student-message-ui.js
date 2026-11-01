import {formatThaiDateTime} from './thai-date.js';
// Student-only message inbox. All content is escaped; server enforces ownership.
const esc=value=>String(value??'').replace(/[&<>"']/g,
 ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function studentMessagePanel({items=[],unread=0,focusId=null}={}){
 const recent=Array.isArray(items)?items:[];
 return `<section class="rd-portal-panel" data-portal-panel="messages">
  <div class="rd-portal-page-title"><span class="rd-portal-kicker">SCHOOL MESSAGES</span>
   <h1>✉️ ข้อความจากโรงเรียน</h1>
   <p>ข้อความส่วนตัวจากฝ่ายกิจการนักเรียนและเจ้าหน้าที่โรงเรียน</p></div>
  <section class="rd-portal-card rd-student-inbox">
   <div class="rd-portal-section-heading"><h2>กล่องข้อความ
     ${Number(unread)>0?`<span class="rd-portal-count">${Number(unread)} ยังไม่อ่าน</span>`:''}</h2>
    <button type="button" id="studentMessagesRefresh" class="rd-portal-outline">รีเฟรช</button></div>
   ${recent.length?recent.map(m=>`<article class="rd-student-message ${m.read_at?'':'rd-student-message-unread'}"
      ${Number(m.id)===Number(focusId)?'id="studentMessageFocus" tabindex="-1"':''}>
     <div class="rd-portal-record-head">
      <strong>${esc(m.subject)}</strong>
      <span class="rd-portal-status">${m.read_at?'อ่านแล้ว':'ยังไม่อ่าน'}</span>
     </div>
     <p class="rd-student-message-body">${esc(m.body)}</p>
     <small>จาก ${esc(m.sender_name||'โรงเรียน')} • ${esc(formatThaiDateTime(m.created_at))}</small>
     ${!m.read_at?`<button type="button" data-student-message-read="${Number(m.id)}" class="rd-portal-primary">✓ รับทราบ / อ่านแล้ว</button>`:''}
    </article>`).join(''):'<p class="rd-portal-empty">ยังไม่มีข้อความจากโรงเรียน</p>'}
   <p class="rd-portal-help">เฉพาะบัญชีนักเรียนผู้รับเท่านั้นที่เข้าถึงข้อความนี้ได้ • ผู้ปกครองจะไม่ได้รับสำเนาอัตโนมัติ</p>
  </section>
 </section>`;
}
