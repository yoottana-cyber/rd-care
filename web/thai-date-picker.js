// Accessible, origin-local Thai Buddhist date picker. The actual input[type=date]
// stays in the form with its original ISO value, name, id, min/max and listeners.
// Only the visible selection UI changes to the Buddhist Era calendar.
import {formatThaiDate} from './thai-date.js';
const RX=/^\d{4}-\d{2}-\d{2}$/;
const MONTHS=['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
 'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const WEEKDAYS=['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.'];
const iso=(y,m,d)=>String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
const valid=value=>{
 if(!RX.test(String(value||'')))return false;
 const [y,m,d]=value.split('-').map(Number);
 return y>=100&&y<=9999&&m>=1&&m<=12&&new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10)===value;
};
const todayBangkok=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',
 year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function thaiMonthGrid(year,month,{min='',max=''}={}){
 if(!Number.isInteger(year)||year<100||year>9999||!Number.isInteger(month)||month<1||month>12)return [];
 const first=new Date(Date.UTC(year,month-1,1)).getUTCDay();
 const days=new Date(Date.UTC(year,month,0)).getUTCDate();
 return Array.from({length:first+days},(_,i)=>{
  const day=i-first+1;
  if(day<1)return null;
  const value=iso(year,month,day);
  return {day,value,disabled:!!(valid(min)&&value<min||valid(max)&&value>max)};
 });
}
export function thaiDateLabel(value){
 return valid(value)?formatThaiDate(value):'เลือกวันที่';
}
const escape=s=>String(s??'').replace(/[&<>"']/g,ch=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

export function installThaiDatePickers(root=document){
 if(!root?.querySelectorAll||!document.body)return ()=>{};
 let picker=null,active=null,visibleYear=0,visibleMonth=0;
 const marked='data-rd-thai-datepicker';
 const isMounted=()=>!!active?.isConnected;
 const labelFor=input=>{
  const id=input.id;
  return (id&&document.querySelector('label[for="'+CSS.escape(id)+'"]')?.textContent?.trim())
   ||input.getAttribute('aria-label')||'เลือกวันที่';
 };
 function sync(input){
  const button=input.parentElement?.querySelector('.rd-thai-date-trigger');
  if(!button)return;
  button.textContent=thaiDateLabel(input.value)+'  ▦';
  button.disabled=input.disabled||input.readOnly;
  button.setAttribute('aria-label',labelFor(input)+': '+thaiDateLabel(input.value));
  button.setAttribute('aria-expanded',String(active===input));
 }
 function close(){
  if(!picker)return;
  const trigger=active?.parentElement?.querySelector('.rd-thai-date-trigger');
  picker.remove();picker=null;active=null;
  if(trigger?.isConnected){sync(trigger.parentElement.querySelector('input[type=date]'));trigger.focus()}
 }
 function render(){
  if(!picker||!isMounted())return;
  const min=valid(active.min)?active.min:'';
  const max=valid(active.max)?active.max:'';
  const grid=thaiMonthGrid(visibleYear,visibleMonth,{min,max});
  const selected=active.value;
  const years=[];
  const start=Math.max(100,Math.max(min?Number(min.slice(0,4)):100,visibleYear-70));
  const end=Math.min(9999,Math.min(max?Number(max.slice(0,4)):9999,visibleYear+30));
  for(let y=start;y<=end;y++)years.push('<option value="'+y+'"'+(y===visibleYear?' selected':'')+'>'+(y+543)+'</option>');
  const prev=iso(visibleMonth===1?visibleYear-1:visibleYear,visibleMonth===1?12:visibleMonth-1,1);
  const next=iso(visibleMonth===12?visibleYear+1:visibleYear,visibleMonth===12?1:visibleMonth+1,1);
  const prevDisabled=!!min&&prev.slice(0,7)<min.slice(0,7);
  const nextDisabled=!!max&&next.slice(0,7)>max.slice(0,7);
  const current=todayBangkok();
  const todayAllowed=(!min||current>=min)&&(!max||current<=max);
  picker.innerHTML=`<div class="rd-thai-calendar-heading">
    <strong id="rdThaiCalendarTitle">เลือกวันที่ (พ.ศ.)</strong>
    <button type="button" class="rd-thai-calendar-close" data-close aria-label="ปิด">×</button>
   </div>
   <div class="rd-thai-calendar-month">
    <button type="button" data-prev aria-label="เดือนก่อนหน้า" ${prevDisabled?'disabled':''}>‹</button>
    <select data-month aria-label="เลือกเดือน">${MONTHS.map((m,i)=>'<option value="'+(i+1)+'"'+(i+1===visibleMonth?' selected':'')+'>'+m+'</option>').join('')}</select>
    <select data-year aria-label="เลือกปี พ.ศ.">${years.join('')}</select>
    <button type="button" data-next aria-label="เดือนถัดไป" ${nextDisabled?'disabled':''}>›</button>
   </div>
   <div class="rd-thai-calendar-grid" role="grid" aria-label="${escape(MONTHS[visibleMonth-1]+' '+(visibleYear+543))}">
     ${WEEKDAYS.map(d=>'<span class="rd-thai-calendar-weekday" role="columnheader">'+d+'</span>').join('')}
     ${grid.map(day=>day===null?'<span aria-hidden="true"></span>':
       '<button type="button" role="gridcell" data-day="'+day.value+'"'+
       (day.disabled?' disabled':'')+(day.value===selected?' class="selected" aria-selected="true"':'')+
       ' aria-label="'+escape(formatThaiDate(day.value))+'">'+day.day+'</button>').join('')}
   </div>
   <div class="rd-thai-calendar-footer">
     <button type="button" data-today ${todayAllowed?'':'disabled'}>วันนี้</button>
     <span>ปีพุทธศักราช ${visibleYear+543}</span>
   </div>`;
  const rect=active.parentElement.querySelector('button.rd-thai-date-trigger').getBoundingClientRect();
  const width=Math.min(336,Math.max(260,window.innerWidth-20));
  const left=Math.max(10,Math.min(rect.left,window.innerWidth-width-10));
  const height=picker.getBoundingClientRect().height;
  const below=window.innerHeight-rect.bottom;
  const top=below>=height+12||rect.top<height+12?
   Math.min(rect.bottom+6,Math.max(8,window.innerHeight-height-8)):
   Math.max(8,rect.top-height-6);
  picker.style.cssText='width:'+width+'px;left:'+left+'px;top:'+top+'px';
 }
 function open(input){
  if(input.disabled||input.readOnly)return;
  if(picker)close();
  active=input;
  const value=valid(input.value)?input.value:todayBangkok();
  visibleYear=Number(value.slice(0,4));
  visibleMonth=Number(value.slice(5,7));
  picker=document.createElement('section');
  picker.className='rd-thai-calendar';
  picker.setAttribute('role','dialog');
  picker.setAttribute('aria-modal','false');
  picker.setAttribute('aria-labelledby','rdThaiCalendarTitle');
  document.body.append(picker);
  sync(input);render();
  picker.querySelector('[data-day]:not([disabled])')?.focus();
 }
 function choose(value){
  if(!active||!valid(value)||(valid(active.min)&&value<active.min)||
   (valid(active.max)&&value>active.max))return;
  const input=active;
  input.value=value;
  close();
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
  queueMicrotask(()=>{if(input.isConnected)sync(input)});
 }
 function decorate(input){
  if(input.hasAttribute(marked)||input.closest('.rd-thai-date-field'))return;
  input.setAttribute(marked,'');
  const wrap=document.createElement('span');
  wrap.className='rd-thai-date-field';
  input.before(wrap);
  wrap.append(input);
  input.classList.add('rd-thai-date-original');
  input.tabIndex=-1;
  const button=document.createElement('button');
  button.type='button';button.className='rd-thai-date-trigger';
  wrap.append(button);
  button.addEventListener('click',()=>open(input));
  input.addEventListener('input',()=>sync(input));
  input.addEventListener('change',()=>queueMicrotask(()=>sync(input)));
  input.addEventListener('invalid',()=>open(input));
  sync(input);
 }
 const scan=scope=>{
  if(scope.matches?.('input[type="date"]'))decorate(scope);
  scope.querySelectorAll?.('input[type="date"]').forEach(decorate);
 };
 scan(root);
 const observer=new MutationObserver(events=>{
  for(const event of events){
   if(event.type==='attributes'&&event.target.matches?.('input[type="date"]')){
    sync(event.target);continue;
   }
   for(const node of event.addedNodes)if(node.nodeType===1)scan(node);
  }
  if(picker&&!isMounted()){picker.remove();picker=null;active=null}
 });
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,
  attributeFilter:['disabled','readonly','min','max']});
 const onClick=event=>{
  if(!picker)return;
  if(!picker.contains(event.target)){
   if(!event.target.closest?.('.rd-thai-date-trigger'))close();
   return;
  }
  const button=event.target.closest('button');
  if(!button)return;
  if(button.hasAttribute('data-close')){close();return}
  if(button.hasAttribute('data-prev')||button.hasAttribute('data-next')){
   const shift=button.hasAttribute('data-prev')?-1:1;
   const index=visibleYear*12+visibleMonth-1+shift;
   visibleYear=Math.floor(index/12);visibleMonth=index%12+1;render();return;
  }
  if(button.hasAttribute('data-today')){choose(todayBangkok());return}
  if(button.dataset.day)choose(button.dataset.day);
 };
 const onChange=event=>{
  if(!picker?.contains(event.target))return;
  if(event.target.matches('[data-month]'))visibleMonth=Number(event.target.value);
  if(event.target.matches('[data-year]'))visibleYear=Number(event.target.value);
  render();
 };
 const onKey=event=>{if(picker&&event.key==='Escape'){event.preventDefault();close()}};
 const onScroll=event=>{if(picker&&event.target!==picker)close()};
 document.addEventListener('click',onClick);
 document.addEventListener('change',onChange);
 document.addEventListener('keydown',onKey);
 window.addEventListener('resize',onScroll);
 return ()=>{
  observer.disconnect();document.removeEventListener('click',onClick);
  document.removeEventListener('change',onChange);
  document.removeEventListener('keydown',onKey);
  window.removeEventListener('resize',onScroll);
  if(picker)close();
 };
}
