# RD CONNECT — คู่มือเตรียมระบบจริงบน cPanel / DirectAdmin

> เอกสารนี้คือ **คู่มือเตรียมชุด Production แยกใหม่** ไม่ใช่คำสั่งย้ายฐาน Dev หรือเปิดใช้งานข้อมูลเด็กจริงทันที ระบบทดลอง `rd-care.pages.dev` และ Worker `rd-care-api-dev` ต้องทำงานต่อไปโดยไม่ถูกแก้ไข

## ภาพรวม

- เว็บครู/นักเรียน/ผู้ปกครอง: **Static PWA** ใน `public_html/rd-connect/` บน cPanel หรือ DirectAdmin (HTTPS)
- API: **Cloudflare Worker Production** ชื่อ `rd-care-api-prod` (ต้องสร้างใหม่)
- ฐานข้อมูล: **Cloudflare D1 Production** ชื่อ `rd-care-prod` (ต้องสร้างใหม่)
- Push: Web Push ของ Production พร้อม VAPID keys แยก (เก็บเป็น Secrets)
- ไฟล์ `functions/api/[[path]].js` ของ Pages **ใช้ไม่ได้บน cPanel**; โปรแกรมสร้างแพ็กเกจจะเปลี่ยน `config.js` เป็น Worker URL โดยตรง

โครงสร้างหลังติดตั้ง: `https://care.YOUR-SCHOOL-DOMAIN.ac.th/rd-connect/` → `https://rd-care-api-prod.<ACCOUNT>.workers.dev` → `rd-care-prod`.

**ต้องมี:** สิทธิ์ File Manager/FTP ของโฮสติ้งโรงเรียน, SSL ที่ใช้ได้, โดเมนย่อยหรือ path ของโรงเรียน, บัญชี Cloudflare, Node.js 22+ บนเครื่องผู้ติดตั้ง, Git และ Python 3 สำหรับทำ ZIP. ถ้าติดตั้งผ่าน FTP โดยไม่ใช้ ZIP ก็ไม่ต้องใช้ Python

## 1. แยกพื้นที่ทดลองออกจาก Production

| พื้นที่ | เว็บ | Worker | D1 |
|---|---|---|---|
| Dev เดิม — คงไว้ | `https://rd-care.pages.dev/` | `rd-care-api-dev` | `rd-care-dev` |
| Production ใหม่ | URL HTTPS ของโรงเรียน | `rd-care-api-prod` | `rd-care-prod` |

ห้ามเปลี่ยนชื่อ/ID D1 ใน `worker/wrangler.toml` เดิม, ห้ามสั่ง migrate หรือ deploy Production โดยไม่มี `--config wrangler.production.toml`, และห้ามคัดลอกข้อมูลบัญชี/นักเรียนจาก Dev โดยไม่ผ่านกระบวนการตรวจสอบ

## 2. เตรียม HTTPS และโฟลเดอร์ในโฮสติ้ง

1. cPanel → Domains / Subdomains หรือ DirectAdmin → Domain Setup / Subdomain Management: กำหนดโดเมน เช่น `care.YOUR-SCHOOL-DOMAIN.ac.th` และเปิด SSL ที่ใช้งานได้
2. เลือกไดเรกทอรีติดตั้งจริง เช่น `public_html/rd-connect/` ถ้าใช้เว็บหลัก หรือ document root ของโดเมนย่อย แล้วคง path ให้ตรง URL ที่ออกให้ครู
3. บันทึก **URL เว็บเต็มที่ลงท้ายด้วย `/`** เช่น `https://care.YOUR-SCHOOL-DOMAIN.ac.th/rd-connect/`
4. ชื่อ URL ที่ใช้แสดงต่อผู้ใช้ต้องคงที่ก่อนพิมพ์ QR ถาวรหรือติดตั้ง PWA

สำหรับโฮสติ้ง nginx-only บางเจ้า `.htaccess` จะไม่มีผล ให้ผู้ดูแลโฮสติ้งตั้ง MIME ของ `.webmanifest`, cache policy และ security headers ที่ web server โดยตรง

## 3. สร้างฐาน D1 Production (ครั้งแรกเท่านั้น)

ใน PowerShell บนเครื่องผู้ติดตั้ง:

```powershell
git clone https://github.com/yoottana-cyber/rd-care.git
cd rd-care\worker
npm.cmd install
npx.cmd wrangler login
npx.cmd wrangler d1 create rd-care-prod
```

คัดลอก **UUID ของฐาน D1 ใหม่** ที่ได้รับไว้ในเครื่องของตนเอง ไม่ต้องส่ง UUID/รหัสผ่าน/Token ในแชต จากนั้น:

```powershell
Copy-Item .\wrangler.production.example.toml .\wrangler.production.toml
```

แก้ **เฉพาะ** `worker/wrangler.production.toml`:

