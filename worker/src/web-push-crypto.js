// RFC 8291 / RFC 8188 aes128gcm Web Push content encoding.
// The message contains only an event category (never a student's details).
const utf8=new TextEncoder();
const fromB64=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')
 .padEnd(Math.ceil(value.length/4)*4,'=')),ch=>ch.charCodeAt(0));
const join=(...parts)=>{
 const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));
 let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length}
 return out;
};
async function hkdf(secret,salt,info,bits){
 const key=await crypto.subtle.importKey('raw',secret,'HKDF',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({
  name:'HKDF',hash:'SHA-256',salt,info:utf8.encode(info)
 },key,bits));
}
export async function encryptPriorityPush(subscription,message){
 // Encryption is performed at dispatch time using fresh ephemeral ECDH key and salt.
 const clientPublic=fromB64(subscription.p256dh),auth=fromB64(subscription.auth);
 if(clientPublic.length!==65||clientPublic[0]!==4||auth.length!==16)
  throw Error('Invalid Web Push subscription keys');
 const clientKey=await crypto.subtle.importKey('raw',clientPublic,{
  name:'ECDH',namedCurve:'P-256'
 },false,[]);
 const ephemeral=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const serverPublic=new Uint8Array(await crypto.subtle.exportKey('raw',ephemeral.publicKey));
 const sharedSecret=new Uint8Array(await crypto.subtle.deriveBits({
  name:'ECDH',public:clientKey
 },ephemeral.privateKey,256));
 // RFC 8291: intermediate key uses WebPush: info \x00 | client public | sender public
 const info=join(utf8.encode('WebPush: info'),new Uint8Array([0]),clientPublic,serverPublic);
 const prk=await crypto.subtle.importKey('raw',sharedSecret,'HKDF',false,['deriveBits']);
 const ikm=new Uint8Array(await crypto.subtle.deriveBits({
  name:'HKDF',hash:'SHA-256',salt:auth,info
 },prk,256));
 const salt=crypto.getRandomValues(new Uint8Array(16));
 const cek=await hkdf(ikm,salt,'Content-Encoding: aes128gcm\x00',128);
 const nonce=await hkdf(ikm,salt,'Content-Encoding: nonce\x00',96);
 const aes=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']);
 // The final-record delimiter 0x02 prevents malformed/partial record ambiguity.
 const plain=join(utf8.encode(JSON.stringify(message)),new Uint8Array([2]));
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({
  name:'AES-GCM',iv:nonce,tagLength:128
 },aes,plain));
 // aes128gcm header: 16-byte salt | 4-byte record-size | 1-byte key length | public key
 const header=new Uint8Array(21+serverPublic.length);
 header.set(salt,0);new DataView(header.buffer).setUint32(16,4096,false);
 header[20]=serverPublic.length;header.set(serverPublic,21);
 return join(header,ciphertext);
}
