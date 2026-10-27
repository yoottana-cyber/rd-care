// Role-safe, presentation-only navigation helpers. These do not grant access.
export const NAV_GROUPS=[
 {id:'overview',label:'ภาพรวม',icon:'◈',pages:['dashboard']},
 {id:'attendance',label:'การเช็กชื่อและติดตาม',icon:'◷',
  pages:['attendance','periodAttendance','myTimetable','advisorCenter','late','lateGate','alerts']},
 {id:'care',label:'ดูแลและส่งเสริม',icon:'✦',pages:['behavior','good','studentAffairs']},
 {id:'management',label:'งานบริหารระบบ',icon:'▦',pages:['adminStudents','portalAccounts','admin']}
];
export const PAGE_DESCRIPTIONS={
 dashboard:'สรุปข้อมูลภาพรวมและทางลัดการทำงานประจำวัน',
 attendance:'ตรวจสอบรายชื่อและบันทึกการมาเรียนของนักเรียน',
 periodAttendance:'เช็กชื่อผู้เรียนตามคาบเรียนและตารางสอน',
 periodCheckin:'เช็กชื่อผู้เรียนตามคาบเรียนและตารางสอน',
 myTimetable:'จัดการตารางสอนเพื่อเช็กชื่อรายคาบได้สะดวก',
 advisorCenter:'ติดตามการมาเรียนและดูแลงานของครูที่ปรึกษา',
 late:'ตรวจสอบและบันทึกข้อมูลนักเรียนมาสาย',
 lateGate:'จัดการจุดสแกน QR ลงชื่อมาสาย',
 behavior:'บันทึกคะแนนพฤติกรรมตามเกณฑ์โรงเรียน',
 good:'ส่งเสริมและบันทึกคะแนนความดีแยกต่างหาก',
 studentAffairs:'ติดตามการเช็กชื่อ กำหนดเกณฑ์ และดูแลพฤติกรรม',
 alerts:'จัดการเหตุการณ์และรายการรอการตรวจสอบ',
 adminStudents:'ค้นหา นำเข้า และแก้ไขทะเบียนนักเรียน',
 portalAccounts:'นำเข้าและดูแลบัญชีนักเรียนกับผู้ปกครอง',
 admin:'บริหารบัญชีบุคลากร สิทธิ์ และตั้งค่าระบบ',
 notifications:'ตรวจสอบและตั้งค่าการแจ้งเตือน'
};
export function groupNavigation(navs){
 const assigned=new Set(),groups=[];
 for(const group of NAV_GROUPS){
  const items=navs.filter(item=>group.pages.includes(item[0]));
  if(items.length){
   groups.push({...group,items});
   for(const item of items)assigned.add(item[0]);
  }
 }
 const rest=navs.filter(item=>!assigned.has(item[0]));
 if(rest.length)groups.push({id:'other',label:'รายการอื่น ๆ',icon:'•',items:rest});
 return groups;
}
export function pageLocation(navs,tab){
 const normalized=tab==='periodCheckin'?'periodAttendance':tab;
 const entry=navs.find(x=>x[0]===normalized);
 return {title:entry?.[1]||'หน้าหลัก',description:PAGE_DESCRIPTIONS[tab]||PAGE_DESCRIPTIONS[normalized]||'จัดการข้อมูล RD CONNECT',
  group:groupNavigation(navs).find(group=>group.items.some(item=>item[0]===normalized))?.label||'RD CONNECT'};
}
export function searchNavItems(root,term){
 const query=String(term??'').trim().toLocaleLowerCase('th-TH');
 const links=[...root.querySelectorAll('.rd-sidebar-link')];
 for(const link of links){
  const label=link.textContent.toLocaleLowerCase('th-TH');
  link.hidden=!!query&&!label.includes(query);
 }
 const groups=[...root.querySelectorAll('.rd-sidebar-group')];
 for(const group of groups){
  const links=[...group.querySelectorAll('.rd-sidebar-link')];
  group.hidden=!!query&&!links.some(link=>!link.hidden);
 }
 const empty=root.querySelector('#rdNavEmpty');
 if(empty)empty.hidden=!query||links.some(link=>!link.hidden);
 return links.filter(link=>!link.hidden).length;
}
