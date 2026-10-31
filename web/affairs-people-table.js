// RD CONNECT student affairs: editable advisor roster with searchable native
// datalist comboboxes. DOM/UI only; server separately authorizes all writes.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
export const activeTeachers=teachers=>(teachers||[]).filter(t=>
 Number(t.active)===1&&['teacher','staff'].includes(t.role)&&Number.isSafeInteger(Number(t.id))).
 slice().sort((a,b)=>String(a.display_name).localeCompare(String(b.display_name),'th'));
export const teacherLabel=teacher=>teacher?
 String(teacher.display_name||'')+' (@'+String(teacher.username||'')+')'+
 (teacher.role==='staff'?' • ฝ่ายกิจการ':''):'';
export function selectedLabel(userId,teachers){
 const teacher=teachers.find(t=>Number(t.id)===Number(userId));
 return teacher?teacherLabel(teacher):'';
}
export function resolveTeacherId(value,teachers){
 const typed=String(value??'').trim();
 if(!typed)return null;
 const found=teachers.find(t=>teacherLabel(t)===typed);
 if(!found)throw Error('กรุณาเลือกชื่อครูจากรายการค้นหาที่แสดง ไม่ใช่พิมพ์ชื่อใหม่เอง');
 return Number(found.id);
}
export function filterAdvisorRoster(rooms,{query='',grade='all',coverage='all'}={}){
 const q=String(query).trim().toLocaleLowerCase('th');
 return rooms.filter(r=>{
  if(grade!=='all'&&Number(grade)!==Number(r.grade))return false;
  if(coverage==='missing'&&(r.advisor_user_id||r.advisor2_user_id))return false;
  if(coverage==='partial'&&!(r.advisor_user_id&&!r.advisor2_user_id))return false;
  if(!q)return true;
  return [r.label,r.advisor_name,r.advisor2_name,r.primaryLabel,r.secondaryLabel]
   .some(x=>String(x||'').toLocaleLowerCase('th').includes(q));
 });
}
export function advisorManagementMarkup(roster){
 const teachers=activeTeachers(roster.teachers);
 const userLabels=new Map(teachers.map(t=>[Number(t.id),teacherLabel(t)]));
 const rows=(roster.rooms||[]).map(room=>({
  ...room,
  primaryLabel:userLabels.get(Number(room.advisor_user_id))||room.advisor_name||'',
  secondaryLabel:userLabels.get(Number(room.advisor2_user_id))||room.advisor2_name||''
 }));
 const choices='<datalist id="rdAffairsTeacherChoices">'+teachers.map(t=>
  '<option value="'+esc(teacherLabel(t))+'"></option>').join('')+'</datalist>';
 const search=(value,name,label,placeholder='ค้นหาชื่อหรือ Username')=>
  '<input class="rd-affairs-searchable-teacher" type="search" list="rdAffairsTeacherChoices" '+
  'name="'+name+'" aria-label="'+esc(label)+'" autocomplete="off" '+
  'value="'+esc(value)+'" placeholder="'+esc(placeholder)+'">';
 const headFor=grade=>(roster.heads||[]).find(x=>Number(x.grade)===grade);
 const heads='<section class="card stack"><h3>หัวหน้าระดับชั้น ม.1–ม.6</h3>'+
  '<p class="muted">ค้นหาชื่อหรือ Username ได้ ครูผู้สอนและครูฝ่ายกิจการนักเรียนที่ยังใช้งานสามารถเป็นหัวหน้าระดับได้ โดยไม่เปลี่ยนบทบาทหรือสิทธิ์เดิม</p>'+
  '<div class="rd-affairs-people-grid">'+[1,2,3,4,5,6].map(grade=>
   '<form class="rd-affairs-person" data-affairs-head="'+grade+'">'+
    '<strong>ระดับชั้นมัธยมศึกษาปีที่ '+grade+'</strong>'+
    '<label>หัวหน้าระดับ'+search(selectedLabel(headFor(grade)?.teacher_user_id,teachers),
     'teacher_user_id','หัวหน้าระดับ ม.'+grade,'พิมพ์ชื่อครู / ว่างเพื่อยกเลิก')+'</label>'+
    '<button type="submit" class="button secondary">บันทึกหัวหน้าระดับ</button></form>'
  ).join('')+'</div></section>';
 const table='<section class="card stack rd-affairs-advisor-manager">'+
  '<div class="rd-affairs-advisor-heading"><div><h3>จัดการครูที่ปรึกษาประจำห้อง</h3>'+
  '<p class="muted">แก้ไขได้ทีละห้อง ครูที่ปรึกษา 1–2 คนต่อห้อง ทั้งสองคนยังใช้บัญชีเดิมในการเช็กชื่อและรับ Push</p></div>'+
  '<strong id="rdAffairsAdvisorCount" class="rd-affairs-counter"></strong></div>'+
  '<div class="rd-affairs-advisor-filters">'+
   '<label>ค้นหาห้องหรือชื่อครู<input id="rdAffairsAdvisorSearch" type="search" placeholder="เช่น ม.1/1 หรือชื่อครู" autocomplete="off"></label>'+
   '<label>ระดับชั้น<select id="rdAffairsAdvisorGrade"><option value="all">ทุกระดับชั้น</option>'+
    [1,2,3,4,5,6].map(g=>'<option value="'+g+'">ม.'+g+'</option>').join('')+'</select></label>'+
   '<label>สถานะ<select id="rdAffairsAdvisorCoverage">'+
    '<option value="all">ทุกห้อง</option><option value="missing">ยังไม่มีครูที่ปรึกษา</option>'+
    '<option value="partial">มีครู 1 คน</option></select></label>'+
  '</div><div class="rd-affairs-advisor-table-wrap" role="region" aria-label="ตารางจัดการครูที่ปรึกษา" tabindex="0">'+
  '<table class="table rd-affairs-advisor-table"><thead><tr><th scope="col">ห้อง</th>'+
   '<th scope="col">ครูที่ปรึกษาคนที่ 1</th><th scope="col">ครูที่ปรึกษาคนที่ 2</th>'+
   '<th scope="col">สถานะ</th><th scope="col">จัดการ</th></tr></thead><tbody>'+
   rows.map(room=>{
    const primary=Number(room.advisor_user_id)||null,secondary=Number(room.advisor2_user_id)||null;
    const count=(primary?1:0)+(secondary?1:0);
    return '<tr data-affairs-advisor="'+Number(room.id)+'" data-room-grade="'+Number(room.grade)+
     '" data-room-search="'+esc([room.label,room.primaryLabel,room.secondaryLabel].join(' ').toLocaleLowerCase('th'))+
     '" data-room-coverage="'+(count===0?'missing':count===1?'partial':'complete')+'">'+
     '<th scope="row">'+esc(room.label)+'</th>'+
     '<td><label class="rd-affairs-cell-label">คนที่ 1'+
      search(room.primaryLabel, 'teacher_user_id','ครูที่ปรึกษาคนที่ 1 ห้อง '+room.label)+'</label></td>'+
     '<td><label class="rd-affairs-cell-label">คนที่ 2 (ไม่บังคับ)'+
      search(room.secondaryLabel, 'teacher2_user_id','ครูที่ปรึกษาคนที่ 2 ห้อง '+room.label)+'</label></td>'+
     '<td><span class="rd-affairs-status '+(count===0?'empty':count===1?'one':'two')+'">'+
      (count===0?'ยังไม่กำหนด':count===1?'1 คน':'2 คน')+'</span></td>'+
     '<td><button type="button" class="button secondary rd-affairs-save-room" data-save-affairs-advisor="'+Number(room.id)+'">บันทึก</button></td></tr>';
   }).join('')+'</tbody></table>'+
  '<p id="rdAffairsAdvisorEmpty" class="muted" hidden>ไม่พบห้องเรียนที่ตรงกับตัวกรอง</p>'+
  '</div><p class="muted">พิมพ์ชื่อหรือ Username ในช่องเลือกครูเพื่อกรองรายการ แล้วเลือกชื่อที่แสดงใน Dropdown ก่อนบันทึก หากต้องการยกเลิกการมอบหมายให้ลบชื่อออก</p>'+
  '</section>';
 return {markup:choices+heads+table,teachers,rooms:rows};
}
