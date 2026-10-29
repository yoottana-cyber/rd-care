#!/usr/bin/env node
// Build a static RD CONNECT package for cPanel / DirectAdmin. The original web/
// and Dev Worker are never modified. No server credentials are required.
import {cp,readFile,writeFile,mkdir,rm,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join,relative,isAbsolute} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(root,'web');
const devHosts=new Set(['rd-care.pages.dev','rd-care-api-dev.yoottana.workers.dev']);
function fail(message){throw new Error(message)}
function argsOf(argv){
 const result={};
 for(let i=0;i<argv.length;i+=2){
  if(!['--site','--api','--out'].includes(argv[i])||!argv[i+1]||argv[i+1].startsWith('--'))
   fail('Usage: node scripts/build-cpanel.mjs --site https://school.example.ac.th/rd-connect/ --api https://PRODUCTION-WORKER.workers.dev [--out dist/cpanel-production]');
  if(Object.hasOwn(result,argv[i]))fail('Duplicate argument '+argv[i]);
  result[argv[i]]=argv[i+1];
 }
 if(!result['--site']||!result['--api'])fail('--site and --api are both required');
 return result;
}
function urlOf(value,type){
 let url;try{url=new URL(value)}catch{fail(type+' must be a valid HTTPS URL')}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
  devHosts.has(url.hostname)||/(^|\.)example\./i.test(url.hostname)||/YOUR|REPLACE/i.test(url.hostname)||
  /^(localhost|127\.0\.0\.1)$/.test(url.hostname))
  fail(type+' must use the real, non-Dev production HTTPS hostname');
 if(type==='site'){
  if(!url.pathname.endsWith('/'))fail('--site must end with /, including its subfolder');
 }else if(url.pathname!=='/')fail('--api must be the Worker origin without a path');
 return url;
}
export async function buildCpanel(argv=process.argv.slice(2)){
 const args=argsOf(argv),site=urlOf(args['--site'],'site'),api=urlOf(args['--api'],'api');
 if(site.origin===api.origin)fail('Site and Worker must be different origins in this kit');
 const output=resolve(root,args['--out']||'dist/cpanel-production');
 // Protect all repository files. The builder may replace only a child of dist/.
 const subpath=relative(join(root,'dist'),output);
 if(!subpath||subpath==='..'||subpath.startsWith('..'+(process.platform==='win32'?'\\':'/'))||
    isAbsolute(subpath))fail('--out must be a subdirectory of dist/');
 await rm(output,{recursive:true,force:true});
 await mkdir(output,{recursive:true});
 await cp(source,output,{recursive:true});
 await rm(join(output,'_routes.json'),{force:true}); // Cloudflare Pages-only routing.
 const config=join(output,'config.js');
 await writeFile(config,`// Generated for the school's hosting. Do not edit the Dev config in web/.\nexport const API_BASE_URL = ${JSON.stringify(api.origin)};\n`,'utf8');
 const htmlFile=join(output,'index.html');
 let html=await readFile(htmlFile,'utf8');
 const original="connect-src https: http://localhost:8787 http://127.0.0.1:8787";
 if(!html.includes(original))fail('Expected CSP connect-src directive changed; builder must be reviewed');
 html=html.replace(original,"connect-src 'self' "+api.origin);
 await writeFile(htmlFile,html,'utf8');
 const ht=await stat(join(output,'.htaccess'));
 if(!ht.isFile())fail('.htaccess must be included (it is a hidden file)');
 console.log('Static hosting folder: '+relative(root,output));
 console.log('Site URL: '+site.href);
 console.log('API origin: '+api.origin);
 console.log('CORS ALLOWED_ORIGINS: '+site.origin);
 console.log('Worker PUBLIC_APP_URL: '+site.href);
 console.log('No Dev files or remote resources have been modified.');
 return {output,site:site.href,api:api.origin};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 buildCpanel().catch(e=>{console.error('RD CONNECT package error: '+e.message);process.exitCode=1});
}
