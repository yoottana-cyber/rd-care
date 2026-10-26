import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const text=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Wrangler deploy keeps Dashboard runtime variables, including VAPID_SUBJECT',()=>{
 const wrangler=text('worker/wrangler.toml');
 const beforeSections=wrangler.split(/^\[[^\n]+\]/m)[0];
 assert.match(beforeSections,/^keep_vars\s*=\s*true\s*$/m);
 assert.match(wrangler,/^name\s*=\s*"rd-care-api-dev"\s*$/m);
 assert.doesNotMatch(wrangler,/^VAPID_PRIVATE_KEY\s*=/m);
 assert.doesNotMatch(wrangler,/^VAPID_SUBJECT\s*=/m);
});

test('Automated Worker deployment fails fast if preservation flag is removed',()=>{
 const workflow=text('.github/workflows/deploy-worker.yml');
 assert.match(workflow,/Ensure dashboard variables are preserved/);
 assert.match(workflow,/grep -Eq .*keep_vars/);
 assert.match(workflow,/wrangler deploy/);
});

test('One-time VAPID setup documentation does not instruct rotating existing keys',()=>{
 const guide=text('docs/MOBILE-PWA-PUSH.md');
 assert.match(guide,/VAPID_SUBJECT หายหลัง Deploy/);
 assert.match(guide,/keep_vars = true/);
 assert.match(guide,/ห้ามสร้างชุดกุญแจ VAPID ใหม่ทุกครั้งที่ Deploy/);
});
