// Static school-hosting pilot: only browser assets move to the school's HTTPS host.
// Existing Cloudflare Pages previews keep the same-origin Pages Function API.
// This is a public Worker URL, never a password or credential.
const SCHOOL_WORKER_API = 'https://rd-care-api-dev.yoottana.workers.dev';
const onCloudflarePages = typeof window !== 'undefined' && /\.pages\.dev$/i.test(window.location.hostname);
export const API_BASE_URL = onCloudflarePages ? '' : SCHOOL_WORKER_API;
