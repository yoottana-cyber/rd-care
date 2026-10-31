'use strict';
// CloudLinux Node.js Selector uses Passenger, which expects a CommonJS startup
// entry. Do not change this to ESM or import the Cloudflare Worker directly.
const http=require('node:http');
const {requestHandler}=require('./src/http-handler.cjs');
const port=Number(process.env.PORT||3000);
if(!Number.isSafeInteger(port)||port<1||port>65535)
 throw new Error('Invalid PORT environment value');
const server=http.createServer(requestHandler);
server.requestTimeout=15000;
server.headersTimeout=10000;
server.listen(port,()=>console.info('RD CONNECT migration HTTP listener started (API NOT READY)'));
module.exports=server;
