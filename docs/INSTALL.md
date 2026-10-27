# คู่มือติดตั้ง RD CONNECT ต้นแบบ

## A. เตรียมสิ่งที่ต้องมี

- Node.js 22 ขึ้นไป, npm, Git และบัญชี Cloudflare
- พื้นที่เว็บไซต์โรงเรียนที่มี HTTPS และเปิดให้อัปโหลดไฟล์ไปยัง `public_html/rd-care/` ได้
- เข้าถึงบัญชี Cloudflare ที่จะใช้สร้าง D1/Workers
- เริ่มต้นทดลองกับข้อมูลจำลอง **ไม่ใช้ข้อมูลนักเรียนจริง**

## B. ติดตั้งและสร้าง D1 ทดสอบ

เปิด Terminal ในโฟลเดอร์ `worker`:

```powershell
npm install
npx wrangler login
npx wrangler d1 create rd-care-dev
```

คัดลอก `database_id` (UUID) ที่ระบบคืนมา แทนข้อความ `REPLACE_WITH_D1_DATABASE_ID` ใน `worker/wrangler.toml` **อย่านำ secret ไปใส่ในไฟล์นี้**

```powershell
npx wrangler d1 migrations apply rd-care-dev --local
npx wrangler d1 execute rd-care-dev --local --file=demo_seed.sql
```

D1 local เก็บข้อมูลไว้ใน `.wrangler` บนเครื่อง ไม่เกี่ยวกับฐานข้อมูลจริงบน Cloudflare

## C. สร้างบัญชี Admin ทดสอบใน local

1. คัดลอกไฟล์ `.dev.vars.example` เป็น `.dev.vars`
2. เปลี่ยน `SETUP_TOKEN` ให้เป็นรหัสสุ่มยาวอย่างน้อย 32 ตัวอักษร ไม่ใช้ค่า placeholder
3. เปิด Worker:

```powershell
npx wrangler dev --ip 127.0.0.1 --port 8787
```

4. อีกหน้าต่าง PowerShell (ปรับข้อมูลก่อนรัน):

```powershell
$headers = @{ 'X-Setup-Token' = 'รหัสสุ่มที่ตั้งใน .dev.vars' }
$body = @{ username = 'admin'; display_name = 'ผู้ดูแลทดสอบ'; password = 'รหัสผ่านที่ยาวอย่างน้อย12ตัว' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/api/setup' -Headers $headers -ContentType 'application/json' -Body $body
```

เส้นทาง `/api/setup` ใช้ได้ครั้งเดียวในฐานที่ยังไม่มีบัญชี เมื่อมีบัญชีแล้วจะตั้งค่าซ้ำไม่ได้

## D. ทดสอบหน้าเว็บบนเครื่องก่อน

เปิดโฟลเดอร์ `web` ด้วย Live Server หรือเว็บเซิร์ฟเวอร์ที่ URL `http://localhost:5500` (ห้ามเปิดไฟล์ตรง `file://`)

แก้ `web/config.js`:

```js
export const API_BASE_URL = 'http://127.0.0.1:8787';
```

หากหน้าเว็บใช้ origin อื่น เช่น `http://127.0.0.1:5500` ให้แก้ `ALLOWED_ORIGINS` ใน `worker/wrangler.toml` ให้ตรงก่อนทดสอบ

เริ่มล็อกอินด้วยบัญชี Admin ที่สร้างไว้ แล้วเลือกห้อง ม.1/1 ซึ่งมีนักเรียนตัวอย่าง 5 คน

สำหรับการทดสอบ **รายคาบ** ให้เพิ่มบัญชีครูและตารางสอนในหน้าผู้ดูแลระบบก่อน ตรวจสอบวันในตารางว่าเป็นวันเดียวกับวันที่เลือกเช็กชื่อ

## E. เตรียม Cloudflare D1 สำหรับทดสอบออนไลน์

