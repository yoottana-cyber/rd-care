# RD CONNECT — เปิด Push Notification บน Node.js + SQLite ของโรงเรียน

เอกสารนี้ใช้กับแอปบน DirectAdmin ของโรงเรียนรัษฎา (Node.js 24 + SQLite ในเครื่อง)
ไม่เกี่ยวกับ Cloudflare D1 หรือฐาน MariaDB รุ่นทดสอบเก่า

## สถานะก่อนเริ่ม

การตรวจ `school:pilot-check` ล่าสุดผ่านฐาน SQLite 46 migrations + 48 ห้อง, ข้อมูลนำร่อง 1 ห้อง, ไฟล์สำรองล่าสุดตรวจได้ แต่ขึ้น `VAPID CONFIGURATION: INCOMPLETE`.
**ยังไม่เปิด Cron สำหรับส่ง Push** และยังไม่ถือว่าผู้ปกครองหรือเด็กยินยอมสมัครรับ Push แล้ว

## ขั้นที่ 1 — สร้าง VAPID สำหรับโรงเรียนอย่างปลอดภัย

1. อัปเดตโค้ดจากสาขา `ops/school-push-vapid-onboarding` ลงใน `rd-connect-school-app` โดย **ไม่แตะ** `rd-connect-private` หรือ `rd-connect-backups`
2. บน DirectAdmin / Setup Node.js App / Run JS Script เลือก `school:test` ก่อน
3. หาก Environment Variables ของแอปยังไม่มี `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` ให้เรียก **`school:push-keygen` เพียงครั้งเดียว**
4. เมื่อขึ้น `SCHOOL VAPID GENERATED ONCE IN PRIVATE FILE` ให้เข้า File Manager ด้วยบัญชีเจ้าของโฮสต์เพื่อเปิดไฟล์
   `/home/ratsadaa/rd-connect-private/rd-connect-vapid-SETUP-PRIVATE.txt`
   (หากค่า `RD_SQLITE_FILE` ถูกตั้งต่างจากนี้ ให้ดูโฟลเดอร์เดียวกับ SQLite จริง)
5. ในไฟล์ส่วนตัวมีค่า `VAPID_PUBLIC_KEY` และ `VAPID_PRIVATE_KEY` ที่เป็นคู่เดียวกัน ให้คัดลอกเข้า Environment Variables ของ Node App ตามชื่อ **ห้ามส่งค่า Private Key ผ่านแชต, อีเมล, ภาพหน้าจอ, GitHub หรือ Log**
6. เพิ่ม `VAPID_SUBJECT=mailto:<อีเมลติดต่อจริงของโรงเรียน>` โดยต้องเป็นอีเมลจริง ไม่ใช่ placeholder
7. บันทึก Environment Variables ใน DirectAdmin และ **Restart Node.js App**
8. ลบไฟล์ตั้งค่า VAPID ชั่วคราวเมื่อยืนยันว่ากุญแจใน Environment Variables ทำงานแล้ว และเก็บกุญแจสำรองไว้เฉพาะในระบบจัดเก็บความลับของโรงเรียนเท่านั้น

**สำคัญ:** สคริปต์นี้ไม่พิมพ์กุญแจใด ๆ ลงใน stdout และใช้สิทธิ์ไฟล์ `0600` ในโฟลเดอร์ส่วนตัว `0700` เท่านั้น ถ้าพบค่า VAPID อยู่แล้วแม้เพียงตัวเดียว หรือไฟล์ดังกล่าวเคยถูกสร้างแล้ว จะปฏิเสธการสร้างใหม่เพื่อไม่ให้เปลี่ยนคู่กุญแจโดยไม่ตั้งใจ

## ขั้นที่ 2 — ตรวจ VAPID โดยไม่ส่งข้อความ

DirectAdmin > Run JS Script > `school:push-check`

ผลที่ต้องการ (จำนวนอุปกรณ์อาจเป็น 0 ในการเปิดครั้งแรก):

    RD CONNECT SCHOOL PUSH CHECK — READ ONLY. NO NOTIFICATION SENT.
    VAPID: READY (PUBLIC/PRIVATE KEY PAIR VERIFIED)
    ELIGIBLE REGISTERED DEVICES: teacher 0, student 0, verified guardian 0.
    NEXT: Have a test teacher/student/verified guardian opt in from their own PWA first.
    NEXT: Test a GENERIC self-notification from each opted-in device in app settings.
    CRON: NOT CHECKED; DO NOT START school:cron UNTIL DEVICES AND RECIPIENT RULES ARE VERIFIED.
    LIVE SQLITE UNCHANGED; SECRETS HIDDEN; NO PUSH PROVIDER CONTACTED.

