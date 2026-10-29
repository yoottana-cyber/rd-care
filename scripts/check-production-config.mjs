#!/usr/bin/env node
// Read-only guard before Production migration or deployment. No Wrangler calls.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
function field(source,key){
 const m=new RegExp('^'+key+'\\s*=\\s*"([^"\\r\\n]+)"','m').exec(source);
 return m?.[1]||'';
}
function check(){
 const source=readFileSync(resolve(root,'worker/wrangler.production.toml'),'utf8');
 const name=field(source,'name'),db=field(source,'database_name'),id=field(source,'database_id');
 const origin=field(source,'ALLOWED_ORIGINS'),publicUrl=field(source,'PUBLIC_APP_URL');
 if(name!=='rd-care-api-prod'||db!=='rd-care-prod')
  throw Error('Worker and D1 must be the distinct Production instances');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)||
  id.toLowerCase()==='161c2fb5-cd80-42bd-bbab-28b5d61df3e0')
  throw Error('Production D1 UUID must be a NEW database, not rd-care-dev');
 let url;try{url=new URL(publicUrl)}catch{throw Error('PUBLIC_APP_URL is not a valid URL')}
 if(url.protocol!=='https:'||!url.pathname.endsWith('/')||url.search||url.hash||
  /YOUR|REPLACE|example/i.test(url.hostname)||!url.hostname.includes('.'))
  throw Error('PUBLIC_APP_URL must be an actual HTTPS hosting folder ending in /');
 if(origin!==url.origin)throw Error('ALLOWED_ORIGINS must be exactly the hosting origin, without path');
 console.log('Production Worker: '+name+'; D1: '+db);
 console.log('School PWA: '+url.href);
 console.log('CORS origin: '+origin);
 console.log('Production config is separate from Dev; no deployment has occurred.');
}
try{check()}catch(error){console.error('Production check failed: '+error.message);process.exitCode=1}
