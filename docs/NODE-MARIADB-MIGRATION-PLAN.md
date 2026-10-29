# RD CONNECT — แผนย้าย Node.js 24 + MariaDB บน DirectAdmin โรงเรียน

**วันที่:** 29 ตุลาคม 2569

**สถานะ:** โครงเริ่มต้นสำหรับทดสอบเท่านั้น ยังไม่ใช่ระบบที่รับข้อมูลนักเรียนจริงได้ ระบบ Cloudflare Dev `rd-care.pages.dev`, Worker `rd-care-api-dev` และฐาน `rd-care-dev` ต้องไม่ถูกแตะต้อง

## 1. สิ่งที่ตรวจพบจริงจาก DirectAdmin

- เมนู **Setup Node.js App** ใช้งานได้และมีหน้า Create Application
- Node.js dropdown มี `22.23.2` และ **`24.20.0`** (รวมรุ่นเก่า)
- Runtime ใช้ CloudLinux Node.js Selector/Passenger; ต้องใช้ **CommonJS** เป็น Startup file ไม่ใช้ Cloudflare Worker ESM ตรง ๆ
- MariaDB `10.4.34-MariaDB-cll-lve` และ PHP 7.4 เว็บไซต์เดิม (PHP 8.5 เลือกได้ใน account selector แต่ยังไม่ควรเปลี่ยน)
- มีช่อง Application root, Application URL, Application startup file, mode และ environment variables
- **ยังไม่ยืนยัน**: สิทธิ์สร้าง Subdomain สำหรับทดสอบ, Cron Jobs, MySQL privileges/การเชื่อมต่อจาก Node, outbound HTTPS, npm install/terminal, Passenger resource limits, ความปลอดภัย/อัปเดตฐานข้อมูล

**อัปเดตด้านความปลอดภัย:** ณ ตุลาคม 2569 Node 24 เป็น LTS แต่ `24.20.0` ที่แสดงในโฮสต์ไม่ใช่แพตช์ใหม่ล่าสุดตามประกาศแก้ช่องโหว่ 21 ตุลาคม 2569 (ระบุ 24.22.1). ก่อนเปิดให้ใช้จริงให้ผู้ให้บริการอัปเดตเป็น **24.22.1 หรือใหม่กว่าภายในสาย 24.x**; ในขั้นต้นใช้ 24.20.0 ทดสอบได้โดยไม่มีข้อมูลจริง. MariaDB 10.4 สิ้นสุดการสนับสนุนปกติแล้ว จึงควรขออัปเกรดเป็น 10.11 LTS หรือรุ่น LTS ที่ผู้ให้บริการรองรับก่อนเก็บข้อมูลจริง

เอกสาร: https://github.com/nodejs/Release (ตาราง LTS), https://docs.cloudlinux.com/cloudlinuxos/cloudlinux_os_components/ (Passenger/CommonJS), https://github.com/nodejs/nodejs.org/blob/main/apps/site/pages/en/blog/vulnerability/october-2026-security-releases.md

## 2. สถาปัตยกรรมหลังย้ายครบ

```text
  care.ratsada.ac.th  (HTTPS + PWA)
          |
          v
 Node.js 24 + CommonJS Passenger startup
 API ตรวจสิทธิ์ / เช็กชื่อ / พฤติกรรม / รายงาน
          |
          v
 MariaDB ของโฮสติ้งโรงเรียน (ฐานใหม่ InnoDB + utf8mb4)
          |
          +-- Cron ส่ง Push และงานคิวจาก server
```

Cloudflare Workers/D1 ไม่จำเป็นต่อ Production เมื่อย้ายครบ (Web Push ยังใช้บริการ Push ของ browser/OS เป็นปกติ). **Frontend PWA เดิมนำกลับมาใช้ได้เป็นส่วนใหญ่** โดยกำหนดให้ API และหน้าเว็บอยู่ HTTPS **same-origin**. Node API ต้องตอบรูปแบบและสถานะ HTTP เดิมที่ `web/` ใช้ รวมถึงการจัดการสิทธิ์ทุกคำขอ.

