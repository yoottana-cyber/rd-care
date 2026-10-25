const statuses=[
 ['present','มาเรียน','#19a571'],
 ['absent','ขาด','#e85a72'],
 ['late','สาย','#eeb347'],
 ['leave','ลา','#6984e8']
];
const num=value=>{
 const n=Number(value);
 return Number.isFinite(n)&&n>0?Math.floor(n):0;
};
const fmt=n=>n.toLocaleString('th-TH');
const shortDate=s=>{
 const m=/^\d{4}-(\d\d)-(\d\d)$/.exec(String(s));
 return m?m[2]+'/'+m[1]:'—';
};
export function renderAttendanceCharts(stats){
 const selected=stats?.daily_statuses||{};
 const totals=statuses.map(([key,label,color])=>({key,label,color,value:num(selected[key])}));
 const total=totals.reduce((sum,s)=>sum+s.value,0);
 const legend=totals.map(item=>'<span class="attendance-chart-legend-item"><span class="attendance-dot" style="background:'+
  item.color+'"></span><span>'+item.label+' <strong>'+fmt(item.value)+'</strong></span></span>').join('');
 const trend=Array.isArray(stats?.daily_trend)?stats.daily_trend.slice(-7):[];
 const days=trend.map(row=>({
  date:shortDate(row.date),
  counts:statuses.map(([key])=>num(row?.[key]))
 }));
 const max=Math.max(1,...days.map(r=>r.counts.reduce((a,b)=>a+b,0)));
 let current=0;
 const sections=totals.map(item=>{
  const start=current;current+=item.value/(total||1)*100;
  return item.color+' '+start.toFixed(2)+'% '+current.toFixed(2)+'%';
 });
 const donutStyle=total?'background:conic-gradient('+sections.join(',')+')':
  'background:conic-gradient(#e3e9f2 0% 100%)';
 const history=days.map(row=>{
  const sum=row.counts.reduce((a,b)=>a+b,0);
  const segments=row.counts.map((v,i)=>v?'<span style="flex:'+v+';background:'+statuses[i][2]+
   '" title="'+statuses[i][1]+' '+fmt(v)+'"></span>':'').join('');
  return '<div class="attendance-chart-day"><div class="attendance-chart-track" role="img" aria-label="วันที่ '+
   row.date+' จำนวนบันทึก '+fmt(sum)+' รายการ"><div class="attendance-chart-bar" style="height:'+
   (sum?Math.max(4,(sum/max)*100):0)+'%">'+segments+'</div></div><span>'+row.date+'</span></div>';
 }).join('');
 const left='<div class="card attendance-chart-panel"><h3>📈 การมาเรียนย้อนหลัง 7 วัน</h3>'+
  '<p class="muted">นับเฉพาะรายการที่มีการบันทึกเช็กชื่อประจำวันจริง</p>'+
  (days.length?'<div class="attendance-chart-bars">'+history+'</div>':'<div class="empty">ไม่มีข้อมูลการมาเรียนในช่วงนี้</div>')+
  '<div class="attendance-chart-legend">'+legend+'</div></div>';
 const right='<div class="card attendance-chart-panel"><h3>◉ สัดส่วนการมาเรียนในวันที่เลือก</h3>'+
  '<p class="muted">สถานะการเช็กชื่อประจำวัน ไม่รวมการเช็กชื่อรายคาบ</p>'+
  '<div class="attendance-chart-pie-row"><div class="attendance-chart-donut" role="img" aria-label="'+
  (total?'เช็กชื่อรวม '+fmt(total)+' รายการ':'ยังไม่มีบันทึกเช็กชื่อสำหรับวันที่เลือก')+
  '" style="'+donutStyle+'"><div><strong>'+(total?fmt(total):'—')+
  '</strong><span>รายการ</span></div></div><div class="attendance-chart-legend attendance-chart-vertical">'+legend+'</div></div></div>';
 return '<section class="grid two attendance-chart-grid" aria-label="กราฟสถิติการมาเรียน">'+left+right+'</section>';
}
