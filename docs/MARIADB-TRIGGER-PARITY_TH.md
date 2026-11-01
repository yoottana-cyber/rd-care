# RD CONNECT — แผนรักษากฎ Trigger จาก SQLite ไป MariaDB (NO-GO)
 
วันที่ตรวจ: 1 พฤศจิกายน 2569, ไฟล์สำรอง SQLite ที่ผ่าน integrity / FK checks เท่านั้น

**ข้อเท็จจริงยืนยันจาก audit ผู้ใช้**
- Generated Columns: 5/5 ผ่านการเทียบสูตรที่รู้จัก
- SQLite CHECK: 101, MariaDB CHECK: 101 **จำนวนเท่ากัน ไม่ใช่การยืนยันความหมาย**
- SQLite Triggers: 10, MariaDB Triggers: 0
- SQLite FK: 119, MariaDB FK: 119 (เปรียบเทียบ NO ACTION/RESTRICT แบบ immediate)
- ตารางที่จะย้าย: 62, แถว: 17,435 (ไม่รวม migration ledger 46 แถว)
- Generated UNIQUE: 3/3, duplicate 0 ตามกฎที่ทดสอบจาก backup

**สถานะ: NO-GO สำหรับ Import + Cutover** จนกว่าจะมี implementation และทดสอบทุก business rule; ห้ามเชื่อว่าการตรวจจำนวนแถวเท่ากันหมายถึงระบบใช้งานได้

## รายการสัญญาพฤติกรรมทั้งหมด (10 Triggers)

| SQLite Trigger | พฤติกรรมที่ต้องรักษาไว้ | แนวทางบน MariaDB/Node | การทดสอบที่ต้องผ่าน |
|---|---|---|---|
| guardian_student_links.guardian_link_role_guard | ปฏิเสธผูกบัญชีที่ไม่ได้เป็น guardian | DB guard ที่ปลอด race และตรวจซ้ำใน backend | บัญชี student/role ถูกเปลี่ยนกลางธุรกรรมต้องถูกปฏิเสธ |
| timetable.timetable_clash_insert | ห้าม active timetable ชนห้อง/ครูและช่วงคาบ | DB transaction พร้อม lock/serialized key + validator | สองคำขอพร้อมกันของครู/ห้องเดียวกันต้องไม่หลุด |
| timetable.timetable_clash_update | ห้ามการแก้ไข/เปิดใช้งานตารางแล้วชน | เช่นเดียวกับ insert และตัด exclude id เดิม | สลับ active, end_period, ห้อง, ครูพร้อมกัน |
| period_truancy.truancy_auto_score_on_insert | เริ่ม incident หนีเรียนตามระดับตักเตือน/หักคะแนน ผูกกับคาบ และคืนประวัติที่เคยแก้ | Backend transaction สำหรับ period, incident, behavior record, link, audit | หนีเรียนครั้งแรก / เตือน / หัก / ย้อนแก้ / ทำซ้ำ ต้อง idempotent |
| period_truancy.truancy_auto_score_on_delete | เมื่อแก้จากหนีเรียน ยกเลิกคะแนนและ incident แบบ soft delete พร้อม audit | Backend transaction เดียวกับแก้สถานะการเข้าเรียน | ประวัติไม่หายและไม่เพิ่มคะแนนซ้ำ |
| behavior_incidents.behavior_incident_apply | คะแนนจริงต้องได้ behavior_records + link `behavior_record_id`; บันทึก audit | **ต้องทำใน backend transaction**; SQLite trigger เขียนกลับตารางต้นเหตุ ไม่สามารถคัดลอกเป็น MariaDB trigger ตรง ๆ ได้ | คำขอซ้ำ/ผิดพลาดกลางรายการ rollback ทั้งชุด |
| behavior_records.behavior_incident_record_deleted | soft delete คะแนนสะท้อนถึง incident | Backend transaction/พิจารณา DB trigger เฉพาะที่ไม่ชนข้อจำกัด | ประวัติเดิมคงอยู่, ยอดปัจจุบันไม่นับ |
| behavior_records.behavior_incident_record_restored | คืนคะแนนแล้วคืน incident เดิม | Backend transaction/พิจารณา DB trigger เฉพาะที่ไม่ชนข้อจำกัด | คืนได้หนึ่งรายการ ไม่สร้าง incident ใหม่ |
| behavior_incidents.behavior_score_notification_on_deduction | enqueue เหตุการณ์แจ้งเตือนเฉพาะคะแนนติดลบจริง | Outbox idempotent ใน transaction เดียวกับ record | Push ไม่ซ้ำ, ไม่แจ้งเตือนคะแนนที่ยกเลิก |
| behavior_incidents.behavior_warning_notification_on_insert | enqueue เฉพาะ warning ที่มีสิทธิ์แจ้งเตือน (minor/moderate), คะแนนจริงเป็นศูนย์ | Outbox idempotent + admin notification preferences | แยกเตือน/หัก, เคารพการตั้งค่าและผู้รับ |

