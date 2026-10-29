# แผนย้าย RD CONNECT ทั้งระบบไป PHP + MySQL บนโฮสติ้งโรงเรียน

**สถานะ ณ 29 ตุลาคม 2569: วางแผนและเริ่มโครง PHP เท่านั้น — ยังไม่พร้อมเปิดใช้ข้อมูลนักเรียนจริง**

**ขอบเขต:** Production ทำงานบนโฮสติ้ง cPanel/DirectAdmin ของโรงเรียนทั้งหมด (เว็บ, PHP API, MySQL/MariaDB, คิวและงาน Cron สำหรับ Push) โดยไม่ต้องมี Cloudflare Worker หรือ D1 ใน Production. ระบบ Dev ที่ https://rd-care.pages.dev/ และ Worker `rd-care-api-dev` + D1 `rd-care-dev` ต้องคงสภาพเดิม **ไม่ย้าย ไม่ลบ ไม่เปลี่ยนค่า Config**.

## 1. ตรวจสอบสภาพโฮสติ้งจริงก่อนเขียนระบบหลังบ้าน

ให้ผู้ดูแลตรวจด้วย cPanel → Select PHP Version / PHP Extensions หรือ DirectAdmin → PHP Settings, MySQL Databases, Cron Jobs, SSL/TLS:
- **PHP 8.2+**, `pdo_mysql`, `openssl`, `json`, `mbstring`, `fileinfo`, `curl` และ `sodium` (ถ้ามี)
- **MySQL 8.0.16+ หรือ MariaDB รุ่นปัจจุบันที่รองรับ CHECK/JSON/Trigger/Foreign Key**; ควรใช้ InnoDB และ charset/collation ที่รองรับภาษาไทย `utf8mb4`. ต้องบันทึกเลขเวอร์ชันจริงก่อนแปลง SQL
- รองรับ `mod_rewrite` (หรือการตั้งค่า nginx ที่เทียบเท่า), HTTPS, Cron Jobs ระดับนาที, PHP memory_limit/ max_execution_time/ max_input_vars, จำกัดจำนวน MySQL connections และปริมาณพื้นที่
- สามารถวางไฟล์ PHP config/secrets **นอก** `public_html` ได้และตั้งค่า `RD_CONNECT_PRIVATE_DIR` อย่างปลอดภัย
- มีระบบ Backup แยกฐานข้อมูล MySQL และไฟล์เว็บ พร้อมทดสอบ Restore ได้จริง
- ใช้โดเมนย่อยแยก เช่น `care.<โดเมนโรงเรียน>/` หรือ path `/rd-connect/` ที่ตรึงให้แน่นอนก่อนติดตั้ง PWA และพิมพ์ QR ถาวร

**เงื่อนไขไม่ผ่าน:** ไม่มี PHP รุ่น/extension จำเป็น, ไม่มี HTTPS, ไม่มี Cron, วาง secrets นอก web root ไม่ได้, หรือ MySQL ไม่มี InnoDB/การกำหนดสิทธิ์ฐานข้อมูลที่เหมาะสม → **หยุด** และให้โฮสติ้งเปิดคุณสมบัติก่อน ห้ามฝืนเปิดให้เด็กใช้.

## 2. โครงใหม่ (แยก Dev โดยกายภาพ)

| ส่วน | Dev เดิม | Production ใหม่ |
|---|---|---|
| Frontend | `web/` บน Cloudflare Pages | PWA เดิมภายใน document root ของ cPanel/DirectAdmin |
| API | `worker/src/` และ Pages Function | `php-hosting/public/api/index.php` + ไฟล์ PHP ส่วนตัวนอก document root |
| Database | `rd-care-dev` D1 / SQLite | `rd_connect_prod` MySQL/MariaDB (สร้างใหม่ ไม่ใช้ฐานทดลอง) |
| Cron/Push | Worker Scheduled + VAPID | PHP CLI Cron + encrypted Web Push queue + VAPID Production keys |
| Login/Permission | Worker/SQLite | PHP PDO/MySQL พร้อม session/role checks ที่ตรวจสอบแล้ว |
| Deploy | GitHub main → Dev | GitHub branch/release ที่ทดสอบแล้ว → ZIP เฉพาะ Production; ไม่ auto-deploy ขณะ Port |

**สำคัญ:** อย่าใช้การ Merge code ไป `main` เพื่อเปิด API ที่แปลงไม่ครบ; อย่าชี้เว็บ Dev ไป PHP. โค้ด PHP อยู่ใน `php-hosting/` แยกต่างหาก, ไม่แก้ `worker/wrangler.toml`, ฐาน D1 หรือ PWA Dev config.

