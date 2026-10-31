# เปิด Cron Jobs สำหรับ RD CONNECT โรงเรียนรัษฎา (Node.js + SQLite)

ระบบเดิมใช้ `https://rd-connect.ratsada.ac.th`, Node.js 24 + Passenger,
Application Root `/home/ratsadaa/rd-connect-school-app`, ฐานข้อมูล
`/home/ratsadaa/rd-connect-private/rd-connect.sqlite`.

**ห้ามเรียก Cloudflare Worker, ย้ายฐานข้อมูล, หรือเรียก school:init / school:install ซ้ำ**
อย่ารันแอปสองอินสแตนซ์ที่เขียน SQLite เดียวกันพร้อมกัน

## 1. ก่อนเปิด Cron ที่ส่ง Push จริง

ที่ DirectAdmin → Setup Node.js App ของ **แอปเดิม** → Run JS Script:

1. เรียก `school:backup` ให้สำเร็จ (exit 0 และ VERIFIED)
2. เรียก `school:push-check` ให้ VAPID READY และตรวจจำนวนอุปกรณ์ที่สมัครจริง
3. เรียก `school:cron-preflight` (READ ONLY) ต้องได้ `PREFLIGHT PASS`

Preflight จะสรุปเหตุการณ์ที่อาจรอแจ้งเตือน แต่ไม่ทราบผู้รับที่แน่นอน
**ต้องตรวจสิทธิ์ผู้รับ ความยินยอม และเหตุการณ์ค้างก่อนรัน `school:cron` ครั้งแรก**
โดยเฉพาะอุปกรณ์ที่เคยสมัครภายใต้โดเมนเก่า

> หากไม่เห็น `school:cron-preflight` ใน Run JS Script แปลว่าไฟล์ของสาขา
> `feature/school-root-subdomain` บน Application Root อาจยังไม่ครบ
> ให้ตรวจสอบการ Deploy โค้ดก่อน อย่าสร้างฐานข้อมูลใหม่

## 2. ตรวจคำสั่งที่ Cron ของโฮสต์ใช้ได้

CloudLinux Node.js Selector รองรับการเรียกสคริปต์จาก package.json ผ่าน
`cloudlinux-selector run-script --json --interpreter nodejs --app-root rd-connect-school-app --script-name NAME`.
การเรียกด้วย Selector ช่วยให้ใช้ Node.js และ Environment Variables ของแอปที่ตั้งไว้
ใน DirectAdmin แทนการสร้าง VAPID Keys ใหม่หรือพิมพ์รหัสลับลงใน Cron

เมื่อมี Terminal/SSH ให้ตรวจ `command -v cloudlinux-selector` และ
`command -v flock` ก่อนใช้คำสั่งด้านล่าง (ตัวอย่างใช้ `/usr/sbin` และ `/usr/bin`).
หากโฮสต์ไม่อนุญาตการเรียก Selector ผ่าน Cron ให้ผู้ดูแลตรวจสิทธิ์และวิธีเรียกสคริปต์;
**อย่าแก้ด้วยการใส่ Private Key ลงในช่อง Cron**

## 3. สร้าง Cron Job ที่ 1: สำรอง SQLite ทุกวัน

DirectAdmin → Advanced Features → Cron Jobs → Create Cron Job

- Minute: `0`
- Hour: `2`
- Day of Month: `*`
- Month: `*`
- Day of Week: `*`
- Command (หนึ่งบรรทัด):

```sh
/usr/bin/flock -n /home/ratsadaa/rd-connect-private/rd-connect-backup.lock /usr/sbin/cloudlinux-selector run-script --json --interpreter nodejs --app-root rd-connect-school-app --script-name school:backup >> /home/ratsadaa/rd-connect-private/backup-cron.log 2>&1
```

**02:00 เป็นเวลาเซิร์ฟเวอร์** ตรวจให้ตรงกับ Asia/Bangkok หากโฮสต์ใช้เขตเวลาอื่น
ควรทดลอง `school:backup` ผ่าน Selector ก่อนบันทึก Cron และตรวจไฟล์ที่สร้างหลังรันจริง

## 4. สร้าง Cron Job ที่ 2: ส่ง Push ตามรอบทุก 5 นาที

**เปิดหลัง preflight PASS และผู้ดูแลตรวจเหตุการณ์ค้าง/ผู้รับแล้วเท่านั้น**

- Minute: `*/5`
- Hour: `*`
- Day of Month: `*`
- Month: `*`
- Day of Week: `*`
- Command (หนึ่งบรรทัด):

```sh
/usr/bin/flock -n /home/ratsadaa/rd-connect-private/rd-connect-push.lock /usr/sbin/cloudlinux-selector run-script --json --interpreter nodejs --app-root rd-connect-school-app --script-name school:cron >> /home/ratsadaa/rd-connect-private/push-cron.log 2>&1
```

`flock -n` ใช้ป้องกันการรันรอบถัดไปทับซ้อนกับรอบที่ยังไม่เสร็จ
ไม่ต้องใส่ `setInterval` ใน Passenger และไม่ต้องเรียก HTTP API จาก Cron

> สำคัญ: CloudLinux Selector บนโฮสต์นี้ต้องใช้ `run-script --json`;
> หากไม่ระบุจะได้ `use --json option, other modes currently unsupported`.
> ผลของ Selector เป็น JSON: ตรวจ `result` ว่าเป็น `success` และตรวจ log
> หากมีฟิลด์ `data` อาจเป็น stdout ของสคริปต์ที่เข้ารหัส Base64
> จึงอย่าตัดสินด้วยการค้นหา `SCHOOL CRON COMPLETED` เป็น plain text อย่างเดียว
> ต้องตรวจผลสำรองฐานข้อมูลและการส่งแจ้งเตือนจริงอีกครั้ง

## 5. ตรวจผลหลังเปิดจริง

- เรียก `school:cron-preflight` ก่อน และตรวจผลก่อนเปิด `school:cron`
- ตรวจ `/home/ratsadaa/rd-connect-private/push-cron.log` โดยไม่เผยแพร่ VAPID/ข้อมูลนักเรียน
- หลัง Cron ทำงานควรเห็น `SCHOOL CRON COMPLETED`; ถ้าเจอ `SCHOOL CRON ERROR`
  หรือ `school_public_origin_required` ให้ระงับงาน Push ตรวจ environment และสิทธิ์ CLI
- ตรวจ `backup-cron.log` และไฟล์ Backup ใหม่ภายในโฟลเดอร์ private backup
- ทดสอบ push บนอุปกรณ์ที่ opt in ภายใต้โดเมนใหม่ ครู/นักเรียน/ผู้ปกครอง
- ตั้งค่าดูแลขนาด log และพื้นที่สำรองข้อมูล และทดลอง Restore ในฐานสำเนาแยก

> **ความสามารถ:** ขั้นตอนนี้เป็นคู่มือและคำสั่งเตรียมไว้สำหรับผู้ดูแล
> การอัปเดต GitHub **ไม่ใช่** การสร้างงาน Cron ใน DirectAdmin โดยอัตโนมัติ
