# RD Care — เว็บทดลองบน Cloudflare Pages (แบบเดียวกับระบบลาออนไลน์)

**เป้าหมาย:** แก้โค้ดผ่าน GitHub `yoottana-cyber/rd-care` แล้ว Cloudflare Pages อัปเดตเว็บทดลองให้อัตโนมัติผ่าน Git integration โดย **ยังไม่อัปโหลดเว็บขึ้น Hosting โรงเรียน** และใช้เฉพาะนักเรียน/บัญชีจำลองระหว่างพัฒนา

## โครงสร้าง

- `web/` = หน้าเว็บ PWA แบบ static บน Pages, ไม่ต้อง npm build
- `functions/api/[[path]].js` = Pages Function ส่ง `/api/*` ผ่าน **Service Binding** ไปยัง Worker `rd-care-api-dev`
- `worker/` = Cloudflare Worker เดิม, ใช้ D1 `rd-care-dev` และต้อง Deploy ฝั่งนี้ **แยกจาก** Pages
- `web/config.js` = ชี้ `API_BASE_URL = ''` (same-origin); ไม่ต้องแก้ CORS สำหรับ Pages Preview เพราะ browser ไม่ต้องข้ามโดเมน
- `web/_routes.json` = ส่งเข้าฟังก์ชันเฉพาะ `/api/*`, หน้า static ไม่เสีย Function invocation

## ขั้นตอนเชื่อมครั้งแรก (ทำใน Cloudflare Dashboard)

1. เข้า [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. เลือก GitHub `yoottana-cyber/rd-care` (Private) และอนุญาตให้ Cloudflare GitHub App เข้าถึง repo นี้หากยังไม่ได้เลือกไว้
3. ตั้งค่าดังนี้:
   - **Project name:** `rd-care-preview` (ถ้าซ้ำให้ใช้ชื่ออื่นที่ว่าง)
   - **Production branch:** `main` (หมายถึงเว็บทดลองบน Pages เท่านั้น ไม่ใช่เว็บโรงเรียน)
   - **Framework preset:** `None`
   - **Root directory:** repository root `/` (เว้นว่างตามค่าเริ่มต้น)
   - **Build command:** `exit 0` หรือเว้นว่างสำหรับ static HTML
   - **Build output directory:** `web`
4. กด **Save and Deploy** จน Pages ให้ URL ในรูป `https://<ชื่อโปรเจกต์>.pages.dev` (URL ที่ได้จริงอาจต่างจากตัวอย่าง)
5. เข้า Pages project → **Settings → Bindings → Add → Service binding**
   - **Variable name:** `RD_CARE_API`
   - **Service / Worker:** `rd-care-api-dev`
   - เพิ่มสำหรับ **Production environment** และ **Preview environment** (เพื่อให้ PR preview ใช้ API ได้)
6. **Redeploy** Pages หลังตั้ง Binding ทั้งสอง environment แล้ว (การเพิ่ม Binding ไม่เชื่อมย้อนหลังกับ deploy เก่า)
7. เปิด `https://<ชื่อโปรเจกต์>.pages.dev/api/health` ต้องได้ JSON ที่มี `ok:true`
   - หากได้ `503 preview_api_not_configured` ให้ตรวจ Binding และ Redeploy
   - หากได้ `502 preview_api_unavailable` ให้ตรวจ Worker `rd-care-api-dev` และ binding
8. เปิดหน้า URL หลักแล้ว Login ด้วยบัญชี `admin` ของฐานทดลอง **อย่าลงรหัสผ่านใน GitHub/ChatGPT**

## การพัฒนาต่อ

- ทุกครั้งที่แก้ไฟล์ GitHub Branch `main` ผ่าน Pull Request แล้ว Merge: **Pages อัปเดตหน้าเว็บโดยอัตโนมัติ**
- แต่ละ Branch/PR จะมี Preview URL แยก (ต้องเปิด Preview deploys ใน Pages)
- **สำคัญ:** การ Merge ไฟล์ `worker/` บน GitHub ไม่ได้ทำให้ Worker API หรือ D1 Remote เปลี่ยนตามอัตโนมัติ ให้จัด migration และ deploy Worker ทดลองเป็นอีกขั้นตอนภายหลัง
- ปัจจุบัน GitHub มี Migration `0002_notification_outbox.sql` แล้ว แต่ยังไม่ใช่การสั่ง Apply ลง D1 Remote; **ต้อง Apply ก่อน Deploy Worker รุ่นที่ใช้งานตารางใหม่**
- สำหรับทดสอบหน้าเว็บ ไม่ต้องเปิด cPanel หรือใช้โดเมนโรงเรียนในขั้นนี้

## เมื่อระบบผ่านทุกการทดสอบและจะย้ายไป Hosting โรงเรียน

Pages Function และ Service Binding ไม่สามารถคัดลอกไปทำงานเป็น PHP/cPanel ได้โดยตรง จึงต้องปรับ `web/config.js` ให้ชี้ URL ของ Worker จริงและตั้งค่า `ALLOWED_ORIGINS` ของ Worker ให้ตรงกับโดเมน HTTPS ของโรงเรียน หรือทำ Proxy ที่เหมาะสมสำหรับ Hosting โรงเรียนก่อนอัปโหลด `web/`.

## ข้อควรระวัง

- GitHub Repository เป็น Private **ไม่ได้ทำให้เว็บ Pages เป็นเว็บส่วนตัวโดยอัตโนมัติ**; ผู้ที่รู้ URL อาจเปิดเว็บทดลองได้
- ทดลองกับข้อมูลจำลอง 48 ห้องเรียนเท่านั้น ก่อนข้อมูลนักเรียนจริงต้องมีบัญชี/สิทธิ์ผู้ปกครอง, อุปกรณ์, ความปลอดภัย, PDPA และมาตรการควบคุมสิทธิ์
- Service Worker ไม่แคช `/api/*` และ Pages Functions ไม่เก็บคุกกี้ผู้ใช้หรือค่า Token ลง GitHub
- ปัจจุบันยังไม่มีการส่ง Push ถึงผู้ปกครองจริง
