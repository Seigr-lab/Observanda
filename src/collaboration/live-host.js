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
import {LiveAdmission,withLiveAdmission} from './live-admission.js';

export async function startLiveHost(workspace,device,{host='0.0.0.0',port=0,advertise}){
 valid(['0.0.0.0','127.0.0.1','::','::1'].includes(host)&&Number.isInteger(port)&&port>=0&&port<=65535);
 const endpoint=liveEndpoint(advertise),identity=new OrganizationIdentity(device),research=new LiveResearch(workspace),authority=await research.access.organizations.load(),actor=research.access.organizations.principal(authority,await identity.public());
 valid(authority.memberships.some(m=>m.active&&m.role==='administrator'&&m.principalId===actor),'COLLABORATION_DENIED');
 const certificate=await liveCertificate(workspace),instance=randomBytes(24).toString('hex'),admission=new LiveAdmission(instance),pending=new Set(),sockets=new Set();let closing=false,inflight=0,issuing=0;
 const server=https.createServer({...certificate,minVersion:'TLSv1.3'},async(req,res)=>{
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
  let finish,challenge=false;const done=new Promise(resolve=>finish=resolve);pending.add(done);inflight++;
  try{
   valid(!closing,'SERVER_CLOSING');valid(inflight<=16,'DATABASE_BUSY');valid(req.method==='POST'&&!req.headers.origin&&!req.headers.cookie,'ORIGIN');valid(req.headers['content-type']==='application/json','INVALID');
   if(req.url==='/challenge'){
    valid(issuing<4,'ACCESS_WAIT');challenge=true;issuing++;
    // This endpoint uses no body values. Keep its four reserved slots until
    // the connection closes, and close it within one second even if a client
    // withholds a body or refuses to read. Other signed requests retain slots.
    const length=req.headers['content-length'];valid(length===undefined||/^\d+$/.test(length)&&Number(length)<=128,'LIMIT');
    const socket=req.socket,closed=new Promise(resolve=>socket.once('close',resolve)),deadline=setTimeout(()=>socket.destroy(),1000);deadline.unref();
    try{
     let bytes=0;req.on('data',chunk=>{bytes+=chunk.length;if(bytes>128)socket.destroy();});req.resume();res.setHeader('Connection','close');
     json({instance,nonce:admission.issue(socket.remoteAddress)});await closed;return;
    }finally{clearTimeout(deadline);}
   }
   valid(req.url==='/request','NOT_FOUND');const signed=await liveJSON(req),command=verifyOrganizationCommand(signed);
   valid(exact(command,['kind','instance','nonce','scope','operation','data'])&&command.kind==='observanda.live.request.v1'&&command.instance===instance,'COLLABORATION_SIGNATURE');
   const address=req.socket.remoteAddress;admission.validate(command.nonce,address);
   return await withLiveAdmission(principal=>admission.consume(command.nonce,address,principal),async()=>{
   if(command.operation==='figure-export'){
    const controller=new AbortController(),abort=()=>{if(!res.writableEnded)controller.abort();};res.once('close',abort);
    try{return await research.figure(signed.identity,command.scope,command.data,{signal:controller.signal,exporting:true,download:async({name,contentType,chunks})=>{res.writeHead(200,{'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name)});await pipeline(Readable.from(chunks),res);}});}finally{res.off('close',abort);}
   }
   if(command.operation==='file'){
    const file=await research.file(signed.identity,command.scope,command.data);res.writeHead(200,{'Content-Type':file.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Length':contentSize(file.content),'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.name)});await pipeline(Readable.from(contentStream(file.content)),res);return;
   }
   return json(await research.dispatch(signed.identity,command.scope,command.operation,command.data));
   });
  }catch(error){if(!res.headersSent)json(safeError(error),({COLLABORATION_DENIED:403,COLLABORATION_SIGNATURE:401,COLLABORATION_EXPIRED:401,RECORD_CHANGED:409,CONFLICT:409,NOT_FOUND:404,LIMIT:413,ACCESS_WAIT:429,DATABASE_BUSY:503,SERVER_CLOSING:503})[error.code]??422);else res.destroy();}
  finally{if(challenge)issuing--;inflight--;pending.delete(done);finish();}
 });
 server.maxConnections=64;server.requestTimeout=30000;server.headersTimeout=10000;server.setTimeout(30000,socket=>socket.destroy());server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 const address=new URL(endpoint);address.port=String(server.address().port);
 return {
  endpoint:address.origin,port:server.address().port,bind:host,
  async card(grantId){const state=await research.access.load(),grant=state.grants.find(g=>g.id===grantId&&g.active);valid(grant,'COLLABORATION_DENIED');const authority=await research.access.organizations.load();requireAdministrator(authority,grant.organizationId,research.access.organizations.principal(authority,await identity.public()));return identity.sign({kind:'observanda.live.v1',workspaceId:authority.authorityId,organizationId:grant.organizationId,grantId,endpoint:address.origin,certificate:certificate.cert,title:(await workspace.outline()).metadata.title});},
  async close(){closing=true;admission.close();const stopped=new Promise(resolve=>server.close(resolve));for(const socket of sockets)socket.destroy();await Promise.all([...pending,stopped]);research.presence.clear();}
 };
}
