// One searchable, grouped school criteria table for conduct, merits and adjustments.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const RULE_GROUPS=[
 {key:'minor',label:'เล็กน้อย',className:'minor'},
 {key:'moderate',label:'ปานกลาง',className:'moderate'},
 {key:'serious',label:'ร้ายแรง',className:'serious'},
 {key:'very_serious',label:'ร้ายแรงมาก',className:'very_serious'}
];
const score=n=>(Number(n)>0?'+':'')+Number(n);
const categoryLabels=Object.fromEntries(RULE_GROUPS.map(x=>[x.key,x.label]));
categoryLabels.good='ความดี';categoryLabels.adjustment='ปรับพฤติกรรม';
const normalized=s=>String(s??'').toLocaleLowerCase('th').trim();
export function visibleCriteria(items,{mode='behavior',query='',category='all'}={}){
 const text=normalized(query);
 return (Array.isArray(items)?items:[]).filter(r=>
  mode==='behavior'?
   RULE_GROUPS.some(x=>x.key===r.category)&&(category==='all'||r.category===category):
  mode==='good'?r.category==='good':mode==='adjustment'
 ).filter(r=>!text||normalized(r.name).includes(text)||
  normalized(r.id).includes(text)||normalized(categoryLabels[r.category]||'').includes(text))
 .sort((a,b)=>{
  const ca=mode==='behavior'?RULE_GROUPS.findIndex(x=>x.key===a.category):0;
  const cb=mode==='behavior'?RULE_GROUPS.findIndex(x=>x.key===b.category):0;
  return ca-cb||Number(a.points)-Number(b.points)||
   String(a.name).localeCompare(String(b.name),'th')||Number(a.id)-Number(b.id);
 });
}
export function criteriaTableMarkup(items,{mode='behavior',query='',category='all',pageSize=25,page=1}={}){
 const found=visibleCriteria(items,{mode,query,category});
 const size=pageSize==='all'?Math.max(1,found.length):[25,50,100].includes(Number(pageSize))?Number(pageSize):25;
 const pages=Math.max(1,Math.ceil(found.length/size));
 const number=Math.min(Math.max(1,Number(page)||1),pages);
 const offset=(number-1)*size,displayed=found.slice(offset,offset+size);
 const groups=mode==='behavior'?RULE_GROUPS.filter(g=>displayed.some(r=>r.category===g.key)):
  [{key:mode,label:mode==='good'?'คะแนนความดี':'คะแนนปรับพฤติกรรม',className:mode}];
 const allCount=Array.isArray(items)?items.length:0;
 const grouped=groups.map(group=>{
  const records=displayed.filter(r=>mode==='behavior'?r.category===group.key:true);
  return `<tbody class="rd-criteria-group rd-criteria-group-${group.className}">
  <tr class="rd-criteria-group-heading"><th colspan="6" scope="rowgroup">
   <span class="rd-criteria-level rd-criteria-level-${group.className}">${esc(group.label)}</span>
   <span class="rd-criteria-group-count">${records.length} เกณฑ์ในหน้านี้</span></th></tr>
  ${records.map(r=>`<tr class="rd-criteria-row ${r.active?'':'rd-criteria-inactive'}">
    <td class="rd-criteria-id" data-label="รหัส">#${Number(r.id)}</td>
    <td data-label="ชื่อเกณฑ์"><strong class="rd-criteria-name">${esc(r.name)}</strong>
     ${r.automatic?'<span class="rd-criteria-managed">ระบบอัตโนมัติ</span>':''}</td>
    <td data-label="ประเภท"><span class="rd-criteria-level rd-criteria-level-${esc(group.className)}">
      ${esc(categoryLabels[r.category]||(mode==='adjustment'?'ปรับพฤติกรรม':r.category))}</span></td>
    <td data-label="คะแนน" class="rd-criteria-points ${Number(r.points)<0?'minus':'plus'}">${score(r.points)}</td>
    <td data-label="สถานะ"><span class="rd-criteria-status ${r.active?'on':'off'}">
      ${r.active?'เปิดใช้งาน':'ปิดใช้งาน'}</span></td>
    <td data-label="จัดการ" class="rd-criteria-actions">
      ${r.automatic?'<span class="rd-criteria-lock">เกณฑ์อัตโนมัติ · แก้ไขไม่ได้</span>':
       `<button type="button" class="button secondary rd-criteria-action" data-affairs-rule-edit="${Number(r.id)}"
        aria-label="แก้ไขเกณฑ์ ${esc(r.name)}">แก้ไข</button>
        <button type="button" class="button rd-criteria-delete" data-affairs-rule-delete="${Number(r.id)}"
        aria-label="ลบเกณฑ์ ${esc(r.name)}">ลบ</button>`}</td>
   </tr>`).join('')}
  </tbody>`;
 }).join('');
 return `<div class="rd-criteria-list-meta">
   <strong>แสดง ${found.length?offset+1:0}–${Math.min(offset+displayed.length,found.length)} จาก ${found.length} เกณฑ์</strong>
   <span class="muted">ทั้งหมด ${allCount} เกณฑ์ • เรียงคะแนนจากน้อยไปมากภายในแต่ละประเภท</span>
  </div>
  ${found.length?`<div class="rd-criteria-table-scroll" role="region" aria-label="ตารางเกณฑ์คะแนนโรงเรียน" tabindex="0">
   <table class="rd-criteria-table"><thead><tr>
    <th scope="col">รหัส</th><th scope="col">ชื่อเกณฑ์</th><th scope="col">ประเภท</th>
    <th scope="col">คะแนน ↑</th><th scope="col">สถานะ</th><th scope="col">จัดการ</th>
   </tr></thead>${grouped}</table></div>`:
   '<p class="rd-criteria-empty">ไม่พบเกณฑ์ที่ตรงกับการค้นหา</p>'}
  <div class="rd-criteria-pagination">
   <span class="muted">หน้า ${number}/${pages}</span>
   <button type="button" class="button secondary" data-criteria-page="prev" ${number<=1?'disabled':''}>ก่อนหน้า</button>
   <button type="button" class="button secondary" data-criteria-page="next" ${number>=pages?'disabled':''}>ถัดไป</button>
  </div>`;
}
