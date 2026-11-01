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

## ขั้นตอน 8.1: SQLite `NO ACTION` กับ MariaDB `RESTRICT`

ผลตรวจจากผู้ใช้ ณ 1 พ.ย. 2569 พบความสัมพันธ์ Foreign Key 119 รายการในทั้งสองฐาน
แต่สคริปต์เวอร์ชันแรกแสดง `MISSING_IN_MARIADB: 119` และ
`EXTRA_IN_MARIADB: 119` เพราะเทียบคำ `NO ACTION` กับ `RESTRICT` แบบตรงตัว

ตามคู่มือ MariaDB `NO ACTION` เป็นคำพ้องของ `RESTRICT` และตรวจในลักษณะ immediate.
ส่วน SQLite `NO ACTION` อาจต่างจาก `RESTRICT` หากมี deferred constraints
จึงอัปเดต `scripts/audit-mariadb-foreign-keys.py` ให้จัดกลุ่มคำพ้องระหว่าง
สองฐาน **โดยยังแสดงจำนวนความต่างของข้อความกฎดิบ** และตรวจแบบอนุรักษ์นิยม
ว่ามีตารางประกาศ `DEFERRABLE` อยู่หรือไม่

ใช้คำสั่งเดิมหลัง GitHub Desktop → Fetch origin → Pull origin:

```powershell
$backup = Get-ChildItem "H:\RD_CONNECT_BACKUP" -File -Filter "rd-connect-*.sqlite" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw "ไม่พบไฟล์สำรอง SQLite" }
py "H:\rd-care\rd-care\scripts\audit-mariadb-foreign-keys.py" $backup.FullName "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-foreign-keys.csv"
```

รายงานใหม่ระบุ `EXACT_ACTION_DIFFERENCES`, `NO_ACTION_RESTRICT_ALIASES`,
`SQLITE_TABLES_WITH_DEFERRABLE_CLAUSES`, `MISSING_IN_MARIADB`,
`EXTRA_IN_MARIADB` แยกกัน; 0 ในสองรายการหลังหมายถึงไม่มีความต่าง
ของตาราง/คอลัมน์/กฎที่ตรวจหลังปรับความหมายชื่อกฎเท่านั้น

แม้ผ่าน ยังไม่ได้พิสูจน์ว่ารัน `PRAGMA defer_foreign_keys=ON`
ระหว่างทำงานจริงหรือไม่ จึงต้องตรวจการเชื่อมต่อ/ธุรกรรมและทดสอบ
FK ภายในฐาน MariaDB สำรอง (ไม่ใช่ฐาน Live) ก่อน Import จริง

## ขั้นตอน 9: ตรวจ Generated UNIQUE Index 3 รายการจาก SQLite Backup

ผล FK ล่าสุด: SQLite 119 / MariaDB 119; NO ACTION/RESTRICT aliases 119;
SQLite DEFERRABLE declarations = 0; missing / extra relationships = 0.

หลัง GitHub Desktop → Fetch origin → Pull origin ให้ใช้ไฟล์เดิมทั้งหมด
โดยไม่ต้อง Export จาก phpMyAdmin ใหม่:

```powershell
$backup = Get-ChildItem "H:\RD_CONNECT_BACKUP" -File -Filter "rd-connect-*.sqlite" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw "ไม่พบไฟล์สำรอง SQLite" }
py "H:\rd-care\rd-care\scripts\audit-mariadb-generated-unique.py" $backup.FullName "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-columns-extended.csv" "H:\RD_CONNECT_BACKUP\mariadb-indexes.csv"
```

เครื่องมือนี้ตรวจคีย์อ้างอิงจาก SQLite ตามกฎที่คาดหมายสำหรับ 3 ดัชนี

- `students(live_classroom_id,live_roll_no)`: ตรวจ `(classroom_id,roll_no)`
  เฉพาะแถวที่ `deleted_at IS NULL`
- `student_enrollments(current_student_id)`: ตรวจ `student_id`
  เฉพาะแถวที่ `end_date IS NULL`