Node.js ไม่สามารถใช้ D1 binding หรือ SQL SQLite แบบเดิมได้โดยตรง: ต้องแยก business rules ออกจาก cloud adapter และสร้าง MariaDB adapter ด้วย `mysql2`, MySQL transactions และ prepared statements.

## 3. ขั้นทดสอบ Node app บน DirectAdmin (ยังไม่ต้องเริ่มจนกว่าชุดไฟล์และสิทธิ์ครบ)

**แนะนำ Subdomain ทดสอบแยก** เช่น `care-test.ratsada.ac.th` แทนการติดตั้งทับเว็บไซต์ `ratsada.ac.th`. ต้องให้ผู้ดูแลโรงเรียนอนุมัติชื่อโดเมน/SSL ก่อน.

ตัวอย่างการกรอกหน้า Setup Node.js App:
- **Node.js version:** `24.20.0` สำหรับทดสอบ โดยขออัปเดต patch ก่อน Production
- **Application mode:** `Development` เฉพาะช่วงทดสอบ, เปลี่ยนเป็น Production เมื่อพร้อมใช้งานจริง
- **Application root:** `rd-connect-node-stage` (ภายใต้ home ของ account, **นอก public_html**)
- **Application URL:** เลือก `care-test.ratsada.ac.th` เมื่อเพิ่ม Subdomain แล้ว; ตั้ง path `/` ถ้าแอปครอบคลุม subdomain
- **Application startup file:** `app.js` (CommonJS; CloudLinux Passenger ไม่เริ่มไฟล์ ESM โดยตรง)
- **Environment:** ให้ระบบจัดการ `PORT` เอง; ห้ามใส่ secret จริงใน GitHub/แชต
- **Passenger log:** ใช้ตำแหน่ง Log ส่วนตัวที่โฮสติ้งอนุญาต

อัปโหลด **เฉพาะโฟลเดอร์ `node-hosting/`** ลง Application root ทดสอบ จากนั้นให้ Node selector ติดตั้ง Dependencies ตาม `package.json`, รีสตาร์ตแอปและลองเปิด:
- `GET https://care-test.ratsada.ac.th/api/health` ต้องได้ HTTP **503** พร้อม `migration_not_ready` — **เป็นพฤติกรรมที่ตั้งใจไว้**
- `POST /api/auth/login` ต้องได้ HTTP **501** พร้อม `endpoint_not_migrated`
- ยังไม่ต้องสร้างบัญชี/เชื่อมข้อมูลจริง

**ไม่ควรเพิ่มเว็บ PWA ที่ใช้งานจริง หรือสั่ง redirect เว็บไซต์หลักไป Node scaffold** ขณะที่ API ย้ายไม่ครบ.

## 4. แผนทำงานให้ระบบใหม่เทียบเท่า Dev

| ระยะ | งาน | เงื่อนไขผ่าน |
|---|---|---|
| 0 | ตรวจ Runtime/Passenger/Cron/outbound HTTPS/SSL/MySQL และทดสอบ Node app แยก | เรียก API สุขภาพทดสอบได้, Log ไม่เผย Secrets, เว็บไซต์หลักไม่เปลี่ยน |
| 1 | สร้าง MariaDB schema จากสถานะสุดท้ายของ **46 D1 migrations** | InnoDB, FK, indexes, unique, triggers, transaction และชุดข้อมูลจำลองผ่าน |
| 2 | Identity: Admin/Staff/Teacher, นักเรียน/ผู้ปกครอง, 2 ที่ปรึกษา/ห้อง, Student Affairs ครูผู้สอน | role-based authorization, hash passwords (Argon2id/scrypt หรือมาตรฐานปัจจุบัน), session, login throttling |
| 3 | Attendance: รายวัน/รายคาบ, timetable, late QR, แก้สถานะและหนีเรียนอัตโนมัติ | สถานะ/คะแนน/notifications ไม่ซ้ำ, concurrent writes ไม่สูญหาย |
| 4 | คะแนน: ความดี, ผิด 4 ระดับ, เตือนก่อนหัก, ปรับพฤติกรรม, เลือกวันที่, export/history | คะแนนไม่ปะปน, warnings ไม่หักคะแนน, UUID idempotency ทุกคำขอ |
| 5 | Push: 13 หมวด, subscriptions 3 บทบาท, Cron scheduler, VAPID ใหม่ | opt-in/ถอนสิทธิ์, delay/retry, ไม่ส่งข้อมูลส่วนตัวบน lock screen |
| 6 | CSV/Excel import ~1,800 คน, โรงเรียน 48 ห้อง, รายงาน, ปีการศึกษา, backup/restore | stress test ตามขนาดจริง, PHP เว็บไซต์เดิมไม่กระทบ |
| 7 | ทดลองใช้จริงแบบจำกัดข้อมูล/อุปกรณ์กับโรงเรียน, Security/Privacy/Load Review | โรงเรียนอนุมัติ, กู้คืนได้, log/monitoring เพียงพอ |

