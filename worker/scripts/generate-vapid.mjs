// Run locally with Node 20+: node worker/scripts/generate-vapid.mjs
// Keep the private value in Cloudflare Worker SECRETS, never in git or a frontend file.
import {createECDH} from 'node:crypto';
const key=createECDH('prime256v1');key.generateKeys();
const encode=buf=>Buffer.from(buf).toString('base64url');
console.log('VAPID_PUBLIC_KEY='+encode(key.getPublicKey(null,'uncompressed')));
console.log('VAPID_PRIVATE_KEY='+encode(Buffer.from(key.getPrivateKey().toString('hex').padStart(64,'0'),'hex')));
console.log('VAPID_SUBJECT=mailto:<school-admin-email>');
console.log('\nTreat the PRIVATE key as a secret. Do not commit it or share it in a chat.');
