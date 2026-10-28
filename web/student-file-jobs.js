// Browser file upload for robust roster-only D1 jobs. One file, one click.
// Local file contents and passwords are never persisted in browser storage.
export function createStudentFileJobUi({api,rooms,csvRows,prepareRows,readXlsxRows,readCsvFile,onSuccess}){
 let busy=false,stop=false,active=null,host=null,lastError='';
 const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const idOk=id=>/^[0-9a-f-]{36}$/i.test(id);
 function statusText(j){
  return 'อัปโหลด '+j.uploaded+'/'+j.total+' • ดำเนินการแล้ว '+j.processed+'/'+j.total+
   ' • เพิ่ม '+j.added+' • อัปเดต '+j.updated+' • ข้าม '+j.skipped;
 }
 function paint(){
  if(!host)return;
  const area=host.querySelector('#rdFileJobProgress');
  if(area)area.textContent=active?
    statusText(active)+(active.status==='completed'?' • เสร็จสิ้นแล้ว':' • '+active.status)+(lastError?' • '+lastError:''):
    (lastError||'เลือก Excel/CSV หนึ่งไฟล์เพื่อเริ่มนำเข้าทั้งโรงเรียน');
  const btn=host.querySelector('#rdFileJobUpload');
  if(btn)btn.disabled=busy;
  const resume=host.querySelector('#rdFileJobContinue');
  if(resume){resume.hidden=!active||active.status==='uploading'||active.status==='completed';resume.disabled=busy}
  const pauseBtn=host.querySelector('#rdFileJobPause');
  if(pauseBtn){pauseBtn.hidden=!busy;pauseBtn.disabled=!busy}
 }
 async function refresh(id){
  if(!idOk(id))throw Error('รหัสงานนำเข้าไม่ถูกต้อง');
  active=await api('/api/admin/student-file-jobs/'+id,{timeoutMs:20000});
  paint();return active;
 }
 async function list(){
  if(!host)return;
  try{
   const data=await api('/api/admin/student-file-jobs',{timeoutMs:20000});
   const panel=host.querySelector('#rdFileJobHistory');if(!panel)return;
   panel.innerHTML=(data.items||[]).map(j=>'<div class="rd-file-job-history-row">'+
     '<span>งาน '+esc(j.job_id.slice(0,8))+' • '+esc(j.status)+
     ' • '+j.processed+'/'+j.total+' • เพิ่ม '+j.added+' / อัปเดต '+j.updated+' / ข้าม '+j.skipped+'</span>'+
     '<button type="button" class="button secondary" data-file-job="'+esc(j.job_id)+'">'+
     (j.status==='completed'?'ดูผล':'เปิดงานนี้')+'</button></div>').join('')||
     '<p class="muted">ยังไม่มีงานนำเข้าที่บันทึกไว้</p>';
   panel.querySelectorAll('[data-file-job]').forEach(b=>b.addEventListener('click',async()=>{
    if(busy)return;
    try{await refresh(b.dataset.fileJob);lastError='';paint()}
    catch(e){lastError=e.message;paint()}
   }));
  }catch(e){lastError='ตรวจสอบรายการงานไม่สำเร็จ: '+e.message;paint()}
 }
 async function send(url,body,tries=3){
  for(let attempt=0;attempt<tries;attempt++){
   try{return await api(url,{method:'POST',body,timeoutMs:30000})}
   catch(e){
    if(attempt===tries-1||![500,502,503,504].includes(e.httpStatus))throw e;
    await pause(750*(attempt+1));
   }
  }
 }
 async function work(){
  if(!active||busy)return;
  stop=false;busy=true;lastError='';paint();
  let failures=0;
  try{
   while(!stop){
    const latest=await refresh(active.job_id);
    if(latest.status==='completed'){
     lastError='เสร็จสิ้นแล้ว ตรวจรายการที่ข้ามได้จากรายงาน';
     await onSuccess?.();
     break;
    }
    if(latest.status==='uploading'){
     lastError='ยังอัปโหลดไม่ครบ กรุณาตรวจสอบไฟล์เดิม';break;
    }
    try{
     active=await send('/api/admin/student-file-jobs/'+active.job_id+'/run',{},2);
     failures=0;
    }catch(e){
     failures++;
     // Read authoritative D1 progress after any ambiguous gateway failure.
     await refresh(active.job_id).catch(()=>{});
     if(failures>=2||![500,502,503,504,409].includes(e.httpStatus))throw e;
     await pause(1200);
    }
    paint();
    if(active?.status==='completed'){
     lastError='นำเข้าครบแล้ว • สามารถตรวจสอบรายการที่ข้ามในผลนำเข้า';
     await onSuccess?.();break;
    }
    await pause(100);
   }
   if(stop)lastError='หยุดตามคำขอ • งานและความคืบหน้าถูกบันทึกใน D1 แล้ว กดทำต่อได้';
  }catch(e){
   lastError='การเชื่อมต่อสะดุด: '+e.message+
    ' • งานค้างอยู่ใน D1 เปิดงานเดิมแล้วกดทำต่อภายหลังได้';
  }finally{busy=false;paint();list().catch(()=>{})}
 }
 async function parse(file){
  let raw;
  if(!file||!file.size)throw Error('กรุณาเลือกไฟล์ Excel หรือ CSV');
  if(file.size>8_000_000)throw Error('ไฟล์ใหญ่เกิน 8 MB');
  if(/\.xlsx$/i.test(file.name))raw=await readXlsxRows(file);
  else if(/\.csv$/i.test(file.name)){
   const result=await readCsvFile(file,'auto');raw=csvRows(result.text);
  }else throw Error('รองรับเฉพาะ .xlsx และ .csv');
  const header=raw[0]?.map(x=>String(x).trim().toLowerCase()).join(',');
  if(header==='classroom,roll_no,student_no,full_name'){
   raw=raw.map((row,index)=>{const extra=index===0?
    ['classroom','roll_no','student_no','full_name','username','password']:[...row,'',''];
    extra.source_row=row.source_row;return extra});
  }
  const prepared=prepareRows(raw,typeof rooms==='function'?rooms():rooms);
  return prepared.map(r=>({
   source_row:r.values.source_row,
   classroom:r.values.classroom,
   roll_no:r.values.roll_no,
   student_no:r.values.student_no,
   full_name:r.values.full_name
  }));
 }
 async function upload(){
  if(busy)return;
  busy=true;stop=false;lastError='';paint();
  try{
   const file=host.querySelector('#rdFileJobFile')?.files?.[0];
   const rows=await parse(file);
   if(!confirm('ยืนยันอัปโหลด '+rows.length+' แถวเข้าสู่คิวนำเข้า D1? '+
    'ระบบจะไม่สร้างหรือเปลี่ยนบัญชีและรหัสผ่าน และสามารถทำต่อหากการเชื่อมต่อสะดุด'))return;
   const created=await send('/api/admin/student-file-jobs',{total:rows.length});
   active={...created,uploaded:0,processed:0,added:0,updated:0,skipped:0};
   paint();
   for(let i=0;i<rows.length;i+=20){
    if(stop){lastError='หยุดระหว่างอัปโหลด: ไฟล์ยังไม่ครบ โปรดเลือกไฟล์อีกครั้งเพื่อสร้างงานใหม่';return}
    await send('/api/admin/student-file-jobs/'+active.job_id+'/chunk',{rows:rows.slice(i,i+20)});
    active.uploaded=Math.min(i+20,rows.length);
    paint();
   }
   active=await send('/api/admin/student-file-jobs/'+active.job_id+'/finish',{});
   await refresh(active.job_id);
  }catch(e){
   lastError='อัปโหลดไม่สำเร็จ: '+e.message+
    ' • หากมีรหัสงานที่สร้างแล้ว ระบบจะเก็บข้อมูลที่ได้รับไว้';
  }finally{busy=false;paint();await list()}
  if(active?.status==='ready')await work();
 }
 function render(container){
  if(!container)return;host=container;
  host.innerHTML='<section class="card stack rd-file-job-panel">'+
   '<h3>นำเข้าจากไฟล์เดียว • บันทึกงานอัตโนมัติ</h3>'+
   '<p class="muted">เหมาะกับ 1,750 คนขึ้นไป • เลือก Excel/CSV หนึ่งไฟล์ ระบบนำเข้าทะเบียนโดยไม่ใช้การเขียนทีละคนแบบเดิม'+
   ' หากการเชื่อมต่อหยุด สามารถกลับมาเปิดงานเดิมได้</p>'+
   '<div class="field"><label for="rdFileJobFile">ไฟล์ Excel (.xlsx) หรือ CSV</label>'+
   '<input type="file" id="rdFileJobFile" accept=".xlsx,.csv,text/csv"></div>'+
   '<div class="row rd-import-controls">'+
   '<button type="button" class="button full" id="rdFileJobUpload">นำเข้าไฟล์และเริ่มบันทึก</button>'+
   '<button type="button" class="button secondary" id="rdFileJobContinue" hidden>ทำงานต่อจากที่ค้าง</button>'+
   '<button type="button" class="button secondary" id="rdFileJobPause" hidden>หยุดหลังรายการปัจจุบัน</button></div>'+
   '<p class="muted" role="status" aria-live="polite" id="rdFileJobProgress"></p>'+
   '<p class="muted">นำเข้าเฉพาะทะเบียน ไม่แก้ Username/Password • ตรวจรายการผิดแล้วข้าม • งานเก็บใน D1'+
   ' หากปิดหน้าเว็บสามารถกลับมาเลือกงานเดิมและทำต่อได้</p>'+
   '<h4>งานที่บันทึกไว้</h4><div id="rdFileJobHistory" class="stack"></div>'+
   '</section>';
  host.querySelector('#rdFileJobUpload').addEventListener('click',upload);
  host.querySelector('#rdFileJobContinue').addEventListener('click',work);
  host.querySelector('#rdFileJobPause').addEventListener('click',()=>{stop=true});
  paint();list();
 }
 return {render};
}
