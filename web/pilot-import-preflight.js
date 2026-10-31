// Local-only school pilot files verifier; does not upload, save, or commit anything.
// Real imports still use existing admin interfaces with server-side validation.
import {readXlsxRows} from './xlsx-reader.js';
import {readCsvFile} from './csv-encoding.js';
import {csvRows,prepareRows} from './unified-import.js';
import {prepareAdvisorRows} from './advisor-import.js';
import {preparePortalRoster} from './portal-roster-import.js';
import {PILOT_ROOM_COUNT,validatePilotImportBundle} from './pilot-import-validation.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[c]));
const LABELS={
 roster:'ทะเบียนนักเรียน',advisors:'ครูที่ปรึกษา',portal:'บัญชีนักเรียนและผู้ปกครอง'
};
async function readLocal(file){
 if(!file?.size)throw Error('เลือกไฟล์ทั้ง 3 ประเภทก่อน');
 if(file.size>8_000_000)throw Error('ไฟล์เกิน 8 MB');
 if(/\.xlsx$/i.test(file.name))return readXlsxRows(file);
 if(/\.csv$/i.test(file.name))return csvRows((await readCsvFile(file,'auto')).text);
 throw Error('รองรับเฉพาะ Excel .xlsx และ CSV .csv');
}
export function createPilotImportPreflight({rooms}){
 let busy=false,revision=0;
 function render(container){
  const catalog=typeof rooms==='function'?rooms():rooms;
  const listed=(catalog||[]).map(r=>'<label class="row" style="display:flex;gap:6px;align-items:center">'+
   '<input type="checkbox" name="pilot_room" value="'+esc(r.label)+'"> '+
   '<span>'+esc(r.label)+'</span></label>').join('');
  container.innerHTML='<section class="card stack" aria-label="ตรวจไฟล์นำร่อง 5 ห้องเรียน">'+
   '<h3>ตรวจไฟล์นำร่อง 5 ห้องเรียน — ก่อนนำเข้าข้อมูลจริง</h3>'+
   '<p class="muted">เลือก 5 ห้องเรียนที่โรงเรียนกำหนดจริง แล้วเลือกไฟล์ทะเบียนนักเรียน ครูที่ปรึกษา และบัญชีนักเรียน/ผู้ปกครอง ระบบตรวจร่วมกันในเบราว์เซอร์ <strong>ไม่ส่งไฟล์หรือ Password ไปที่เซิร์ฟเวอร์ในขั้นตอนนี้</strong></p>'+
   '<form id="pilotImportForm" class="stack">'+
   '<details><summary>เลือกห้องเรียนนำร่อง (ต้องครบ '+PILOT_ROOM_COUNT+' ห้อง)</summary>'+
   '<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(85px,1fr));gap:8px;margin-top:12px">'+listed+'</div></details>'+
   '<p id="pilotRoomSelection" class="muted">เลือกแล้ว 0 / '+PILOT_ROOM_COUNT+' ห้อง</p>'+
   '<div class="grid two">'+Object.entries(LABELS).map(([type,label])=>
     '<div class="field"><label for="pilotFile_'+type+'">'+esc(label)+'</label>'+
     '<input id="pilotFile_'+type+'" type="file" name="'+type+'" accept=".csv,.xlsx" required></div>').join('')+
   '</div><p class="muted">ไฟล์ใช้หัวตารางเดียวกับเมนูนำเข้าเดิม หากยังไม่มีตัวอย่าง ให้ดาวน์โหลดจากเมนูนำเข้าทะเบียน ครูที่ปรึกษา และบัญชีนักเรียน/ผู้ปกครองตามลำดับ</p>'+
   '<button class="button full" type="submit" id="pilotImportRun">ตรวจสอบ 3 ไฟล์ โดยไม่บันทึกข้อมูล</button>'+
   '</form><div id="pilotImportResult" role="status" aria-live="polite"></div>'+
   '<p class="warn">ผลตรวจนี้เป็นการเทียบไฟล์กันเอง ไม่ยืนยันว่าบัญชีหรือเลขที่ยังว่างในฐานข้อมูลจริง การนำเข้าจริงต้องใช้ปุ่มตรวจสอบจากฐานข้อมูลของแต่ละเมนูอีกครั้ง และยืนยันความสัมพันธ์ผู้ปกครองตามเอกสารก่อนบันทึก</p>'+
   '</section>';
  const form=container.querySelector('#pilotImportForm');
  const selection=form.querySelector('#pilotRoomSelection');
  function updateSelection(){
   const count=form.querySelectorAll('input[name="pilot_room"]:checked').length;
   selection.textContent='เลือกแล้ว '+count+' / '+PILOT_ROOM_COUNT+' ห้อง';
   revision++;
   container.querySelector('#pilotImportResult').textContent='';
  }
  form.querySelectorAll('input[name="pilot_room"]').forEach(box=>box.addEventListener('change',updateSelection));
  form.querySelectorAll('input[type="file"]').forEach(input=>input.addEventListener('change',()=>{
   revision++;container.querySelector('#pilotImportResult').textContent='';
  }));
  form.addEventListener('submit',async event=>{
   event.preventDefault();
   if(busy)return;
   const selected=[...form.querySelectorAll('input[name="pilot_room"]:checked')].map(el=>el.value);
   const target=container.querySelector('#pilotImportResult'),btn=container.querySelector('#pilotImportRun');
   if(selected.length!==PILOT_ROOM_COUNT){
    target.textContent='กรุณาเลือกห้องเรียนนำร่องให้ครบ 5 ห้อง';return;
   }
   const startRevision=revision;busy=true;btn.disabled=true;target.textContent='กำลังตรวจไฟล์ภายในเบราว์เซอร์...';
   try{
    const localFiles=Object.fromEntries(Object.keys(LABELS).map(type=>
     [type,form.querySelector('#pilotFile_'+type).files?.[0]]));
    const [rawStudents,rawAdvisors,rawPortals]=await Promise.all([
     readLocal(localFiles.roster),readLocal(localFiles.advisors),readLocal(localFiles.portal)
    ]);
    if(revision!==startRevision)return; // Never show stale result after file/room changes.
    if(rawStudents.length>1001||rawAdvisors.length>101||rawPortals.length>1001)
     throw Error('ไฟล์นำร่องใหญ่ผิดปกติ กรุณาตรวจจำนวนแถวก่อนใช้');
    const result=validatePilotImportBundle({
     selectedRooms:selected,rooms:catalog,
     roster:prepareRows(rawStudents,catalog,{rosterOnly:false}),
     advisors:prepareAdvisorRows(rawAdvisors,catalog),
     portal:preparePortalRoster(rawPortals)
    });
    const lines=result.rooms.map(x=>'<tr><td>'+esc(x.label)+'</td><td>'+x.students+
     '</td><td>'+x.advisors+'</td><td>'+x.portals+'</td><td>'+x.guardians+'</td></tr>').join('');
    target.innerHTML='<p class="'+(result.ok?'ok':'warn')+'"><strong>'+
     (result.ok?'ตรวจรูปแบบและความสัมพันธ์ระหว่างไฟล์ผ่าน':'พบปัญหาที่ต้องแก้ก่อนนำเข้า')+
     '</strong> • นักเรียน '+result.totalStudents+' • ครูที่ปรึกษา '+result.totalAdvisors+
     ' • บัญชี '+result.totalAccounts+'</p>'+
     '<div class="table-wrap"><table class="table"><thead><tr><th>ห้อง</th><th>นักเรียน</th>'+
     '<th>ครูที่ปรึกษา</th><th>บัญชี</th><th>มีข้อมูลผู้ปกครอง</th></tr></thead><tbody>'+
     lines+'</tbody></table></div>'+
     (result.issues.length?'<p class="warn">ข้อผิดพลาด (สูงสุด 60 รายการ):</p><ul>'+
      result.issues.map(x=>'<li>'+esc(x.detail)+'</li>').join('')+'</ul>':'')+
     (result.warnings.length?'<p class="muted">ข้อควรตรวจสอบ:</p><ul>'+
      result.warnings.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':'')+
     (result.ok?'<p class="ok">ขั้นถัดไป: ใช้เมนูนำเข้าครูที่ปรึกษา → ทะเบียนนักเรียน (เลือกโหมดทะเบียนอย่างเดียว) → บัญชีนักเรียน/ผู้ปกครอง โดยตรวจจากฐานข้อมูลอีกครั้งก่อนยืนยันทุกไฟล์</p>':'');
   }catch(error){
    if(revision===startRevision)target.textContent='ตรวจไฟล์ไม่สำเร็จ: '+String(error?.message||'รูปแบบไฟล์ไม่ถูกต้อง');
   }finally{
    busy=false;if(btn.isConnected)btn.disabled=false;
   }
  });
 }
 return {render};
}
