import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {BlockList,isIP} from 'node:net';
import {AppError} from '../errors.js';
const blocked=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]])blocked.addSubnet(address,prefix);
export function publicAddress(address){
 const family=isIP(address);
 if(family===4)return !blocked.check(address,'ipv4');
 // Accept only globally routed IPv6; exclude documentation, Teredo and 6to4.
 if(family===6)return /^[23][0-9a-f]{3}:/i.test(address)&&!/^2001:(?:0:|db8:)/i.test(address)&&!/^2002:/i.test(address);
 return false;
}
export async function fetchCalendar(value,{resolve=lookup}={}){
 let url;try{url=new URL(value);}catch{throw new AppError('CALENDAR_FETCH');}
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{
 for(let redirects=0;redirects<=3;redirects++){
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443'))throw new AppError('CALENDAR_URL');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(isIP(hostname)&&!publicAddress(hostname))throw new AppError('CALENDAR_URL');
  const addresses=await Promise.race([resolve(hostname,{all:true}),new Promise((_,reject)=>{if(controller.signal.aborted)reject(new AppError('CALENDAR_FETCH'));else controller.signal.addEventListener('abort',()=>reject(new AppError('CALENDAR_FETCH')),{once:true});})]);
  if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new AppError('CALENDAR_URL');
  const address=addresses[0];
  const result=await new Promise((resolve,reject)=>{
   const req=https.get(url,{signal:controller.signal,headers:{Accept:'text/calendar','Accept-Encoding':'identity'},lookup:(_host,options,cb)=>options.all?cb(null,[address]):cb(null,address.address,address.family)},res=>{
    if([301,302,303,307,308].includes(res.statusCode)){res.resume();return resolve({redirect:res.headers.location});}
    if(res.statusCode!==200){res.resume();return reject(new AppError('CALENDAR_FETCH'));}
    const parts=[];let size=0;res.on('data',part=>{size+=part.length;if(size>2*1024*1024){req.destroy();reject(new AppError('CALENDAR_LIMIT'));}else parts.push(part);});
    res.on('end',()=>resolve({text:Buffer.concat(parts).toString('utf8')}));res.on('error',reject);
   });req.on('error',reject);req.setTimeout(10000,()=>req.destroy(new Error('timeout')));
  });
  if(result.text!==undefined)return result.text;
  if(!result.redirect)throw new AppError('CALENDAR_FETCH');
  url=new URL(result.redirect,url);
 }
 throw new AppError('CALENDAR_FETCH');
 }catch(e){throw e instanceof AppError?e:new AppError('CALENDAR_FETCH');}finally{clearTimeout(timer);}
}
