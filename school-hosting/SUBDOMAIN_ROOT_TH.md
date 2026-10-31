# ย้าย RD CONNECT จาก URL ทดสอบเป็น rd-connect.ratsada.ac.th (Node.js + SQLite เท่านั้น)

เป้าหมาย: ให้หน้าเว็บและ API ใช้ HTTPS โดเมนเดียวกันโดยไม่เรียก Cloudflare Worker,
Cloudflare D1 หรือ MariaDB. ใช้แอป Passenger เดิมและฐานข้อมูล SQLite เดิม
**ไม่ต้องรัน school:install, school:init หรือ school:admin ซ้ำ**

## ก่อนเริ่ม
- ทดสอบว่าแอปเดิมยังเปิด /web/rd-connect-fast/api/health และล็อกอินได้
- ใน DirectAdmin แอปเดิมใช้ Node.js 24, Application Root
  `/home/ratsadaa/rd-connect-school-app` และ Startup File `app.js`
- กด Run JS Script `school:backup` และตรวจว่า exit code 0; เก็บ backup ไว้นอก public_html
- อัปโหลด/อัปเดตโค้ดสาขา `feature/school-direct-node-sqlite` โดย **รักษาไฟล์ฐานข้อมูลเดิมนอก public_html**
  โดยเฉพาะ `school-hosting/server.cjs`, `web/config.js`, `web/package.json`
  และ `school-hosting/test/school-subdomain.test.cjs`
- ทดสอบ `school:test` บน Node.js 24 ให้ผ่านก่อนเปลี่ยน URL

## การตั้งค่าที่ต้องเปลี่ยนใน DirectAdmin → Setup Node.js App
เปลี่ยนการผูก URL ของแอป **เดิม** ให้เป็น:
- Application URL (domain): `rd-connect.ratsada.ac.th`
- Application URL (path): `/`
- Application Root: `/home/ratsadaa/rd-connect-school-app` (ค่าเดิม)
- Startup File: `app.js` (ค่าเดิม)

Environment Variables:
- `RD_PUBLIC_ORIGIN=https://rd-connect.ratsada.ac.th`
- `RD_APP_MOUNT=/`
- `RD_SQLITE_FILE=/home/ratsadaa/rd-connect-private/rd-connect.sqlite` (ไม่เปลี่ยน)
- `RD_SQLITE_BACKUP_DIR=/home/ratsadaa/rd-connect-backups` (ไม่เปลี่ยน)

ห้ามเปิด Passenger แอปใหม่ที่ชี้เขียน SQLite เดียวกับแอปเดิมพร้อมกัน
และห้ามนำ `RD_SETUP_PASSWORD` / ตัวแปรติดตั้งครั้งแรกกลับมาใช้

## สำคัญ: Document Root กับ Passenger ไม่ใช่สิ่งเดียวกัน
ถ้า `rd-connect.ratsada.ac.th` ยังเสิร์ฟไฟล์จาก
`/domains/ratsada.ac.th/public_html/web/rd-connect` แบบ Apache static
หน้า Login อาจเปิดได้ แต่ `/api/auth/login` จะไม่ได้เชื่อม Node.
**ต้องผูก Node.js App กับ hostname/path จริงผ่าน Setup Node.js App**
แล้วตรวจไฟล์ Passenger/Apache ที่ DirectAdmin สร้าง โดยอย่าแก้เส้นทางแบบสุ่ม
และอย่าทิ้งโฟลเดอร์ `.github/`, `worker/`, `tests/` ที่ใช้เป็นโค้ดต้นฉบับไว้ใน public webroot
เมื่อไม่จำเป็น

## ทดสอบหลัง Restart แอป
1. `https://rd-connect.ratsada.ac.th/api/health` ต้องตอบเป็น JSON
   `{"ok":true,...}` และ `service` เป็น `RD Care API`
2. เปิด `https://rd-connect.ratsada.ac.th/?login=staff` และรีเฟรชไม่ใช้ cache
3. ใน DevTools → Network, POST ของ Login ต้องอยู่ที่
   `https://rd-connect.ratsada.ac.th/api/auth/login` เท่านั้น
   ไม่ควรเห็นคำขอไป `*.workers.dev` หรือ `rd-care.pages.dev`
4. ล็อกอินบัญชีใน SQLite เดิม; ตรวจห้องเรียน 48 ห้อง, การอ่านข้อมูล,
   สิทธิ์ครู/นักเรียน/ผู้ปกครอง, PWA และ Push ก่อนใช้งานจริง

ถ้า `/api/health` ได้ 404/403/HTML แปลว่ายังถูกเสิร์ฟโดย Apache static
แทน Passenger; ตรวจ Application URL/Passenger ก่อน ไม่ต้องลบหรือสร้างฐานใหม่

ถ้าไม่สำเร็จ ให้กลับไปใช้ App URL และค่า `RD_PUBLIC_ORIGIN`/`RD_APP_MOUNT`
เดิมชั่วคราว โดยคงไฟล์ SQLite เดิมและใช้ backup เป็นทางเลือกกู้คืน
