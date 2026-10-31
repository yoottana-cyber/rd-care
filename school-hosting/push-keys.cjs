'use strict';
// School-only one-time VAPID pair generation. No secret is printed to stdout.
// The secret is placed in an owner-only file OUTSIDE the public web directory.
// Operator copies the two values to DirectAdmin environment variables, sets
// VAPID_SUBJECT to a school contact, and deletes the temporary key file.
const fs=require('node:fs');
const path=require('node:path');
const {createECDH}=require('node:crypto');
const {privateDbPath}=require('./d1-sqlite.cjs');
const {WEB_ROOT}=require('./server.cjs');
const FILE_NAME='rd-connect-vapid-SETUP-PRIVATE.txt';
function destination(env){
 const source=privateDbPath(env.RD_SQLITE_FILE,WEB_ROOT);
 const dir=path.dirname(source);
 if(!fs.existsSync(source)||!fs.statSync(source).isFile())
  throw Error('school_push_database_not_ready');
 const stat=fs.lstatSync(dir);
 if(stat.isSymbolicLink()||!stat.isDirectory()||(stat.mode&0o077)!==0)
  throw Error('school_push_private_directory_insecure');
 return path.join(dir,FILE_NAME);
}
function createVapidPair(){
 const ecdh=createECDH('prime256v1');
 ecdh.generateKeys();
 const publicBytes=ecdh.getPublicKey(null,'uncompressed');
 const privateBytes=Buffer.from(ecdh.getPrivateKey().toString('hex').padStart(64,'0'),'hex');
 if(publicBytes.length!==65||publicBytes[0]!==4||privateBytes.length!==32)
  throw Error('school_push_key_generation_failed');
 return {
  publicKey:publicBytes.toString('base64url'),
  privateKey:privateBytes.toString('base64url')
 };
}
function run({env=process.env,log=console.log}={}){
 if(Number(process.versions.node.split('.')[0])<24)
  throw Error('school_push_node_24_required');
 if(['VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'].some(k=>String(env[k]||'').trim()))
  throw Error('school_push_existing_vapid_settings');
 const target=destination(env);
 if(fs.existsSync(target))throw Error('school_push_setup_file_already_exists');
 const pair=createVapidPair();
 // 'wx' is atomic no-overwrite protection; 0600 means account owner only.
 const contents='VAPID_PUBLIC_KEY='+pair.publicKey+'\n'+
  'VAPID_PRIVATE_KEY='+pair.privateKey+'\n';
 fs.writeFileSync(target,contents,{flag:'wx',mode:0o600,encoding:'utf8'});
 fs.chmodSync(target,0o600);
 log('SCHOOL VAPID GENERATED ONCE IN PRIVATE FILE: '+FILE_NAME);
 log('NO SECRET PRINTED. Open with school-owner File Manager only.');
 log('COPY VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY into DirectAdmin Node App Environment Variables.');
 log('SET VAPID_SUBJECT separately to mailto:your-actual-school-contact-email.');
 log('SAVE SETTINGS, RESTART NODE APP, THEN RUN school:push-check.');
 log('DELETE THE PRIVATE SETUP FILE AFTER VERIFYING SETTINGS, WITHOUT POSTING ITS CONTENT ANYWHERE.');
 log('NO DATABASE CHANGES. NO DEVICE SUBSCRIPTIONS. NO PUSH SENT.');
 return {ok:true,file:target};
}
if(require.main===module){
 try{run()}catch(e){
  const code=String(e?.message||'');
  console.error('SCHOOL VAPID KEYGEN BLOCKED ('+
   (/^school_push_[a-z0-9_]+$/.test(code)?code:'school_push_generation_failed')+').');
  process.exitCode=1;
 }
}
module.exports={FILE_NAME,destination,createVapidPair,run};