โครงสร้างเป้าหมาย:
```text
/home/CPANEL_USER/
├── public_html/rd-connect/
│   ├── index.html, app.js, config.js, sw.js, ...
│   └── api/
│       ├── index.php
│       └── .htaccess
└── rd-connect-private/
    ├── bootstrap.php
    ├── config.local.php          # ห้าม commit/เปิดผ่าน URL
    ├── src/                     # PHP Auth, Attendance, Behavior, Push ฯลฯ
    ├── migrations/              # MySQL schema revisions
    └── cli/                     # cron worker, backup verification
```
`web/config.js` **ในชุด Production เท่านั้น** ต้องกำหนด `API_BASE_URL` เป็น path ระดับเว็บ เช่น `/rd-connect` (เมื่อ PWA อยู่ใน `/rd-connect/`), เพราะหน้าเว็บเดิมเรียก `API_BASE_URL + '/api/...'`. ถ้าเว็บอยู่ที่ document root โดเมนตรง ๆ ให้ใช้ `''`. ต้องให้เว็บกับ PHP API เป็น **same-origin HTTPS** และไม่ต้องใช้ CORS ข้ามโดเมน. `functions/api/[[path]].js` เป็นของ Cloudflare Pages เท่านั้น ห้ามอัปโหลดมาใช้เป็น PHP API.

## 3. แปลงฐานข้อมูลให้รักษากติกาเดิมครบ

ณ วันจัดทำ Repository มีไฟล์ Migration D1/SQLite **46 ไฟล์** (`worker/migrations/0001...` ถึง `0046...`). ห้ามรัน SQL SQLite เหล่านี้กับ MySQL โดยตรงหรือแปลงทั้งหมดด้วยคำสั่งค้นหา-แทนที่เพียงครั้งเดียว.

ต้องจัดทำ **MySQL schema จากสภาพสุดท้ายของ D1** และทดสอบ Migration ด้วยฐานว่างก่อน มีทั้ง:
- `AUTOINCREMENT` → `AUTO_INCREMENT`, `INTEGER PRIMARY KEY`, `TEXT` PK / unique, collations `NOCASE`, `datetime('now')`, `strftime`, SQLite `ON CONFLICT`, `INSERT OR IGNORE`, `RETURNING`, partial index, `CHECK`, `TRIGGER` และ rebuild-table migrations
- ข้อมูลตาราง: ผู้ใช้/เซสชัน, ห้อง 48 ห้อง, นักเรียน/ทะเบียนและการย้ายห้อง, บัญชีนักเรียน+ผู้ปกครองและลิงก์, ตารางสอน/คาบ, เช็กชื่อรายวัน/รายคาบ, QR มาสาย, การแจ้งเตือน, พฤติกรรม/ความดี/ปรับพฤติกรรม, ประวัติ/ audit, งานนำเข้า
- D1 triggers สำหรับ **หนีเรียนรายคาบ**, การยกเลิก/คืนคะแนน, **ตักเตือนแยกรายการ** (เล็กน้อย 2 ครั้ง ปานกลาง 1 ครั้ง), หักคะแนนร้ายแรงโดยครูฝ่ายกิจการ, push outbox, การลบแบบเก็บประวัติ และการป้องกันข้อมูลซ้ำ ต้องเทียบผล MySQL แบบธุรกรรมจริง
- บังคับ `utf8mb4`, InnoDB, Foreign Keys, UNIQUE keys, transaction + rollback + isolation ตรวจพร้อมกันหลายครู; นโยบายวันที่ Asia/Bangkok แยกจากการเก็บเวลาที่มี timezone อย่างชัดเจน
- สร้าง `rd_schema_migrations` สำหรับติดตาม revision/checksum, ให้ migration ย้อนรันซ้ำไม่สร้างข้อมูลซ้ำ; **อย่ารัน SQL Dev โดยตรง**
- หากต้องย้ายข้อมูลจริงภายหลัง: ส่งออกแบบเข้ารหัส/เข้าถึงจำกัด, แปลง format ภายในระบบที่โรงเรียนอนุมัติ, ทดสอบจำนวนแถว/ยอดคะแนน/ประวัติ/Foreign Keys แล้วทำ Cutover แบบมีช่วงหยุดเขียนชัดเจน; **ไม่มีการเชื่อม Dev และ Production แบบอ่าน/เขียนร่วม**

`php-hosting/mysql/0000_schema_migrations.sql` เป็นเพียงตาราง metadata เพื่อเริ่ม Port ยัง **ไม่มี** Schema นักเรียนหรือบัญชี และห้ามเข้าใจว่า PHP/MySQL ใช้งานได้แล้ว.

## 4. ย้าย API ตามลำดับความเสี่ยง

