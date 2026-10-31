// Scan the school's printed, permanent late QR entirely on the student's device.
// The camera stays local; only the validated public "gate" intent reaches the
// existing authenticated /api/portal/late/qr submission after confirmation.
const PUBLIC_ORIGIN='https://rd-care.pages.dev';
// Printed QR codes are absolute links. On school-hosted Node.js the PWA
// lives under /web/rd-connect-fast/, not at the domain root. Compare the
// exact application mount to prevent QR codes for arbitrary paths/hosts.
// Previously printed Cloudflare root QR codes are accepted for transition.
export function isSchoolLateQr(raw,appUrl=PUBLIC_ORIGIN+'/'){
 if(typeof raw!=='string'||!raw.trim())return false;
 try{
  const url=new URL(raw.trim()),app=new URL(appUrl);
  if(url.protocol!=='https:'||url.searchParams.get('late_qr')!=='gate')return false;
  const base=app.pathname.endsWith('/')?app.pathname:new URL('.',app).pathname;
  const sameApp=url.origin===app.origin&&
   (url.pathname===base||url.pathname===base+'index.html');
  const olderPrintedQr=url.origin===PUBLIC_ORIGIN&&
   (url.pathname==='/'||url.pathname==='/index.html');
  return sameApp||olderPrintedQr;
 }catch{return false}
}
export function lateCameraError(error){
 const name=error?.name||'';
 if(name==='NotAllowedError'||name==='PermissionDeniedError')
  return 'ไม่ได้รับสิทธิ์ใช้กล้อง กรุณาอนุญาตการใช้กล้องในเบราว์เซอร์ หรือเลือกภาพ QR จากเครื่อง';
 if(name==='NotFoundError'||name==='DevicesNotFoundError')
  return 'ไม่พบกล้องบนอุปกรณ์นี้ สามารถเลือกภาพ QR จากเครื่องแทนได้';
 if(name==='NotReadableError'||name==='TrackStartError')
  return 'ไม่สามารถใช้กล้องได้ในขณะนี้ กรุณาปิดแอปอื่นที่ใช้กล้องแล้วลองใหม่';
 if(name==='NotSupportedError'||name==='TypeError')
  return 'ไม่รองรับการเปิดกล้องในเบราว์เซอร์นี้ กรุณาเปิดผ่าน HTTPS หรือเลือกภาพ QR จากเครื่อง';
 return 'เปิดกล้องไม่สำเร็จ กรุณาลองใหม่ หรือเลือกภาพ QR จากเครื่อง';
}
export function createStudentLateQrScanner({
 onDetected,onInvalid=()=>{},
 loadScanner=async()=> (await import('./vendor/qr-scanner.min.js')).default,
 origin=()=>globalThis.location?.href||PUBLIC_ORIGIN+'/'
}){
 let camera=null,generation=0;
 function stop(){
  generation++;
  const previous=camera;camera=null;
  if(previous)previous.destroy();
 }
 async function start(video){
  stop();
  const current=generation;
  const QrScanner=await loadScanner();
  if(current!==generation)return;
  const scanner=new QrScanner(video,detected=>{
   if(current!==generation)return;
   const raw=typeof detected==='string'?detected:detected?.data;
   if(!isSchoolLateQr(raw,origin())){onInvalid();return}
   stop();
   onDetected();
  },{
   preferredCamera:'environment',
   returnDetailedScanResult:true,
   highlightScanRegion:true,
   highlightCodeOutline:true
  });
  camera=scanner;
  try{
   await scanner.start();
   if(current!==generation&&camera===scanner)stop();
  }catch(error){
   if(current!==generation)return; // canceled by a page change
   stop();
   throw error;
  }
 }
 async function scanFile(file){
  if(!file)return;
  const current=generation;
  const QrScanner=await loadScanner();
  if(current!==generation)return;
  let decoded;
  try{decoded=await QrScanner.scanImage(file,{returnDetailedScanResult:true})}
  catch{throw new Error('ไม่พบ QR Code ในภาพ กรุณาถ่ายภาพให้ชัดแล้วลองใหม่')}
  if(current!==generation)return;
  if(!isSchoolLateQr(typeof decoded==='string'?decoded:decoded?.data,origin()))
   throw new Error('QR Code นี้ไม่ใช่ QR ลงชื่อมาสายของโรงเรียน');
  stop();onDetected();
 }
 return {start,stop,scanFile};
}
