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

## ขั้นตอน 4: เปรียบเทียบชื่อ 63 ตารางและคอลัมน์กับ MariaDB

เมื่อตรวจ SQLite ได้ `INTEGRITY: OK | FOREIGN KEYS: OK` ให้สร้างรายงานโครงสร้างจาก Backup
ด้วย PowerShell โดยปรับชื่อไฟล์สำรองให้ตรงกับไฟล์จริง:

```powershell
py "H:\rd-care\rd-care\scripts\sqlite-backup-inventory.py" "H:\RD_CONNECT_BACKUP\rd-connect-2026-11-01T03-22-03-873Z-8904c1cdef.sqlite" --report "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json"
```

ใน phpMyAdmin เลือก `ratsadaa_connect` → SQL แล้วรันคำสั่ง **อ่านอย่างเดียว**:

```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'ratsadaa_connect'
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

ที่ผลลัพธ์ เลือก Query results operations → Export → CSV (ใช้ comma เป็นตัวคั่น
และรวมบรรทัดหัวคอลัมน์ `TABLE_NAME,COLUMN_NAME,DATA_TYPE,IS_NULLABLE,EXTRA`).
บันทึกเป็น `H:\RD_CONNECT_BACKUP\mariadb-columns.csv`.
CSV นี้มีเฉพาะ metadata โครงสร้าง ไม่มีข้อมูลนักเรียน.

เปรียบเทียบโครงสร้างแบบออฟไลน์บนเครื่องคอมพิวเตอร์:

```powershell
py "H:\rd-care\rd-care\scripts\compare-mariadb-schema.py" "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-columns.csv"
```

- `TABLE/COLUMN NAMES: MATCH` หมายถึงชื่อตาราง/คอลัมน์ตรงกัน
- `MISMATCH` แสดงชื่อตาราง/คอลัมน์ที่ขาดหรือเกิน
- `SCHEMA CHECK BLOCKED` หมายถึงไฟล์ metadata ไม่ครบหรือ CSV ผิดรูปแบบ

**การที่ชื่อคอลัมน์ตรงกันยังไม่รับรองการย้ายข้อมูล** ต้องตรวจชนิดข้อมูล,
defaults, PK/FK, unique/indexes, triggers, ความสัมพันธ์, ค่ารหัสผ่าน,
ข้อกำหนด transactions และทดสอบนำเข้าฐานทดลองก่อนเปลี่ยนระบบจริง.

## ขั้นตอน 5: ตรวจข้อมูลวันที่และเวลา ก่อนนำเข้าจริง

หลังจากตารางและคอลัมน์ผ่าน read-only audit แล้ว ให้รันเครื่องมือตรวจ `TEXT → DATETIME`
**บนคอมพิวเตอร์เท่านั้น** จาก SQLite Backup ที่ได้ `INTEGRITY: OK` ไม่ใช่ SQLite ที่เว็บกำลังใช้งาน

เปิด GitHub Desktop → Fetch origin → Pull origin ก่อน แล้วรันคำสั่งต่อไปนี้ใน PowerShell:

```powershell
$backup = Get-ChildItem "H:\RD_CONNECT_BACKUP" -File -Filter "rd-connect-*.sqlite" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw "ไม่พบไฟล์สำรอง SQLite ชื่อมีวันที่ใน H:\RD_CONNECT_BACKUP" }
py "H:\rd-care\rd-care\scripts\audit-sqlite-datetime.py" $backup.FullName "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-columns.csv"
```

รายงานแสดงเฉพาะจำนวนแถว/รูปแบบ ไม่แสดงค่าต้นฉบับหรือข้อมูลรายคน:

- `DATE_COLUMNS_SCANNED`: คาดหมาย 75 คอลัมน์ตาม Audit ล่าสุด
- `NAIVE_SPACE`: รูปแบบ `YYYY-MM-DD HH:mm:ss` ไม่มีเครื่องหมายเขตเวลา
- `NAIVE_ISO_T`: รูปแบบ `YYYY-MM-DDTHH:mm:ss` ไม่มีเครื่องหมายเขตเวลา
- `UTC_Z`: ข้อมูลระบุ UTC (`Z`) ต้องมีนโยบายแปลงก่อน MariaDB DATETIME
- `OFFSET`: มีเขตเวลา `+07:00` หรืออื่น ๆ ต้องแปลงเป็นเวลาอ้างอิงเดียวกัน
- `FRACTIONAL`: มีทศนิยมวินาที ต้องดู `DATETIME_PRECISION` ของ MariaDB
- `INVALID`, `BLANK`, `OUT_OF_RANGE`: ค่าที่ต้องแก้ในแผนแปลงก่อน import
- `NULL_VIOLATION`: SQLite เป็น NULL แต่ MariaDB คอลัมน์บังคับ NOT NULL

แม้ผลตรวจเป็นศูนย์ทั้งหมด ก็ยังไม่อนุญาตให้นำเข้าจริงโดยอัตโนมัติ
ต้องทดสอบชนิด/ความยาวข้อมูล, FK/Unique, trigger และการกู้คืนบนฐานทดลองก่อน
อย่าส่ง SQLite Backup หรือไฟล์ข้อมูลส่วนบุคคลไปยัง GitHub หรือแชต

## ขั้นตอน 6: ตรวจความยาวข้อมูลจริง ความเป็น NULL และตัวเลขเกินช่วงรับได้

เมื่อรายงานวันที่เวลาผ่านแล้ว (75 คอลัมน์, INVALID=0, NULL_VIOLATION=0)
ให้ Export **metadata** คอลัมน์ MariaDB แบบขยายอีก 1 ไฟล์
จาก phpMyAdmin → ฐาน `ratsadaa_connect` → SQL:

```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, EXTRA,
       CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE, DATETIME_PRECISION
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'ratsadaa_connect'
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

