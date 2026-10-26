// Permanent printed late-arrival QR for the school duty station.
// No rotating secret: the QR is a public link; authenticated student and duty
// teacher review are required before attendance is verified.
const esc=value=>String(value??'').replace(/[&<>"']/g,
 ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
export function createLateGate({api,mount,toast,safeRun}){
 const state={qr:null,queue:[],date:'',timer:null,alive:false,busy:false};
 function destroy(){
  state.alive=false;
  if(state.timer)clearInterval(state.timer);
  state.timer=null;state.busy=false;
 }
 function render(){
  if(!state.alive)return;
  const pending=state.queue.filter(x=>x.state==='pending');
  const verified=state.queue.filter(x=>x.state==='verified');
  const statuses={pending:'รอครูเวรตรวจสอบ',verified:'ยืนยันแล้ว',rejected:'ไม่อนุมัติ'};
  mount(`<div class="stack late-qr-page">
   <header class="row between"><div><h2>📷 QR ลงชื่อมาสาย (ถาวร)</h2>
    <p class="muted">QR แผ่นเดียวพิมพ์ติดไว้ได้ทุกวัน • นักเรียนลงชื่อได้หลัง 08.00 น. ตามเวลาโรงเรียน</p></div>
    <span class="tag">วันที่ ${esc(state.date||'-')}</span></header>
   <div class="late-qr-layout">
    <section class="card stack late-qr-station">
     <div class="late-qr-print" id="lateQrPrintable">
      <div class="late-qr-print-head">
       <h2>โรงเรียนรัษฎา</h2>
       <h3>QR Code ลงชื่อมาสาย</h3>
       <p>สำหรับนักเรียนที่มาถึงโรงเรียนหลัง 08.00 น.</p>
      </div>
      <div class="late-qr-image" id="lateQrImage">
       ${state.qr?.svg||'<div class="empty">กำลังโหลด QR Code ถาวร</div>'}
      </div>
      <p class="late-qr-print-instruction">สแกนด้วยกล้องโทรศัพท์ → เข้าสู่ระบบบัญชีนักเรียน → กดยืนยันลงชื่อมาสาย</p>
      <p class="late-qr-print-link">${esc(state.qr?.url||'https://rd-care.pages.dev/')}</p>
      <p class="late-qr-print-footer">ระบบการดูแลและช่วยเหลือนักเรียน • RD Care</p>
     </div>
     <div class="late-qr-controls">
      <span class="tag">QR ถาวร • ไม่หมดอายุ • ใช้ซ้ำได้ทุกวัน</span>
      <div class="row">
       <button id="lateQrPrint" class="button" type="button" ${state.qr?'':'disabled'}>🖨️ พิมพ์ QR ติดที่จุดครูเวร</button>
       <button id="lateQrReload" class="button secondary" type="button">โหลด QR อีกครั้ง</button>
      </div>
      <p class="muted">QR ถาวรเป็นลิงก์เปิดหน้าลงชื่อ ไม่ยืนยันว่าผู้สแกนอยู่ในโรงเรียน ครูเวรต้องตรวจสอบตัวนักเรียนก่อนอนุมัติ</p>
     </div>
    </section>
    <section class="card stack">
     <div class="row between"><h3>รายชื่อนักเรียนลงชื่อวันนี้</h3><button id="lateQrRefresh" type="button" class="button secondary">รีเฟรช</button></div>
     <div class="grid two"><div class="summary"><strong>${pending.length}</strong><p class="muted">รอตรวจสอบ</p></div>
       <div class="summary"><strong>${verified.length}</strong><p class="muted">ยืนยันแล้ว</p></div></div>
     <p class="muted" role="status">อัปเดตประมาณทุก 6 วินาที • ใช้เวลาเข้าระบบจากเซิร์ฟเวอร์ • รายการต้องได้รับการยืนยันจากครูเวร</p>
     <div class="late-qr-list" aria-live="polite">
      ${state.queue.length?state.queue.map(item=>`<article class="late-qr-entry">
        <div class="row between"><strong>${esc(item.full_name)}</strong><span class="tag">${esc(item.arrived_at)} น.</span></div>
        <p class="muted">${esc(item.student_no)} • ${esc(item.classroom_label||'ไม่พบห้องเรียน')} • เลขที่ ${esc(item.roll_no||'-')}</p>
        ${item.reason?`<p>สาเหตุ: ${esc(item.reason)}</p>`:''}
        <p class="${item.state==='pending'?'warn':'muted'}">${esc(statuses[item.state]||item.state)}</p>
        ${item.state==='pending'?`<div class="row">
         <button class="button" type="button" data-qr-review="${esc(item.id)}" data-status="verified">ยืนยันมาสาย</button>
         <button class="button secondary" type="button" data-qr-review="${esc(item.id)}" data-status="rejected">ไม่อนุมัติ</button>
        </div>`:''}
       </article>`).join(''):'<p class="empty">ยังไม่มีนักเรียนสแกนลงชื่อในวันนี้</p>'}
     </div>
    </section>
   </div></div>`);
  document.querySelector('#lateQrPrint')?.addEventListener('click',()=>window.print());
  document.querySelector('#lateQrReload')?.addEventListener('click',()=>safeRun(loadQr));
  document.querySelector('#lateQrRefresh')?.addEventListener('click',()=>safeRun(()=>poll(true)));
  document.querySelectorAll('[data-qr-review]').forEach(button=>button.addEventListener('click',()=>safeRun(async()=>{
   const id=button.dataset.qrReview,decision=button.dataset.status;
   const matched=state.queue.find(x=>String(x.id)===id);
   if(!matched||!confirm((decision==='verified'?'ยืนยัน':'ไม่อนุมัติ')+'การลงชื่อมาสายของ '+matched.full_name+'?'))return;
   button.disabled=true;
   try{
    await api('/api/late/qr/'+encodeURIComponent(id)+'/review',{method:'POST',body:{state:decision}});
    toast(decision==='verified'?'ยืนยันมาสายและบันทึกประวัติสำเร็จ':'ไม่อนุมัติรายการแล้ว');
    await poll(true);
   }finally{if(button.isConnected)button.disabled=false}
  })));
 }
 async function poll(always=false){
  if(!state.alive||state.busy)return;
  state.busy=true;
  try{
   const response=await api('/api/late/qr/queue');
   if(!state.alive)return;
   const next=response.items||[];
   const changed=JSON.stringify(next)!==JSON.stringify(state.queue);
   state.queue=next;state.date=response.date;
   if(changed||always)render();
  }finally{state.busy=false}
 }
 async function loadQr(){
  const result=await api('/api/late/qr/print');
  if(!state.alive)return;
  state.qr=result;render();
 }
 async function load(){
  destroy();state.alive=true;state.queue=[];state.date='';state.qr=null;
  render();
  await Promise.all([loadQr(),poll(true)]);
  if(!state.alive)return;
  state.timer=setInterval(()=>{
   if(state.alive)poll().catch(err=>console.warn('RD late gate refresh',err?.name||'failed'));
  },6000);
 }
 return {load,destroy};
}
