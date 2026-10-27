# RD CONNECT — Mobile App / PWA / Staff Web Push

## Mobile UI
- 5-action bottom navigation: ภาพรวม, แจ้งเตือน, เช็กชื่อ (กลาง), งานตรวจสอบ, เมนู
- Full menu sheet holds all original modules, theme switch, app install and logout
- Card-first dashboard, tap-friendly controls and iPhone safe-area support
- The admin/teacher/student features and existing login APIs remain unchanged

## Installing RD CONNECT
- Android Chrome/Edge: open https://rd-care.pages.dev, choose **ติดตั้งแอป** from menu or use browser Install App.
- iOS Safari: open the site, tap **แชร์ (Share)** → **เพิ่มไปยังหน้าจอโฮม (Add to Home Screen)**, then launch the RD CONNECT icon.
- Installation requires HTTPS and a supported browser. The existing PWA manifest, 192/512 icons, and service worker provide offline app shell only; forms still require internet to save data.

## Push capabilities implemented
- Opt-in, **staff-only** device subscriptions bound to the currently logged-in staff user.
- Staff device push currently relates only to **new pending class-advisor absence reviews**. Notifications carry generic text, no student name/status or class information on lock screens.
- Outbox advisor events are sent after saved attendance, with cron retried approximately every 5 minutes. Multiple pending student events are consolidated into one generic notification per advisor.
- Disabling Push removes that user's device subscription. Logout attempts to revoke server consent and removes the local browser subscription.
- No automatic permission prompts. Guardian/student Push is **not active** and requires its own account verification/consent and content policy before deployment.
- API endpoints: `GET /api/push/config`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`.
- Database migration `0011_staff_web_push.sql`.

## กรณี VAPID_SUBJECT หายหลัง Deploy

GitHub Actions deploys Worker `rd-care-api-dev` ด้วย Wrangler และตั้งแต่แก้ไขล่าสุด
`worker/wrangler.toml` มี `keep_vars = true` เพื่อเก็บตัวแปรที่เพิ่มผ่าน
Cloudflare Dashboard ต่อไปหลัง Deploy และ workflow ตรวจว่าต้องเปิดการตั้งค่านี้เสมอ

- **ให้เพิ่ม `VAPID_SUBJECT` กลับเพียงครั้งเดียว** ถ้าค่าหายไปก่อนแก้:
  Cloudflare → Workers & Pages → `rd-care-api-dev` → Settings → Variables and Secrets → Add
  ใช้ชื่อ `VAPID_SUBJECT` และค่า `mailto:` ตามด้วยอีเมลผู้ดูแลโรงเรียนจริง
- แนะนำใช้ประเภท **Secret** สำหรับทั้ง 3 VAPID bindings เพราะ secrets ถูกคงไว้ระหว่าง
  Wrangler Deploy ตามเอกสาร Cloudflare; `keep_vars = true` ยังช่วยเก็บค่าประเภท Text
  ที่ตั้งผ่าน Dashboard
- **ห้ามสร้างชุดกุญแจ VAPID ใหม่ทุกครั้งที่ Deploy** ใช้ Public/Private คู่เดิมต่อเนื่อง
  เพื่อไม่ให้มือถือครูและผู้ปกครองต้องสมัครรับ Push ใหม่
- ปุ่มตรวจสอบและส่ง Push ทดสอบในหน้า RD CONNECT จะตรวจว่าค่า VAPID ครบ ถูกต้อง
  และอุปกรณ์สมัครรับแจ้งเตือนแล้วหรือยัง โดยไม่แสดงกุญแจลับ
- Worker Deploy ไปที่ `rd-care-api-dev` เท่านั้น การตั้งค่าบน Cloudflare Pages
  `rd-care` ไม่ได้ตั้งค่าตัวแปรให้ Worker API
- ไม่มีการเก็บ VAPID Private Key หรืออีเมลจริงของโรงเรียนใน GitHub

## Required Cloudflare VAPID setup (no credentials in GitHub)
The code deploys even if keys are absent. In that case the notification settings page truthfully displays **Push ยังไม่พร้อม** and does not request permission.

A Cloudflare Worker administrator must create a permanent VAPID keypair once:

```bash
node worker/scripts/generate-vapid.mjs
```

Keep the **private** value secret and set these three Cloudflare Worker environment secrets for `rd-care-api-dev` (via Cloudflare dashboard, Worker settings → Variables and Secrets, or Wrangler commands):

```bash
cd worker
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

For the SUBJECT, use a real school-maintained administrative contact in `mailto:your-admin-address@example.ac.th` format (replace with the school's actual address). The VAPID key pair must remain stable across deployments; replacing the keys invalidates existing browser subscriptions.

**Do not commit** `.dev.vars`, private keys or real subscription endpoints to GitHub. The public key is public by design; the private key is not.

## Testing delivery
1. Confirm Cloudflare Worker API `/api/health` is healthy and all migrations completed.
2. Sign in on the installed RD CONNECT PWA with a teacher account assigned as an advisor.
3. Navigate to **แจ้งเตือน**, tap **เปิดรับ Push** and explicitly allow the browser permission.
4. On a second staff account, mark a student absent in a taught lesson. The new pending advisor review should produce **one generic push** to the advisor's subscribed device.
5. Tap the push to launch RD CONNECT notifications. Open **ศูนย์ครูที่ปรึกษา** to inspect the actual review details after authentication.
6. Switch off push in the app and confirm no more messages are received. Test logout and re-login separately.

## Privacy and deployment boundaries
- Push endpoints are validated against known HTTPS push providers to avoid arbitrary server requests.
- No student personal information is delivered as a push payload. The service worker displays a fixed generic notification.
- Only the authenticated user's push endpoint can be removed/updated by that account. A subscription already claimed by another account is rejected.
- Device and account subscriptions must be audited before use with actual student personal data, and school privacy/retention policies should be approved first.
- The app shell is cached offline; the service worker intentionally never caches `/api/*` responses containing school data.
