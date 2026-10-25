// Admin input validation shared by the Worker and unit tests.
// Fail before any DB write; keep school records in a fixed, auditable shape.
export function validateStudentInput(data) {
  const classroom_id = Number(data?.classroom_id);
  const roll_no = Number(data?.roll_no);
  const student_no = typeof data?.student_no === 'string' ? data.student_no.trim() : '';
  const full_name = typeof data?.full_name === 'string' ? data.full_name.trim() : '';
  const active = data?.active === undefined ? 1 : data.active;
  if (!Number.isSafeInteger(classroom_id) || classroom_id < 1) throw Error('กรุณาเลือกห้องเรียน');
  if (!Number.isSafeInteger(roll_no) || roll_no < 1 || roll_no > 100) throw Error('เลขที่ต้องอยู่ระหว่าง 1–100');
  if (!student_no || student_no.length > 40 || /[\u0000-\u001f\u007f]/.test(student_no))
    throw Error('กรุณากรอกรหัสนักเรียนไม่เกิน 40 ตัวอักษร');
  if (!full_name || full_name.length > 120 || /[\u0000-\u001f\u007f]/.test(full_name))
    throw Error('กรุณากรอกชื่อ–สกุลไม่เกิน 120 ตัวอักษร');
  if (active !== 0 && active !== 1 && active !== false && active !== true)
    throw Error('สถานะนักเรียนไม่ถูกต้อง');
  return {classroom_id,roll_no,student_no,full_name,active:Number(active)};
}

export function validatePersonnelInput(data) {
  const display_name = typeof data?.display_name === 'string' ? data.display_name.trim() : '';
  const active = data?.active;
  if (!display_name || display_name.length > 100 || /[\u0000-\u001f\u007f]/.test(display_name))
    throw Error('กรุณากรอกชื่อบุคลากรไม่เกิน 100 ตัวอักษร');
  if (active !== 0 && active !== 1 && active !== false && active !== true)
    throw Error('สถานะบุคลากรไม่ถูกต้อง');
  return {display_name,active:Number(active)};
}
