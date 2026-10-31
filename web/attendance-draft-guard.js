// Pure draft-state detection shared by daily and period check-in forms.
// Do not persist student attendance or notes in localStorage/service worker.
export function takeAttendanceSnapshot(state){
 return {kind:state.kind,date:state.date,roomId:Number(state.roomId)||null,
  slotId:state.kind==='period'?(Number(state.slotId)||null):null,
  statuses:{...state.statuses},teachingNote:state.kind==='period'?String(state.teachingNote||''):''};
}
export function attendanceHasUnsavedChanges(current,baseline){
 if(!baseline)return false;
 const now=takeAttendanceSnapshot(current);
 if(now.kind!==baseline.kind||now.roomId!==baseline.roomId||
  now.date!==baseline.date||now.slotId!==baseline.slotId)return false;
 if(now.teachingNote!==baseline.teachingNote)return true;
 const old=baseline.statuses||{},keys=Object.keys(now.statuses);
 return keys.length!==Object.keys(old).length||
  keys.some(id=>now.statuses[id]!==old[id]);
}