ใต้ผล SQL เลือก Export CSV, comma separator, มีหัวคอลัมน์ในบรรทัดแรก,
เลือก **Dump all rows** (คาดว่า 456 แถว) แล้วบันทึก:

`H:\RD_CONNECT_BACKUP\mariadb-columns-extended.csv`

อัปเดต GitHub Desktop → Fetch origin → Pull origin

เปิด PowerShell (ใช้ Backup สำเนาเดิมที่มีชื่อวันที่ในชื่อไฟล์):

```powershell
$backup = Get-ChildItem "H:\RD_CONNECT_BACKUP" -File -Filter "rd-connect-*.sqlite" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw "ไม่พบไฟล์สำรอง SQLite" }
py "H:\rd-care\rd-care\scripts\audit-sqlite-mariadb-data-fit.py" $backup.FullName "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-columns-extended.csv"
```

ผลรายงานแสดงเฉพาะจำนวนและชื่อคอลัมน์ (ไม่แสดงค่า, ชื่อนักเรียน, username
หรือ hash ของบัญชี):

- `NOT_NULL` = ค่า NULL ที่ปลายทางไม่อนุญาต
- `LENGTH` = ข้อความ/ข้อมูลไบนารีมีขนาดเกินคอลัมน์ปลายทาง
- `RANGE` = ค่าจำนวนเต็มเกินช่วงของ integer ปลายทาง
- `TYPE` = ประเภทข้อมูลใน SQLite ไม่ตรงกับชนิดของ MariaDB
- `UNSUPPORTED_COLUMNS` = จำนวนช่องที่ยังไม่ได้รับการตรวจในสคริปต์นี้
  (เช่น DATETIME ที่ตรวจด้วยสคริปต์ก่อนหน้า) ไม่ใช่ข้อผิดพลาดโดยตรง

สคริปต์ตรวจทุกแถวของทุกตารางที่ชื่อเหมือนกันและเปรียบเทียบจำนวนแถวกับ
รายงาน SQLite เดิม; ตัด `school_schema_migrations` ออกจากรายการข้อมูล
และข้าม Generated Columns 5 ช่องของ MariaDB

**ยังไม่สั่งนำเข้าข้อมูลจริง** หลังผ่านขั้นนี้ต้องตรวจ Unique/Foreign Key,
Collation, CHECK, Generated Expressions และการจำลอง INSERT ใน MariaDB
บนฐานทดลองที่ไม่กระทบ Production ก่อนเปลี่ยนระบบ

## ขั้นตอน 7: ตรวจ MariaDB UNIQUE INDEX ชนกับข้อมูล SQLite หรือไม่

Export **เฉพาะ metadata ดัชนี** จาก phpMyAdmin → `ratsadaa_connect` → SQL:

```sql
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX,
       COLUMN_NAME, SUB_PART, INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'ratsadaa_connect'
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
```

ใต้ผล SQL เลือก **Export → CSV**, delimiter เป็น comma,
เปิดชื่อคอลัมน์บรรทัดแรก, Dump all rows แล้วบันทึกชื่อ
`H:\RD_CONNECT_BACKUP\mariadb-indexes.csv`.
ไฟล์นี้ไม่มีข้อมูลนักเรียนหรือรหัสผ่าน

GitHub Desktop → Fetch origin → Pull origin แล้วใช้ PowerShell:

```powershell
$backup = Get-ChildItem "H:\RD_CONNECT_BACKUP" -File -Filter "rd-connect-*.sqlite" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw "ไม่พบไฟล์ Backup SQLite" }
py "H:\rd-care\rd-care\scripts\audit-mariadb-unique-keys.py" $backup.FullName "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-columns-extended.csv" "H:\RD_CONNECT_BACKUP\mariadb-indexes.csv"
```

- `UNIQUE_CHECKED`: จำนวน Unique Index ที่ตรวจจากข้อมูล SQLite จริง
- `EXACT_DUPLICATE_GROUPS`: กลุ่มรายการที่ซ้ำตรงกัน
- `POTENTIAL_CASEFOLD_COLLISIONS`: รูปแบบอักษรต่างกัน แต่ casefold เหมือนกัน
- `UNIQUE_SKIPPED_GENERATED`: ดัชนีที่ประกอบด้วย Generated Columns
  ต้องตรวจอีกครั้งด้วย MySQL/MariaDB จริงในฐานทดลองแยก
