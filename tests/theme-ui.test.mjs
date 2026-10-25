import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveTheme,themeButtonLabel} from '../web/theme.js';

test('visual preference has explicit light/dark states and supports system fallback',()=>{
 assert.equal(resolveTheme('light',true),'light');
 assert.equal(resolveTheme('dark',false),'dark');
 assert.equal(resolveTheme(null,true),'dark');
 assert.equal(resolveTheme('unexpected',false),'light');
 assert.match(themeButtonLabel('dark'),/โหมดสว่าง/);
 assert.match(themeButtonLabel('light'),/โหมดกลางคืน/);
});
test('dashboard quick links target existing supported routes and real refresh',()=>{
 const js=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
 for(const tab of ['attendance','late','behavior','alerts','adminStudents'])
  assert.ok(js.includes("['"+tab+"',"),'missing dashboard link '+tab);
 assert.match(js,/\$\$\('\[data-quick-tab\]'\)/);
 assert.match(js,/showTab\(button\.dataset\.quickTab\)/);
 assert.match(js,/id="refreshDashboard"/);
 assert.match(js,/await loadDashboard\(\)/);
});
test('appearance setting is available to students, guardians and staff',()=>{
 for(const file of ['app.js','portal-ui.js']){
  const code=readFileSync(new URL('../web/'+file,import.meta.url),'utf8');
  assert.match(code,/data-theme-toggle/);
  assert.match(code,/bindThemeButtons\(\)/);
 }
 const html=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
 assert.match(html,/theme\.css/);
});
test('theme stylesheet supports small screens and reduced motion',()=>{
 const css=readFileSync(new URL('../web/theme.css',import.meta.url),'utf8');
 for(const rule of ['[data-theme="dark"]','@media(max-width:480px)','prefers-reduced-motion','quick-action','dashboard-hero'])
  assert.ok(css.includes(rule));
});
