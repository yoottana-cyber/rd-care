// Keep the staff's date selection scoped to the attendance workflow.
// An opened period lesson uses a day-specific date, but returning to DAILY
// attendance via the menu must not silently retain that old lesson date.
// Explicit deep links to historical daily records remain respected.
export function dateOnAttendanceEntry({tab,previousTab,selectedDate,today,preserveDate=false}){
 if(tab!=='attendance'||previousTab===tab||preserveDate)return selectedDate;
 return today;
}
