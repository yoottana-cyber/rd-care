# ติดตั้ง RD CONNECT บนเว็บเซิร์ฟเวอร์โรงเรียน — แบบเร็วที่สุด

รุ่นนี้ **ใช้หน้าเว็บเดิม + API เดิมทั้งหมด** บน Node.js 24 ของโรงเรียน
และฐานข้อมูล **SQLite เก็บเป็นไฟล์ในเซิร์ฟเวอร์โรงเรียน** (ไม่ใช่ MariaDB/D1).
ไม่ต้องแปลง API 28 ตัว ไม่ต้องใช้บัญชี Cloudflare สำหรับติดตั้งใหม่
และไม่ย้ายข้อมูลจาก D1 อัตโนมัติ

> ใช้กับแอปทดสอบใหม่ก่อน อย่าทับเว็บไซต์เดิมหรือฐานข้อมูลเดิม
> และยังไม่เปิดข้อมูลนักเรียนจริงก่อนผลทดสอบการใช้งานและสิทธิ์ผ่าน

## 1. เตรียมโฟลเดอร์และ Node App

ดาวน์โหลด ZIP ของสาขา
`feature/school-direct-node-sqlite` จาก GitHub แล้วแตกไฟล์
**ทั้ง repository** ไปไว้ใน Application Root ใหม่ เช่น

`/home/ratsadaa/rd-connect-school-app/`

ให้มีไฟล์ `app.js`, `package.json`, โฟลเดอร์
`web/`, `worker/` และ `school-hosting/`
อยู่ในโฟลเดอร์หลักเดียวกัน

ใน DirectAdmin → Setup Node.js App สร้างแอปทดสอบแยก:

- Node.js: 24.x (ที่โฮสต์มี 24.20.0)
- Application Root: ตำแหน่งที่แตกไฟล์ข้างต้น
- Application URL: `https://ratsada.ac.th/web/rd-connect-fast/`
- Application Startup File: `app.js`

สร้างโฟลเดอร์ **นอก public_html** สองโฟลเดอร์:

`/home/ratsadaa/rd-connect-private/`

`/home/ratsadaa/rd-connect-backups/`

ตั้งสิทธิ์โฟลเดอร์ 0700 (เข้าได้เฉพาะเจ้าของบัญชี)

## 2. เพิ่ม Environment Variables

รายการต่อไปเป็นค่าตัวอย่างอ้างอิงจากชื่อบัญชี/URL ที่มีอยู่
หาก Application Root หรือชื่อโดเมนจริงต่างกัน ให้ใช้ค่าจริงของโฮสต์

| Name | Value |
|---|---|
| `RD_PUBLIC_ORIGIN` | `https://ratsada.ac.th` |
| `RD_APP_MOUNT` | `/web/rd-connect-fast` |
| `RD_SQLITE_FILE` | `/home/ratsadaa/rd-connect-private/rd-connect.sqlite` |
| `RD_SQLITE_BACKUP_DIR` | `/home/ratsadaa/rd-connect-backups` |
| `RD_SCHOOL_INIT_CONFIRM` | `INITIALIZE_PRIVATE_SCHOOL_SQLITE` |
| `RD_SCHOOL_ADMIN_CONFIRM` | `CREATE_FIRST_SCHOOL_ADMIN` |
| `RD_SETUP_USERNAME` | ชื่อผู้ดูแลคนแรก (อักษรอังกฤษเล็ก 3–40 ตัว) |
| `RD_SETUP_DISPLAY_NAME` | ชื่อผู้ดูแลสำหรับแสดงผล |
| `RD_SETUP_PASSWORD` | รหัสผ่านใหม่ยาวอย่างน้อย 12 ตัว |

**อย่าส่งรหัสผ่านหรือข้อมูลนักเรียนในแชต หรือเพิ่มลง GitHub**

## 3. ติดตั้งด้วยคำสั่งเดียว

DirectAdmin → Setup Node.js App → Run JS Script เลือก

