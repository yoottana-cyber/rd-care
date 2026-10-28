// Reused by teacher entry screens and Student Affairs monitor.
const fmt=score=>Number(score)>0?'+'+Number(score):String(Number(score)||0);
const categoryName={minor:'ความผิดเล็กน้อย',moderate:'ความผิดปานกลาง',
 serious:'ความผิดร้ายแรง',very_serious:'ความผิดร้ายแรงมาก'};
export const scoreDate=value=>{
 if(!value)return '—';
 const raw=String(value).trim();
 const normalized=raw.includes('T')?raw:raw.replace(' ','T')+'Z';
 const date=new Date(normalized);
 if(Number.isNaN(date.getTime()))return raw;
 return new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',day:'numeric',month:'short',
  year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
};
export function scoreHistoryTables({items=[],mode='all',esc,readOnly=false}){
 const render=(isGood)=>{
  const rows=items.filter(row=>isGood?row.score_type==='good':row.score_type!=='good');
  const title=isGood?'ประวัติคะแนนความดี':'ประวัติความผิดและการปรับพฤติกรรม';
  const subject=isGood?'ความดีที่ทำ':'ความผิด / การปรับพฤติกรรม';
  return `<section class="score-history-group" aria-label="${title}"><h4>${title}</h4>
   ${rows.length?`<div class="table-wrap"><table class="table score-history-table"><thead><tr>
    <th>วันที่</th><th>${subject}</th><th>คะแนน</th><th>รายละเอียด</th>
    ${isGood?'<th>ผู้ให้คะแนน</th>':''}${readOnly?'':'<th>จัดการ</th>'}
   </tr></thead><tbody>
   ${rows.map(row=>`<tr>
    <td>${esc(scoreDate(row.created_at))}</td>
    <td><strong>${esc(row.action_name||(
     row.score_type==='adjustment'?'ปรับพฤติกรรม':
     isGood?'ทำความดี':categoryName[row.affairs_category]||'บันทึกความผิด'))}</strong>
     ${row.score_type==='adjustment'?'<span class="tag">ปรับพฤติกรรม</span>':''}</td>
    <td class="score-history-points"><strong>${esc(fmt(row.points))}</strong></td>
    <td>${esc(row.reason&&row.reason!==row.action_name?row.reason:'—')}</td>
    ${isGood?`<td>${esc(row.teacher_name||'—')}</td>`:''}
    ${readOnly?'':`<td>${row.can_delete?
     `<button class="button danger score-delete-own" type="button" data-score-delete="${Number(row.id)}"
      aria-label="ลบรายการคะแนนที่ตนเองบันทึก">ลบ</button>`:
     '<span class="muted">—</span>'}</td>`}
   </tr>`).join('')}</tbody></table></div>`:
   '<p class="empty">ยังไม่มีประวัติในหมวดนี้</p>'}
  </section>`;
 };
 return (mode==='all'||mode==='behavior'?render(false):'')+
   (mode==='all'||mode==='good'?render(true):'');
}