> ใช้ **ข้อมูลจำลอง** เท่านั้น เพราะเวอร์ชันนี้ยังไม่ผ่านกระบวนการรับรองและตรวจความปลอดภัยสำหรับข้อมูลจริง

เปิด `worker/wrangler.toml` และแก้ `ALLOWED_ORIGINS` ให้เป็น origin จริงของเว็บ เช่น `https://school.example.ac.th` (ไม่ต้องมี `/rd-care/`)

```powershell
npx wrangler d1 migrations apply rd-care-dev --remote
npx wrangler d1 execute rd-care-dev --remote --file=demo_seed.sql
npx wrangler secret put SETUP_TOKEN
npx wrangler deploy
```

ตั้งรหัสลับแบบสุ่ม 32+ ตัวอักษรผ่าน `wrangler secret put` (Wrangler จะถามให้กรอกเอง) จากนั้นสร้าง Admin ด้วยคำสั่งตัวอย่างหัวข้อ C แต่เปลี่ยน URL ให้เป็น HTTPS ของ Worker ที่ deploy แล้ว **หลังตั้งค่าเสร็จ ลบ SETUP_TOKEN ด้วย `npx wrangler secret delete SETUP_TOKEN`** เพื่อลดความเสี่ยง

## E.1 ปัญหา Login รุ่นแรก: PBKDF2 บน Cloudflare Workers

RD CONNECT รุ่นแรกใช้ PBKDF2-SHA256 210,000 รอบ แต่ workerd จำกัดการเรียก PBKDF2 สูงสุด 100,000 รอบ
จึงแก้โค้ดต้นแบบให้ใช้ 100,000 รอบ (สำหรับข้อมูลจำลองเท่านั้น) โดยคงรหัสผ่านแบบ salted hash

**สำคัญ:** ผู้ที่เคยสร้างบัญชีด้วยเวอร์ชันเดิมจะต้องตั้ง Hash ใหม่ เนื่องจาก 210,000 และ 100,000 รอบให้ผลลัพธ์ต่างกัน

หลังอัปเดต GitHub แล้วให้ Deploy Worker จากโฟลเดอร์ worker:

```powershell
npm.cmd install
npx.cmd wrangler deploy
```

กลับไปโฟลเดอร์รากโปรเจกต์แล้วรันสคริปต์รีเซ็ต Admin รุ่นทดลอง:

```powershell
.\scripts\reset-demo-admin-password.ps1
```

ตรวจสอบก่อนว่าค่า D1 binding ใน worker/wrangler.toml เป็นฐาน **rd-care-dev** ที่ต้องการ
สคริปต์ถามรหัสผ่านในเครื่อง ไม่แสดงรหัสผ่านและไม่บันทึกรหัสผ่านจริงลง GitHub
แล้วเปลี่ยนเฉพาะ Salt/Hash ของบัญชี admin ที่มีอยู่แล้วผ่าน D1 remote

ก่อนเปิดใช้งานจริงกับข้อมูลนักเรียน ต้องทบทวน Authentication ใหม่: ปรับไปใช้บริการยืนยันตัวตนมาตรฐานที่รองรับ MFA, การจำกัดอัตราคำขอและ password hashing ที่แข็งแรงกว่า

## F. เว็บทดลองระหว่างพัฒนา (ยังไม่ใช้ Hosting โรงเรียน)

ใช้ [PAGES-PREVIEW.md](PAGES-PREVIEW.md) เพื่อเผยแพร่หน้าเว็บอัตโนมัติบน Cloudflare Pages เหมือนระบบลาออนไลน์เดิม โดยผูก Service Binding ไปยัง Worker ที่ทดสอบผ่านแล้ว และใช้ข้อมูลจำลองเท่านั้น

## F.1 เมื่อพร้อมเปิดจริงจึงอัปโหลด PWA ไป cPanel / DirectAdmin

