// The three RD CONNECT home-screen applications have separate stable manifest IDs
// and launch at their own login URL. This is presentation-only: auth stays server-side.
import {resolveLoginEntrance} from './login-route.js';

export const PWA_ROLES=Object.freeze({
 staff:{label:'ครู',name:'RD CONNECT ครู',manifest:'./manifest-staff.webmanifest',icon:'./icons/staff-192.png'},
 student:{label:'นักเรียน',name:'RD CONNECT นักเรียน',manifest:'./manifest-student.webmanifest',icon:'./icons/student-192.png'},
 guardian:{label:'ผู้ปกครอง',name:'RD CONNECT ผู้ปกครอง',manifest:'./manifest-guardian.webmanifest',icon:'./icons/guardian-192.png'}
});
export const homeScreenRole=(search='')=>resolveLoginEntrance(search);
export const isInstalledPwa=()=>typeof window!=='undefined'&&
 (window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true);

// No generic manifest on the role chooser: Chrome must install a role-specific
// app only after its page has been selected. In Safari each role URL is saved
// with a separate Apple home-screen label and icon.
export function configureRolePwa(search='',doc=document){
 const role=homeScreenRole(search),selection=role?PWA_ROLES[role]:null;
 const head=doc.head;
 const manifests=[...doc.querySelectorAll('link[rel="manifest"]')];
 const manifest=manifests[0]||doc.createElement('link');
 if(selection){
  manifest.setAttribute('rel','manifest');
  manifest.setAttribute('href',selection.manifest);
  manifest.setAttribute('data-role-pwa',role);
  if(!manifest.isConnected)head.appendChild(manifest);
 }else{
  for(const link of manifests)link.remove();
 }
 for(const other of manifests.slice(1))other.remove();
 function meta(name,attribute,value){
  let el=doc.querySelector('meta['+attribute+'="'+name+'"]');
  if(!el){el=doc.createElement('meta');el.setAttribute(attribute,name);head.appendChild(el)}
  el.setAttribute('content',value);
 }
 meta('apple-mobile-web-app-title','name',selection?.name||'RD CONNECT');
 meta('application-name','name',selection?.name||'RD CONNECT');
 let appleIcon=doc.querySelector('link[rel="apple-touch-icon"]');
 if(!appleIcon){appleIcon=doc.createElement('link');appleIcon.setAttribute('rel','apple-touch-icon');head.appendChild(appleIcon)}
 appleIcon.setAttribute('href',selection?.icon||'./icons/icon-192.png');
 let icon=doc.querySelector('link[rel="icon"][type="image/png"]');
 if(!icon){icon=doc.createElement('link');icon.setAttribute('rel','icon');icon.setAttribute('type','image/png');head.appendChild(icon)}
 icon.setAttribute('href',selection?.icon||'./icons/icon-192.png');
 if(doc.documentElement)doc.documentElement.dataset.rdPwaRole=role||'choice';
 doc.title=selection?selection.name+' | โรงเรียนรัษฎา':
  'RD CONNECT | ระบบการดูแลและช่วยเหลือนักเรียนโรงเรียนรัษฎา';
 return role;
}
