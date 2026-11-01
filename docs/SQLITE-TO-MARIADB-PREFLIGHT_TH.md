# RD CONNECT — เตรียมย้าย SQLite → MariaDB (ตรวจสอบเท่านั้น)

เอกสารนี้ใช้กับ RD CONNECT บน `rd-connect.ratsada.ac.th` ที่ใช้งาน Node.js 24 + SQLite จริง
และ MariaDB ฐานทดลอง `ratsadaa_connect` บนโฮสติ้งโรงเรียน

**ห้าม** แก้ RD_SQLITE_FILE, เปลี่ยน API เป็น MariaDB, สั่ง `school:init`,
สั่ง `school:install`, นำเข้าข้อมูลผ่าน phpMyAdmin หรือเขียนทับ SQLite จริงในขั้นนี้

## ขั้นตอน 1: ดาวน์โหลด Backup ที่ระบบตรวจสอบผ่านลงเครื่อง

ใช้ WinSCP เปิด:
`/home/ratsadaa/rd-connect-backups/`

เลือกไฟล์ `rd-connect-2026-11-01T03-22-03-873Z-8904c1cdef.sqlite` หรือไฟล์
`rd-connect-YYYY-MM-DDT...sqlite` ล่าสุด **ที่มีบันทึก VERIFIED**.

สร้างโฟลเดอร์ใน Windows เช่น `H:\RD_CONNECT_BACKUP` แล้วดาวน์โหลดไฟล์
`.sqlite` ลงโฟลเดอร์นี้ **ห้ามวางในโฟลเดอร์ rd-care ที่ Sync กับ GitHub**.

ไม่ต้องดาวน์โหลด `rd-connect.sqlite` ซึ่งเป็นไฟล์ฐานข้อมูลที่เว็บไซต์กำลังใช้
ไม่ต้องส่งไฟล์ Backup/รหัสผ่าน/โทเคนเข้าแชตหรือ GitHub.

## ขั้นตอน 2: ดึงสคริปต์ตรวจสอบจาก GitHub

GitHub Desktop → `feature/school-root-subdomain` → `Fetch origin` → `Pull origin`.

ตัวอย่างที่เก็บไฟล์โปรเจกต์ `H:\rd-care\rd-care`:

```powershell
py "H:\rd-care\rd-care\scripts\sqlite-backup-inventory.py" "H:\RD_CONNECT_BACKUP\rd-connect-2026-11-01T03-22-03-873Z-8904c1cdef.sqlite"
```

สคริปต์ใช้ Python มาตรฐาน (ไม่ต้องติดตั้งแพ็กเกจเพิ่ม), อ่านจากไฟล์ Backup เท่านั้น
และตรวจ `PRAGMA integrity_check`, `PRAGMA foreign_key_check`,
นับทุกตาราง และดึง **เฉพาะ metadata โครงสร้างตาราง** โดยไม่อ่านข้อความ
ชื่อผู้ใช้ ชื่อนักเรียน รหัสผ่าน หรือเนื้อหาแถวจริงออกไปแสดง/ส่งเครือข่าย.

ผลตัวอย่าง (ตัวเลขจะขึ้นอยู่กับ Backup):

```text
RD CONNECT SQLITE BACKUP INVENTORY: READ ONLY
INTEGRITY: OK | FOREIGN KEYS: OK
TABLES: ...
TOTAL ROWS ACROSS ALL TABLES: ...
users: ...
students: ...
classrooms: ...
portal_accounts: ...
guardian_student_links: ...
SOURCE BACKUP UNCHANGED. NO NETWORK REQUESTS. NO MARIA DB WRITES.
```

สามารถส่ง **เฉพาะข้อความผลตรวจสอบ** กลับให้ผู้พัฒนา ไม่ต้องส่งไฟล์ `.sqlite`.

## ขั้นตอน 3: (ทางเลือก) เก็บรายงานโครงสร้างแบบไม่มีข้อมูลส่วนบุคคล

```powershell
py "H:\rd-care\rd-care\scripts\sqlite-backup-inventory.py" "H:\RD_CONNECT_BACKUP\rd-connect-2026-11-01T03-22-03-873Z-8904c1cdef.sqlite" --report "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json"
```

รายงานนี้มีเฉพาะชื่อตาราง ชื่อคอลัมน์ ชนิดคอลัมน์ Foreign Keys
และจำนวนแถวแต่ละตาราง **ไม่มีค่าในแถวของข้อมูลจริง**.
สามารถใช้เปรียบเทียบกับ MariaDB 63 ตาราง/119 FK ได้ในขั้นถัดไป
อย่าเผยแพร่รายงานหรือไฟล์ SQLite ใน GitHub แบบ public.

## ขอบเขต

1. SQL schema ต้นทางมาจาก SQLite + ledger การ migrations ของระบบที่ใช้งานจริง
2. MariaDB ปลายทางเคยตรวจได้ 63 ตาราง, 119 FKs, 0 Triggers และ core tables ว่าง
3. ข้อมูล `TABLE_ROWS` ของ InnoDB เป็นเพียงค่าประมาณ **ยังยืนยันไม่ได้ว่าทุกตารางว่างจริง**
4. สาขาเก่า `feature/school-direct-mariadb-release-candidate` มีเครื่องมือวางแผน D1 → MariaDB
   แต่ไม่ใช่ตัวนำเข้าข้อมูล SQLite จริงของเวอร์ชันนี้
5. ยังไม่ย้ายข้อมูลหรือเปลี่ยนเว็บจริง จนกว่าโครงสร้างตรงกัน, ตรวจข้อมูลทุกตาราง,
   ทดสอบ import/reconcile/rollback และผ่านการตรวจสิทธิ์/การเชื่อมต่อ
6. ข้อมูล SQLite อาจเปลี่ยนหลังช่วงเวลา Backup; การสลับระบบจริงต้องมี
   ช่วงหยุดการเขียนและ snapshot ล่าสุดอีกครั้ง