1. เปลี่ยน `web/config.js` ให้เป็น URL Worker จริง **ใช้ HTTPS** เช่น:

   ```js
   export const API_BASE_URL = 'https://rd-care-api-dev.YOUR-SUBDOMAIN.workers.dev';
   ```

2. ใน File Manager ของ Hosting เปิด `public_html/rd-care/`
3. อัปโหลด **เนื้อหาภายในโฟลเดอร์ `web/`** ไปยังตำแหน่งนี้ ไม่ใช่โฟลเดอร์ `worker/`
4. ตรวจสอบว่าเข้าถึง `https://ชื่อโดเมนโรงเรียน/rd-care/` ได้
5. ทดสอบล็อกอินด้วยบัญชีทดสอบ, เช็กชื่อห้องจำลอง, รีโหลดหน้า, ทดสอบเพิ่มเข้าหน้าจอโฮม
6. ถ้ามี error CORS ให้ตรวจ `ALLOWED_ORIGINS`: ต้องเป็น `https://โดเมน` เท่านั้น (รวม subdomain และ port ถ้ามี แต่ไม่รวม path)

**อย่าอัปโหลดโค้ด Worker, `.dev.vars`, SQL ที่มีข้อมูลจริง หรือโฟลเดอร์ `.git` ไปยัง `public_html`**

## G. หลังจากเปลี่ยนโค้ด

- Backend: ทดสอบก่อน `npx wrangler deploy`
- Frontend: อัปโหลดไฟล์ใน `web/` ที่แก้ไขแล้วขึ้น Hosting และรีเฟรช PWA; หากมีการเปลี่ยน asset ต้องเพิ่ม `CACHE` version ใน `web/sw.js`
- แก้สคีมาฐานข้อมูล: เพิ่มไฟล์ migration ใหม่เท่านั้น ไม่ย้อนกลับไปเปลี่ยน migration ที่ apply ไปแล้ว

## H. หมายเหตุการจัดการข้อมูลนักเรียน

ห้ามใช้รหัสบัตรประชาชนหรือเบอร์โทรศัพท์เป็นรหัสผ่านเริ่มต้น นำเข้าข้อมูลจริงเฉพาะเมื่อมีมาตรการสิทธิ์ การรักษาความปลอดภัย และการแจ้งข้อมูลส่วนบุคคลครบถ้วน

## I. การพัฒนาระบบแจ้งเตือน (ยังไม่ Deploy สำหรับผู้ปกครอง)

- เพิ่ม migration `worker/migrations/0002_notification_outbox.sql` เพื่อเก็บเหตุการณ์ในฐาน D1
- เมื่อตรวจพบการขาดรายคาบ ระบบบันทึกรายการติดตามของครูที่ปรึกษา แต่ **ยังไม่ส่ง Push**
- หลังครูที่ปรึกษายืนยันว่าไม่มีเหตุที่อนุญาต ระบบจึงสร้างเหตุการณ์สำหรับผู้ปกครอง
- หากแก้ไขเป็น มา/สาย/ลา ระบบยกเลิกเหตุการณ์ค้างที่ยังไม่ได้จัดส่ง
- ใช้ `UNIQUE(alert_id,event_type,audience)` เพื่อกันการสร้างเหตุการณ์ซ้ำ
- ยังไม่มีบัญชีผู้ปกครอง/การผูกบุตรหลาน/อุปกรณ์ Push/การส่ง Push/บริการ retry; **อย่าเปิดใช้งานจริง**
- เมื่อต้องการทดลอง migration บนฐาน Local สำหรับการพัฒนา ให้ใช้ `npx.cmd wrangler d1 migrations apply rd-care-dev --local` เท่านั้น
- การเพิ่ม migration ลง GitHub **ไม่ทำให้ D1 Remote ถูกแก้ไขเอง**; ต้องมีขั้นตอน Deploy และทดสอบแยกต่างหาก
