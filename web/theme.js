// Only the user's visual preference is stored; never save student data or tokens.
const storageKey='rd-care-ui-theme';
export function resolveTheme(saved,systemDark=false){
 if(saved==='light'||saved==='dark')return saved;
 return systemDark?'dark':'light';
}
export const themeButtonLabel=theme=>theme==='dark'?'☀️ โหมดสว่าง':'🌙 โหมดกลางคืน';
export function initTheme(){
 let saved;
 try{saved=localStorage.getItem(storageKey)}catch{}
 const systemDark=typeof matchMedia==='function'&&matchMedia('(prefers-color-scheme: dark)').matches;
 const value=resolveTheme(saved,systemDark);
 document.documentElement.dataset.theme=value;
 document.documentElement.style.colorScheme=value;
 return value;
}
export function setTheme(theme){
 const value=resolveTheme(theme);
 document.documentElement.dataset.theme=value;
 document.documentElement.style.colorScheme=value;
 try{localStorage.setItem(storageKey,value)}catch{}
 syncButtons();
 return value;
}
export function syncButtons(){
 const theme=document.documentElement.dataset.theme==='dark'?'dark':'light';
 document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
  button.textContent=themeButtonLabel(theme);
  button.setAttribute('aria-label','เปลี่ยนเป็น'+(theme==='dark'?'โหมดสว่าง':'โหมดกลางคืน'));
  button.setAttribute('aria-pressed',String(theme==='dark'));
 });
}
export function bindThemeButtons(){
 syncButtons();
 document.querySelectorAll('[data-theme-toggle]').forEach(button=>{
  button.addEventListener('click',()=>{
   setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
  });
 });
}