- `name = "rd-care-api-prod"` (ต้องไม่ใช่ชื่อ Worker Dev)
- `database_name = "rd-care-prod"` และ `database_id = "UUID ของ D1 ใหม่"`
- `ALLOWED_ORIGINS = "https://care.YOUR-SCHOOL-DOMAIN.ac.th"` (**origin เท่านั้น ไม่รวม /rd-connect/**)
- `PUBLIC_APP_URL = "https://care.YOUR-SCHOOL-DOMAIN.ac.th/rd-connect/"` (**URL เต็ม และลงท้าย / เพื่อให้ QR มาสายตรงโดเมนจริง**)

ตรวจสอบว่าฐานใหม่ว่างและไม่มีรายการ Migration:

```powershell
npx.cmd wrangler d1 migrations list rd-care-prod --remote --config wrangler.production.toml
```

รัน Migration กับ **Production เท่านั้น** โดยตรวจชื่อฐาน/Worker และ UUID ใหม่ให้ตรงก่อนกดยืนยัน:

```powershell
npx.cmd wrangler d1 migrations apply rd-care-prod --remote --config wrangler.production.toml
```

เมื่อสำเร็จ ให้ตรวจ D1 schema และตารางใน Dashboard ก่อน deploy ต่อ

> อย่ารัน `demo_seed.sql` หรือ `classrooms_only.sql` โดยอัตโนมัติใน Production การจัดห้องและบัญชีควรเป็นขั้นตอนที่ตรวจสอบแล้วหลังการสร้างระบบ

## 4. Deploy Production Worker และ Secrets

```powershell
npx.cmd wrangler deploy --config wrangler.production.toml
```

ตั้ง `SETUP_TOKEN` และ Secret ของ Push สำหรับ Production ด้วยคำสั่ง `wrangler secret put ... --config wrangler.production.toml` ผ่านหน้าจอที่เครื่องของตนเอง:

```powershell
npx.cmd wrangler secret put SETUP_TOKEN --config wrangler.production.toml
npx.cmd wrangler secret put VAPID_PUBLIC_KEY --config wrangler.production.toml
npx.cmd wrangler secret put VAPID_PRIVATE_KEY --config wrangler.production.toml
npx.cmd wrangler secret put VAPID_SUBJECT --config wrangler.production.toml
```

- ใช้ **SETUP_TOKEN สุ่มยาว** ไม่ใช้ตัวอย่างหรือรหัสที่เดาได้
- ใช้ **VAPID key pair ที่สร้างสำหรับ Production** จากเครื่องที่เชื่อถือได้ เก็บ private key เป็น Secret; `VAPID_SUBJECT` ต้องถูกต้อง เช่น `mailto:` ที่เป็นอีเมลติดต่อผู้ดูแลระบบ
- อย่าเก็บ Secrets ลง GitHub หรืออัปโหลดขึ้น cPanel
- ตรวจ API Production จาก URL Worker ที่ Cloudflare แสดง: `https://<WORKER-PROD>.workers.dev/api/health`
- สร้างบัญชี Admin Production เพียงครั้งเดียวผ่าน `POST /api/setup` โดยใช้ Header `X-Setup-Token` และชื่อผู้ใช้/รหัสผ่านที่ปลอดภัย (อ่าน `docs/INSTALL.md`)
- หลังสร้าง Admin เรียบร้อย: `npx.cmd wrangler secret delete SETUP_TOKEN --config wrangler.production.toml`

**ไม่แนะนำเชื่อมให้ GitHub Actions Dev deploy Production อัตโนมัติ**; ใช้คำสั่ง `--config` ทีละขั้นและตรวจสอบก่อนทุกครั้ง

## 5. สร้างชุดไฟล์อัปโหลด cPanel / DirectAdmin

กลับไปที่โฟลเดอร์ราก `rd-care`:

```powershell
cd ..
node .\scripts\build-cpanel.mjs --site "https://care.YOUR-SCHOOL-DOMAIN.ac.th/rd-connect/" --api "https://<WORKER-PROD>.workers.dev"
python .\scripts\zip-cpanel.py
```

สคริปต์จะปฏิเสธการใส่โดเมน `rd-care.pages.dev` หรือ Worker Dev ลงในแพ็กเกจ Production โดยตั้งใจ และจะไม่แก้ไข `web/config.js` หรือ `worker/wrangler.toml` เดิม

ได้ไฟล์/โฟลเดอร์ดังนี้:

- `dist/cpanel-production/` = ชุดเว็บพร้อม Production `config.js`, CSP ตรง Worker, PWA assets และ `.htaccess`
- `dist/rd-connect-cpanel.zip` = ZIP รวมทุกไฟล์ **รวมไฟล์ซ่อน `.htaccess`**
- ไม่ใส่ `web/_routes.json` เพราะเป็น Pages-only

**อัปโหลด:** cPanel / DirectAdmin → File Manager → เข้า **document root ของ URL ที่เลือกไว้** → Upload `rd-connect-cpanel.zip` → Extract **ในโฟลเดอร์นั้นโดยตรง**; จะต้องมองเห็น `index.html`, `config.js`, `sw.js`, `manifest-staff.webmanifest`, `icons/` และ `.htaccess` อยู่ใน document root เดียวกัน **อย่าอัปโหลดโฟลเดอร์ `worker/`, .git/, .dev.vars หรือไฟล์ credential**

## 6. ตรวจสอบหลังติดตั้งโดยยังไม่ใช้ข้อมูลนักเรียนจริง

1. เปิด URL โรงเรียน เช่น `https://care.YOUR-SCHOOL-DOMAIN.ac.th/rd-connect/` และตรวจว่าหน้าล็อกอินขึ้นโดย HTTPS
2. Developer Tools → Network: `config.js` ต้องชี้ Worker Production เท่านั้น และ `/api/health` ต้องตอบจาก Worker Production (ไม่ใช่ Pages Dev)
3. ทดสอบ Login admin ทดลอง, แก้ค่าคะแนน/แจ้งเตือนใน Production แล้วตรวจว่า **Dev ไม่เปลี่ยน**
4. ทดสอบ QR ครูเวร: พิมพ์ QR ใหม่จาก Production และตรวจลิงก์ต้องขึ้นต้นด้วย URL โรงเรียน (QR เดิมที่พิมพ์จาก Dev จะยังชี้ Dev)
5. ทดสอบเพิ่ม PWA แยกครู/นักเรียน/ผู้ปกครองบนมือถือและ Push พร้อมตรวจสิทธิ์/หน้าที่แสดงหลังแตะ Push
6. ทดสอบการโหลดพร้อมกัน, การป้องกันการส่งคะแนนซ้ำ, การนำเข้าจำนวนมากแบบแบ่งชุด, การจัดเก็บ Log และ Backup/Restore D1
7. ตั้งระบบสำรองข้อมูล D1 แยกจาก Dev ตรวจว่ามีสิทธิ์เข้าถึงจำกัด และทดลองกู้คืนโดยไม่ใช้ฐานจริง
8. ก่อนนำข้อมูลนักเรียนจริงเข้าระบบ ให้โรงเรียนอนุมัติการใช้ข้อมูลและตรวจ PDPA, สิทธิ์ผู้ปกครอง, รหัสผ่าน/MFA, อายุการเก็บข้อมูล, incident response และ security review

## 7. อัปเดตระบบในอนาคตโดย Dev ไม่หยุด

- Web: Merge code `main` ตามกระบวนการปกติ แล้วรัน `node scripts/build-cpanel.mjs ...` ใหม่, `python scripts/zip-cpanel.py` และอัปโหลดเฉพาะชุด Static ไปโฮสติ้ง
- Worker: Backup D1 Production ก่อน → ตรวจ Migration ที่จะใช้ → รัน `wrangler d1 migrations apply ... --config wrangler.production.toml` → `wrangler deploy --config wrangler.production.toml`
- ไม่ใช้ `wrangler deploy` โดยไม่ระบุ Config เมื่ออยู่ในโฟลเดอร์ `worker`, เพราะจะชี้ Dev แทน
- ถ้า PWA แสดงหน้าเก่า ให้เปิดใหม่/รีเฟรชหลัง service worker อัปเดต; เมื่อแก้หน้าเว็บในอนาคตให้เพิ่มเวอร์ชัน cache ใน `web/sw.js`

## การตรวจสอบปัญหาที่พบบ่อย

| อาการ | ตรวจสอบ |
|---|---|
| เปิด URL แล้วไม่พบหน้าเว็บ | document root, index.html, HTTPS, DNS |
| Login แล้ว `Failed to fetch` | `config.js` ในชุดที่อัปโหลด, CSP และ `ALLOWED_ORIGINS` ของ Worker |
| API 403 `origin_not_allowed` | ใส่โดเมนแบบ **origin ไม่รวม path** และตรวจว่าตรงทั้ง www/non-www |
| API ทำงานแต่ 500 | ตรวจว่า migrate ฐาน D1 Production สำเร็จและ Worker binding ใช้ `rd-care-prod` |
| QR มาสายพาไป Pages Dev | ยังไม่กำหนด `PUBLIC_APP_URL` ให้ Worker Production หรือใช้ QR แผ่นเก่า |
| PWA ติดตั้งไม่ได้ | ตรวจ HTTPS, manifest files, service worker scope และไฟล์ icons |
| Push ไม่เข้า | HTTPS, VAPID Production, สิทธิ์แจ้งเตือนในอุปกรณ์, สวิตช์ที่แอดมินเปิด และ Cron Worker |
| `.htaccess` ไม่มีผล | โฮสติ้งอาจเป็น nginx-only ต้องให้ผู้ให้บริการตั้งค่าเทียบเท่าที่เว็บเซิร์ฟเวอร์ |

**ข้อสรุป:** ชุดนี้ช่วยเตรียมการติดตั้งและแยก Production โดยไม่กระทบ Dev แต่การใช้งานข้อมูลนักเรียนจริงยังต้องผ่านการทดสอบและอนุมัติด้านความปลอดภัยก่อน