แนวทางข้างต้นเป็น **แผน** ยังไม่ได้ทำพอร์ต/ย้าย Trigger จริงไป MariaDB

## ข้อจำกัด MariaDB ที่ต้องแก้

1. MariaDB ห้าม Trigger/Stored Function เขียนกลับไปยังตารางที่กำลังถูกคำสั่งต้นเหตุใช้ (Error 1442): `behavior_incident_apply` มี `UPDATE behavior_incidents` หลัง `INSERT INTO behavior_incidents`. ต้องเปลี่ยนเป็น Node/MariaDB transaction ที่สร้าง incident + behavior record + update link + audit ไม่ใช่ copy SQL เดิม
2. SQLite syntax `RAISE(ABORT)`, `INSERT OR IGNORE`, `last_insert_rowid()`, `||`, `WHEN NEW...` ต้องออกแบบใหม่โดยคำนึงถึง MariaDB 10.4. **ห้าม** แปลงข้อความแบบ replace แล้ว deploy
3. Trigger `truancy_auto_score_on_insert` อาจทำให้เพิ่ม incident/score ซ้ำระหว่าง Import ประวัติเก่า หากนำเข้าข้อมูลผ่านตารางแล้วมี Trigger เปิดใช้อยู่ ต้องออกแบบขั้นตอน Import บนฐานทดลองโดยหลีกเลี่ยง side effect ที่จะสร้างคะแนนหรือ push ซ้ำ และต้องตรวจ reconciliation
4. `timetable_clash_*` และ `guardian_link_role_guard` ต้องตรวจความปลอดภัยต่อ concurrent writes: แค่ `SELECT EXISTS` แล้ว `INSERT` คนละ transaction ไม่เพียงพอ
5. CHECK 101 รายการต้องตรวจค่ากฎและชนิดการบังคับใช้ MariaDB จริง ไม่ใช่แค่จำนวนตรงกัน
6. Transaction boundaries, idempotency, FK checks, retry, unique indexes, timestamps, push outbox และสิทธิ์ผู้ใช้ ต้องพิสูจน์ด้วย test ใน staging โดย **ไม่แตะ SQLite ตัวจริง**

## ลำดับการพัฒนาที่ปลอดภัย

- ตรวจ read-only ให้ผ่าน: 63 ตาราง MariaDB ว่างจริง, Generated Expressions 5 ช่อง, FK/UNIQUE, CHECK expressions, Collation/Charset
- สร้าง MariaDB `ratsadaa_connect_lab` ที่ **แยกจาก** `ratsadaa_connect` และไม่ได้ต่อกับเว็บจริง; ใช้ข้อมูลจำลองก่อน, มีสิทธิ์จำกัด, ไม่เผยรหัสผ่าน
- พัฒนา Node.js MariaDB adapter และ transactional domain operations (behavior, truancy, guardian, timetable, notification), test rollback/concurrency โดยไม่มีบัญชี/ประวัตินักเรียนจริง
- เมื่อ behavior parity ผ่าน จึงออกแบบ Import จาก SQLite snapshot ลง lab พร้อมรักษา IDs, links, migration bookkeeping, session policy และ reconcile counts/checksum เฉพาะระบบที่โรงเรียนควบคุม
- Deploy ตัวทดสอบที่ปิด public login, ทดสอบครู/นักเรียน/ผู้ปกครอง/กิจการ/Push/QR, ตัดสิน GO/NO-GO และแผนย้อนกลับ ก่อนมีหน้าต่าง cutover

