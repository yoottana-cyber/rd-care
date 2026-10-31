# RD CONNECT — ตั้ง Cron บน DirectAdmin หลัง Push ผ่านครบ 3 บทบาท

อ้างอิงผลทดสอบจริงวันที่ 31 ต.ค. 2569: VAPID ผ่าน, ครู/นักเรียน/ผู้ปกครองส่ง Push ทดสอบบนอุปกรณ์จริงได้ครบ; SQLite load test ครู 50 คนผ่าน
**ไม่ใช่** การอนุมัติให้ส่งเหตุการณ์ทั้งหมดทันทีโดยไม่ตรวจผู้รับ และ **ยังไม่มี Cron ถูกสร้างผ่าน GitHub**

## 1. อ่านตรวจสิ่งที่รอส่งก่อน

อัปเดตเฉพาะโค้ดจากสาขา `ops/school-cron-preflight` ไปที่แอปเดิม
`/home/ratsadaa/rd-connect-school-app/` โดยไม่ทับ `rd-connect-private` และ `rd-connect-backups`

DirectAdmin > Setup Node.js App > Run JS Script:

    school:test
    school:cron-preflight

`school:cron-preflight` เป็น **READ ONLY**; ตรวจความสมบูรณ์ Schema, VAPID ที่เป็นคู่กัน, จำนวนอุปกรณ์ครู/นักเรียน/ผู้ปกครองที่สมัครรับ, snapshot ล่าสุด และสรุปยอดเหตุการณ์/คิวที่อาจรอส่ง โดย **ไม่ส่ง Push, ไม่สร้าง Cron และไม่แก้ SQLite**

- ผล `PREFLIGHT PASS` / `returncode 0`: ค่า VAPID/อุปกรณ์ทั้งสามชนิดและไฟล์สำรองล่าสุดอยู่ในเกณฑ์เบื้องต้น **ยังต้องตรวจข้อความ/ผู้รับ/เหตุการณ์ค้างด้วยคนก่อนเปิดจริง**
- ผล `PREFLIGHT PENDING` / `returncode 2`: ยังขาดเงื่อนไข ห้ามตั้ง Cron ส่ง Push
- ผล `returncode 1`: ข้อผิดพลาดสภาพแวดล้อม/ฐานข้อมูล ให้หยุดและแก้ก่อน
- จำนวนเหตุการณ์ในรายงาน **ไม่เท่ากับจำนวนแจ้งเตือนที่จะส่งได้จริง** บางประเภทใช้การสร้างรายการปลายทางขณะ Dispatch
- หากเคยทำข้อมูลทดสอบหนีเรียน/มาสาย/คะแนนผิด/ข้อความถึงนักเรียนไว้ ให้ตรวจสอบประวัติและผู้รับก่อนเปิด Scheduler เพื่อป้องกันส่งแจ้งเตือนเก่าโดยไม่ตั้งใจ
- การตรวจนี้ไม่เปลี่ยนการอนุญาต Push ของบุคคลใด และไม่ยืนยันการกำหนดผู้รับทุกเหตุการณ์

## 2. สร้างงานสำรองข้อมูลทุกวันก่อน

เข้า **DirectAdmin > Advanced Features > Cron Jobs > Create Cron Job**
(ชื่อเมนูอาจเปลี่ยนตามธีม DirectAdmin) ตั้งเวลาตามเขตเวลาของ **เซิร์ฟเวอร์** ไม่ใช่อาศัยเวลาไทยโดยไม่ตรวจสอบ

**เวลาแนะนำ 02:00 น. ตามเวลาไทย**:

| ช่อง | ค่า |
|---|---|
| Minute | 0 |
| Hour | 2 |
| Day of Month | * |
| Month | * |
| Day of Week | * |

งานต้องเรียกสคริปต์เดิม `school-hosting/backup.cjs` ผ่าน Node.js 24 ของแอป และต้องมองเห็น `RD_SQLITE_FILE` / `RD_SQLITE_BACKUP_DIR` ในสภาพแวดล้อม Cron

ตัวอย่าง **แม่แบบคำสั่ง** (ห้ามวางจนกว่าจะเปลี่ยน `NODE24_ABSOLUTE_PATH` เป็น path จริงที่ตรวจสอบแล้วและยืนยัน Environment Variables ของ Cron):

    cd /home/ratsadaa/rd-connect-school-app && NODE24_ABSOLUTE_PATH school-hosting/backup.cjs

