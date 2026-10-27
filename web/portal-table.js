// Table pagination and on-demand "all" mode for administrator-only portal records.
// "All" fetches multiple bounded API pages rather than truncating at old SQL limits.
export const PORTAL_PAGE_SIZES=['10','25','50','100','all'];
export function normalizePageSize(value){
 const v=String(value??'25');
 return PORTAL_PAGE_SIZES.includes(v)?v:'25';
}
export function pageWindow(total,page,pageSize){
 const count=Math.max(0,Number(total)||0),limit=normalizePageSize(pageSize);
 const maxPage=limit==='all'?1:Math.max(1,Math.ceil(count/Number(limit)));
 const current=limit==='all'?1:Math.min(maxPage,Math.max(1,Number(page)||1));
 const first=count?limit==='all'?1:(current-1)*Number(limit)+1:0;
 const last=count?limit==='all'?count:Math.min(count,current*Number(limit)):0;
 return {page:current,pages:maxPage,total:count,first,last,
  hasPrev:current>1,hasNext:current<maxPage};
}
export function portalListUrl(kind,{role='',page=1,limit=25,query=''}={}){
 if(!['accounts','links'].includes(kind))throw Error('Invalid portal list kind');
 const params=new URLSearchParams();
 if(kind==='accounts'&&role)params.set('role',role);
 params.set('page',String(page));params.set('limit',String(limit));
 if(query)params.set('q',String(query).trim());
 return '/api/admin/portal/'+kind+'?'+params.toString();
}
export async function fetchPortalRows(api,kind,{role='',page=1,pageSize='25',query='',
 onProgress=()=>{},isCurrent=()=>true}={}){
 const normalized=normalizePageSize(pageSize);
 if(normalized!=='all'){
  const result=await api(portalListUrl(kind,{role,page,limit:Number(normalized),query}));
  return {items:result.items||[],total:Number(result.total)||0,page:Number(result.page)||page,
   has_more:!!result.has_more,complete:true};
 }
 let next=1,items=[],total=0;
 while(isCurrent()){
  const r=await api(portalListUrl(kind,{role,page:next,limit:250,query}));
  if(!isCurrent())return null;
  items.push(...(r.items||[]));total=Number(r.total)||0;
  onProgress(items.length,total);
  if(!r.has_more||!r.items?.length)return{items,total,page:1,has_more:false,complete:true};
  next++;
 }
 return null;
}
