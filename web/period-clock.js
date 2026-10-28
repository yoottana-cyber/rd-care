// Pure school clock calculator; display-only, never gates attendance.
// Lunch replaces the short inter-period break at its chosen boundary.
// Defaults preserve legacy continuous periods until an admin configures breaks.
export const PERIOD_DURATION_CHOICES=Object.freeze([50,45,40]);
export const DEFAULT_PERIOD_BREAKS=Object.freeze({
 lunch_after_period:0,lunch_break_minutes:0,between_period_break_minutes:0
});
const fmt=minutes=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+
 String(minutes%60).padStart(2,'0');
export function validatedBreaks(options=DEFAULT_PERIOD_BREAKS){
 const {lunch_after_period:after,lunch_break_minutes:lunch,
  between_period_break_minutes:between}=options??{};
 if(!Number.isInteger(after)||after<0||after>9||
  !Number.isInteger(lunch)||!Number.isInteger(between)||
  between<0||between>30||
  (after===0&&lunch!==0)||(after>0&&(lunch<15||lunch>180)))
  throw new RangeError('Invalid school lunch or recess settings');
 return {lunch_after_period:after,lunch_break_minutes:lunch,between_period_break_minutes:between};
}
export function periodClockRows(firstPeriodStart='08:30',durationMinutes=50,count=10,options=DEFAULT_PERIOD_BREAKS){
 if(typeof firstPeriodStart!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(firstPeriodStart)||
  !PERIOD_DURATION_CHOICES.includes(durationMinutes)||!Number.isInteger(count)||count<1||count>12)
  throw new RangeError('Invalid school period time settings');
 const breaks=validatedBreaks(options);
 if(breaks.lunch_after_period>=count)throw new RangeError('Lunch break must occur between lessons');
 const [hour,minute]=firstPeriodStart.split(':').map(Number);
 let cursor=hour*60+minute;
 const rows=[];
 for(let i=0;i<count;i++){
  let breakBefore;
  if(i>0){
   const after=i===breaks.lunch_after_period;
   const minutes=after?breaks.lunch_break_minutes:breaks.between_period_break_minutes;
   if(minutes){
    breakBefore={kind:after?'lunch':'recess',after_period:i,
     minutes,start:fmt(cursor),end:fmt(cursor+minutes)};
    cursor+=minutes;
   }
  }
  if(cursor+durationMinutes>1440)throw new RangeError('School schedule exceeds midnight');
  const row={period:i+1,start:fmt(cursor),end:fmt(cursor+durationMinutes)};
  if(breakBefore)row.breakBefore=breakBefore;
  rows.push(row);cursor+=durationMinutes;
 }
 return rows;
}
export function lessonClockLabel(startPeriod,endPeriod,rows){
 const first=rows?.[Number(startPeriod)-1],last=rows?.[Number(endPeriod??startPeriod)-1];
 if(!first||!last||last.period<first.period)return '';
 const includesBreak=rows.slice(first.period,last.period).some(row=>row?.breakBefore?.minutes>0);
 return first.start+'–'+last.end+' น.'+(includesBreak?' (มีช่วงพัก)':'');
}
