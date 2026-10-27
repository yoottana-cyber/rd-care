# Deploy RD CONNECT Dev Worker ผ่าน GitHub Actions

ใช้เฉพาะ **Cloudflare Dev**:
- Worker: `rd-care-api-dev`
- D1: `rd-care-dev`
- D1 ID: `161c2fb5-cd80-42bd-bbab-28b5d61df3e0`

Cloudflare Pages deploy frontend อัตโนมัติเมื่อ Merge เข้า `main`. ส่วน Worker/D1 ต้องมี Cloudflare credentials ใน **GitHub Actions secrets** (ห้ามใส่ลงไฟล์ GitHub หรือแชต)

## ตั้งค่าครั้งเดียว (สำหรับเจ้าของบัญชี Cloudflare)

1. เข้า Cloudflare Dashboard → Account API Tokens → Create Token
2. สร้าง API Token ที่จำกัดเฉพาะบัญชี Dev ของ RD CONNECT โดยอนุญาตอย่างน้อย **Workers Editor** สำหรับ `rd-care-api-dev` และ **D1 Edit** สำหรับฐาน `rd-care-dev` เพื่อให้รัน remote migrations ได้ อย่าให้สิทธิ์กว้างกว่าจำเป็น
3. จด **Account ID** จากบัญชี Cloudflare
4. ไป GitHub `yoottana-cyber/rd-care` → **Settings → Secrets and variables → Actions → New repository secret** เพิ่ม:
   - `CLOUDFLARE_ACCOUNT_ID` = Account ID ของ Cloudflare
   - `CLOUDFLARE_API_TOKEN` = Token ที่สร้างข้างต้น
5. ห้ามใส่ Token ลง `wrangler.toml`, `README.md`, commit หรือข้อความในแชต

## วิธี Deploy

1. ไป GitHub → Actions → **Deploy RD CONNECT Dev Worker**
2. เลือก **Run workflow** → Branch `main` → Run workflow
3. ขั้นตอนจะตรวจ Credentials, ตรวจ JS/tests, Apply D1 Migration และ Deploy Worker ตามลำดับ
4. สำเร็จแล้วตรวจ `https://rd-care-api-dev.yoottana.workers.dev/api/health` และ Login ผ่านหน้าเว็บทดลอง

การแก้ `worker/**` บน `main` หลังตั้ง Secrets แล้วจะรัน Deploy อัตโนมัติ เฉพาะ Worker และ D1 Dev; ไม่แตะ Hosting โรงเรียน

## Troubleshooting

- ถ้าขึ้น `Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID`: เพิ่ม/ตรวจ GitHub Actions Secrets ให้ตรงชื่อ
- ถ้า API Token permission denied: ตรวจสิทธิ์ Worker Editor และ D1 Edit ในบัญชี Dev ให้ตรงบัญชี
- ถ้า Migration ล้มเหลว: **ไม่ Deploy Worker ใหม่** เพื่อป้องกันการเรียกตารางที่ยังไม่มี
- หาก Worker Deploy สำเร็จ แต่ Pages ยังแสดงหน้าเก่า: รีเฟรช `Ctrl + Shift + R`; Cloudflare Pages และ Worker deploy แยกกัน
- การ Deploy Worker รุ่นนี้อาศัย Migration `0002_notification_outbox.sql` (ไม่มีการลบข้อมูลนักเรียนใน Migration นี้)
- ห้ามเพิ่มข้อมูลจริงของนักเรียน/ผู้ปกครองก่อนทดสอบ PDPA/สิทธิ์/ความปลอดภัยครบถ้วน

## สถานะ

ถ้า Secrets ยังไม่ถูกกำหนด GitHub Actions จะหยุดที่ขั้นตรวจ Credentials และจะไม่ทำ Migration/Deploy ใด ๆ.
