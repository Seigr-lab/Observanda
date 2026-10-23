import https from 'node:https';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {liveCertificate} from './live-certificate.js';
import {liveJSON,liveValid as valid,liveEndpoint} from './live-protocol.js';
import {OrganizationIdentity,verifyOrganizationCommand} from './identity.js';
import {LiveResearch} from './live-research.js';
import {requireAdministrator} from './organization-policy.js';
import {AppError,safeError} from '../errors.js';
import {contentStream,contentSize} from '../file-content.js';
import {exact} from '../modules/validation.js';

export async function startLiveHost(workspace,device,{host='0.0.0.0',port=0,advertise}){
 valid(['0.0.0.0','127.0.0.1','::','::1'].includes(host)&&Number.isInteger(port)&&port>=0&&port<=65535);
 const endpoint=liveEndpoint(advertise),identity=new OrganizationIdentity(device),research=new LiveResearch(workspace),authority=await research.access.organizations.load(),actor=research.access.organizations.principal(authority,await identity.public());
 valid(authority.memberships.some(m=>m.active&&m.role==='administrator'&&m.principalId===actor),'COLLABORATION_DENIED');
 const certificate=await liveCertificate(workspace),instance=randomBytes(24).toString('hex'),challenges=new Map(),pending=new Set(),sockets=new Set();let closing=false,inflight=0;
 const server=https.createServer({...certificate,minVersion:'TLSv1.3'},async(req,res)=>{
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  let finish;const done=new Promise(resolve=>finish=resolve);pending.add(done);inflight++;
  try{
   valid(!closing,'SERVER_CLOSING');valid(inflight<=16,'DATABASE_BUSY');valid(req.method==='POST'&&!req.headers.origin&&!req.headers.cookie,'ORIGIN');valid(req.headers['content-type']==='application/json','INVALID');
   if(req.url==='/challenge'){
    await liveJSON(req,128);const now=Date.now();for(const [key,value] of challenges)if(value<now)challenges.delete(key);valid(challenges.size<256,'ACCESS_WAIT');
    const nonce=randomBytes(32).toString('hex');challenges.set(nonce,now+30000);return json({instance,nonce});
   }
   valid(req.url==='/request','NOT_FOUND');const signed=await liveJSON(req),command=verifyOrganizationCommand(signed);
   valid(exact(command,['kind','instance','nonce','scope','operation','data'])&&command.kind==='observanda.live.request.v1'&&command.instance===instance,'COLLABORATION_SIGNATURE');
   const expiry=challenges.get(command.nonce);challenges.delete(command.nonce);valid(expiry&&expiry>=Date.now(),'COLLABORATION_EXPIRED');
   if(command.operation==='figure-export'){
    const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
    try{return await research.figure(signed.identity,command.scope,command.data,{signal:controller.signal,exporting:true,download:async({name,contentType,chunks})=>{res.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name)});await pipeline(Readable.from(chunks),res);}});}finally{res.off('close',abort);}
   }
   if(command.operation==='file'){
    const file=await research.file(signed.identity,command.scope,command.data);res.writeHead(200,{'Content-Type':file.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':contentSize(file.content),'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name)});await pipeline(Readable.from(contentStream(file.content)),res);return;
   }
   return json(await research.dispatch(signed.identity,command.scope,command.operation,command.data));
  }catch(error){if(!res.headersSent)json(safeError(error),({COLLABORATION_DENIED:403,COLLABORATION_SIGNATURE:401,COLLABORATION_EXPIRED:401,RECORD_CHANGED:409,CONFLICT:409,NOT_FOUND:404,LIMIT:413,ACCESS_WAIT:429,DATABASE_BUSY:503,SERVER_CLOSING:503})[error.code]??422);else res.destroy();}
  finally{inflight--;pending.delete(done);finish();}
 });
 server.maxConnections=64;server.requestTimeout=30000;server.headersTimeout=10000;server.setTimeout(30000,socket=>socket.destroy());server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 const address=new URL(endpoint);address.port=String(server.address().port);
 return {
  endpoint:address.origin,port:server.address().port,
  async card(grantId){const state=await research.access.load(),grant=state.grants.find(g=>g.id===grantId&&g.active);valid(grant,'COLLABORATION_DENIED');const authority=await research.access.organizations.load();requireAdministrator(authority,grant.organizationId,research.access.organizations.principal(authority,await identity.public()));return identity.sign({kind:'observanda.live.v1',workspaceId:authority.authorityId,organizationId:grant.organizationId,grantId,endpoint:address.origin,certificate:certificate.cert,title:(await workspace.outline()).metadata.title});},
  async close(){closing=true;challenges.clear();const stopped=new Promise(resolve=>server.close(resolve));for(const socket of sockets)socket.destroy();await Promise.all([...pending,stopped]);research.presence.clear();}
 };
}
