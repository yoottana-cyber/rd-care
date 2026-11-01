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
