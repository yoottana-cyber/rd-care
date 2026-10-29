import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const file=path=>fileURLToPath(new URL('../'+path,import.meta.url));
const read=path=>readFileSync(file(path),'utf8');
const php=spawnSync('php',['-v'],{encoding:'utf8'});
const canPhp=php.status===0;
const entry=file('php-hosting/public/api/index.php');
const privateDir=file('php-hosting/private/');

function invoke(uri,dir=privateDir){
 const phpCode='$_SERVER["REQUEST_METHOD"]="GET";$_SERVER["REQUEST_URI"]='+JSON.stringify(uri)+
 '; require '+JSON.stringify(entry)+';';
 return spawnSync('php',['-r',phpCode],{
  encoding:'utf8',timeout:10000,env:{...process.env,RD_CONNECT_PRIVATE_DIR:dir}
 });
}
test('migration plan makes clear nothing is Production ready and Dev remains isolated',()=>{
 const guide=read('docs/PHP-MYSQL-MIGRATION-PLAN.md');
 const readme=read('php-hosting/README.md');
 assert.match(guide,/46 ไฟล์/);
 assert.match(guide,/rd-care-dev/);
 assert.match(guide,/MySQL/);
 assert.match(guide,/ตักเตือน/);
 assert.match(guide,/PHP 8\.2/);
 assert.match(guide,/Backup/);
 assert.match(guide,/Cron/);
 assert.match(guide,/Push/);
 assert.match(readme,/NOT PRODUCTION READY/);
 assert.match(read('.gitignore'),/php-hosting\/private\/config\.local\.php/);
});
test('no fake success responses or unprotected school credentials are shipped',()=>{
 const entryText=read('php-hosting/public/api/index.php');
 const bootstrap=read('php-hosting/private/bootstrap.php');
 const template=read('php-hosting/private/config.example.php');
 assert.match(entryText,/migration_configuration_missing/);
 assert.match(bootstrap,/endpoint_not_migrated/);
 assert.match(bootstrap,/migration_not_ready/);
 assert.match(template,/CHANGE_LOCALLY_NEVER_COMMIT/);
 assert.doesNotMatch(entryText,/rd-care-api-dev|rd-care.pages.dev|password_hash\(/);
 assert.doesNotMatch(bootstrap,/SELECT \* FROM users/);
 assert.match(read('php-hosting/public/api/.htaccess'),/RewriteRule/);
});
test('MySQL metadata schema is safe and does not pretend to be the school data schema',()=>{
 const sql=read('php-hosting/mysql/0000_schema_migrations.sql');
 assert.match(sql,/CREATE TABLE IF NOT EXISTS rd_schema_migrations/);
 assert.match(sql,/ENGINE=InnoDB/);
 assert.match(sql,/utf8mb4/);
 assert.doesNotMatch(sql,/CREATE TABLE (users|students|behavior_records)/);
 const pdo=read('php-hosting/private/src/Database.php');
 assert.match(pdo,/PDO::ATTR_EMULATE_PREPARES => false/);
 assert.match(pdo,/charset=utf8mb4/);
 assert.match(pdo,/PDO::ERRMODE_EXCEPTION/);
});
test('PHP 8.2+ syntax check on scaffold', {skip:!canPhp&&'PHP CLI is not installed on CI runner'},()=>{
 for(const path of [
  'php-hosting/public/api/index.php',
  'php-hosting/private/bootstrap.php',
  'php-hosting/private/src/Database.php',
  'php-hosting/private/config.example.php'
 ]){
  const r=spawnSync('php',['-l',file(path)],{encoding:'utf8'});
  assert.equal(r.status,0,path+': '+r.stdout+r.stderr);
 }
});
test('PHP migration API fails closed rather than silently accepting login/attendance', {
 skip:!canPhp&&'PHP CLI is not installed on CI runner'
},()=>{
 for(const [uri,error] of [
  ['/rd-connect/api/health','migration_not_ready'],
  ['/rd-connect/api/login','endpoint_not_migrated'],
  ['/rd-connect/api/attendance','endpoint_not_migrated']
 ]){
  const r=invoke(uri);
  assert.equal(r.status,0,r.stderr);
  const data=JSON.parse(r.stdout);
  assert.equal(data.ok,false);
  assert.equal(data.error,error);
 }
 const bad=invoke('/rd-connect/api/health','/tmp/rd-connect-private-does-not-exist');
 assert.equal(bad.status,0,bad.stderr);
 assert.equal(JSON.parse(bad.stdout).error,'migration_configuration_missing');
});
