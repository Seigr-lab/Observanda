// The server logins of one workspace: how to sign in to each web server the
// author publishes to over SSH, SFTP or FTP. They are set up once, in
// Preferences → Integrations, and every website of the workspace may use any of
// them with its own folder or subdomain. They hold no secrets: SSH and SFTP
// sign in with the author's key or agent, and an FTP password stays on each
// computer (host-credentials.js).
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';

export const SERVER_LOGINS_FILE='.observanda/server-logins.json';
export const SERVER_PROTOCOLS=['ssh','sftp','ftp'];
export const FTP_SECURITY=['explicit','implicit','none'];
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value);
const hostName=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(value);
// SSH runs remote commands as this user, so its name is restricted further.
const userName=(protocol,value)=>protocol==='ssh'?/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(value):typeof value==='string'&&value.length>0&&value.length<=128&&!/[\x00-\x1f@:/\\]/.test(value);
const fields={ssh:['host','id','identityFile','name','port','protocol','user'],sftp:['host','id','identityFile','name','port','protocol','user'],ftp:['host','id','name','port','protocol','security','user']};

export function validServerLogin(value){
 if(!value||typeof value!=='object'||!SERVER_PROTOCOLS.includes(value.protocol))return false;
 if(Object.keys(value).sort().join()!==fields[value.protocol].join())return false;
 if(!uuid(value.id)||!text(value.name,120)||!hostName(value.host)||!userName(value.protocol,value.user)||!Number.isInteger(value.port)||value.port<1||value.port>65535)return false;
 if(value.protocol==='ftp')return FTP_SECURITY.includes(value.security);
 return typeof value.identityFile==='string'&&value.identityFile.length<=1000&&(!value.identityFile||path.isAbsolute(value.identityFile)&&!/[\x00-\x1f]/.test(value.identityFile));
}
// The parts that identify where a login signs in; its name is only a label.
export const serverIdentity=login=>({protocol:login.protocol,host:login.host.toLowerCase(),port:login.port,user:login.user});

export class ServerLogins{
 constructor(workspace){this.workspace=workspace;}
 async read(){
  const raw=await this.workspace.readMetadata(SERVER_LOGINS_FILE,1024*1024);
  if(raw===null)return {logins:[],etag:'new'};
  let value;try{value=JSON.parse(raw);}catch{throw new AppError('PUBLISH_CONFIG');}
  if(value?.version!==1||!Array.isArray(value.logins)||value.logins.length>256||!value.logins.every(validServerLogin)||new Set(value.logins.map(login=>login.id)).size!==value.logins.length)throw new AppError('PUBLISH_CONFIG');
  return {logins:value.logins,etag:digest(raw)};
 }
 async get(id){const login=(await this.read()).logins.find(login=>login.id===id);if(!login)throw new AppError('PUBLISH_LOGIN');return login;}
 async write(change,etag){
  return this.workspace.withLock(async()=>{
   const current=await this.read();if(current.etag!==etag)throw new AppError('PUBLISH_STALE');
   const logins=change(structuredClone(current.logins));
   await this.workspace.writeMetadata(SERVER_LOGINS_FILE,serialize({version:1,logins}));return this.read();
  });
 }
 // A new login receives its identity here; an edit keeps it.
 async save(login,etag){
  const value={...login,id:login.id??randomUUID()};
  if(!validServerLogin(value))throw new AppError('PUBLISH_CONFIG');
  return this.write(logins=>{const at=logins.findIndex(item=>item.id===value.id);if(at<0&&login.id)throw new AppError('PUBLISH_LOGIN');if(at<0)logins.push(value);else logins[at]=value;return logins;},etag);
 }
 async remove(id,etag){return this.write(logins=>{const next=logins.filter(login=>login.id!==id);if(next.length===logins.length)throw new AppError('PUBLISH_LOGIN');return next;},etag);}
}
