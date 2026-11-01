// Display-only Thai Buddhist Era formatting. Keep ISO values in API, dates,
 // inputs, filters, sorting and stored SQLite records unchanged.
const DATE_ONLY=/^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i;
const dateFormatter=new Intl.DateTimeFormat('th-TH',{
 calendar:'buddhist',numberingSystem:'latn',timeZone:'UTC',
 day:'numeric',month:'short',year:'numeric'
});
const timeFormatter=new Intl.DateTimeFormat('th-TH',{
 calendar:'buddhist',numberingSystem:'latn',timeZone:'Asia/Bangkok',
 day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
function toDate(value){
 const raw=String(value??'').trim();
 if(DATE_ONLY.test(raw)){
  const d=new Date(raw+'T00:00:00Z');
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===raw?{date:d,dateOnly:true}:null;
 }
 if(!DATE_TIME.test(raw))return null;
 const normalized=raw.replace(' ','T');
 const explicitZone=/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
 const d=new Date(explicitZone?normalized:normalized+'Z');
 return Number.isNaN(d.getTime())?null:{date:d,dateOnly:false};
}
export function formatThaiDate(value,{withTime=false}={}){
 const raw=String(value??'').trim();
 if(!raw)return '—';
 const parsed=toDate(raw);
 if(!parsed)return raw;
 // Date-only fields are school calendar days and should never shift timezone.
 if(!withTime||parsed.dateOnly)return dateFormatter.format(parsed.date);
 return timeFormatter.format(parsed.date)+' น.';
}
export const formatThaiDateTime=value=>formatThaiDate(value,{withTime:true});
