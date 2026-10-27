// Shared validation for the mobile portal date picker.
// Restrict only the size of the requested period, matching the server's 90-day rule.
export function validPortalDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(value+'T00:00:00Z');
 return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function portalPeriodMode(from,to,now){
 return from===now&&to===now?'today':from===to?'date':'range';
}
export function checkedPortalPeriod(mode,values,now){
 if(!validPortalDate(now))throw Error('ไม่พบวันที่ปัจจุบัน');
 if(!['today','date','range'].includes(mode))throw Error('รูปแบบการเลือกวันที่ไม่ถูกต้อง');
 const from=mode==='today'?now:mode==='date'?values?.date:values?.from;
 const to=mode==='today'?now:mode==='date'?values?.date:values?.to;
 if(!validPortalDate(from)||!validPortalDate(to))throw Error('กรุณาเลือกวันที่ให้ครบและถูกต้อง');
 if(from>to)throw Error('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
 if(to>now)throw Error('ไม่สามารถเลือกวันที่ในอนาคตได้');
 if(Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z')>89*86400000)
  throw Error('เลือกช่วงวันที่ได้สูงสุด 90 วัน');
 return {from,to,mode};
}
