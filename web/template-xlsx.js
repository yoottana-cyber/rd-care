// RD Care schoolwide XLSX example (generated locally in the browser).
// Excel OOXML ZIP is deliberately uncompressed, so no external library/CDN is needed.
const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const utf8=value=>new TextEncoder().encode(value);
function crc32(data){
 let crc=0xffffffff;
 for(const b of data){
  crc^=b;
  for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 return (crc^0xffffffff)>>>0;
}
function join(parts){
 const out=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));
 let offset=0;
 for(const part of parts){out.set(part,offset);offset+=part.length}
 return out;
}
function zip(files){
 const local=[],central=[];let offset=0,dirSize=0;
 for(const [name,text] of Object.entries(files)){
  const filename=utf8(name),data=utf8(text),crc=crc32(data);
  const head=new Uint8Array(30+filename.length);
  const a=new DataView(head.buffer);
  a.setUint32(0,0x04034b50,true);a.setUint16(4,20,true);
  a.setUint32(14,crc,true);a.setUint32(18,data.length,true);
  a.setUint32(22,data.length,true);a.setUint16(26,filename.length,true);
  head.set(filename,30);
  local.push(head,data);
  const entry=new Uint8Array(46+filename.length),b=new DataView(entry.buffer);
  b.setUint32(0,0x02014b50,true);b.setUint16(4,20,true);b.setUint16(6,20,true);
  b.setUint32(16,crc,true);b.setUint32(20,data.length,true);
  b.setUint32(24,data.length,true);b.setUint16(28,filename.length,true);
  b.setUint32(42,offset,true);entry.set(filename,46);
  central.push(entry);dirSize+=entry.length;offset+=head.length+data.length;
 }
 const end=new Uint8Array(22),view=new DataView(end.buffer);
 view.setUint32(0,0x06054b50,true);view.setUint16(8,central.length,true);
 view.setUint16(10,central.length,true);view.setUint32(12,dirSize,true);
 view.setUint32(16,offset,true);
 return join([...local,...central,end]);
}
function cell(value,column,row,style=0){
 const location=column+row;
 const numeric=typeof value==='number';
 return numeric
  ?'<c r="'+location+'" s="'+style+'"><v>'+value+'</v></c>'
  :'<c r="'+location+'" s="'+style+'" t="inlineStr"><is><t>'+esc(value)+'</t></is></c>';
}
function sheet(rows,widths,freeze=true){
 const columns=widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('');
 const data=rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((v,j)=>
  cell(v,String.fromCharCode(65+j),i+1,i===0?1:([2,4,5].includes(j)?2:0))).join('')+'</row>').join('');
 const frozen=freeze?'<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>':'';
 return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+frozen+
  '<cols>'+columns+'</cols><sheetData>'+data+'</sheetData></worksheet>';
}
export function buildExampleXlsx(kind='students',scoreRules=[]){
 const isAdvisor=kind==='advisors',isPortal=kind==='portal',isRoster=kind==='roster';
 const isScore=kind==='score-good'||kind==='score-behavior',isGoodScore=kind==='score-good';
 const eligibleRules=isScore&&Array.isArray(scoreRules)?
  scoreRules.filter(x=>x?.active&&Number(x.automatic)!==1&&
   (isGoodScore?x.category==='good':x.category!=='good')):[];
 const exampleRule=eligibleRules.length?Number(eligibleRules[0].id):0;
 const students=isScore?[
  ['student_no','rule_id','reason'],
  ['000001',exampleRule,'ตัวอย่างเท่านั้น กรุณาแทนเลขประจำตัวนักเรียนจริงก่อนนำเข้า'],
  ['000002',exampleRule,'']
 ]:isRoster?[
  ['classroom','roll_no','student_no','full_name'],
  ['ม.1/1',1,'000001','นักเรียนตัวอย่าง หนึ่ง'],
  ['ม.1/1',2,'000002','นักเรียนตัวอย่าง สอง'],
  ['ม.2/1',1,'000003','นักเรียนตัวอย่าง สาม']
 ]:isPortal?[
  ['student_no','full_name','student_username','student_password','guardian_name','guardian_username','guardian_password'],
  ['000001','นักเรียนตัวอย่าง ก','000001','ReplaceStudentPassword1','ผู้ปกครองตัวอย่าง ก','guardian000001','ReplaceGuardianPassword1'],
  ['000002','นักเรียนตัวอย่าง ข','000002','ReplaceStudentPassword2','ผู้ปกครองตัวอย่าง ข','guardian000002','ReplaceGuardianPassword2']
 ]:isAdvisor?[
  ['classroom','full_name','username','password'],
  ['ม.1/1','ครูตัวอย่าง หนึ่ง','teacher001','Teacher#1234'],
  ['ม.1/1','ครูตัวอย่าง สอง','teacher002','Teacher#5678'],
  ['ม.2/3','ครูตัวอย่าง สาม','teacher003','Teacher#9012'],
  ['ม.3/2','ครูตัวอย่าง สาม','teacher003','Teacher#9012']
 ]:[
  ['classroom','roll_no','student_no','full_name','username','password'],
  ['ม.1/1',1,'STU9001','นักเรียนตัวอย่าง หนึ่ง','student001','Student#1234'],
  ['ม.2/3',2,'STU9002','นักเรียนตัวอย่าง สอง','student002','Student#5678'],
  ['ม.3/2',3,'STU9003','นักเรียนตัวอย่าง สาม','student003','Student#9012']
 ];
 const instructions=isScore?[
  ['RD CONNECT — ตัวอย่างนำเข้า'+(isGoodScore?'คะแนนความดี':'คะแนนความผิด'),'คำอธิบาย'],
  ['Sheet1','ใช้ตารางในแผ่นงานแรกเท่านั้น แถวแรกเป็นหัวตาราง ห้ามเพิ่มแถวเหนือหัวตาราง'],
  ['student_no','เลขประจำตัวนักเรียน (รูปแบบข้อความ เพื่อรักษาเลข 0 นำหน้า)'],
  ['rule_id','รหัสเกณฑ์คะแนนจริงจากแผ่น Rules และต้องเป็นหมวด'+(isGoodScore?'ความดี':'ความผิด')],
  ['reason','รายละเอียดเพิ่มเติม เว้นว่างได้ ระบบจะใช้ชื่อเกณฑ์คะแนน (สูงสุด 300 ตัวอักษร)'],
  ['การคำนวณคะแนน','ระบบดึงคะแนนจากเกณฑ์ที่ฝ่ายกิจการกำหนด ไม่รับคะแนนที่กรอกเอง'],
  ['ตรวจสอบข้อมูล','ระบบตรวจนักเรียน เกณฑ์ สิทธิ์ครู และแสดงตัวอย่างก่อนบันทึก'],
  ['ความซ้ำ','เลขนักเรียน + รหัสเกณฑ์ห้ามซ้ำกันภายในไฟล์เดียว'],
  ['แบ่งชุด','หากมีหลายรายการ ระบบจะส่งเป็นชุดเล็ก และสามารถดำเนินการต่อได้หากเน็ตสะดุด'],
  ['คำเตือน','เลขนักเรียน 000001 และ 000002 เป็นตัวอย่าง ห้ามกดนำเข้าโดยไม่แทนข้อมูลจริง'],
  ['ประวัติ','บันทึกใหม่ตามวันที่ทำรายการ ไม่แก้ไขคะแนนเดิม และไม่แก้คะแนนปรับพฤติกรรม']
 ]:isRoster?[
  ['RD CONNECT — ตัวอย่างนำเข้าทะเบียนนักเรียนจากไฟล์เดียว','คำอธิบาย'],
  ['Students','คอลัมน์ 4 ช่องในแถวแรก ห้ามเพิ่มแถวเหนือหัวตาราง'],
  ['classroom','ห้องเรียน เช่น ม.1/1 ต้องตรงกับห้องที่มีในระบบ'],
  ['roll_no','เลขที่ 1–100 ในห้อง ไม่ซ้ำกับนักเรียนคนอื่น'],
  ['student_no','เลขประจำตัวนักเรียน ต้องเก็บเป็นข้อความเพื่อรักษาเลขศูนย์นำหน้า'],
  ['full_name','ชื่อและนามสกุลนักเรียน'],
  ['การนำเข้า','เพิ่มใหม่หรืออัปเดตนักเรียนเดิมที่อยู่ห้องเดียวกัน'],
  ['ข้อมูลเดิม','คง student_id เดิม และประวัติการเช็กชื่อหรือคะแนนพฤติกรรม'],
  ['การย้ายห้อง','หากต้องการเปลี่ยนห้อง ให้ดำเนินการผ่านเมนูย้ายห้อง'],
  ['บัญชี','รูปแบบนี้ไม่สร้างหรือแก้ Username/Password นักเรียนและผู้ปกครอง'],
  ['ความปลอดภัย','ลบชื่อและเลขประจำตัวสมมติในตัวอย่าง แล้วใส่รายชื่อจริงก่อนอัปโหลด']
 ]:isPortal?[
  ['RD CONNECT — นำเข้าบัญชีนักเรียนและผู้ปกครอง','คำอธิบาย'],
  ['student_no','เลขประจำตัวนักเรียนที่มีอยู่ในระบบ รักษาเลข 0 นำหน้า (Text)'],
  ['full_name','ชื่อ–สกุลนักเรียน เว้นว่างเพื่อใช้ชื่อเดิม'],
  ['student_username','Username นักเรียน เว้นว่างเพื่อใช้เลขประจำตัว/ชื่อบัญชีเดิม'],
  ['student_password','บัญชีใหม่ต้องมี Password 4–128 ตัว บัญชีเดิมเว้นว่างเพื่อรักษารหัสเดิม'],
  ['guardian_name','ชื่อ–สกุลผู้ปกครอง'],
  ['guardian_username','Username ผู้ปกครอง 3–40 ตัว ซ้ำกันได้สำหรับพี่น้อง'],
  ['guardian_password','รหัสผู้ปกครองใหม่ 4–128 ตัว บัญชีเดิมเว้นว่างเพื่อรักษารหัสเดิม'],
  ['การเชื่อม','ใช้เลขประจำตัวนักเรียนเชื่อมความสัมพันธ์ ต้องตรวจสอบตัวตนก่อนกดนำเข้า'],
  ['รหัสผ่าน','ห้ามใช้เลขบัตรประชาชน ไม่บังคับเปลี่ยนรหัสครั้งแรก'],
  ['ความปลอดภัย','ใช้ตัวอย่างเท่านั้น เก็บไฟล์รหัสผ่านอย่างปลอดภัย ห้ามส่งกลุ่มสาธารณะ']
 ]:isAdvisor?[
  ['RD Care — ตัวอย่างนำเข้าครูที่ปรึกษาทุกห้องในไฟล์เดียว','คำอธิบาย'],
  ['Advisors','4 คอลัมน์ในแถวแรก classroom,full_name,username,password'],
  ['classroom','ห้องเรียนตามรายการที่ตั้งค่าใน RD Care เช่น ม.1/1'],
  ['full_name','ชื่อ–สกุลครู (ตรงกับบัญชีเดิมเมื่อผูกบัญชีครูที่มีอยู่แล้ว)'],
  ['username','กำหนดเอง 3–40 ตัว อังกฤษ ตัวเลข จุด ขีด'],
  ['password','ครูใหม่ 4–128 ตัว (แนะนำให้ยาวและไม่ซ้ำ) / ครูมีบัญชีแล้วให้เว้นว่าง'],
  ['การนำเข้า','ระบบตรวจซ้ำทั้งไฟล์ก่อนสร้างบัญชีหรือผูกห้อง'],
  ['ความปลอดภัย','เปลี่ยนรหัสผ่านตัวอย่างก่อนนำเข้า และเก็บไฟล์ที่มีรหัสผ่านให้ปลอดภัย']
 ]:[
  ['RD Care — ตัวอย่างนำเข้านักเรียนทุกห้องในไฟล์เดียว','คำอธิบาย / แนวทาง'],
  ['Students','ต้องมีหัวตาราง 6 คอลัมน์ในแถวแรก และไม่เพิ่มแถวเหนือหัวตาราง'],
  ['classroom','ห้องเรียน เช่น ม.1/1 ม.2/3 ม.3/2 (อักษร ม. มอ ม้า)'],
  ['roll_no','เลขที่ 1–100 ไม่ซ้ำกันภายในห้อง'],
  ['student_no','เลขประจำตัวนักเรียน ต้องรักษาเลข 0 นำหน้า'],
  ['full_name','ชื่อ–สกุลนักเรียน'],
  ['username','กำหนดเองได้ 3–40 ตัว ภาษาอังกฤษ ตัวเลข . _ -'],
  ['password','ขั้นต่ำ 4 ตัว ควรยาวและไม่ซ้ำ ห้ามใช้เลขบัตรประชาชน'],
  ['การนำเข้า','เลือกหลายห้องในไฟล์เดียว RD Care ตรวจทั้งไฟล์แล้วนำเข้าเป็นชุด'],
  ['ความปลอดภัย','ใช้ข้อมูลสมมติเท่านั้น ห้ามส่งไฟล์รหัสผ่านลงกลุ่มสาธารณะ']
 ];
 const rooms=isScore?[
  ['rule_id','ชื่อเกณฑ์','คะแนน','หมวด'],
  ...eligibleRules.map(r=>[Number(r.id),String(r.name),Number(r.points),String(r.category)])
 ]:[['รายการห้องเรียน (ตรวจสอบให้ตรงกับระบบ)']];
 for(const [grade,count] of (isScore?[]:[[1,9],[2,9],[3,9],[4,7],[5,7],[6,7]])){
  for(let number=1;number<=count;number++)rooms.push(['ม.'+grade+'/'+number]);
 }
 const types='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
  '<Default Extension="xml" ContentType="application/xml"/>'+
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+
  [1,2,3].map(n=>'<Override PartName="/xl/worksheets/sheet'+n+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>';
 const relations='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
 const workbook='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
  '<sheets><sheet name="'+(isScore?'Score Import':isPortal?'Portal Accounts':isAdvisor?'Advisors':'Students')+'" sheetId="1" r:id="rId1"/><sheet name="Instructions" sheetId="2" r:id="rId2"/><sheet name="'+(isScore?'Rules':'Rooms')+'" sheetId="3" r:id="rId3"/></sheets></workbook>';
 const bookRelations='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
  [1,2,3].map(n=>'<Relationship Id="rId'+n+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+n+'.xml"/>').join('')+
  '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
 const styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
  '<fonts count="2"><font><sz val="11"/><name val="Tahoma"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Tahoma"/></font></fonts>'+
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF184477"/><bgColor indexed="64"/></patternFill></fill></fills>'+
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'+
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
  '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'+
  '<xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'+
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'+
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
 return zip({
  '[Content_Types].xml':types,'_rels/.rels':relations,
  'xl/workbook.xml':workbook,'xl/_rels/workbook.xml.rels':bookRelations,
  'xl/styles.xml':styles,
  'xl/worksheets/sheet1.xml':sheet(students,isScore?[25,16,64]:isRoster?[17,14,22,40]:isPortal?[22,39,27,34,39,28,34]:isAdvisor?[17,38,25,24]:[17,14,22,35,22,20]),
  'xl/worksheets/sheet2.xml':sheet(instructions,[49,83]),
  'xl/worksheets/sheet3.xml':sheet(rooms,isScore?[16,50,16,25]:[32])
 });
}
export function downloadStudentExampleXlsx(){
 const bytes=buildExampleXlsx();
 const url=URL.createObjectURL(new Blob([bytes],{type:MIME}));
 const link=document.createElement('a');
 link.href=url;link.download='RD_Care_Student_Import_All_Rooms_Thai_Font_Fixed.xlsx';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),3000);
}

