// Administrator-only classroom coverage view, using aggregated counts (no student PII).
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=v=>(Number(v)||0).toLocaleString('th-TH');
export function summarizeRooms(rows){
 const grades=Array.from({length:6},(_,i)=>({grade:i+1,rooms:0,students:0,empty:0}));
 let students=0,empty=0;
 for(const r of rows){
  const n=Math.max(0,Number(r.student_count)||0);
  students+=n;if(n===0)empty++;
  const g=grades[Number(r.grade)-1];
  if(g){g.rooms++;g.students+=n;if(n===0)g.empty++}
 }
 return {students,rooms:rows.length,empty,filled:rows.length-empty,grades};
}
export function filterRooms(rows,{grade='all',status='empty',search=''}={}){
 const q=String(search).trim().toLocaleLowerCase('th-TH');
 return rows.filter(r=>{
  const n=Number(r.student_count)||0;
  return (grade==='all'||String(r.grade)===String(grade))&&
   (status==='all'||(status==='empty'?n===0:n>0))&&
   (!q||String(r.label||'').toLocaleLowerCase('th-TH').includes(q));
 }).sort((a,b)=>Number(a.grade)-Number(b.grade)||Number(a.room)-Number(b.room));
}
export function createStudentStatistics({api,mount,safeRun,onRoom,isActive=()=>true}){
 let rooms=[],grade='all',status='empty',search='',seq=0;
 const row=r=>{
  const n=Number(r.student_count)||0,paused=Number(r.inactive_count)||0;
  const zero=n===0;
  return '<tr class="'+(zero?'rd-room-zero':'')+'"><td>ม.'+fmt(r.grade)+'</td>'+
   '<td><strong>'+esc(r.label)+'</strong></td><td class="rd-room-number">'+fmt(n)+' คน</td>'+
   '<td class="rd-room-number">'+fmt(paused)+' คน</td><td><span class="rd-room-pill '+(zero?'zero':'filled')+'">'+
   (zero?(paused?'ไม่มีนักเรียนใช้งาน':'ยังไม่มีนักเรียน'):'มีนักเรียนแล้ว')+'</span></td>'+
   '<td><button type="button" class="button secondary" data-room-id="'+Number(r.id)+'">เปิดทะเบียนห้อง</button></td></tr>';
 };
 function render(){
  const sum=summarizeRooms(rooms);
  const tiles=[
   ['นักเรียนใช้งาน',sum.students,'คน',''],['ห้องเรียนทั้งหมด',sum.rooms,'ห้อง',''],
   ['ห้องที่มีนักเรียน',sum.filled,'ห้อง',''],['ห้องยังไม่มีนักเรียน',sum.empty,'ห้อง','rd-stat-alert']
  ];
  const tilesHTML=tiles.map(t=>'<div class="rd-stat-metric '+t[3]+'"><span>'+t[0]+'</span><strong>'+fmt(t[1])+'</strong><small>'+t[2]+'</small></div>').join('');
  const gradesHTML=sum.grades.map(g=>'<button type="button" data-grade="'+g.grade+
   '" class="rd-stat-grade '+(String(grade)===String(g.grade)?'selected':'')+
   '" aria-pressed="'+(String(grade)===String(g.grade))+'"><span>ม.'+fmt(g.grade)+'</span>'+
   '<strong>'+fmt(g.students)+' <small>คน</small></strong><small>'+fmt(g.rooms)+' ห้อง • ยังว่าง '+fmt(g.empty)+' ห้อง</small></button>').join('');
  const gradeOpts=sum.grades.map(g=>'<option value="'+g.grade+'" '+(String(grade)===String(g.grade)?'selected':'')+'>ม.'+fmt(g.grade)+'</option>').join('');
  mount('<section class="stack rd-room-statistics" id="rdStudentStatistics">'+
   '<header class="rd-stat-hero"><div><span class="rd-stat-kicker">RD CONNECT • STUDENT ROSTER</span>'+
   '<h2>สถิติจำนวนนักเรียนแยกตามห้อง</h2>'+
   '<p>ตรวจสอบความครบถ้วนของการนำเข้าทะเบียนนักเรียน ม.1–ม.6 จากฐานข้อมูลปัจจุบัน</p></div>'+
   '<button type="button" class="button secondary" id="rdStatRefresh">↻ โหลดจำนวนล่าสุด</button></header>'+
   '<div class="rd-stat-metrics">'+tilesHTML+'</div>'+
   '<section class="card stack"><h3>สรุปตามระดับชั้น</h3><div class="rd-stat-grades">'+gradesHTML+'</div></section>'+
   '<section class="card stack"><div class="row between"><h3>ตรวจสอบรายห้อง</h3>'+
   '<span id="rdStatShown" class="muted" role="status"></span></div>'+
   '<div class="rd-stat-filters"><div class="field"><label for="rdStatGrade">ระดับชั้น</label>'+
   '<select id="rdStatGrade"><option value="all" '+(grade==='all'?'selected':'')+'>ทุกระดับชั้น</option>'+gradeOpts+'</select></div>'+
   '<div class="field"><label for="rdStatStatus">สถานะห้อง</label>'+
   '<select id="rdStatStatus"><option value="empty" '+(status==='empty'?'selected':'')+'>เฉพาะห้องที่ยังไม่มีนักเรียน</option>'+
   '<option value="all" '+(status==='all'?'selected':'')+'>ทุกห้องเรียน</option>'+
   '<option value="filled" '+(status==='filled'?'selected':'')+'>เฉพาะห้องที่มีนักเรียน</option></select></div>'+
   '<div class="field"><label for="rdStatSearch">ค้นหาห้อง</label>'+
   '<input type="search" id="rdStatSearch" value="'+esc(search)+'" placeholder="เช่น ม.2/3" autocomplete="off"></div></div>'+
   '<div class="table-wrap"><table class="table rd-stat-table"><thead><tr><th>ชั้น</th><th>ห้อง</th>'+
   '<th>นักเรียนใช้งาน</th><th>พักข้อมูล</th><th>สถานะ</th><th>จัดการ</th></tr></thead>'+
   '<tbody id="rdStatRows"></tbody></table></div>'+
   '<p class="muted">นับนักเรียนที่ใช้งานอยู่ในทะเบียนปัจจุบันเท่านั้น ห้องที่มีแต่ข้อมูลพักใช้งานจะขึ้นเป็น 0 และไม่รวมข้อมูลที่ลบหรือเก็บเป็นประวัติ</p>'+
   '</section></section>');
  const root=document.querySelector('#rdStudentStatistics');
  const draw=()=>{
   const displayed=filterRooms(rooms,{grade,status,search});
   root.querySelector('#rdStatShown').textContent='แสดง '+fmt(displayed.length)+' จาก '+fmt(rooms.length)+' ห้อง';
   root.querySelector('#rdStatRows').innerHTML=displayed.map(row).join('')||
    '<tr><td colspan="6" class="rd-stat-no-data">'+
     (status==='empty'&&sum.empty===0?'ทุกห้องมีนักเรียนแล้ว':'ไม่พบห้องเรียนตามตัวกรอง')+'</td></tr>';
  };
  root.querySelector('#rdStatRefresh').addEventListener('click',()=>safeRun(load));
  root.querySelector('#rdStatGrade').addEventListener('change',e=>{grade=e.target.value;render()});
  root.querySelector('#rdStatStatus').addEventListener('change',e=>{status=e.target.value;render()});
  root.querySelector('#rdStatSearch').addEventListener('input',e=>{search=e.target.value;draw()});
  root.addEventListener('click',e=>{
   const g=e.target.closest('[data-grade]');
   if(g){grade=String(grade)===g.dataset.grade?'all':g.dataset.grade;render();return}
   const room=e.target.closest('[data-room-id]');
   if(room)safeRun(()=>onRoom(Number(room.dataset.roomId)));
  });
  draw();
 }
 async function load(){
  const request=++seq;
  mount('<section class="card"><h2>สถิติจำนวนนักเรียน</h2><p class="muted">กำลังโหลดจำนวนรายห้อง…</p></section>');
  try{
   const result=await api('/api/admin/student-statistics',{timeoutMs:20000});
   if(request!==seq||!isActive())return;
   if(!Array.isArray(result.items))throw Error('ข้อมูลสถิติไม่ถูกต้อง');
   rooms=result.items;render();
  }catch(error){
   if(request!==seq||!isActive())return;
   mount('<section class="card stack"><h2>สถิติจำนวนนักเรียน</h2><p class="warn">ไม่สามารถโหลดข้อมูลได้: '+
    esc(error.message)+'</p><button type="button" id="rdStatRetry" class="button">ลองอีกครั้ง</button></section>');
   document.querySelector('#rdStatRetry')?.addEventListener('click',()=>safeRun(load));
  }
 }
 return {load};
}
