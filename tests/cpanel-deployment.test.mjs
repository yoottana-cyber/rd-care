import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {lateQrPublicUrl} from '../worker/src/late-qr.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const source=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const testOut='dist/cpanel-kit-unit-'+process.pid;
const target=resolve(root,testOut);
const build=(...args)=>spawnSync(process.execPath,['scripts/build-cpanel.mjs',...args],
 {cwd:root,encoding:'utf8',timeout:35000});
const site='https://care.school.ac.th/rd-connect/';
const api='https://rd-care-api-prod.school-worker.workers.dev';
test('production QR points to the school domain but Dev keeps the existing printed link',()=>{
 assert.equal(lateQrPublicUrl({},'gate'),'https://rd-care.pages.dev/?late_qr=gate');
 assert.equal(lateQrPublicUrl({PUBLIC_APP_URL:site},'gate'),site+'?late_qr=gate');
 assert.equal(lateQrPublicUrl({PUBLIC_APP_URL:site},'a & b'),site+'?late_qr=a+%26+b');
 for(const invalid of ['http://care.school.ac.th/rd-connect/','https://care.school.ac.th/rd-connect',
  'https://care.school.ac.th/rd-connect/?abc=123']){
  assert.throws(()=>lateQrPublicUrl({PUBLIC_APP_URL:invalid}),/PUBLIC_APP_URL/);
 }
 assert.match(source('worker/src/late-qr.js'),/lateQrPublicUrl\(env\)/);
 assert.match(source('worker/src/late-qr.js'),/lateQrPublicUrl\(env,token\)/);
});
test('builder produces a direct-Worker upload folder including hidden .htaccess without altering Dev',()=>{
 const devConfig=source('web/config.js');
 try{
  const result=build('--site',site,'--api',api,'--out',testOut);
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.ok(existsSync(resolve(target,'index.html')));
  assert.ok(existsSync(resolve(target,'.htaccess')));
  assert.ok(existsSync(resolve(target,'sw.js')));
  assert.ok(existsSync(resolve(target,'manifest-student.webmanifest')));
  assert.ok(existsSync(resolve(target,'icons','icon-192.png')));
  assert.equal(existsSync(resolve(target,'_routes.json')),false);
  const config=readFileSync(resolve(target,'config.js'),'utf8');
  assert.match(config,/API_BASE_URL = "https:\/\/rd-care-api-prod/);
  assert.ok(config.includes(api));
  const html=readFileSync(resolve(target,'index.html'),'utf8');
  assert.ok(html.includes("connect-src 'self' "+api));
  assert.ok(!html.includes('connect-src https: http://localhost'));
  assert.equal(source('web/config.js'),devConfig);
  assert.match(result.stdout,/CORS ALLOWED_ORIGINS: https:\/\/care\.school\.ac\.th/);
  assert.match(result.stdout,/Worker PUBLIC_APP_URL:/);
 }finally{
  rmSync(target,{recursive:true,force:true});
 }
});
test('builder refuses Dev endpoints, insecure URLs and dangerous output locations',()=>{
 for(const pairs of [
  ['http://care.school.ac.th/rd-connect/',api],
  ['https://rd-care.pages.dev/',api],
  [site,'https://rd-care-api-dev.yoottana.workers.dev'],
  [site,'http://rd-care-api-prod.school-worker.workers.dev'],
  ['https://care.school.ac.th/rd-connect',api]]){
  const result=build('--site',pairs[0],'--api',pairs[1],'--out',testOut);
  assert.notEqual(result.status,0,'Expected build rejection for '+pairs.join(' vs '));
 }
 for(const out of ['web','worker','dist','scripts']){
  const result=build('--site',site,'--api',api,'--out',out);
  assert.notEqual(result.status,0,'Expected unsafe path rejection: '+out);
 }
 assert.equal(existsSync(target),false);
});
test('production Worker config is isolated and never points at Dev D1 or Worker',()=>{
 const config=source('worker/wrangler.production.example.toml');
 const dev=source('worker/wrangler.toml');
 assert.match(config,/name = "rd-care-api-prod"/);
 assert.match(config,/database_name = "rd-care-prod"/);
 assert.match(config,/PUBLIC_APP_URL/);
 assert.match(config,/ALLOWED_ORIGINS/);
 assert.doesNotMatch(config,/161c2fb5-cd80-42bd-bbab-28b5d61df3e0/);
 assert.match(dev,/name = "rd-care-api-dev"/);
 assert.match(dev,/database_name = "rd-care-dev"/);
 assert.match(source('.gitignore'),/worker\/wrangler\.production\.toml/);
});