export function buildAdvisorExampleXlsx(){return buildExampleXlsx('advisors')}
export function downloadAdvisorExampleXlsx(){
 const bytes=buildAdvisorExampleXlsx();
 const url=URL.createObjectURL(new Blob([bytes],{type:MIME}));
 const link=document.createElement('a');
 link.href=url;link.download='RD_Care_Advisor_Import_All_Rooms.xlsx';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),3000);
}

export function buildPortalAccountExampleXlsx(){return buildExampleXlsx('portal')}
export function downloadPortalAccountExampleXlsx(){
 const bytes=buildPortalAccountExampleXlsx();
 const url=URL.createObjectURL(new Blob([bytes],{type:MIME}));
 const link=document.createElement('a');
 link.href=url;link.download='RD_CONNECT_Student_Guardian_Accounts.xlsx';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),3000);
}

export function buildStudentRosterExampleXlsx(){return buildExampleXlsx('roster')}
export function downloadStudentRosterExampleXlsx(){
 const bytes=buildStudentRosterExampleXlsx();
 const url=URL.createObjectURL(new Blob([bytes],{type:MIME}));
 const link=document.createElement('a');
 link.href=url;link.download='RD_CONNECT_Student_Roster_Template.xlsx';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),3000);
}

export function buildScoreImportExampleXlsx(mode,rules=[]){
 if(!['good','behavior'].includes(mode))throw Error('Invalid score mode');
 return buildExampleXlsx(mode==='good'?'score-good':'score-behavior',rules);
}
export function downloadScoreImportExampleXlsx(mode,rules=[]){
 const bytes=buildScoreImportExampleXlsx(mode,rules);
 const url=URL.createObjectURL(new Blob([bytes],{type:MIME}));
 const link=document.createElement('a');
 link.href=url;
 link.download=mode==='good'?'RD_CONNECT_Import_Good_Deeds.xlsx':'RD_CONNECT_Import_Misconduct.xlsx';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),3000);
}
