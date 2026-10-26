// Staff PWA installation / push opt-in settings; all permission prompts require a tap.
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createNotificationSettings({api,pwaTools,mount,toast,safeRun,showTab,getAlerts}){
 async function load(){
  const st=await pwaTools.check();
  const info=!st.canPush?'เบราว์เซอร์นี้ไม่รองรับการแจ้งเตือนแบบ Push':
   !st.enabled?'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่ากุญแจ VAPID จึงยังไม่พร้อมเปิด Push':
   st.permission==='denied'?'การแจ้งเตือนถูกปฏิเสธ โปรดอนุญาตในตั้งค่าอุปกรณ์':
   st.subscribed?'อุปกรณ์นี้เปิดรับการแจ้งเตือนแล้ว':'ยังไม่ได้เปิด Push บนอุปกรณ์นี้';
  // Direct notification opens may skip Dashboard; get the signed-in user's fresh task count.
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [snapshot,urgent]=await Promise.all([
   api('/api/dashboard?date='+encodeURIComponent(day)).catch(()=>({alerts:getAlerts()})),
   api('/api/truancy/advisor').catch(()=>({items:[]}))
  ]);
  const pending=Math.max(0,Number(snapshot?.alerts||0));
  const priority=(urgent.items||[]).filter(item=>item.school_date===day);
  mount(`<section class="stack rd-notification-settings">
   <div class="rd-mobile-welcome"><h2>🔔 ศูนย์แจ้งเตือน</h2>
   <p>เข้าถึงงานสำคัญและตั้งค่า RD Care บนโทรศัพท์ของคุณ</p></div>
   <section class="rd-priority-card" aria-label="เหตุการณ์การมาเรียนที่ควรตรวจสอบโดยเร็ว">
    <div class="rd-priority-heading"><span aria-hidden="true">🚨</span><div>
      <h3>รายการสำคัญวันนี้</h3><p>เหตุการณ์หนีเรียนที่ครูบันทึกและควรติดตามข้อเท็จจริง</p></div>
      <strong class="rd-priority-count" aria-label="${priority.length} รายการ">${priority.length.toLocaleString('th-TH')}</strong></div>
    ${priority.length?`<p class="rd-priority-description">มีรายการควรประสานและตรวจสอบโดยเร็ว ข้อมูลนักเรียนแสดงเฉพาะเมื่อเข้าสู่ระบบ</p>`:
     '<p class="rd-priority-clear">ไม่มีเหตุการณ์หนีเรียนใหม่สำหรับวันนี้ในห้องที่คุณได้รับสิทธิ์</p>'}
    <button type="button" class="button rd-priority-action" data-tab="advisorCenter">เปิดศูนย์ครูที่ปรึกษา</button>
   </section>
   <section class="card stack">
    <div class="row between"><h3>งานรอการตรวจสอบ</h3><span class="tag">${pending.toLocaleString('th-TH')} รายการ</span></div>
    <p class="muted">เปิดดูรายการในระบบหลังเข้าสู่บัญชี โดยไม่ส่งชื่อหรือข้อมูลนักเรียนไปแสดงบนหน้าจอล็อก</p>
    <button type="button" class="button secondary" data-tab="alerts">ตรวจสอบการขาดเรียน</button>
    <button type="button" class="button secondary" data-tab="advisorCenter">ศูนย์ครูที่ปรึกษา</button>
   </section>
   <section class="card stack"><h3>📱 ติดตั้ง RD Care ลงมือถือ</h3>
    <p class="muted">ใช้งานเหมือนแอปผ่านไอคอนบนหน้าจอหลัก พร้อมโหมดเต็มหน้าจอ</p>
    <div class="row between"><span class="tag">${st.installed?'ติดตั้งแอปแล้ว':'ยังไม่อยู่ในโหมดแอป'}</span>
     <button type="button" class="button" id="rdInstallApp" ${st.installed?'disabled':''}>⬇️ ติดตั้งแอป</button></div>
    <p class="muted">iPhone/iPad: เปิดผ่าน Safari → แชร์ → เพิ่มไปยังหน้าจอโฮม จากนั้นเปิดผ่านไอคอน RD Care</p>
   </section>
   <section class="card stack"><h3>🔔 Push Notification สำหรับครู</h3>
    <p class="muted">แจ้งเตือนเมื่อมีรายการขาดรายคาบที่ครูที่ปรึกษาต้องตรวจสอบ โดยใช้ข้อความทั่วไป ไม่มีข้อมูลส่วนตัวของนักเรียน และเปิดรับโดยสมัครใจเท่านั้น</p>
    <div class="${st.enabled&&st.subscribed?'ok':'summary'}" role="status">${esc(info)}</div>
    <div class="row">
     <button type="button" class="button" id="rdEnablePush" ${!st.canPush||!st.enabled||st.permission==='denied'||st.subscribed?'disabled':''}>เปิดรับ Push</button>
     <button type="button" class="button secondary" id="rdDisablePush" ${!st.subscribed?'disabled':''}>ปิด Push อุปกรณ์นี้</button></div>
    <p class="muted">ผู้ปกครองเปิดรับ Push ได้จากบัญชีผู้ปกครองที่ยืนยันแล้ว เฉพาะเหตุหนีเรียน และไม่มีการสมัครรับแจ้งเตือนอัตโนมัติ</p>
   </section></section>`);
  document.querySelector('#rdInstallApp')?.addEventListener('click',()=>safeRun(()=>pwaTools.install()));
  // Must call requestPermission in the synchronous click activation path (especially iOS).
  document.querySelector('#rdEnablePush')?.addEventListener('click',()=>{
   safeRun(async()=>{await pwaTools.enable();await load()});
  });
  document.querySelector('#rdDisablePush')?.addEventListener('click',()=>safeRun(async()=>{await pwaTools.disable();await load()}));
 }
 return {load};
}