- `student_enrollments(current_classroom_id,current_roll_no)`:
  ตรวจ `(classroom_id,roll_no)` เฉพาะแถวที่ `end_date IS NULL`

รายงานจะแสดงจำนวนดัชนีที่ตรงตามกฎ/ดัชนีที่ไม่รู้จัก และจำนวนคีย์
ที่ซ้ำกัน; **ไม่แสดง student_id, roll_no, ชื่อหรือข้อมูลรายคน**

สิ่งสำคัญ: นี่คือการตรวจ **ค่าที่คาดว่าคอลัมน์ Generated จะสร้าง**
ไม่ใช่การพิสูจน์ว่า `GENERATION_EXPRESSION` จริงใน MariaDB ตรงกัน
ทุกประการ ต้องตรวจ SQL metadata เพิ่มก่อนตัดสินใจ Import:

```sql
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, EXTRA, GENERATION_EXPRESSION
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'ratsadaa_connect'
  AND LOWER(EXTRA) LIKE '%generated%'
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

เครื่องมือนี้ไม่มีคำสั่ง INSERT/ALTER/DROP และไม่ได้แตะ DB ที่โรงเรียน
ยังไม่รับรอง foreign key transactions, collation, check constraints, trigger
หรือการย้ายข้อมูลจำนวนมาก; ต้องจำลอง import ใน MariaDB แยกจาก Production ต่อไป

## ขั้นตอน 10: วางแผนนำเข้า MariaDB เฉพาะฐานทดสอบ (ยังไม่เขียนฐาน)

หลังตรวจ FK พบ SQLite 119 / MariaDB 119, กฎ `NO ACTION` และ `RESTRICT`
มีความหมายที่เทียบได้สำหรับ Foreign Key แบบ immediate และไม่มี
`DEFERRABLE` ประกาศในตาราง SQLite ทั้ง 63 ตารางที่ตรวจ

สร้างโปรแกรม `scripts/plan-mariadb-staging-import.py` เพื่อวางลำดับ
ตาราง Parent → Child ก่อน Import และตัด Migration Ledger
`school_schema_migrations`/`d1_migrations` ออก รวมถึง Generated Columns 5 ช่อง
เครื่องมือใช้รายงานโครงสร้างเดิม **โดยไม่อ่านข้อมูลนักเรียนและไม่เปิดฐานข้อมูล**

เปิด GitHub Desktop → Fetch origin → Pull origin แล้วรัน PowerShell:

```powershell
py "H:\rd-care\rd-care\scripts\plan-mariadb-staging-import.py" "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-columns-extended.csv" "H:\RD_CONNECT_BACKUP\mariadb-foreign-keys.csv"
```

ถ้าต้องการรายงาน JSON สำหรับนักพัฒนาในโฟลเดอร์ที่อยู่นอก GitHub:

```powershell
py "H:\rd-care\rd-care\scripts\plan-mariadb-staging-import.py" "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-columns-extended.csv" "H:\RD_CONNECT_BACKUP\mariadb-foreign-keys.csv" --report "H:\RD_CONNECT_BACKUP\mariadb-stage-plan.json"
```

รายงานมีเฉพาะชื่อตาราง ลำดับการนำเข้า คอลัมน์และจำนวนแถว
ไม่บันทึกชื่อบุคคล รหัสนักเรียน รหัสผ่าน หรือค่าในข้อมูลต้นฉบับ
จำนวนแถวที่คาดว่าจะนำเข้า: 17,435 (ไม่รวม Migration Ledger 46 แถว)

ตรวจ `TABLE_DEPENDENCY_CYCLES` และ `SELF_REFERENCING_TABLES`;
หากรายการใดไม่ใช่ 0 จะต้องออกแบบวิธีนำเข้าที่เคารพ FK ใหม่ก่อน
และยังต้องรอผล Generated UNIQUE 3 รายการ

สถานะ `IMPORT_AUTHORIZED: NO` เป็นค่าคงที่โดยตั้งใจ;
**ไม่มีความสามารถสั่ง INSERT/ALTER/DROP** และไม่ควรเปิด
`FOREIGN_KEY_CHECKS=0` เพื่อหลบความสัมพันธ์ที่ผิด

ก่อนพัฒนาส่วนเขียนลงฐานทดลองต้องตรวจว่าใช้ **ฐานทดลองที่แยกจริง**
จาก `ratsadaa_connect` และ DB SQLite ตัวจริง, มีสิทธิ์จำกัด
ตรวจ CHECK/Trigger/Collation, ทดลอง rollback แล้วจึงทดสอบนำเข้าข้อมูล

## ขั้นตอน 11: ยืนยันสูตร MariaDB Generated และเปรียบเทียบ CHECK/Triggers แบบอ่านอย่างเดียว

หลังขั้นตอน Generated UNIQUE และลำดับนำเข้าผ่าน:
`EXPECTED_INDEXES=3, MATCHED_INDEXES=3, EXACT_DUPLICATE_KEYS=0`,
`TABLES_TO_IMPORT=62, SOURCE_ROWS_TO_IMPORT=17435, TABLE_DEPENDENCY_CYCLES=0`

ใน phpMyAdmin ของฐาน `ratsadaa_connect` ใช้คำสั่ง SELECT ต่อไปนี้:

```sql
SELECT 'GENERATED' AS ITEM_TYPE, TABLE_NAME, COLUMN_NAME AS ITEM_NAME,
       GENERATION_EXPRESSION AS ITEM_VALUE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'ratsadaa_connect'
  AND LOWER(EXTRA) LIKE '%generated%'
