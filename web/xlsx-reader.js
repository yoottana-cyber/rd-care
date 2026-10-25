// Minimal first-worksheet .xlsx reader, using browser DOMParser + native
// DecompressionStream('deflate-raw'). No third-party code or external CDN.
// Accepts only bounded Office Open XML ZIP archives, not legacy .xls.
const MAX_FILE=3_000_000, MAX_ENTRY=6_000_000;
const utf8=new TextDecoder();
function u16(view,i){return view.getUint16(i,true)}
function u32(view,i){return view.getUint32(i,true)}
function within(bytes,from,length){if(!Number.isSafeInteger(from)||!Number.isSafeInteger(length)||from<0||length<0||from+length>bytes.length)throw Error('ไฟล์ Excel เสียหายหรือมีขนาดเกินกำหนด')}
export async function unzipXlsx(buffer){
 const bytes=new Uint8Array(buffer);
 if(bytes.length>MAX_FILE)throw Error('ไฟล์ .xlsx ต้องไม่เกิน 3 MB');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let eocd=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(u32(v,i)===0x06054b50){eocd=i;break}
 if(eocd<0)throw Error('ไฟล์นี้ไม่ใช่ .xlsx ที่ถูกต้อง');
 const entries=u16(v,eocd+10),offset=u32(v,eocd+16);
 if(entries>200||entries===0||offset===0xffffffff)throw Error('ไฟล์ Excel มีข้อมูลซับซ้อนเกินกว่าที่รองรับ');
 let cursor=offset;const result=new Map();
 for(let n=0;n<entries;n++){
  within(bytes,cursor,46);
  if(u32(v,cursor)!==0x02014b50)throw Error('โครงสร้างไฟล์ Excel ไม่ถูกต้อง');
  const flags=u16(v,cursor+8),method=u16(v,cursor+10),compressed=u32(v,cursor+20),size=u32(v,cursor+24);
  const nameLength=u16(v,cursor+28),extra=u16(v,cursor+30),comment=u16(v,cursor+32);
  within(bytes,cursor+46,nameLength+extra+comment);
  const name=utf8.decode(bytes.subarray(cursor+46,cursor+46+nameLength));
  cursor+=46+nameLength+extra+comment;
  if(name.includes('..')||name.startsWith('/')||(flags&1)||size>MAX_ENTRY||compressed>MAX_ENTRY)throw Error('ไฟล์ Excel ไม่ปลอดภัยหรือใหญ่เกินกำหนด');
  if(!['xl/worksheets/sheet1.xml','xl/sharedStrings.xml'].includes(name))continue;
  const local=u32(v,cursor-(46+nameLength+extra+comment)+42);
  within(bytes,local,30);
  if(u32(v,local)!==0x04034b50)throw Error('ข้อมูล Excel ไม่ถูกต้อง');
  const start=local+30+u16(v,local+26)+u16(v,local+28);
  within(bytes,start,compressed);
  const data=bytes.subarray(start,start+compressed);
  let text;
  if(method===0)text=utf8.decode(data);
  else if(method===8){
   if(typeof DecompressionStream!=='function')throw Error('เบราว์เซอร์ไม่รองรับ .xlsx กรุณาใช้ Chrome/Edge รุ่นล่าสุดหรือ CSV');
   const stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
   const output=await new Response(stream).arrayBuffer();
   if(output.byteLength>MAX_ENTRY)throw Error('ข้อมูล Excel หลังคลายไฟล์ใหญ่เกินกำหนด');
   text=utf8.decode(output);
  }else throw Error('วิธีบีบอัด Excel ไม่รองรับ');
  if(text.length>MAX_ENTRY)throw Error('ไฟล์ Excel มีข้อมูลมากเกินกำหนด');
  result.set(name,text);
 }
 return result;
}
function parseXml(source){
 const doc=new DOMParser().parseFromString(source,'application/xml');
 if(doc.getElementsByTagName('parsererror').length)throw Error('ข้อมูล XML ใน Excel ไม่ถูกต้อง');
 return doc;
}
export async function readXlsxRows(file){
 if(!file||!(/\.xlsx$/i.test(file.name)))throw Error('รองรับเฉพาะไฟล์ Excel .xlsx');
 const entries=await unzipXlsx(await file.arrayBuffer());
 const sheet=entries.get('xl/worksheets/sheet1.xml');
 if(!sheet)throw Error('ไม่พบ Sheet1 ในไฟล์ Excel กรุณาย้ายรายชื่อไปยังแผ่นงานแรกหรือบันทึกเป็น CSV UTF-8');
 const strings=entries.has('xl/sharedStrings.xml')?
  [...parseXml(entries.get('xl/sharedStrings.xml')).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent||'').join('')):[];
 const xml=parseXml(sheet);
 const rows=[];
 for(const r of xml.getElementsByTagName('row')){
  if(rows.length>=1500)throw Error('กรุณาแบ่ง Excel เป็นไฟล์เล็กลง (สูงสุด 1,500 แถว)');
  const row=[];
  for(const cell of r.getElementsByTagName('c')){
   const ref=cell.getAttribute('r')||'';
   const col=/^([A-Z]{1,3})[0-9]+$/.exec(ref);
   if(!col)continue;
   const index=[...col[1]].reduce((n,ch)=>n*26+ch.charCodeAt(0)-64,0)-1;
   if(index<0||index>=30)continue;
   const type=cell.getAttribute('t');
   const value=type==='inlineStr'?[...cell.getElementsByTagName('t')].map(x=>x.textContent||'').join(''):
     cell.getElementsByTagName('v')[0]?.textContent||'';
   row[index]=type==='s'?(strings[Number(value)]??''):value;
  }
  if(row.some(x=>String(x??'').trim()))rows.push(row);
 }
 return rows;
}