```text
school:install
```

สคริปต์จะดำเนินการให้ครบสี่ขั้นตอนโดยอัตโนมัติ:
1. รันชุดทดสอบ API เดิมและ Schema บนข้อมูลจำลอง
2. ติดตั้ง Migration เดิม **46 ไฟล์** และรายชื่อห้อง **48 ห้อง**
3. สร้างผู้ดูแลระบบคนแรกในฐานข้อมูลของโรงเรียนแบบออฟไลน์
4. สำรอง SQLite ครั้งแรกและตรวจความถูกต้อง

ต้องได้ `returncode: 0` เช่น

```text
[1/4] ORIGINAL WORKER + PWA TESTS: OK.
[2/4] SCHOOL SQLITE: 46 ORIGINAL MIGRATIONS + 48 CLASSROOMS OK.
[3/4] INITIAL ADMIN: CREATED LOCALLY, WEB SETUP DISABLED.
[4/4] FIRST PRIVATE SQLITE BACKUP: VERIFIED.
SCHOOL PACKAGE INSTALLED: restart Passenger and test school URL with limited staff.
NO REAL STUDENTS IMPORTED; NO CLOUDFLARE D1 OR MARIADB MODIFIED.
```

ถ้าได้ `returncode: 1` **หยุด ไม่ลบ/สร้างฐานซ้ำ**
ตรวจสภาพโฟลเดอร์และทดสอบ `school:test` แบบแยก
ก่อนแก้ปัญหา ระบบไม่ใช่ฐาน MariaDB และไม่แตะฐานเดิม

## 4. หลังติดตั้ง

ลบ Environment Variables ชั่วคราว **ทั้ง 5 ตัว** ทันที:

- `RD_SCHOOL_INIT_CONFIRM`
- `RD_SCHOOL_ADMIN_CONFIRM`
- `RD_SETUP_USERNAME`
- `RD_SETUP_DISPLAY_NAME`
- `RD_SETUP_PASSWORD`

คงไว้เฉพาะ `RD_PUBLIC_ORIGIN`, `RD_APP_MOUNT`,
`RD_SQLITE_FILE`, `RD_SQLITE_BACKUP_DIR`

กด **Restart** แอป Node.js ใน DirectAdmin แล้วเปิด
`https://ratsada.ac.th/web/rd-connect-fast/`

สุขภาพ API:
`https://ratsada.ac.th/web/rd-connect-fast/api/health`

ล็อกอินด้วยแอดมินที่สร้างใหม่ ตรวจว่าขึ้นห้องเรียน 48 ห้อง
และใช้ไฟล์ตัวอย่างนำเข้าครู/นักเรียน/ผู้ปกครองจากหน้า Admin
**หลังผ่านการตรวจสิทธิ์ผู้ใช้และการคุ้มครองข้อมูลนักเรียน**

## 5. ก่อนใช้ทั้งโรงเรียน

ตรวจอย่างน้อยการล็อกอินครู/นักเรียน/ผู้ปกครอง สิทธิ์ดูข้อมูลเด็ก,
การเช็กชื่อรายวัน/รายคาบ, กฎคะแนนพฤติกรรมและการแก้ย้อนหลัง,
QR มาสาย, Push, โหลดพร้อมกันหลายห้อง, และทดสอบกู้คืนจาก Backup
บนฐานสำเนาเท่านั้น จัดกำหนดการสำรองข้อมูลประจำวัน

หลังผ่านการทดสอบ จึงย้าย Application URL เป็น
`/web/rd-connect/` และแก้ `RD_APP_MOUNT=/web/rd-connect`
พร้อมกัน โดยไม่ลบระบบเดิมก่อนยืนยันระบบใหม่สมบูรณ์

โปรดอ่าน [README.md](README.md) สำหรับเงื่อนไข WAL, Backup,
Cron, ความปลอดภัยและข้อจำกัดของ Node SQLite