| ระยะ | งาน | เงื่อนไขผ่านก่อนทำต่อ |
|---|---|---|
| P0: สำรวจ/เตรียม | เวอร์ชัน PHP/MySQL, SSL, DB quotas, Cron, เส้นทางไฟล์, แผน Backup | PHP ขึ้น, MySQL ต่อได้เฉพาะจาก private config, secrets ไม่อยู่ใน public |
| P1: Schema + ทดสอบ | Port โครงสร้างทั้งหมด + triggers/constraints, seed ห้องทดสอบ, เทียบกับ D1 | Table/Index/FK, นับคะแนน/ตักเตือนและแก้ไขการเช็กชื่อเทียบผลได้ |
| P2: Identity & Security | admin/staff/teacher, student, guardian, role+advisor mapping, session/remember, ล็อกอิน, reset, lockout | ไม่อ่านข้อมูลข้ามบทบาท/ห้อง, session หมดอายุ/เพิกถอนได้, audit ครบ |
| P3: Attendance | ห้องเรียน, เช็กชื่อรายวันและรายคาบ, ตารางสอน 1–10, รายงานครูที่ปรึกษา, QR มาสาย | กดพร้อมกันไม่ข้อมูลหาย, หนีเรียน/มาสายไม่แจ้งซ้ำ, ลบ/คืนค่าถูกต้อง |
| P4: Behavior & Merit | เกณฑ์ 4 ระดับ, เตือนก่อนหัก, บันทึกหลายคน, แก้รายการ, ปรับพฤติกรรม, ประวัติ | คะแนนแยกความดี, warning=0, ครูทั่วไปห้ามหักร้ายแรง, idempotency |
| P5: Push & Cron | สมัครรับ Push ทั้ง 3 บทบาท, VAPID Production, outbox, retry, สวิตช์แอดมิน 13 ประเภท | ส่งได้เฉพาะผู้มีสิทธิ์, ไม่ส่งซ้ำ, ปิดสวิตช์แล้วหยุด, Cron ไม่รันซ้อน |
| P6: Admin & Reports | นำเข้า CSV/Excel, ปีการศึกษา, สถิติห้อง/ระดับ, exports, users, audit, backup | ทดสอบนำเข้า ~1,800 คนเป็นชุด, duplicate = update ตามกติกา, Unicode ไทยถูกต้อง |
| P7: Pilot / Cutover | ทดสอบ 48 ห้อง, 3 บทบาท PWA, อุปกรณ์/OS, Load Test, Restore Drill, โรงเรียนอนุมัติ | ผ่าน acceptance ทุกโมดูล และมี rollback + ติดตามปัญหาได้จริง |

**ข้อควรระวังเรื่องบัญชี:** Worker Dev ปัจจุบันรองรับ PBKDF2 แบบประหยัด CPU สำหรับทดลอง (บางบัญชี iteration ต่ำกว่ามาตรฐานที่ควรใช้จริง). PHP Production ต้องสร้าง/ยืนยันรหัสผ่านด้วย `password_hash()/password_verify()` (Argon2id เมื่อโฮสต์รองรับ หรือวิธีมาตรฐานที่โฮสต์รองรับ) พร้อมนโยบายรหัสผ่านที่ปลอดภัย. ถ้าจำเป็นต้องย้ายบัญชีเดิม ให้รองรับการตรวจ hash เดิมเพื่อแปลงเฉพาะกรณีที่โรงเรียนอนุญาต และ **rehash เมื่อผู้ใช้ยืนยันตัวตนสำเร็จ** หรือบังคับตั้งรหัสใหม่; อย่าเก็บ password เป็น plaintext และอย่ารับส่งผ่านแชต.

## 5. Web Push บน PHP Shared Hosting

การย้ายโค้ดส่ง Push ต้องพัฒนาใหม่ด้วย PHP และงาน Cron (ไม่ใช้ Cloudflare Scheduled): คิวเหตุการณ์ → lock/claim ใน MySQL → สร้าง Web Push encrypted payload + VAPID → ส่ง HTTPS ตาม endpoint → บันทึก status/retry โดยไม่ log ข้อมูลนักเรียน. ต้องตรวจว่าโฮสต์มี outbound HTTPS/cURL, PHP extensions ที่จำเป็น, Cron Jobs และเวลา CPU เพียงพอ; อาจต้องใช้ Composer/ไลบรารี PHP Web Push ที่ผ่านการตรวจสอบ.

