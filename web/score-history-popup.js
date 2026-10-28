// Shared teacher score-history popup for conduct, merit and adjustment menus.
// Keeps the focused student's history out of the recording form.
import {scoreHistoryTables} from './score-history.js';

export function createScoreHistoryPopup({api,toast,safeRun,escapeHtml}){
 const esc=escapeHtml;
 let state=null,overlay=null,returnFocus=null,version=0;
 const heading=mode=>mode==='good'?'ประวัติคะแนนความดี':'ประวัติความผิดและการปรับพฤติกรรม';
 function close(){
  version++;
  if(overlay){overlay.remove();overlay=null}
  document.body.classList.remove('rd-score-popup-open');
  state=null;
  if(returnFocus?.isConnected)returnFocus.focus();
  returnFocus=null;
 }
 function draw(){
  if(!state)return;
  if(!overlay){
   overlay=document.createElement('div');
   overlay.className='rd-score-popup-overlay';
   overlay.id='rdScoreHistoryOverlay';
   document.body.append(overlay);
   document.body.classList.add('rd-score-popup-open');
  }
  const {student,mode,scores,items,hasMore}=state;
  const remaining=Number(scores.behavior_remaining)||0;
  const merit=Number(scores.good_total)||0;
  overlay.innerHTML=`<section class="rd-score-popup-dialog card stack" role="dialog"
    aria-modal="true" aria-labelledby="rdScoreHistoryHeading" tabindex="-1">
   <div class="row between rd-score-popup-heading">
    <div><h3 id="rdScoreHistoryHeading">${heading(mode)}</h3>
     <p>${esc(student.full_name)} · ${esc(student.student_no||'')}
      ${student.classroom_label?' · '+esc(student.classroom_label):''}</p></div>
    <button type="button" class="rd-score-popup-close" id="rdScorePopupClose"
      aria-label="ปิดประวัติคะแนน" title="ปิด (Esc)">×</button>
   </div>
   <div class="row rd-score-popup-metrics">
    <span class="tag">ความดี +${merit}</span>
    <span class="tag">ความผิดคงเหลือ ${remaining}</span>
    <span class="tag">ปรับแล้ว ${Number(scores.behavior_adjusted)||0}</span>
   </div>
   ${scoreHistoryTables({items,mode,esc})}
   ${hasMore?'<button type="button" class="button secondary" id="rdScorePopupMore">ดูประวัติเพิ่มเติม</button>':''}
  </section>`;
  const dialog=overlay.querySelector('[role="dialog"]');
  overlay.onclick=event=>{if(event.target===overlay)close()};
  dialog.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();close();return}
   if(event.key!=='Tab')return;
   const controls=[...dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled])')];
   if(!controls.length){event.preventDefault();dialog.focus();return}
   const first=controls[0],last=controls[controls.length-1];
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
  });
  overlay.querySelector('#rdScorePopupClose')?.addEventListener('click',close);
  overlay.querySelector('#rdScorePopupMore')?.addEventListener('click',()=>safeRun(async()=>load(true)));
  overlay.querySelectorAll('[data-score-delete]').forEach(button=>button.addEventListener('click',()=>safeRun(async()=>{
   const current=state;
   if(!window.confirm('ยืนยันลบรายการคะแนนที่คุณบันทึกเอง? ระบบเก็บหลักฐานการลบไว้'))return;
   button.disabled=true;
   try{
    await api('/api/behavior/records/'+Number(button.dataset.scoreDelete)+'/delete',
     {method:'POST',body:{}});
    toast('ลบรายการและปรับยอดคะแนนใหม่แล้ว');
    if(current?.onChange)await current.onChange();
    if(state===current)await load(false);
   }finally{if(button.isConnected)button.disabled=false}
  })));
 }
 async function load(more=false){
  if(!state)return;
  const current=state,requestVersion=version;
  const offset=more?current.nextOffset:0;
  const data=await api(current.endpoint+'?student_id='+Number(current.student.id)+'&offset='+offset);
  if(state!==current||version!==requestVersion)return;
  const rows=current.readOnly?(data.items||[]).map(row=>({...row,can_delete:0})):(data.items||[]);
  current.items=more?[...current.items,...rows]:rows;
  current.scores=data;
  current.hasMore=Boolean(data.has_more);
  current.nextOffset=Number(data.next_offset)||0;
  draw();
  (overlay.querySelector(more?'#rdScorePopupMore':'#rdScorePopupClose')||
   overlay.querySelector('#rdScorePopupClose'))?.focus();
 }
 async function open({student,mode='all',onChange,readOnly=false}){
  if(!student?.id)return;
  close();
  returnFocus=document.activeElement;
  state={student,mode,onChange,readOnly,endpoint:readOnly?'/api/affairs/behavior/monitor/history':'/api/behavior',
   items:[],scores:{},hasMore:false,nextOffset:0};
  // Show a helpful loading state while fetching the student record.
  overlay=document.createElement('div');
  overlay.className='rd-score-popup-overlay';
  overlay.id='rdScoreHistoryOverlay';
  overlay.innerHTML='<section class="rd-score-popup-dialog card stack" role="dialog" aria-modal="true" aria-label="กำลังโหลดประวัติ" tabindex="-1">'+
   '<div class="row between rd-score-popup-heading"><p>กำลังโหลดประวัติคะแนน...</p>'+
   '<button type="button" class="rd-score-popup-close" id="rdScorePopupClose" aria-label="ปิดประวัติคะแนน">×</button></div></section>';
  document.body.append(overlay);
  document.body.classList.add('rd-score-popup-open');
  overlay.onclick=event=>{if(event.target===overlay)close()};
  overlay.querySelector('#rdScorePopupClose')?.addEventListener('click',close);
  overlay.querySelector('[role="dialog"]')?.addEventListener('keydown',event=>{
   if(event.key==='Escape'){event.preventDefault();close()}
  });
  overlay.querySelector('#rdScorePopupClose')?.focus();
  const current=state,requestVersion=version;
  try{
   await load(false);
  }catch(error){
   if(state===current&&version===requestVersion)close();
   throw error;
  }
 }
 return {open,close};
}