**D1 → MariaDB** ต้องแปลง `ON CONFLICT`, `INSERT OR IGNORE`, `PRAGMA`, `CURRENT_TIMESTAMP`, `CHECK`, partial indexes, auto-increment, date/time, triggers และ transaction semantics. ไม่สามารถย้ายด้วยการเปลี่ยน Connection string อย่างเดียว.

**Push บน shared hosting:** ต้องตรวจว่ามี Cron Jobs และ outbound HTTPS; Passenger process อาจถูกหยุดเมื่อไม่ใช้งาน **อย่าใช้ setInterval ใน Web App เป็นตัวส่ง Push หลัก**. ทำ Cron CLI แยก พร้อมตาราง outbox และ locking.

**รหัสผ่าน Dev:** เคยใช้ PBKDF2 iteration ต่ำสำหรับข้อจำกัด Cloudflare Workers Free; ก่อน Production ต้องอัปเกรดการจัดเก็บรหัสผ่านและวางแผน rehash/reset สำหรับบัญชีใหม่ ห้ามย้าย plaintext password.

## 5. ขอบเขตโค้ดตอนนี้

- `node-hosting/app.js` เป็น Passenger CommonJS startup (ฟัง port ที่ hosting ให้มา)
- `src/http-handler.cjs` ตอบ `503 migration_not_ready` หรือ `501 endpoint_not_migrated`; **ไม่ได้สร้างข้อมูลหรือแอบส่งไป Dev**
- `src/database.cjs` เตรียม pool ด้วย `mysql2/promise` 4 connections, MariaDB UTF-8, ปิด multiStatements; **ยังไม่ได้เรียกต่อฐาน**
- `.env.example` เป็นแค่ชื่อ environment variables; ไม่ใช่ password จริง
- `mysql/0000_migration_ledger.sql` เป็นตารางติดตาม migration เท่านั้น, ยังไม่มีตารางนักเรียน
- `tests/node-hosting-scaffold.test.mjs` ตรวจ CommonJS/ความปลอดภัยและ fail-closed

**ห้าม Deploy Production หรือ Merge แล้วชี้ PWA ไปโครงนี้ก่อนระบบครบ**. โครงการ PHP/MySQL ใน PR #66 และโครงการ cPanel+Cloudflare Worker ใน PR #65 เป็นทางเลือกเก่าที่ยังไม่ถูกนำขึ้นเซิร์ฟเวอร์; Node/MariaDB คือแนวทางใหม่สำหรับการตรวจสอบต่อ.

## 6. สิ่งที่ต้องทราบก่อนเปิดจริง

- ผู้ให้บริการรองรับ Node 24.22.1+ และ MariaDB LTS รุ่นใหม่หรือมีแพตช์ extended support หรือไม่
- ลิมิต RAM/CPU/Passenger processes/MySQL connections ใน CloudLinux LVE และการรัน Cron ทุก 1–5 นาที
- เส้นทาง home และสิทธิ์ SSH/Terminal/npm install, อนุญาตสร้าง Subdomain ทดลองและ SSL
- ผู้ดูแลโรงเรียนอนุมัติการประมวลผลข้อมูลนักเรียนและการแจ้งเตือน Push ตามนโยบายส่วนบุคคลหรือไม่

**คำแนะนำ:** ทดสอบ CommonJS app ก่อน → พัฒนา MySQL Schema แล้ว Authentication → เช็กชื่อและคะแนน → Push/รายงาน → ทดลอง 48 ห้อง → เปิดจริง. ระหว่างนี้ Dev เดิมยังทำงานตามปกติ