**ห้าม** เปลี่ยน RD_SQLITE_FILE, เปลี่ยน live API, ใช้ `school:init`/`school:install`, ล้างตาราง `ratsadaa_connect`, ปิด `FOREIGN_KEY_CHECKS` เพื่อผ่านข้อผิดพลาด, หรือ Import ประวัติโดยตรงในขั้นนี้

เอกสาร MariaDB: Trigger limitations Error 1442, trigger ordering `ACTION_ORDER`, trigger events/side effects; และ FK `NO ACTION` ≈ `RESTRICT` ใน immediate enforcement.

## ความคืบหน้า 1 พฤศจิกายน 2569 — 22/22 REGEXP PASS และ Conduct Contract

phpMyAdmin แสดง SELECT synthetic tests 22 แถว สำหรับ 2 กฎวันที่/เวลา
ทุกแถว RESULT=PASS (SQLITE_EXPECTED ตรงกับ MARIADB_ACTUAL).
ไม่รับรอง CHECK 101 กฎเทียบเท่าทั้งหมด และไม่ได้ทดสอบ INSERT/UPDATE.

เพิ่มโมดูล pure (ไม่มี DB driver, network หรือไฟล์ และไม่ผูก live backend):
- school-hosting/mariadb-parity/conduct-contract.cjs
- school-hosting/test/mariadb-conduct-parity.test.cjs

สัญญาพฤติกรรมที่โค้ดและ synthetic tests ตรวจ:
- minor: เตือน 2 ครั้ง, หักตั้งแต่ครั้งที่ 3
- moderate: เตือน 1 ครั้ง, หักตั้งแต่ครั้งที่ 2
- serious / very_serious: หักครั้งแรก และต้องเป็นครูฝ่ายกิจการ/แอดมิน
- good: เก็บบวกแยกจากหนี้พฤติกรรม
- receipt ขอซ้ำ: ต้องไม่สร้าง incident/score/push ซ้ำ
- push: warning และ deduction เป็นคนละ event, dispatch หลัง COMMIT เท่านั้น
- truancy: ผูกกับรายคาบ, soft delete เมื่อแก้, restore ID เดิมเมื่อกลับมาหนีเรียน

**โค้ดใหม่นี้เป็น contract / plan object เท่านั้น ยังไม่ใช่ MariaDB transaction adapter**
และไม่ได้พิสูจน์การใช้จริงกับ MariaDB, race, lock หรือ rollback.

ลำดับการ implement transaction บนฐาน lab ที่แยกจริง:
1. Begin transaction, ตรวจสิทธิ์ครู/กฎ/ผู้เรียน, ล็อก students.id FOR UPDATE
   และเรียง student IDs เมื่อหลายคนเพื่อลด deadlock
2. ตรวจ request_id+student_id receipt ภายใต้ lock (validate rule, reason, date)
3. นับ active incident ในคู่ student_id+affairs_rule_id แล้วคำนวณเตือน/หัก
4. INSERT incident และ (ถ้ามีคะแนน) INSERT behavior_records พร้อม UPDATE link
5. INSERT audit และ idempotent outbox, COMMIT แล้วค่อย dispatch push
6. เมื่อผิดพลาด ROLLBACK ทั้งชุด, ทดสอบ retry/concurrency/timeout ใน lab เท่านั้น
7. สำหรับ truancy ต้องบันทึก period+incident+score+audit ใน transaction เดียว
   soft-delete และ restore ID เดิมเมื่อเปลี่ยนสถานะไปมา