การรันผ่าน Cron มักไม่ได้รับ Environment Variables จากหน้า Setup Node.js App/Passenger โดยอัตโนมัติ และ Node.js ใน Cron อาจเป็นเวอร์ชันคนละตัว ต้องทดสอบกับผู้ดูแลโฮสต์ เช่น ใช้ virtual environment ของ CloudLinux/Node.js Selector ที่ถูกต้องหรือวิธีส่งผ่าน Env ของแอปที่ผู้ให้บริการแนะนำ **ห้ามใส่ค่า VAPID_PRIVATE_KEY หรือรหัสผ่านในช่อง Cron command, shell history หรือไฟล์ที่เว็บเข้าถึงได้**

ให้ทดสอบงานนี้จริงจาก Scheduler หนึ่งรอบและตรวจใน `rd-connect-backups` ว่ามีไฟล์ `rd-connect-*.sqlite` ใหม่ สิทธิ์เฉพาะเจ้าของ และตรวจ `school:restore-test` บนสำเนาเป็นระยะ ไม่ใช่เพียงการรัน `school:backup` จากหน้า Run JS Script

## 3. เปิด Cron Push หลังตรวจผล Preflight/ผู้รับแล้ว

เมื่อ Preflight และการตรวจรายการค้าง/ผู้รับผ่านแล้วจึงสร้าง Cron อีกหนึ่งงาน:

| ช่อง | ค่า |
|---|---|
| Minute | */5 |
| Hour | * |
| Day of Month | * |
| Month | * |
| Day of Week | * |

เรียก **`school-hosting/cron.cjs`** ผ่าน Node.js 24 และ Environment Variables เดียวกับแอป ซึ่งต้องมี `RD_PUBLIC_ORIGIN`, `RD_APP_MOUNT`, `RD_SQLITE_FILE`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` ตามค่าแอปจริง

แม่แบบคำสั่ง:

    cd /home/ratsadaa/rd-connect-school-app && NODE24_ABSOLUTE_PATH school-hosting/cron.cjs

ต้องตรวจว่ามี Cron นี้เพียงหนึ่งงาน ไม่เรียกซ้ำจากทั้ง Scheduler และ service loop ใน Passenger; ระวังการทำงานซ้อนและติดตามข้อผิดพลาด/สถานะส่งจริงของอุปกรณ์ทดสอบ

`school:cron` **ไม่ใช่คำสั่งตรวจแบบอ่านอย่างเดียว**: อาจส่งแจ้งเตือนไปยังผู้สมัครรับจริงและทำงานเตือน/เก็บกวาดรายการต่าง ๆ ด้วย อย่ารันล่วงหน้าเพื่อทดสอบ Path หากยังไม่ตรวจผู้รับ/คิว

## 4. หลังเปิดงานจริง

- ตรวจว่า Cron ทำงานตามเวลาที่ตั้งใน DirectAdmin และ log ไม่แสดงข้อผิดพลาด
- ครู นักเรียน และผู้ปกครองต้องได้รับเฉพาะการแจ้งเตือนที่ตรงกับสิทธิ์ ข้อมูลนักเรียนไม่ปรากฏบนหน้าจอล็อก
- ถ้าเริ่มส่งผิดผู้รับ/ซ้ำ ให้ **ปิด Cron Push จาก DirectAdmin ทันที** แล้วตรวจระบบ โดยไม่ลบฐานข้อมูลหรือกุญแจ VAPID
- ถ้างาน Backup ล้มเหลวให้ตรวจ Cron Environment/Node runtime โดยไม่รัน `school:install` ซ้ำ
- คงแผนทดลองใช้จำกัด 5–10 ห้องก่อนขยายครบ 48 ห้อง

**ข้อจำกัดสำคัญ:** การแก้ GitHub ไม่สามารถสร้างงาน Cron บน DirectAdmin ให้อัตโนมัติ และผล Run JS Script ไม่ได้เป็นหลักฐานว่า Scheduler Cron ทำงานแล้ว ต้องตรวจจาก Cron จริง
