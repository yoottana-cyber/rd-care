// Route only to the existing three authentication experiences; no new identity store.
const roles=new Set(['staff','student','guardian']);
export function loginHref(role){
 if(!roles.has(role))throw Error('Unknown login role');
 return './?login='+role;
}
export function resolveLoginEntrance(search=''){
 const p=new URLSearchParams(search);
 const late=p.get('late_qr');
 if(late==='gate'||/^[a-f0-9]{40}$/.test(late||''))return 'student';
 if(['late','truancy'].includes(p.get('portal_notice'))&&/^\d{1,15}$/.test(p.get('notice_id')||''))return 'guardian';
 if(['advisorCenter','lateGate','notifications'].includes(p.get('tab')))return 'staff';
 return roles.has(p.get('login'))?p.get('login'):null;
}