**หมายเหตุ:** แม้ Hosting/DB/Backend อยู่โรงเรียนทั้งหมด Web Push ยังผ่านผู้ให้บริการ Push ของ browser/OS (เช่น Apple/Google) ตามสถาปัตยกรรมมาตรฐาน; ไม่สามารถบังคับให้มือถือรับการแจ้งเตือนโดยไม่มีบริการเหล่านั้นได้. การเปลี่ยน origin เป็นโดเมนโรงเรียนทำให้ **ต้องสมัครรับ Push ใหม่บนโดเมนโรงเรียน** และติดตั้ง PWA ใหม่ (subscription ของ Pages Dev ไม่ย้ายตามอัตโนมัติ).

## 6. ยืนยันความเทียบเท่าด้วย Test Matrix

1. Identity: admin, Student Affairs (สอนด้วยได้), teacher (ครูที่ปรึกษาได้ 1–2 คนต่อห้อง), student, guardian, active/inactive, self-only access
2. Attendance: 48 ห้อง, ย้ายห้อง/ปีการศึกษา, เช็กชื่อย้อนหลังและตรงวัน, ร่วมกันหลายครู, automatic truancy, late QR หลัง 08:00, การแก้สถานะคืนคะแนน/แจ้งเตือนถูกต้อง
3. Conduct: เล็กน้อย 2 เตือน, ปานกลาง 1 เตือน, serious/very_serious หักตั้งแต่ครั้งแรกโดยครูฝ่ายกิจการเท่านั้น, warning ไม่หักคะแนน, ประวัติแยกคะแนนความดีและความผิด
4. Push: เปิดปิดได้ 13 ประเภทแยกนักเรียน/ผู้ปกครอง/ครู, กดสมัครรับจริงบน Android/iPhone, opt-in, retry, dedup, ไม่แสดงข้อมูลอ่อนไหวบนหน้าจอล็อก
5. Data: ~1,800 นักเรียน, 48 ห้อง, import ต่อระดับชั้น/ทั้งหมด, UTF-8 CSV, audit logs, total counts, สำรองและกู้คืนได้
6. Security: SQL Injection, XSS, CSRF (ถ้าใช้ Cookie), authz ทุก API, brute-force rate limit, token hashes, error response ไม่เปิดเผย server/database config, data export permission, backup encryption
7. Performance: shared hosting CPU/memory/DB connection caps, ตารางสอนพร้อมกัน, งาน Cron เบียดเวลาเรียน, ล็อก/Deadlock retry, pagination และอินเด็กซ์

## 7. ป้องกันผลกระทบ Dev และกำหนดจุด Cutover

- พัฒนาในสาขา **`plan/php-mysql-full-school-hosting`** และ `php-hosting/`; ไม่แก้/Deploy `worker/` หรือ `web/` บน `main` ระหว่างทำเอกสารและ Port
- การทดสอบเริ่มจากบัญชีและข้อมูล **จำลอง** ในฐาน MySQL ที่ต่างจาก Dev และข้อมูลจริง
- เมื่อทุกโมดูลผ่านและโรงเรียนอนุมัติ ให้กำหนดช่วงหยุดเขียน, สำรองข้อมูลต้นทาง/ปลายทาง, import ครั้งสุดท้าย, ตรวจจำนวน/ประวัติ/คะแนน, ปรับ DNS และแจก QR/PWA ใหม่
- หลัง Cutover ให้วัด error, login, throughput, cron queue; หากพบข้อผิดพลาดใช้ **Rollback กลับเว็บเดิมพร้อมแผนปรับยอดข้อมูลระหว่างช่วงเปลี่ยนผ่าน** ห้าม rollback ข้อมูลโดยละเลยการเปลี่ยนแปลงหลัง Cutover
- **ไม่ปิด Dev เดิม** เว้นแต่โรงเรียนตัดสินใจภายหลัง โดย Dev ต้องไม่รับบัญชี production/ข้อมูลจริงอีกหลังย้าย

## 8. สิ่งที่ทำแล้วและยังขาด

**ทำแล้ว:** โครง PHP entrypoint แบบ fail-closed (501/503), config ตัวอย่างที่ไม่เก็บ secrets, PDO MySQL แบบ prepared statements, MySQL migration bookkeeping, คู่มือแยกระบบ.

**ยังไม่ทำ:** แปลง 46 migrations เป็น MySQL ที่ทำงานเทียบเท่า, Login/Auth จริง, Attendance/Behavior/Portal/Push PHP, frontend production packaging, MySQL data migration, full integration test และการ Deploy บนเซิร์ฟเวอร์โรงเรียน.

**อย่านำ scaffold นี้ไปเปิดให้ครู/นักเรียนใช้งานจริง** การตอบ `migration_not_ready` เป็นพฤติกรรมที่ตั้งใจไว้จนกว่า Port และ Acceptance จะครบ.