UNION ALL
SELECT 'CHECK' AS ITEM_TYPE, TABLE_NAME, CONSTRAINT_NAME, CHECK_CLAUSE
FROM information_schema.CHECK_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'ratsadaa_connect'
UNION ALL
SELECT 'TRIGGER' AS ITEM_TYPE, EVENT_OBJECT_TABLE AS TABLE_NAME,
       TRIGGER_NAME AS ITEM_NAME,
       CONCAT(ACTION_TIMING, ' ', EVENT_MANIPULATION) AS ITEM_VALUE
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = 'ratsadaa_connect'
ORDER BY ITEM_TYPE, TABLE_NAME, ITEM_NAME;
```

Export เฉพาะผล SQL เป็น CSV แบบ comma, เปิด header row, dump all rows
และบันทึก `H:\RD_CONNECT_BACKUP\mariadb-constraints.csv`
รายงานนี้เป็น metadata เท่านั้น ไม่ใช่ข้อมูลบุคคลหรือข้อมูลบัญชี

GitHub Desktop → Fetch origin → Pull origin แล้ว PowerShell:

```powershell
$backup = Get-ChildItem "H:\RD_CONNECT_BACKUP" -File -Filter "rd-connect-*.sqlite" |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw "ไม่พบไฟล์สำรอง SQLite" }
py "H:\rd-care\rd-care\scripts\audit-mariadb-constraints.py" $backup.FullName "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-constraints.csv"
```

โปรแกรมตรวจ MariaDB Generation Expressions ให้ตรงกับกฎที่คาดหมาย
5 คอลัมน์ (เช่น `deleted_at IS NULL`, `end_date IS NULL`)
และรายงานจำนวน CHECK/Trigger ใน SQLite และ MariaDB

ข้อจำกัด: เปรียบเทียบรูปแบบ CASE WHEN ที่รู้จักเท่านั้น
หาก MariaDB ใช้รูปแบบนิพจน์อื่นที่สมมูลกัน จะไม่รายงานว่า MATCH
ก่อนตรวจด้วยผู้พัฒนา; CHECK count เป็นการนับ SQL syntax
ไม่ใช่การพิสูจน์ว่าความหมายเหมือนกัน และชื่อ Trigger ต่างกัน
ไม่ได้แปลว่าทำงานผิดเสมอ ต้องตรวจ body และทดสอบธุรกรรม

ถ้า `SQLITE_TRIGGER_COUNT > MARIADB_TRIGGER_COUNT` ต้องหยุดการเปิดใช้งาน
บน MariaDB จนกว่าจะมีการออกแบบและทดสอบ business rule ที่ขาดหายไป
ยังไม่มีคำสั่งเขียนลง MariaDB และห้ามใช้กับ SQLite Live

## ขั้นตอน 12: ยืนยันว่า MariaDB Staging ว่างทั้ง 63 ตารางด้วย COUNT(*) จริง

**ห้าม** อ้าง `information_schema.TABLES.TABLE_ROWS` เพราะ InnoDB อาจให้ค่าประมาณ
ก่อนเริ่มทดลอง import ต้องยืนยันฐาน `ratsadaa_connect` แยกจากเว็บ SQLite Live
และทุกตารางว่างจริงด้วยการนับข้อมูลตรง ๆ ไม่ต้องส่งข้อมูลนักเรียนออกไป

GitHub Desktop → Fetch origin → Pull origin และ PowerShell:

```powershell
py "H:\rd-care\rd-care\scripts\check-mariadb-staging-empty.py" "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" --generate-sql "H:\RD_CONNECT_BACKUP\mariadb-staging-counts.sql"
```

สคริปต์จะสร้างไฟล์ SELECT 63 ตารางเท่านั้นในที่เก็บ Backup นอก GitHub
เปิดไฟล์ `mariadb-staging-counts.sql` ด้วย Notepad คัดลอก SQL ทั้งหมดไปวาง
phpMyAdmin → ฐาน `ratsadaa_connect` → SQL แล้วกด Go
ที่ Query results operations เลือก Export CSV comma/ชื่อคอลัมน์เป็นแถวแรก
ส่งออกให้ได้ครบ 63 แถว บันทึกเป็น:

`H:\RD_CONNECT_BACKUP\mariadb-staging-counts.csv`

จากนั้นตรวจ CSV ด้วยคำสั่ง:

```powershell
py "H:\rd-care\rd-care\scripts\check-mariadb-staging-empty.py" "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" --verify-csv "H:\RD_CONNECT_BACKUP\mariadb-staging-counts.csv"
```

ผลที่คาดหมายสำหรับฐาน **ว่าง**:

```text
TABLES: 63
EMPTY_TABLES: 63
NON_EMPTY_TABLES: 0
TOTAL_TARGET_ROWS: 0
```

หากพบข้อมูลอยู่ ห้ามลบ/ล้าง/เขียนทับโดยอัตโนมัติ
ต้องแยกให้ได้ก่อนว่ารายการนั้นมาจากไหนและฐานนี้ถูกใช้งานหรือไม่
ไม่เรียก `school:init`, `school:install`, ไม่สั่ง TRUNCATE และไม่ปิด FK checks

ตัวตรวจนี้ไม่มีฟังก์ชัน Import; ต้องตรวจ Generated/CHECK/Triggers และ
ทดสอบการเชื่อมต่อ MariaDB ผ่านบัญชีทดลองสิทธิ์จำกัดก่อนดำเนินงานต่อ

## ขั้นตอน 12.1: แก้ STAGING EMPTY GATE BLOCKED: metadata_unreadable

จากการตรวจ 1 พฤศจิกายน 2569: ไฟล์ `mariadb-staging-counts.sql`
สร้างสำเร็จแล้ว แต่ผลตรวจ `--verify-csv` ยังไม่ผ่าน
ซึ่งไม่ใช่ข้อยืนยันว่าฐานมีข้อมูล สคริปต์เวอร์ชันใหม่แยกความผิดพลาดได้

ขั้นแรกให้ตรวจว่ามี CSV ผลการรัน SELECT อยู่จริงหรือไม่:

```powershell
Test-Path "H:\RD_CONNECT_BACKUP\mariadb-staging-counts.csv"
Get-Item "H:\RD_CONNECT_BACKUP\mariadb-staging-counts.csv" -ErrorAction SilentlyContinue | Select-Object Name,Length
```

ถ้าขึ้น False: ไฟล์ SQL ไม่ได้เป็น CSV ผลลัพธ์โดยอัตโนมัติ
ให้เปิด `H:\RD_CONNECT_BACKUP\mariadb-staging-counts.sql` ด้วย Notepad
คัดลอก SQL ทั้งหมด รันที่ phpMyAdmin → `ratsadaa_connect` → SQL → Go;
จากหน้า **ผลการค้นหา** เลือก Query results operations → Export → CSV
ตั้ง comma (ไม่ใช่ semicolon), Include column names in first row
และ Dump all rows ให้ได้ 63 แถว; บันทึกชื่อ CSV ที่ระบุข้างต้น

ถ้าขึ้น True: ตรวจว่าไม่เป็นไฟล์ 0 bytes และหัวคอลัมน์ต้องเป็น
`TABLE_NAME,ROW_COUNT` ไม่ใช่ SQL source, HTML, spreadsheet,
หรือข้อมูลที่ Export จากแท็บฐานข้อมูลแทน query results

หลัง Fetch/Pull อัปเดตสคริปต์แล้วรัน:

```powershell
py "H:\rd-care\rd-care\scripts\check-mariadb-staging-empty.py" "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" --verify-csv "H:\RD_CONNECT_BACKUP\mariadb-staging-counts.csv"
```

สคริปต์จะแยก `count_csv_missing`, `count_csv_empty`,
`count_csv_delimiter_should_be_comma`, `invalid_count_csv_header`,
`mariadb_count_tables_missing_or_extra`, `count_csv_encoding_not_utf8`
โดยไม่แสดงข้อมูลส่วนบุคคล

## ขั้นตอน 13: Trigger parity blocker

ข้อมูลล่าสุด: `GENERATED_MATCHED: 5`, CHECK count 101/101, SQLite triggers 10
แต่ MariaDB triggers 0; **ยัง NO-GO** แม้ฐานว่างและ import plan ถูกต้อง
อ่านรายละเอียดหน้าที่ Trigger ทั้ง 10 และแนวทางรักษาผลลัพธ์ใน
`docs/MARIADB-TRIGGER-PARITY_TH.md`

โดยเฉพาะ `behavior_incident_apply` เขียนกลับตารางต้นเหตุ; ไม่สามารถ
คัดลอกไป MariaDB trigger ตรง ๆ โดยไม่กระทบ Error 1442
ต้องทำ transactional backend พร้อมตรวจ concurrency / rollback / push
และทดสอบฐานจำลองก่อนย้ายข้อมูลจริง


## ขั้นตอน 12.2: จัดการ error `invalid_count_csv_header` (1 พฤศจิกายน 2569)

หาก Export ผลลัพธ์จาก phpMyAdmin โดยไม่ติ๊ก Include column names in first row
จะเป็น CSV ที่ **ไม่มี header**. สคริปต์ `check-mariadb-staging-empty.py` ล่าสุด
รองรับ CSV ทั้งแบบมี header `TABLE_NAME,ROW_COUNT` และแบบไม่มี header
เมื่อทุกชื่อรายการตรงกับ 63 ตารางที่ตรวจ และนับจำนวนเต็มไม่ติดลบเท่านั้น.
รองรับอักษรเล็กใน header ด้วย แต่ไม่รับไฟล์ SQL dump หรือไฟล์ข้อมูลอื่น.

หลัง GitHub Desktop → Fetch origin → Pull origin รัน:

```powershell
py "H:\\rd-care\\rd-care\\scripts\\check-mariadb-staging-empty.py" "H:\\RD_CONNECT_BACKUP\\sqlite-schema-summary.json" --verify-csv "H:\\RD_CONNECT_BACKUP\\mariadb-staging-counts.csv"
```

หากยัง `invalid_count_csv_header`: ตรวจสองบรรทัดแรกเท่านั้น (มีแต่ชื่อ table/count)

```powershell
Get-Content "H:\\RD_CONNECT_BACKUP\\mariadb-staging-counts.csv" -TotalCount 2
```

ควรได้บรรทัดแรก `TABLE_NAME,ROW_COUNT` แล้วตามด้วย `affairs_...,...`
หรือถ้าไม่มีหัวตาราง บรรทัดแรกต้องเป็นชื่อตารางที่มีอยู่จริงตาม SQL ผลลัพธ์.
ถ้าได้ `-- MariaDB dump` / `CREATE TABLE` / `INSERT INTO` หมายถึง Export ผิดเมนู;
ต้อง Export จาก **Query results operations** ไม่ใช่ Export ระดับ Database.
ถ้าเป็นไฟล์จาก Excel ต้องเลือก UTF-8 CSV comma delimiter และรักษาหัวคอลัมน์เดิม.

**ยังไม่ผ่าน Emptiness Gate และ Trigger parity NO-GO** จนกว่าจะได้ CSV ผล query ครบ 63 แถว.


## ขั้นตอน 14: ผลฐานว่างผ่าน และตรวจ CHECK รายเงื่อนไข (1 พ.ย. 2569)

รับผลจาก phpMyAdmin exact COUNT ของฐาน `ratsadaa_connect` แล้ว:

- `TABLES: 63`
- `EMPTY_TABLES: 63`
- `NON_EMPTY_TABLES: 0`
- `TOTAL_TARGET_ROWS: 0`

**นี่เป็นผลจากเวลาที่ตรวจเท่านั้น** ไม่ได้ยืนยันว่าฐานจะยังว่าง ณ เวลา Import หรือว่าฐานนี้แยกจากทุกบริการโดยสมบูรณ์ ต้องตรวจอีกครั้งก่อนมีการเขียนใด ๆ

จุดค้างสำคัญ: SQLite Triggers 10 / MariaDB Triggers 0
และ CHECK 101/101 เท่ากันเฉพาะ **จำนวน** ยังไม่ใช่ความเท่าเทียมของกฎ

เพิ่ม `scripts/audit-mariadb-check-parity.py` ให้ตรวจเงื่อนไข CHECK รายตาราง
โดยอ่าน SQLite Backup แบบ immutable, metadata CSV เดิม, ไม่เชื่อมต่อฐานใด
และไม่พิมพ์ค่าของแถวนักเรียน:

```powershell
$backup = Get-ChildItem "H:\RD_CONNECT_BACKUP" -File -Filter "rd-connect-*.sqlite" |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $backup) { throw "ไม่พบ SQLite Backup ที่ตรวจสอบแล้ว" }

py "H:\rd-care\rd-care\scripts\audit-mariadb-check-parity.py" $backup.FullName "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-constraints.csv"
```

คำสั่งนี้มี `PER_TABLE_COUNT_MISMATCHES`,
`EXACT_NORMALIZED_TEXT_MATCHES`, `UNMATCHED_SQLITE_CHECKS`
และ `UNMATCHED_MARIADB_CHECKS`.
**แม้ `EXACT_NORMALIZED_TEXT_MATCHES: 101` ก็ยังไม่พิสูจน์ semantics**
อาจต่างกันที่ collations, numeric coercion, NULL, SQLite GLOB และ MariaDB regexp
จึงต้องทดสอบพฤติกรรมด้วย synthetic data บนฐาน lab ที่แยกจริง

ขั้นถัดไปหลังได้ผล CHECK: วางแผน transactional MariaDB backend
รักษาพฤติกรรม Trigger ทั้ง 10 ตาม `docs/MARIADB-TRIGGER-PARITY_TH.md`,
สร้าง lab ไม่ผูกกับเว็บจริง, ทดสอบ rollback/concurrency/idempotency.
`IMPORT_AUTHORIZED: NO` / `CUTOVER_AUTHORIZED: NO` จนกว่าจะผ่านทั้งหมด
