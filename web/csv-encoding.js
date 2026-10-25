// Decode student CSV from raw bytes. File.text() always assumes UTF-8 and
// silently corrupts Thai CSV exported by desktop Excel as Windows-874/TIS-620.
// Passwords remain inside the browser until Admin confirms import.
const UTF8='utf-8', THAI='windows-874';
const charError='ข้อความภาษาไทยในไฟล์มีอักขระเสียหาย (�) กรุณาเปิดไฟล์ต้นฉบับแล้วบันทึกเป็น CSV UTF-8 หรือ Excel .xlsx อีกครั้ง';
function decoded(bytes,encoding){
 return new TextDecoder(encoding,{fatal:true}).decode(bytes);
}
export function decodeCsvBytes(input,requested='auto'){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
 if(!['auto',UTF8,THAI].includes(requested))throw Error('รูปแบบรหัสอักขระไม่ถูกต้อง');
 if(bytes.length===0)throw Error('ไฟล์ว่างเปล่า');
 if(bytes.length>8_000_000)throw Error('ไฟล์ใหญ่เกิน 8 MB กรุณาแบ่งเป็นหลายไฟล์');
 let encoding=requested,source;
 const isUtf8Bom=bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf;
 const isUtf16=bytes[0]===0xff&&bytes[1]===0xfe||bytes[0]===0xfe&&bytes[1]===0xff;
 if(isUtf16)throw Error('CSV แบบ UTF-16 ไม่รองรับ กรุณาบันทึกเป็น CSV UTF-8 หรือ Excel .xlsx');
 try {
  if(requested==='auto'){
   try{source=decoded(bytes,UTF8);encoding=UTF8;}
   catch{
    source=decoded(bytes,THAI);encoding=THAI;
   }
  }else source=decoded(bytes,requested);
 }catch{
  throw Error('ไม่สามารถอ่านรหัสภาษาไทยของไฟล์ CSV ได้ กรุณาเลือก Windows-874 หรือบันทึกเป็น CSV UTF-8');
 }
 // Never silently import corrupted names/room labels from lossy decoders.
 if(source.includes('\ufffd'))throw Error(charError);
 if(source.includes('\u0000'))throw Error('CSV มีอักขระ NULL กรุณาบันทึกเป็น CSV UTF-8 หรือ Excel .xlsx');
 return {text:source.replace(/^\ufeff/,''),encoding,encodingLabel:encoding===THAI?'ภาษาไทย Windows-874 / TIS-620':'UTF-8'};
}
export async function readCsvFile(file,requested='auto'){
 return decodeCsvBytes(new Uint8Array(await file.arrayBuffer()),requested);
}