คำสั่ง `school:push-check` จะคืน `returncode: 0` เมื่อคู่กุญแจพร้อม และคืน `returncode: 2` เมื่อการตั้งค่า VAPID ยังไม่พร้อม (แสดงชื่อค่าที่ขาด แต่ไม่แสดงรหัสลับ)

หากขึ้น `NOT READY (missing_settings)` ให้ตรวจชื่อ Environment Variables ที่ขาด
หากขึ้น `NOT READY (invalid_subject)` ให้ตรวจ `mailto:` จริง
หากขึ้น `NOT READY (keypair_mismatch)` หรือ `invalid_keypair` ให้ตรวจว่าคัดลอก Public/Private Key คู่เดียวกันแบบครบ ไม่มีช่องว่าง/ตัดท้าย
**อย่ารัน `school:push-keygen` เพื่อหมุนกุญแจซ้ำ** หากมีอุปกรณ์สมัครรับแล้ว: อาจทำให้การส่งแจ้งเตือนเดิมเสีย ต้องวางแผนเปลี่ยนกุญแจและสมัครอุปกรณ์ใหม่

## ขั้นที่ 3 — ทดสอบส่งเฉพาะอุปกรณ์ของผู้ยินยอม

- ครูทดสอบ: ล็อกอินหน้าโรงเรียน → เมนูศูนย์แจ้งเตือน → กด **เปิดรับ Push** บนมือถือของตนเอง → กด **ส่ง Push ทดสอบถึงอุปกรณ์นี้**
- นักเรียนทดสอบ: ล็อกอินบัญชีตนเอง → เมนู Push/การแจ้งเตือนของนักเรียน → เปิดรับด้วยตนเอง → กดส่งข้อความทดสอบถึงเครื่องตน
- ผู้ปกครองทดสอบ: ต้องมีความสัมพันธ์นักเรียนที่โรงเรียนตรวจสอบแล้ว → ล็อกอินบัญชีผู้ปกครอง → เปิดรับ Push ด้วยตนเอง → กดทดสอบบนเครื่องนั้น

การทดสอบด้วยปุ่มดังกล่าวมีข้อความทั่วไป ไม่เปิดเผยชื่อหรือสถานะนักเรียน และจะส่งเฉพาะเครื่องที่ผู้ใช้นั้นสมัครรับแล้ว **ผู้ให้บริการตอบรับ (accepted) ยังไม่เท่ากับมือถือแสดงจริง** ต้องดูการแจ้งเตือนบนเครื่องด้วย

ระบบไม่ควรขอสิทธิ์กล้องหรือ Push แบบบังคับ หากไม่ยินยอมยังใช้เว็บปกติได้
ใน iPhone ให้เพิ่มแอปไปที่หน้าจอโฮมแล้วเปิดผ่านไอคอนก่อนทดสอบ Push ตามข้อจำกัดของ iOS

## ขั้นที่ 4 — Cron หลังทดสอบอุปกรณ์สำเร็จเท่านั้น

ระบบเดิมมี `school:cron` สำหรับ dispatch push/outbox/reminders; **การเรียกคำสั่งนี้อาจส่งแจ้งเตือนจริง** จึงอย่ารันก่อนตรวจผู้รับ/อุปกรณ์/ประเภทข้อความและการตั้งค่าแจ้งเตือนของแอดมิน

เมื่อผ่านการทดสอบและโรงเรียนอนุมัติ ให้ตั้ง Scheduler ใน DirectAdmin ทุก 5 นาที
ผ่าน Node.js runtime ของแอปและ Environment Variables เดียวกับ Passenger (Cron ธรรมดาอาจไม่รับค่า Env ของแอปอัตโนมัติ)
ตรวจ Log จาก Scheduler ให้แน่ใจว่ารันสำเร็จ; อย่าเปิด Cron ซ้ำหลายรายการ
แยก `school:backup` แบบทุกวันต่างหาก และต้องทดสอบว่าไฟล์สำรองเกิดจาก Cron จริง

## ข้อควรทราบ

- `school:push-keygen` สร้างไฟล์ตั้งค่าส่วนตัวอย่างเดียว ไม่เพิ่มบัญชีหรือแก้ SQLite
- `school:push-check` อ่าน SQLite + ตรวจ Public/Private Key + นับอุปกรณ์ ไม่มีการติดต่อผู้ให้บริการ Push และไม่ส่งข้อความ
- `school:test` ทดสอบกับฐานจำลอง ไม่ส่ง Push ไปยังผู้ใช้จริง
- ไม่จำเป็นต้องรัน `school:install` หรือย้ายเป็น MariaDB
- ขณะนี้ยังเป็นการทดสอบนำร่อง ไม่เปิดแจ้งเตือน/ข้อมูลนักเรียนจริงทั้งโรงเรียนอัตโนมัติ
