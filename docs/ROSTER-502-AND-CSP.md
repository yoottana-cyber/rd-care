# ตรวจสอบ HTTP 502 ระหว่างนำเข้านักเรียน (Cloudflare Pages / Worker / D1)

## ความหมายของข้อผิดพลาด
- `POST /api/admin/unified-import/commit → 502` จาก Pages Function เกิดได้เมื่อ `RD_CARE_API.fetch` ผ่าน Service Binding โยน exception แทนที่จะคืนคำตอบ HTTP ปกติ อาจเกิดจาก Worker ล้มเหลว, CPU limit, deployment mismatch, binding ผิด หรือ D1 ไม่พร้อม ต้องตรวจ Logs ก่อนสรุปสาเหตุ
- `Content Security Policy style-src` เป็นข้อผิดพลาดคนละส่วนจาก `style="..."` ใน HTML ของหน้า Preview: ย้ายไปไฟล์ `app.css` แล้ว **ไม่** เปิด `unsafe-inline`
- Error ด้านหน้าอาจเกิดหลัง transaction บันทึกไปแล้ว อย่าถือว่ารายการที่ HTTP 502 เป็น “ไม่ได้บันทึก” ให้ยืนยันผลก่อนส่งซ้ำ

## ขั้นตอนตรวจบน Production

1. เปิด Admin → จัดการนักเรียน → นำเข้า Excel/CSV → ปุ่ม **ตรวจสอบการเชื่อมต่อ Worker/D1** ซึ่งเรียก `GET /api/admin/unified-import/health` หลัง Login เท่านั้น ไม่มีข้อมูลรายชื่อนักเรียนในผล API
2. หากได้ 200 พร้อม `ok:true` Worker เชื่อมฐานข้อมูลและคอลัมน์ที่ใช้นำเข้าได้ (ยังไม่รับประกันว่าเขียนข้อมูลได้หรือ CPU เพียงพอ)
3. หากได้ 503 พร้อม `issues` ให้ตรวจ migrations และ binding ของ `students`, `enrollments`, `accounts`, `sessions`, `audit` ตามหมวดที่แจ้ง
4. หากได้ 502 พร้อม `request_id` แสดงว่า Pages gateway ไม่ได้รับ response ปกติจาก Service Binding: ดู Cloudflare Pages Functions logs และ Worker logs ในช่วงเวลาที่เกิดเหตุด้วยเลขอ้างอิงที่แสดง (หากมี) ไม่ต้องส่งไฟล์หรือรหัสผ่าน
5. หาก health 200 แต่ commit 502 ให้ดู Worker CPU limit, `PBKDF2` 100,000 iterations, D1 query logs, และข้อผิดพลาดจาก SQL batch ของรายการนั้น
6. สำรอง D1 ตรวจว่ามี Migration จนถึง `0030_large_roster_import_lookup.sql`, Deploy Worker และ Pages ให้ตรงกัน และทดสอบข้อมูลสมมติหนึ่งรายการ ก่อนนำเข้าข้อมูลจริง 1,750 คน

## การป้องกันความเสียหาย
- UI หยุดทันทีเมื่อได้รับ HTTP 500/502/503/504 แทนส่งต่อหลายครั้ง
- รายการที่ไม่ทราบผลจะมีสถานะ `uncertain` และยังอยู่ในหน้าเดิม ดำเนินการต่อได้เมื่อระบบพร้อม โดย API ต้องค้น student_no เพื่อตัดสินใจ insert/update ทุกครั้ง
- รายการที่สำเร็จแล้วคงอยู่ และไม่ถูกนำเข้าซ้ำจากการกดดำเนินการต่อ
- แสดง `request_id` เฉพาะรหัสติดตามข้อผิดพลาด ไม่เก็บหรือ log password / รายชื่อนักเรียน
