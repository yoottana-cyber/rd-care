# RD CONNECT — ทดสอบเช็กชื่อพร้อมกัน (ข้อมูลจำลองเท่านั้น)

## วัตถุประสงค์

ตรวจการส่งผลเช็กชื่อผ่าน API เดิมของ RD CONNECT ด้วยครูจำลอง 5, 20 และ 50 บัญชีพร้อมกัน ทั้งรายวันและรายคาบ วัดความเร็ว ความสำเร็จของ HTTP และความครบถ้วนของข้อมูล SQLite

## ความปลอดภัย

- สร้าง SQLite ชั่วคราวใหม่ภายใต้ os.tmpdir() ไม่ใช่ RD_SQLITE_FILE หรือฐานจริง
- สร้างห้อง 48 ห้อง ครูจำลอง 50 คน นักเรียนจำลองห้องละ 20 คน ไม่มีชื่อจริง
- ใช้ Node.js 2 โปรเซสกับฐานจำลองเดียวกัน ผ่าน 127.0.0.1 เท่านั้น
- ไม่เรียก URL โรงเรียน ไม่แก้ข้อมูล/บัญชีจริง ไม่แตะ MariaDB หรือ Cloudflare D1
- ทดสอบสถานะ มา เท่านั้น ไม่สร้างเหตุหนีเรียนหรือส่ง Push
- จบแล้วลบฐานจำลอง ไม่ยุ่งไฟล์สำรองหรือฐาน SQLite จริง
- ใช้ CPU/RAM/ดิสก์ของเครื่องโฮสต์ชั่วคราว จึงควรรันทดสอบนอกช่วงเช็กชื่อของครูจริง

## วิธีรันบน DirectAdmin

1. อัปโหลดสาขา test/school-checkin-concurrency-lab จาก GitHub ไปยัง rd-connect-school-app เดิม อย่าแตะ rd-connect-private และ rd-connect-backups
2. ที่ Run JS Script เลือก school:test ตรวจชุดทดสอบพื้นฐานก่อน
3. ที่ Run JS Script เลือก school:load-test เพื่อทดสอบครู 5, 20, 50 คนพร้อมกัน
4. ส่งผล stdout และ stderr; ไม่มีข้อมูลนักเรียนจริงในรายงาน ไม่ต้องใส่รหัสผ่านหรือ Environment Variables ใหม่

## ผลที่คาดหวัง

    RD CONNECT CONCURRENCY LAB: 100% SYNTHETIC, 127.0.0.1 ONLY.
    LIVE SQLITE / SCHOOL URL / REAL ACCOUNTS / PUSH: NOT USED.
    [OK] DAILY 5 teachers: success 5/5 | p50 ...ms | p95 ...ms
    [OK] DAILY 20 teachers: success 20/20 | p50 ...ms | p95 ...ms
    [OK] DAILY 50 teachers: success 50/50 | p50 ...ms | p95 ...ms
    [OK] PERIOD 5 teachers: success 5/5 | p50 ...ms | p95 ...ms
    [OK] PERIOD 20 teachers: success 20/20 | p50 ...ms | p95 ...ms
    [OK] PERIOD 50 teachers: success 50/50 | p50 ...ms | p95 ...ms
    DATABASE: daily 960 rows, period 1000 rows, audit 150 writes; integrity OK, foreign keys OK.
    LOAD TEST PASS: 5/20/50 simultaneous requests in DAILY and PERIOD, 2 independent Node processes.
    ALL REAL SCHOOL DATA UNTOUCHED. SYNTHETIC DATABASE REMOVED.

p50 = ค่ากลางเวลาตอบสนอง และ p95 = เวลา 95 เปอร์เซ็นต์ของคำขอตอบสำเร็จภายในเวลานี้

- returncode 0: คำขอทั้งหมด HTTP 200, บันทึกครบ 20 คนต่อคำขอ, SQLite สมบูรณ์ และ p95 ไม่มีชุดใดเกิน 10 วินาที
- returncode 1: มีข้อผิดพลาด หรือข้อมูลไม่ครบ หรือช้าเกินเกณฑ์
- p95 เกิน 3 วินาทีมีคำเตือน แม้อาจผ่านการตรวจความถูกต้อง
- รายวัน 48 ห้อง x 20 = 960 ระเบียน; รายคาบ 50 คาบ x 20 = 1000 ระเบียน (ครูที่ปรึกษาคนที่สองของ 2 ห้อง มีคาบสอนแยกกัน)
- เป็นการทดสอบสองโปรเซสบนเครื่องโฮสต์ ไม่ใช่หลักประกันรองรับทั้งโรงเรียนในทุกสถานการณ์ ระบบ Push ยังต้องตรวจต่างหาก

ข้อควรระวัง: อย่าทดสอบบนข้อมูลนักเรียนจริงโดยยิง HTTP พร้อมกัน และอย่ารัน school:install อีก
