// Pure, browser-side class-period clock. Not an attendance enforcement policy.
// Breaks/assemblies are not inferred: the preview is continuous from period one.
export const PERIOD_DURATION_CHOICES=Object.freeze([50,45,40]);
const fmt=minutes=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+
 String(minutes%60).padStart(2,'0');
export function periodClockRows(firstPeriodStart='08:30',durationMinutes=50,count=10){
 if(typeof firstPeriodStart!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(firstPeriodStart)||
  !PERIOD_DURATION_CHOICES.includes(durationMinutes)||!Number.isInteger(count)||count<1||count>12)
  throw new RangeError('Invalid school period time settings');
 const [hour,minute]=firstPeriodStart.split(':').map(Number),startMinute=hour*60+minute;
 if(startMinute+durationMinutes*count>1440)throw new RangeError('School schedule exceeds midnight');
 return Array.from({length:count},(_,i)=>({
  period:i+1,start:fmt(startMinute+i*durationMinutes),end:fmt(startMinute+(i+1)*durationMinutes)
 }));
}
export function lessonClockLabel(startPeriod,endPeriod,rows){
 const first=rows?.[Number(startPeriod)-1],last=rows?.[Number(endPeriod??startPeriod)-1];
 return first&&last&&last.period>=first.period?first.start+'–'+last.end+' น.':'';
}
