# RD Care: เปลี่ยนฐานทดลอง D1 เป็นโครงสร้างใหม่ (ไม่ต้องสำรอง)

ใช้กับฐานข้อมูลทดลองที่ยอมรับการเริ่มข้อมูลใหม่ได้เท่านั้น
ห้ามนำไฟล์นี้ไปใช้เป็นคำสั่งลบฐานข้อมูลจริง

## ผลลัพธ์
- นำเข้าด้วย student_no เป็นตัวระบุหลัก และคง students.id สำหรับประวัติ
- ห้อง/เลขที่ของนักเรียนที่ถูกถอนออก (deleted_at ไม่ว่าง) ใช้ซ้ำได้
- ห้อง/เลขที่ของนักเรียนที่ยังใช้งานและพักข้อมูล ห้ามซ้ำ
- เริ่มด้วยรายชื่อห้องเรียน 48 ห้องตามไฟล์ classrooms_only.sql
- ไม่ใส่นักเรียนตัวอย่าง DEMO
- บัญชี Admin และข้อมูลทดลองเดิมไม่ถูกคัดลอกเข้าฐานใหม่

## วิธีทำบน Cloudflare + GitHub

1. ไปที่ Cloudflare Dashboard > Storage & Databases > D1 แล้วสร้างฐานใหม่ชื่อ rd-care-dev-v2
2. คัดลอก Database ID ของฐานใหม่ (UUID)
3. ไป GitHub Repository yoottana-cyber/rd-care แล้วแก้ไฟล์ worker/wrangler.toml เฉพาะส่วน [[d1_databases]]:
   binding = "DB"
   database_name = "rd-care-dev-v2"
   database_id = "UUID_ของฐานใหม่"
   migrations_dir = "migrations"
4. Commit การแก้ไฟล์บน Branch main ระบบ GitHub Actions ชื่อ Deploy RD CONNECT Dev Worker จะ apply migrations ทั้งหมดแล้ว deploy Worker อัตโนมัติ
5. ตรวจ GitHub Actions ว่าผ่านทั้งการทดสอบและ Deploy; อย่าเริ่มนำเข้าหากขั้นตอน Migrate/Deploy ไม่ผ่าน
6. GitHub Actions จะสร้างรายชื่อห้องเรียนให้โดยอัตโนมัติ เฉพาะเมื่อ D1 ใหม่นั้นยังไม่มีห้องเรียน (ไม่มีข้อมูล DEMO)
7. ตั้งบัญชี Admin ครั้งแรกด้วย POST /api/setup ไปยัง Worker ใหม่ โดยใช้ค่า x-setup-token ที่ตั้งใน Cloudflare และรหัสผ่าน Admin ใหม่อย่างน้อย 12 ตัวอักษร
8. เข้าระบบ Admin, ตรวจ /api/admin/unified-import/health ว่า archived_roll_reuse_ready เป็น true
9. นำเข้า ม.1 แล้วตรวจสถิติห้องเรียน ก่อนนำเข้า ม.2–ม.6

ข้อควรระวัง:
- ห้ามนำ demo_seed.sql ไปใช้กับฐานใหม่ เพราะจะเพิ่มข้อมูลนักเรียน DEMO
- ไม่ต้องลบฐานเดิมเพื่อให้ระบบทำงาน แค่เปลี่ยน Worker binding ไปใช้ฐานใหม่
- ไม่มีการคัดลอกข้อมูลจากฐานเดิม; นักเรียน/ครู/ผู้ปกครองทดลองต้องเพิ่มใหม่
- ห้ามใส่ SETUP_TOKEN หรือรหัสผ่านใน GitHub/ChatGPT
- หากเว็บยังเห็นข้อมูลเก่า ให้ตรวจว่าคุณกำลังเปิด Worker และ Pages Service Binding เวอร์ชันล่าสุด
- ไม่ควรรันการแปลงตารางแบบ DROP TABLE บนฐานข้อมูลเก่าเพราะอาจกระทบ Foreign Keys