งานค้างต่อ: adapter MariaDB สำหรับ lab, trigger contracts อีก 7+ รายการ,
CHECK semantic/collation, FK/lock, transaction integration tests และ importer
ฐาน ratsadaa_connect ที่ตรวจว่าง 63/63 ตารางยังไม่ใช่ lab สำหรับเขียนทดสอบ.

สถานะคงเดิม: IMPORT_AUTHORIZED=NO, CUTOVER_AUTHORIZED=NO.

## ขั้น Lab-only Transaction Prototype — 1 พฤศจิกายน 2569

เพิ่มโมดูลไม่ผูกเข้ากับ app.js / school-hosting/server.cjs:

- school-hosting/mariadb-parity/lab-transaction.cjs
- school-hosting/mariadb-parity/manual-conduct-transaction.cjs
- school-hosting/test/mariadb-lab-transaction.test.cjs
- school-hosting/test/mariadb-manual-conduct-transaction.test.cjs

ข้อจำกัดความปลอดภัย:

- รับ connection แบบ mysql2/promise จากผู้เรียกเท่านั้น; โค้ดไม่สร้าง pool,
  ไม่อ่านรหัสผ่านจาก Environment, ไม่เปิด network และไม่มี route ให้เว็บจริง
- ต้องยืนยันชื่อฐานผ่าน SELECT DATABASE() ตรงกับ ratsadaa_connect_lab เท่านั้น
  ปฏิเสธ ratsadaa_connect (staging เดิม) และชื่ออื่นทั้งหมด
- ก่อน BEGIN และขณะ Transaction ตรวจ FOREIGN_KEY_CHECKS=1 กับ UNIQUE_CHECKS=1
  ไม่มีการปิด constraint checks, ไม่มี TRUNCATE, ไม่มี Import/ALTER/DROP
- ต้องระบุ confirmation เฉพาะ Lab และใช้ connection เดียวกันจน COMMIT/ROLLBACK
- ตรวจ actor ใน users + student_affairs_assignments, ตรวจ room/advisor/advisor2
  หรือ timetable active ภายใน transaction, ล็อก students.id FOR UPDATE
- อ่านกฎคะแนนที่เปิดใช้และไม่ถูก archive, ปฏิเสธ managed truancy rule
- นับ incident ภายใต้ student lock, คำนวณเตือน/หักจาก conduct-contract
- ตรวจ request_id+student_id ก่อน INSERT, ป้องกัน replay ที่มี reason/rule/actor ต่าง
- INSERT behavior_incidents; หาก points_applied !=0 จึง INSERT behavior_records
  โดยเลือก created_at ของ incident เดิม, UPDATE incident.behavior_record_id
- INSERT audit_log และ event ลง behavior_score_push_events ใน Transaction เดียว
  โดยไม่ dispatch Push ระหว่าง Transaction หรือโดยโมดูลนี้
- ถ้า SQL ผิดพลาด ROLLBACK; ถ้า COMMIT ไม่แน่ชัด ห้าม retry อัตโนมัติ
- ถ้ามี Trigger ที่เกี่ยวกับ behavior อยู่ใน MariaDB Lab ให้หยุด
  เพื่อไม่เสี่ยงสร้างคะแนน/แจ้งเตือนซ้ำ

**ทดสอบโดย mock connection เท่านั้น:** warning, deduction, audit/outbox
ภายในการ commit เดียว, duplicate request ไม่สร้างข้อมูลซ้ำ,
unauthorized, failed statement rollback, wrong schema blocked, FK/UNIQUE off
blocked, commit uncertainty. ยังไม่ได้ทดสอบจริงกับ MariaDB engine

ยังไม่รองรับ record date ที่ผู้ใช้เลือก, bulk conduct, undo/restore
จริงบน DB, period truancy write path, outbox dispatcher หรือ reconnect retry.
โมดูลจะปฏิเสธ selected history date แทนการนำเข้าด้วยวันผิด

