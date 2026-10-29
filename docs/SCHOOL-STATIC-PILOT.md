# ทดลอง RD CONNECT: ย้ายเฉพาะหน้าเว็บไป Hosting โรงเรียน

> Pilot เท่านั้น: **ไม่ย้าย Worker, ไม่ย้าย D1, ไม่เปลี่ยนข้อมูลเดิม, ไม่เปลี่ยน DNS** และอย่าเพิ่งยกเลิก `rd-care.pages.dev`

## โครงสร้าง
- หน้าเว็บ/PWA: Hosting โรงเรียน (แนะนำ URL แยก เช่น `https://YOUR-SCHOOL-DOMAIN/rd-connect/`)
- API: `https://rd-care-api-dev.yoottana.workers.dev`
- DB: Cloudflare D1 เดิม `rd-care-dev`
- GitHub: เก็บโค้ดและแก้ไขต่อได้ตามปกติ

## ติดตั้งเว็บ (ยังไม่แตะฐานข้อมูล)
1. เลือกสาขา `pilot/school-static-hosting` ใน GitHub → **Code > Download ZIP**.
2. แตก ZIP แล้วเปิดโฟลเดอร์ `web`.
3. ตรวจไฟล์ `web/config.js` ว่า `SCHOOL_WORKER_API` ชี้ Worker ด้านบน (สำหรับเว็บบน `*.pages.dev` ยังคงใช้ Pages Function เช่นเดิม)
4. ใน File Manager ของ Hosting สร้าง `public_html/rd-connect/` โดย **อย่าลบ/เขียนทับหน้าเว็บไซต์โรงเรียน**
5. อัปโหลด **เนื้อหาภายใน `web/` ทั้งหมด** (รวม `icons/`, `media/`, `vendor/`, `templates/`, `.htaccess`) ลง `public_html/rd-connect/`. ถ้า File Manager ซ่อนไฟล์ขึ้นต้นด้วยจุด ให้เปิด Show hidden files
6. ยืนยันว่า URL ใช้ HTTPS และเปิดหน้า `https://YOUR-SCHOOL-DOMAIN/rd-connect/` ได้ ไม่มี 404 ของ JS/CSS

## สิ่งที่ต้องทำก่อน Login ผ่านโดเมน Hosting
Worker กำหนด CORS ตาม **Origin ที่อนุญาต** โดยตรวจค่า `ALLOWED_ORIGINS`. ปัจจุบัน `worker/wrangler.toml` เป็นค่า placeholder; ต้องเปลี่ยนหรือเพิ่ม **โดเมน HTTPS ที่ใช้จริง** ก่อนทดสอบ Login เช่น `https://www.school.ac.th` (ไม่มี `/rd-connect/`).

ตัวอย่างค่า (ปรับเป็นโดเมน Hosting จริงเท่านั้น):
```toml
[vars]
ALLOWED_ORIGINS = "https://www.school.ac.th"
```
หากต้องคง Origin ที่เคยอนุญาต ให้คั่นแต่ละค่าโดยเครื่องหมาย `,` (ไม่มี wildcard `*`). การเปิด URL Worker โดยตรงไม่ได้พิสูจน์ว่า CORS ผ่าน ต้องทดสอบจากหน้าเว็บไซต์ของ Hosting

ข้อควรระวัง: หากแก้ตัวแปรที่ Cloudflare Dashboard ต้องตรวจให้ตรงกับ `worker/wrangler.toml` และวิธี deploy ครั้งต่อไปด้วย เพื่อไม่ให้ค่ากลับไปเป็นค่าเดิม อย่ากด deploy Worker / apply migration โดยไม่ตรวจการตั้งค่าฐานข้อมูล

## ทดสอบก่อนปล่อยใช้
- เปิดหน้าหลักจาก Hosting ผ่าน HTTPS → DevTools Network: ไม่มี JS/CSS 404 หรือ Service Worker install error
- ตรวจ `web/config.js` จาก Hosting (public config) ว่าชี้ Worker; **ไม่ต้องมี API key**
- ทดลอง Login ด้วย **บัญชีทดสอบ** และยืนยันว่า API preflight (OPTIONS) จาก Origin โรงเรียนผ่าน
- ทดลองเช็กชื่อและอ่านประวัติจากบัญชีทดสอบเท่านั้น; ตรวจว่า Cloudflare Pages เดิมยังใช้ได้
- ทดสอบ PWA ติดตั้งบนมือถือ และสมัครรับ Push ใหม่: Subscription ผูกกับ Origin/Service Worker ใหม่ ไม่ย้ายอัตโนมัติจาก `pages.dev`
- ตรวจ Metrics ของ Workers/D1 ขณะทดลอง (ข้อมูลทั้งสองเว็บไซต์ยังใช้ D1 เดียวกัน)

## QR มาสาย
**ข้อจำกัดระหว่าง Pilot:** Backend `worker/src/late-qr.js` ยังสร้าง QR ถาวรที่ชี้ไป `https://rd-care.pages.dev/?late_qr=gate` และตัวสแกนใน `web/student-late-qr-scanner.js` ยังยอมรับ URL เดิมด้วย จึงใช้ QR เดิมต่อได้ขณะทดลอง แต่ถ้าจะให้ QR ที่พิมพ์ใหม่เปิด Hosting โรงเรียนแทน ต้องกำหนด URL ที่แน่นอนและแก้ Backend/ทดสอบแยกต่างหากก่อน อย่าลบเว็บ Pages เดิมก่อนย้าย QR

## การอัปเดตในอนาคต
- แก้โค้ดผ่าน GitHub เหมือนเดิม
- หน้าเว็บ: อัปโหลดไฟล์จาก `web/` เวอร์ชันใหม่เข้า Hosting; หากมีการเปลี่ยน Service Worker assets ให้เพิ่ม `CACHE` version ตามขั้นตอนปกติ
- Backend: ยัง Deploy Worker แยกจากหน้าเว็บ ไม่จำเป็นต้อง deploy Worker ทุกครั้งที่แก้ CSS/HTML
- **ห้ามอัปโหลด** โฟลเดอร์ `worker/`, `functions/`, `.git/`, `.dev.vars`, credentials, SQL สำรอง หรือรายชื่อนักเรียนจริง ไปยัง `public_html/`

## ก่อนดำเนินขั้นตอน CORS
ต้องทราบ **URL HTTPS ที่โรงเรียนจะใช้** (เช่น โดเมนพร้อม path `/rd-connect/`) และประเภท Hosting (DirectAdmin / cPanel / อื่น ๆ) ไม่ต้องส่งชื่อผู้ใช้หรือรหัสผ่าน Hosting ในแชต
