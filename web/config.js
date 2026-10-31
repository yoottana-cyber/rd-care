// RD CONNECT: automatic same-origin API base for both Cloudflare Pages at /
// and the school Passenger application at /web/rd-connect/.
// Every API call stays beneath the PWA's own URL prefix (no CORS/proxy).
// The school server rewrites <app-mount>/api/... into the original Worker /api/... .
const base=new URL('.',import.meta.url);
export const API_BASE_URL=base.pathname==='/'?'':base.pathname.replace(/\/$/,'');
