// Persistent authentication is explicit and scoped to this browser/profile.
// Never store passwords or personal student records; save only the opaque bearer
// credential and the server-issued expiry, and verify it again at every app start.
const persistentKey=name=>name+'_remember_v1';
export function readAuthSession(name){
 let temporary='';
 try{temporary=sessionStorage.getItem(name)||''}catch{}
 if(temporary)return temporary;
 try{
  const saved=JSON.parse(localStorage.getItem(persistentKey(name))||'null');
  if(saved&&typeof saved.token==='string'&&/^[a-f0-9]{64}$/.test(saved.token)&&
   Number.isSafeInteger(saved.expiresAt)&&saved.expiresAt>Date.now()){
   return saved.token;
  }
  localStorage.removeItem(persistentKey(name));
 }catch{try{localStorage.removeItem(persistentKey(name))}catch{}}
 return '';
}
export function saveAuthSession(name,token,expiresIn,remember){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw Error('รหัสเซสชันไม่ถูกต้อง');
 clearAuthSession(name);
 if(remember){
  const seconds=Number(expiresIn);
  if(!Number.isSafeInteger(seconds)||seconds<=0||seconds>30*86400)throw Error('อายุเซสชันไม่ถูกต้อง');
  try{
   localStorage.setItem(persistentKey(name),JSON.stringify({
    token,expiresAt:Date.now()+seconds*1000
   }));
   return;
  }catch{ /* Private browsing, storage disabled or quota exceeded: use this tab only. */ }
 }
 try{sessionStorage.setItem(name,token)}catch{}
}
export function clearAuthSession(name){
 try{sessionStorage.removeItem(name)}catch{}
 try{localStorage.removeItem(persistentKey(name))}catch{}
}
export function getLastLoginArea(){
 try{return localStorage.getItem('rd_last_login_area')||''}catch{return ''}
}
export function setLastLoginArea(value){
 try{localStorage.setItem('rd_last_login_area',value)}catch{}
}
