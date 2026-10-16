import https from 'node:https';
import {checkServerIdentity} from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {OrganizationIdentity} from './identity.js';
import {liveCard,liveJSON,liveValid as valid} from './live-protocol.js';
import {peerName} from './live-certificate.js';
import {AppError} from '../errors.js';

// Connections trust only the owner-signed certificate, not an arbitrary
// machine's system trust configuration. Redirects and cookies are never used.
export class LiveClient{
 constructor(device,signed){this.identity=new OrganizationIdentity(device);this.signed=signed;this.card=liveCard(signed);this.agent=new https.Agent({keepAlive:true,maxSockets:4});this.controllers=new Set();this.closed=false;}
 close(){this.closed=true;for(const controller of this.controllers)controller.abort();this.agent.destroy();}
 async request(path,body,{stream=false,signal}={}){
  valid(!this.closed,'ACCESS_LOCKED');
  let streaming=false;
  const controller=new AbortController();this.controllers.add(controller);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  try{
   const response=await new Promise((resolve,reject)=>{
    const request=https.request(new URL(path,this.card.endpoint),{method:'POST',agent:this.agent,ca:this.card.certificate,servername:peerName,minVersion:'TLSv1.3',rejectUnauthorized:true,checkServerIdentity:(name,certificate)=>{const error=checkServerIdentity(peerName,certificate);if(error)return error;return new X509Certificate(certificate.raw).fingerprint256===new X509Certificate(this.card.certificate).fingerprint256?undefined:new AppError('COLLABORATION_SIGNATURE');},headers:{'Content-Type':'application/json'},signal:controller.signal},resolve);
    request.setTimeout(30000,()=>request.destroy(new AppError('LIVE_UNAVAILABLE')));request.once('error',reject);request.end(JSON.stringify(body));
   });
   if(response.statusCode!==200){const error=await liveJSON(response);throw new AppError(error.code??'LIVE_UNAVAILABLE',error.details);}
   if(stream){streaming=true;const release=()=>{this.controllers.delete(controller);signal?.removeEventListener('abort',abort);};response.once('close',release);return response;}
   return await liveJSON(response,8*1024*1024);
  }catch(error){if(error instanceof AppError||error.name==='AbortError')throw error;throw new AppError('LIVE_UNAVAILABLE');}
  finally{if(!streaming){this.controllers.delete(controller);signal?.removeEventListener('abort',abort);}}
 }
 async call(operation,data={},options={}){
  const {instance,nonce}=await this.request('/challenge',{},{signal:options.signal}),{workspaceId,organizationId,grantId}=this.card;
  valid(typeof instance==='string'&&/^[a-f0-9]{48}$/.test(instance)&&typeof nonce==='string'&&/^[a-f0-9]{64}$/.test(nonce),'COLLABORATION_SIGNATURE');
  return this.request('/request',await this.identity.sign({kind:'observanda.live.request.v1',instance,nonce,scope:{workspaceId,organizationId,grantId},operation,data}),options);
 }
}
