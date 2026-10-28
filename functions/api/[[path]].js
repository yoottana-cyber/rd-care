// Cloudflare Pages preview-only same-origin API gateway.
// The D1 Worker is linked with a Cloudflare Service Binding named RD_CARE_API.
// No tokens, credentials or database information are stored in this file.
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  if (!env?.RD_CARE_API || typeof env.RD_CARE_API.fetch !== 'function') {
    return Response.json(
      { error: 'preview_api_not_configured', message: 'ตั้งค่า Service Binding ชื่อ RD_CARE_API ใน Cloudflare Pages ก่อน' },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    );
  }
  // Forward only headers used by RD Care, never browser cookies or Origin.
  // A Service Binding stays inside Cloudflare, so no public cross-origin
  // request is made. The Worker still authenticates all protected API routes.
  const headers = new Headers();
  for (const name of ['authorization', 'content-type', 'accept']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const upstream = new Request(request, { headers });
  try {
    const response = await env.RD_CARE_API.fetch(upstream);
    const safeHeaders = new Headers(response.headers);
    safeHeaders.set('cache-control', 'no-store');
    return new Response(response.body, { status: response.status, headers: safeHeaders });
  } catch (error) {
    // A 502 here means the Service Binding fetch rejected before the Worker
    // could return its normal JSON error. Keep a trace ID, but never log request
    // bodies, authorization headers, names, or student identifiers.
    const requestId = crypto.randomUUID();
    console.error('RD Care Pages gateway: upstream rejected',requestId,error?.name||'unknown');
    return Response.json(
      { error: 'service_binding_fetch_failed',
        message: 'Cloudflare Pages ติดต่อ Worker ไม่สำเร็จ กรุณาตรวจ Worker Logs',
        request_id: requestId },
      { status: 502, headers: { 'cache-control': 'no-store',
        'x-rd-gateway-error': 'service_binding_fetch_failed',
        'x-rd-request-id': requestId } }
    );
  }
}