**ยังไม่ใช่ Production Adapter และไม่อนุญาต Import/Cutover.**
ต้องสร้างฐาน Lab แยกพร้อม synthetic schema และ MariaDB connection
ที่ได้รับอนุมัติก่อนถึงจะเปิด real DB integration test ได้
และต้องเก็บฐาน ratsadaa_connect ที่ยังว่างไว้โดยไม่เขียนทับ

## MariaDB Lab — FK 0 จาก 119 (1 พ.ย. 2569)

ข้อมูล phpMyAdmin: `ratsadaa_connect_lab` มี 63 ตาราง, students=0,
Generated Columns=5, Triggers=0, Foreign Keys=0. Lab ยังไม่พร้อม
สำหรับ Transaction tests / Import จนกว่าจะซ่อม Foreign Keys.

เตรียมเครื่องมือ `scripts/prepare-mariadb-lab-fks.py` ที่อ่าน
SQLite verified backup และ `mariadb-foreign-keys.csv` ของต้นทาง
(ผ่าน 119 FK, 123 FK parts) ไม่เชื่อมต่อหรือเขียนฐานจริง.

### A. สร้าง SQL อ่านจำนวนแถวทั้งหมดของ Lab

GitHub Desktop Fetch origin → Pull origin แล้วรัน:

```powershell
$backup = Get-ChildItem "H:\RD_CONNECT_BACKUP" -Filter "rd-connect-*.sqlite" -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $backup) { throw "ไม่พบ SQLite backup" }
py "H:\rd-care\rd-care\scripts\prepare-mariadb-lab-fks.py" $backup.FullName "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-foreign-keys.csv" --preflight-sql "H:\RD_CONNECT_BACKUP\mariadb-lab-fk-preflight.sql"
```

คัดลอก SQL เข้า phpMyAdmin ฐาน `ratsadaa_connect_lab` → SQL → Go
Export *Query results operations* เป็น CSV ที่มี 3 หัวคอลัมน์
`KIND,NAME,N` บันทึกไว้เป็น
`H:\RD_CONNECT_BACKUP\mariadb-lab-fk-preflight.csv`.

ผล CSV ต้องมี 67 แถว: TABLE_ROWS 63 ตารางต้อง 0 ทุกตาราง,
TABLE_COUNT=63, FK_COUNT=0, GENERATED_COUNT=5, TRIGGER_COUNT=0.

### B. สร้าง DDL ซ่อม FK (ยังไม่ execute)

```powershell
py "H:\rd-care\rd-care\scripts\prepare-mariadb-lab-fks.py" $backup.FullName "H:\RD_CONNECT_BACKUP\sqlite-schema-summary.json" "H:\RD_CONNECT_BACKUP\mariadb-foreign-keys.csv" --prepare-alters "H:\RD_CONNECT_BACKUP\mariadb-lab-add-fks.sql" --lab-counts-csv "H:\RD_CONNECT_BACKUP\mariadb-lab-fk-preflight.csv"
```

สคริปต์จะสร้าง 119 `ALTER TABLE` ที่เจาะจงฐาน
`ratsadaa_connect_lab` เท่านั้น เมื่อข้อมูล metadata แสดงว่าฐานว่าง
ครบและ schema สำคัญมีจำนวนตรงตามที่คาด. ไม่เขียนฐานเอง.

**ห้ามรัน DDL ซ่อมจนกว่าจะตรวจความสอดคล้องของชนิดคอลัมน์และ
indexes ใน Lab และได้รับผลตรวจ preflight ล่าสุด**
MariaDB ALTER TABLE เป็น DDL ที่อาจ commit รายคำสั่ง หากผิดพลาด
ต้องตรวจสถานะ partial repair; ห้ามสั่งรันซ้ำทันทีหรือปิด FK checks.

ฐาน `ratsadaa_connect` และ SQLite Live ไม่ถูกแตะในขั้นตอนนี้.
