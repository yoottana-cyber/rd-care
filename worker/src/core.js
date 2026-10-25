export const STATUS = new Set(['present','absent','late','leave']);
export const isAdmin = (u) => u?.role === 'admin';
export const isStaff = (u) => ['admin','staff'].includes(u?.role);
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
export function bangkokToday() {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
export function weekday(date) {
  return ((new Date(date+'T00:00:00Z').getUTCDay()+6)%7)+1;
}
export function schoolDateAllowed(date) {
  if (!validDate(date)) return false;
  const today=bangkokToday();
  const difference=(Date.parse(date+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000;
  return difference<=0 && difference>=-14;
}
export function validateEntries(entries, validIds, max=100) {
  if (!Array.isArray(entries) || !entries.length || entries.length>max) return false;
  const ids = new Set();
  for (const row of entries) {
    if (!Number.isSafeInteger(row.student_id) || !validIds.has(row.student_id) || !STATUS.has(row.status) || ids.has(row.student_id)) return false;
    ids.add(row.student_id);
  }
  return ids.size === validIds.size;
}
export function cleanText(text,max=120) {
  if (typeof text!=='string') return '';
  return text.trim().slice(0,max);
}
export function validUsername(value) {
  return typeof value==='string' && /^[a-z0-9._-]{3,40}$/i.test(value);
}

// Exception codes from Web Crypto DOMException (e.g. 9=NotSupportedError)
// are NOT HTTP response statuses. Using them in new Response({status})
// throws again and leaves the request as Cloudflare 1101.
export function httpErrorStatus(error) {
  const status = error?.code;
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}