- `UNIQUE_SKIPPED_PREFIX`: ดัชนี prefix ต้องตรวจความยาวและ prefix เพิ่ม

**ข้อจำกัด:** วิธี Python ไม่จำลองกฎ Collation ของ MariaDB ได้ครบ
โดยเฉพาะการเปรียบเทียบอักษรไทย, accent, accent folding และการ normalize;
ผลที่ไม่พบปัญหา **ไม่ได้แปลว่านำเข้าจะสำเร็จแน่นอน**
ยังต้องตรวจ Foreign Keys, generated expressions และ INSERT จริงในฐานทดลองแยก
ก่อนเปิดใช้ Production; ไม่ปิด foreign_key_checks เพื่อแก้ปัญหาข้อมูลผิด

## ขั้นตอน 8: ตรวจ Foreign Keys ทั้ง 62 ตารางก่อน Import

ผลของ UNIQUE INDEX ล่าสุด: ตรวจได้ 93/96 index,
ไม่มีค่าซ้ำตรงกันหรืออักษรต่างรูปแบบแต่ casefold ซ้ำ;
เหลือ Generated Unique Index 3 รายการที่ต้องตรวจเพิ่ม

Export เฉพาะ Foreign Key metadata จาก phpMyAdmin → ฐาน `ratsadaa_connect` → SQL:

```sql
SELECT
  k.TABLE_NAME,
  k.CONSTRAINT_NAME,
  k.ORDINAL_POSITION,
  k.COLUMN_NAME,
  k.REFERENCED_TABLE_NAME,
  k.REFERENCED_COLUMN_NAME,
  r.UPDATE_RULE,
  r.DELETE_RULE
FROM information_schema.KEY_COLUMN_USAGE AS k
JOIN information_schema.REFERENTIAL_CONSTRAINTS AS r
  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
 AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
 AND r.TABLE_NAME = k.TABLE_NAME
WHERE k.TABLE_SCHEMA = 'ratsadaa_connect'
  AND k.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION;
```

ใต้ผล SQL เลือก Export → CSV ให้มีหัวคอลัมน์และทุกแถว
บันทึกเป็น `H:\RD_CONNECT_BACKUP\mariadb-foreign-keys.csv`
CSV นี้เป็น metadata ของกฎฐานข้อมูล ไม่ใช่ข้อมูลส่วนตัว

GitHub Desktop → Fetch origin → Pull origin แล้วรัน:

```powershell
$backup = Get-ChildItem "H:\RD_CONNECT_BACKUP" -File -Filter "rd-connect-*.sqlite" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw "ไม่พบไฟล์ Backup SQLite" }
py "H:\rd-care\rd-care\scripts\audit-mariadb-foreign-keys.py" $backup.FullName "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-foreign-keys.csv"
```

เครื่องมือเปรียบเทียบ foreign key รายความสัมพันธ์ โดยไม่ใช้ชื่อ constraint เป็นเงื่อนไข
ตรวจลำดับคอลัมน์ คอลัมน์ที่อ้างอิง และ ON UPDATE/ON DELETE
หากพบข้อแตกต่างจะแสดงเฉพาะชื่อโครงสร้างและกฎ ไม่แสดงข้อมูลของนักเรียน
ข้อควรระวัง: source key ที่อ้าง primary key แบบ implicit จะถูกหยุดเพื่อตรวจด้วยมือ
รายงานสำเร็จไม่แทนการทดสอบ FK insert order, collation หรือ generated index

ตรวจนิพจน์และส่วนประกอบของ Generated UNIQUE INDEX อีก 3 รายการได้ด้วย SQL:

```sql
SELECT s.TABLE_NAME, s.INDEX_NAME, s.SEQ_IN_INDEX, s.COLUMN_NAME,
       c.EXTRA, c.GENERATION_EXPRESSION
FROM information_schema.STATISTICS AS s
LEFT JOIN information_schema.COLUMNS AS c
  ON c.TABLE_SCHEMA = s.TABLE_SCHEMA
 AND c.TABLE_NAME = s.TABLE_NAME
 AND c.COLUMN_NAME = s.COLUMN_NAME
WHERE s.TABLE_SCHEMA = 'ratsadaa_connect'
  AND s.NON_UNIQUE = 0
  AND EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS AS gs
    JOIN information_schema.COLUMNS AS gc
      ON gc.TABLE_SCHEMA = gs.TABLE_SCHEMA
     AND gc.TABLE_NAME = gs.TABLE_NAME
     AND gc.COLUMN_NAME = gs.COLUMN_NAME
    WHERE gs.TABLE_SCHEMA = s.TABLE_SCHEMA
      AND gs.TABLE_NAME = s.TABLE_NAME
      AND gs.INDEX_NAME = s.INDEX_NAME
      AND LOWER(gc.EXTRA) LIKE '%generated%'
  )
ORDER BY s.TABLE_NAME, s.INDEX_NAME, s.SEQ_IN_INDEX;
```

การดูนิพจน์เป็น metadata read-only; อย่า ALTER/DROP ดัชนีเพื่อให้ผ่าน
