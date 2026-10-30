'use strict';
// Stage 6.4: Auth service implementation, intentionally NOT bound to the public HTTP listener.
// Exercise ONLY through transactional check:auth-service, with synthetic temporary users.
// The D1 password verifier handles two old PBKDF2 schemes for compatibility.
// Production deployment must upgrade stored password hashes after successful login.
const {randomBytes,createHash}=require('node:crypto');
const {verifyD1Password,d1PasswordHash}=require('./d1-password-compat.cjs');
const USERNAME=/^[a-z0-9._-]{3,40}$/i;
const TOKEN=/^[0-9a-f]{64}$/;
const SESSION_NORMAL=8*3600;
const SESSION_REMEMBER=30*86400;
const FAKE_SALT='rd2$00000000000000000000000000000000';
const TABLES=Object.freeze({
 staff:{account:'users',sessions:'sessions',attempts:'login_attempts',fk:'user_id'},
 portal:{account:'portal_accounts',sessions:'portal_sessions',attempts:'portal_login_attempts',fk:'account_id'}
});
function fail(status,code){
 const err=new Error(code);
 err.status=status;err.code=code;
 throw err;
}
function kindInfo(kind){
 if(!Object.prototype.hasOwnProperty.call(TABLES,kind))fail(400,'invalid_account_area');
 return TABLES[kind];
}
function publicAccount(row,kind){
 const base={id:row.id,username:row.username,display_name:row.display_name,role:row.role};
 if(kind==='portal')return { ...base,must_change_password:false };
 return base;
}
function sessionHash(token){return createHash('sha256').update(token).digest('hex')}
function tokenFromAuthorization(value){
 if(typeof value!=='string')return null;
 const m=/^Bearer ([0-9a-f]{64})$/.exec(value);
 return m?m[1]:null;
}
async function verifyAccountPassword(password,row){
 // Same fake PBKDF2 call for unknown users, to limit username enumeration timing.
 const salt=typeof row?.password_salt==='string'?row.password_salt:FAKE_SALT;
 const expected=typeof row?.password_hash==='string'?row.password_hash:null;
 if(!expected){await d1PasswordHash(password,salt);return false}
 return verifyD1Password(password,salt,expected);
}
function checkLoginInput(body,kind){
 kindInfo(kind);
 if(!body||typeof body!=='object'||Array.isArray(body))fail(400,'invalid_input');
 const username=typeof body.username==='string'?body.username.trim().toLowerCase():'';
 const password=body.password;
 if(!USERNAME.test(username)||typeof password!=='string'||password.length<1||password.length>512)fail(400,'invalid_input');
 const role=kind==='portal'?body.role:null;
 if(kind==='portal'&&!['student','guardian'].includes(role))fail(400,'invalid_role');
 return {username,password,role,remember:body.remember===true};
}
function failureKey(kind,username){return kind==='portal'?'portal:'+username:username}
function unixNow(now=Date.now){return Math.floor(now()/1000)}
async function readAttempts(conn,table,key){
 const [rows]=await conn.execute('SELECT failures,locked_until FROM `'+table+'` WHERE username=?',[key]);
 return rows[0]||null;
}
async function recordFailure(conn,table,key,previous,at){
 const failures=Number(previous?.failures||0)+1;
 const locked=failures>=5?at+900:0;
 // Atomic upsert. Keep the count >=5 during lock; don't reset at threshold.
 await conn.execute('INSERT INTO `'+table+'` (username,failures,locked_until) VALUES (?,?,?) ON DUPLICATE KEY UPDATE failures=VALUES(failures),locked_until=VALUES(locked_until)',
  [key,failures,locked]);
}
async function login(conn,{kind,body,now=Date.now,random=randomBytes}){
 const spec=kindInfo(kind);
 const parsed=checkLoginInput(body,kind);
 const at=unixNow(now);
 const key=failureKey(kind,parsed.username);
 const existing=await readAttempts(conn,spec.attempts,key);
 if(Number(existing?.locked_until||0)>at)fail(429,'too_many_attempts');
 const [records]=await conn.execute(
  'SELECT id,username,display_name,role,password_salt,password_hash,active FROM `'+spec.account+'` WHERE username=? AND active=1 LIMIT 1',
  [parsed.username]
 );
 const account=records[0];
 const valid=await verifyAccountPassword(parsed.password,account);
 if(!account||!valid||(kind==='portal'&&account.role!==parsed.role)){
  await recordFailure(conn,spec.attempts,key,existing,at);
  fail(401,'invalid_credentials');
 }
 await conn.execute('DELETE FROM `'+spec.attempts+'` WHERE username=?',[key]);
 const sessionSeconds=parsed.remember?SESSION_REMEMBER:SESSION_NORMAL;
 const token=random(32).toString('hex');
 if(!TOKEN.test(token))throw new Error('bad_random_token');
 await conn.execute(
  'INSERT INTO `'+spec.sessions+'` (token_hash,`'+spec.fk+'`,expires_at,remember_device) VALUES (?,?,?,?)',
  [sessionHash(token),account.id,at+sessionSeconds,parsed.remember?1:0]
 );
 const field=kind==='portal'?'account':'user';
 return {token,[field]:publicAccount(account,kind),expires_in:sessionSeconds};
}
async function me(conn,{kind,authorization,now=Date.now}){
 const spec=kindInfo(kind);
 const token=tokenFromAuthorization(authorization);
 if(!token)fail(401,'authentication_required');
 const at=unixNow(now);
 const [rows]=await conn.execute(
  'SELECT a.id,a.username,a.display_name,a.role,a.active FROM `'+spec.sessions+'` s '+
  'JOIN `'+spec.account+'` a ON a.id=s.`'+spec.fk+'` '+
  'WHERE s.token_hash=? AND s.expires_at>? AND a.active=1 LIMIT 1',
  [sessionHash(token),at]
 );
 if(!rows.length)fail(401,'session_expired');
 const account=publicAccount(rows[0],kind);
 if(kind==='staff'){
  const [assignments]=await conn.execute(
   'SELECT 1 AS assigned FROM student_affairs_assignments WHERE user_id=? LIMIT 1',
   [rows[0].id]
  );
  account.student_affairs=(rows[0].role==='admin'||rows[0].role==='staff'||assignments.length>0)?1:0;
 }
 return kind==='staff'?{user:account}:{account};
}
async function logout(conn,{kind,authorization}){
 const spec=kindInfo(kind);
 const token=tokenFromAuthorization(authorization);
 if(!token)fail(401,'authentication_required');
 await conn.execute('DELETE FROM `'+spec.sessions+'` WHERE token_hash=?',[sessionHash(token)]);
 return {ok:true};
}
module.exports={
 TABLES,SESSION_NORMAL,SESSION_REMEMBER,
 kindInfo,checkLoginInput,publicAccount,sessionHash,tokenFromAuthorization,
 verifyAccountPassword,login,me,logout
};
