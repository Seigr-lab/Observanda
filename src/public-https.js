import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {Readable} from 'node:stream';
import {publicAddress,publicHttpsUrl} from './public-network.js';

async function resolveWithSignal(resolve,hostname,signal){
 signal?.throwIfAborted();
 let abort;
 try{return await Promise.race([resolve(hostname,{all:true}),new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();})]);}
 finally{signal?.removeEventListener('abort',abort);}
}

// This transport is deliberately separate from authenticated GitHub requests.
// Resolve on every request, reject mixed public/private answers, and pin the
// accepted answer in the TLS socket lookup. The URL hostname still owns SNI,
// Host and certificate verification. No redirects, cookies, proxy or auth.
export function createPublicHttpsRequest({resolve=lookup,request=https.request}={}){
 return async(value,{signal}={})=>{
  const url=publicHttpsUrl(value),hostname=url.hostname.replace(/^\[|\]$/g,''),family=isIP(hostname);
  const addresses=family?[{address:hostname,family}]:await resolveWithSignal(resolve,hostname,signal);
  if(!Array.isArray(addresses)||!addresses.length||addresses.some(row=>!publicAddress(row.address)||isIP(row.address)!==row.family))throw new TypeError('Public HTTPS destination required');
  const address=addresses[0];signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
   const req=request(url,{method:'GET',agent:false,signal,headers:{'Cache-Control':'no-cache','Accept-Encoding':'identity'},lookup:(_host,options,callback)=>options.all?callback(null,[address]):callback(null,address.address,address.family)},response=>{
    try{
     const status=response.statusCode;
     if(status<200||status>599||status>=300&&status<400){response.destroy();reject(new TypeError('Publication redirects are not allowed'));return;}
     const empty=[204,205,304].includes(status),body=empty?null:Readable.toWeb(response);if(empty)response.resume();
     resolve(new Response(body,{status,headers:response.headers}));
    }catch(error){response.destroy();reject(error);}
   });
   req.on('error',reject);req.end();
  });
 };
}
export const publicHttpsRequest=createPublicHttpsRequest();
