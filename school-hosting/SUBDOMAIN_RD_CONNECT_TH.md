# RD CONNECT — ย้ายจาก /web/rd-connect-fast/ ไป rd-connect.ratsada.ac.th

## เป้าหมาย
จาก `https://ratsada.ac.th/web/rd-connect-fast/`
เป็น `https://rd-connect.ratsada.ac.th/`

สาขา PR นี้เพิ่มการรองรับ **RD_APP_MOUNT=/** ใน Node.js/SQLite server ให้บริการหน้าเว็บ, API และ PWA ที่รากของ Subdomain ได้โดยตรง โดยไม่ลบหรือย้ายบัญชีครู นักเรียน ผู้ปกครอง หรือข้อมูลการเช็กชื่อ

> **ทำในช่วงเวลาบำรุงรักษาและสำรองก่อนเสมอ**: ไม่ควรให้ Node App สองตัวชี้มาที่ไฟล์ SQLite ที่เดียวกันระหว่างการสลับ URL นาน ๆ เพราะการบริหารงานแอป/การส่ง Push/Cron อาจซ้ำกัน ห้ามรัน `school:install`, `school:init`, `school:admin` กับฐานเดิมอีกครั้ง

## 1. สำรองและตรวจค่าเดิม

DirectAdmin → Setup Node.js App ให้จดค่าปัจจุบัน และ Run JS Script:
- `school:test` (ทดสอบข้อมูลจำลอง)
- `school:backup` (สำรอง SQLite จริงตามเครื่องมือที่รองรับ WAL)
- `school:restore-test` (ตรวจว่าไฟล์สำรองกู้คืนได้ในไฟล์ทดสอบแยก)

ตัวอย่างค่าที่คาดว่าจะใช้อยู่:
```ini
RD_PUBLIC_ORIGIN=https://ratsada.ac.th
RD_APP_MOUNT=/web/rd-connect-fast
RD_SQLITE_FILE=/home/ratsadaa/rd-connect-private/rd-connect.sqlite
RD_SQLITE_BACKUP_DIR=/home/ratsadaa/rd-connect-backups
```
ยืนยันไฟล์จริงจาก DirectAdmin ก่อนเปลี่ยน ไม่พิมพ์รหัสผ่านหรือ VAPID_PRIVATE_KEY ลงใน Log/แชต

## 2. ตั้ง Subdomain ใน DirectAdmin
1. ตรวจว่า `rd-connect.ratsada.ac.th` ถูกสร้างใน DirectAdmin และ DNS A/CNAME ชี้ไปยังบริการของโฮสต์ตามผู้ดูแล DNS ของโรงเรียน (Domain ratsada.ac.th ใช้ Cloudflare; ถ้าไม่มีสิทธิ์ Cloudflare ให้ผู้ดูแล DNS เพิ่มให้)
2. ติดตั้ง HTTPS SSL สำหรับ Subdomain ให้ทั้ง Cloudflare edge และเซิร์ฟเวอร์ต้นทางตรวจสอบถูกต้อง (แนะนำ Full (strict) หากใช้ Cloudflare proxy)
3. ใน Setup Node.js App เปลี่ยน Application URL ของแอป **เดิม** ให้ผูกกับ `rd-connect.ratsada.ac.th/` (หาก DirectAdmin ไม่รองรับแก้ URL ข้ามโดเมน ให้ผู้ดูแลโฮสต์ช่วยย้าย Passenger mapping ไม่ใช่สร้างฐานใหม่)
4. Application Root **คงเดิม** `/home/ratsadaa/rd-connect-school-app`, Startup File **คงเดิม** `app.js`, Node.js **24** และไฟล์ฐาน SQLite **คงเดิม**

## 3. อัปเดตโค้ดให้รองรับการติดตั้งที่ /
ใช้สาขา PR ที่มีการแก้ `school-hosting/server.cjs` สำหรับ root mount พร้อมชุดทดสอบใหม่ อย่าใช้ไฟล์ server.cjs เก่าที่ไม่รับ `RD_APP_MOUNT=/`.

DirectAdmin → Environment Variables เปลี่ยน **เพียงสองตัว**:
```ini
RD_PUBLIC_ORIGIN=https://rd-connect.ratsada.ac.th
RD_APP_MOUNT=/
```
ส่วน `RD_SQLITE_FILE` และ `RD_SQLITE_BACKUP_DIR` **ห้ามเปลี่ยนค่าจากไฟล์ฐานที่ใช้งานอยู่จริง**. เก็บ VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT เดิมไว้ อย่าสร้าง key ใหม่

เมื่อเปลี่ยนค่าครบแล้ว **Restart** Node App ใน DirectAdmin

## 4. ตรวจสอบหลังสลับ (ทำกับบัญชีที่ได้รับสิทธิ์)
- `https://rd-connect.ratsada.ac.th/` แสดง RD CONNECT ไม่ Redirect ไป `//`
- `https://rd-connect.ratsada.ac.th/api/health` ตอบ HTTP 200 + `ok:true`
- DevTools Network: `/api/auth/me` และ `/api/classrooms` = HTTP 200 หลังล็อกอิน; จำนวนห้อง 48 ห้อง และบัญชีเดิมไม่หาย
- ครูที่ปรึกษาคนที่ 1/2 เข้าเฉพาะห้องของตน; เช็กชื่อรายวัน/รายคาบ และคะแนนถูกต้อง
- ครูฝ่ายกิจการ, นักเรียน, ผู้ปกครองดูข้อมูลเฉพาะที่มีสิทธิ์
- `/api/late/qr/print` ให้ URL พิมพ์ QR ใหม่แบบ `https://rd-connect.ratsada.ac.th/?late_qr=gate`; เก็บ QR เก่าที่พิมพ์แล้วผ่านการ Redirect ที่ตรวจสอบแล้วเท่านั้น
- ติดตั้ง PWA ครู/นักเรียน/ผู้ปกครองบนโดเมนใหม่ และเปิดรับ Push อีกครั้งบนอุปกรณ์ทดลองทั้งสามประเภท

## 5. ข้อควรระวังเมื่อเปลี่ยน Origin
- **เซสชัน/LocalStorage/PWA/Push Subscription แยกตาม Origin**: ผู้ใช้จะต้องล็อกอินใหม่ ติดตั้งหรือเปิดแอปจาก URL ใหม่ และยืนยัน Push อีกครั้ง ชุดข้อมูลบัญชี/พฤติกรรมใน SQLite ยังเดิม
- อุปกรณ์ที่เคยสมัคร Push บนโดเมนเก่าอาจยังอยู่ในฐานข้อมูล แต่จะไม่ใช้ Service Worker ของ Origin ใหม่โดยอัตโนมัติ ต้องตรวจข้อมูลผู้รับ, Subscription ใหม่, VAPID เดิม และทดสอบรับจริงทุกบทบาทก่อนเปิด Cron Push
- **Cron Backup/Push** ต้องใช้ค่า Environment Variables ใหม่ ทั้ง `RD_PUBLIC_ORIGIN` และ `RD_APP_MOUNT` หาก Cron รับ Env แยกจาก Passenger; ควรหยุด Cron Push ระหว่างสลับแล้วตรวจ preflight และคิวค้างก่อนเปิด
- Redirect ลิงก์เดิมเป็น HTTPS 301/308 จาก `/web/rd-connect-fast/` ไป Subdomain ใหม่พร้อม query string (โดยเฉพาะ `?late_qr=gate`) เมื่อทดสอบเสร็จแล้ว ไม่ใช่ Redirect API เก่าทันทีระหว่างมีผู้ใช้งาน
- เมื่อพบปัญหาควร Rollback ค่า Application URL และ Env สองตัวกลับ แล้ว Restart โดยไม่ Restore DB ทับถ้าไม่มีปัญหาข้อมูล; เก็บ Backup ไว้

## 6. ห้ามทำ
- ห้ามเรียก `school:install`, `school:init`, `school:admin` ซ้ำ
- ห้ามสร้างฐาน SQLite ใหม่แล้วนำเข้าครู/นักเรียน 1,751 คนซ้ำ
- ห้ามใส่ไฟล์ `rd-connect.sqlite` ไว้ใน `public_html`
- ห้ามลบไฟล์ WAL/SHM ขณะที่แอปทำงาน
- ห้ามสรุปว่า Push พร้อมจากการเช็กหน้าเว็บเพียงอย่างเดียว

ถ้ามีหลาย Node App ต้องมีเพียงแอปที่ได้รับมอบหมายจริงตัวเดียวที่ใช้ฐานและ Cron ชุดนี้อยู่หลังสลับเสร็จ
