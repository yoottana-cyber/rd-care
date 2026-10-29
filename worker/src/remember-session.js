// One authenticated renewal adds another 30 days of inactivity allowance.
// The bearer remains revocable; no unexpiring credentials are issued.
export const REMEMBER_SECONDS=30*86400;
const day=86400;
const fail=(code,message)=>{throw Object.assign(new Error(message),{code})};

export async function renewRememberedSession(db,tokenHash,portal=false,at=Math.floor(Date.now()/1000)){
 const table=portal?'portal_sessions':'sessions';
 // Legacy sessions created before the remember_device migration had 30-day
 // lifetimes but no flag. They can upgrade only if their ORIGINAL lifetime
 // was a remembered session, never from a tab-only eight-hour login.
 const sql=`UPDATE ${table} SET expires_at=?,remember_device=1
  WHERE token_hash=? AND expires_at>? AND (
    remember_device=1 OR expires_at-CAST(strftime('%s',created_at) AS INTEGER)
      BETWEEN ? AND ?
  ) RETURNING expires_at`;
 const row=await db.prepare(sql).bind(at+REMEMBER_SECONDS,tokenHash,at,
  29*day,31*day).first();
 if(!row)fail(403,'เซสชันนี้ไม่ได้เปิดจดจำการเข้าสู่ระบบ หรือหมดอายุแล้ว');
 return {ok:true,expires_in:REMEMBER_SECONDS};
}
