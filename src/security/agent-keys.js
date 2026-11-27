// Agent keys let programs on this computer, from any provider, use the running
// app's agent API. They live beside the device key in a private folder, never
// inside a workspace, so a copied or moved workspace carries none. Each key file
// holds only a SHA-256 hash of the key's secret; the full key is shown once.
// A key alone opens nothing: the app accepts it only while the owner has the
// key's workspace, and the project or lab book it reaches, unlocked.
import path from 'node:path';
import {readFile,readdir,unlink} from 'node:fs/promises';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {assertRegular,atomicWrite,serialize} from '../storage.js';
import {withWriterLease} from '../writer-lease.js';
import {AppError} from '../errors.js';
import {refuseNewerFormat} from '../stored-format.js';
import {preparePrivateDirectory} from './private-directory.js';

export const AGENT_KEY_LIMIT=64;
const LINE=String.fromCharCode(10),ACTIVITY_LIMIT=500,ACTIVITY_BYTES=4*1024*1024,ACTIVITY_OPERATIONS=['lab-books/create','records/create','records/update','records/link','records/unlink','files/attach','app/research','app/website','app/pdf'];
const PREFIX='obsk_',uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const instant=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&new Date(value).toISOString()===value;
const secretHash=secret=>createHash('sha256').update(secret).digest('hex');
const invalidKey=()=>{throw new AppError('AGENT_KEY_INVALID');};
// Last use is saved at most this often, so a busy agent does not rewrite its key file on every request.
const USE_INTERVAL=10*60*1000;

export function validAgentScope(scope){
 if(!scope||typeof scope!=='object')return false;
 if(scope.kind==='workspace')return Object.keys(scope).join()==='kind';
 if(scope.kind==='project')return Object.keys(scope).sort().join()==='kind,projectId'&&uuid(scope.projectId);
 return scope.kind==='lab-book'&&Object.keys(scope).sort().join()==='kind,labBookId,projectId'&&uuid(scope.projectId)&&uuid(scope.labBookId);
}
const validName=name=>typeof name==='string'&&name.trim()===name&&name.length>=1&&name.length<=80&&!/[\x00-\x1f\x7f]/.test(name);
function validRecord(value,id){
 return value&&Object.keys(value).sort().join()==='access,createdAt,expiresAt,format,id,lastUsedAt,name,scope,sha256,workspaceId'&&value.format===1&&value.id===id&&uuid(value.workspaceId)&&
  validName(value.name)&&validAgentScope(value.scope)&&['read','write'].includes(value.access)&&instant(value.createdAt)&&(value.expiresAt===null||instant(value.expiresAt))&&
  (value.lastUsedAt===null||instant(value.lastUsedAt))&&/^[a-f0-9]{64}$/.test(value.sha256);
}
function validActivity(value){
 return value&&Object.keys(value).sort().join()==='at,format,keyId,keyName,labBookId,operation,projectId,recordId,title,workspaceId'&&value.format===1&&instant(value.at)&&
  [value.workspaceId,value.keyId].every(uuid)&&ACTIVITY_OPERATIONS.includes(value.operation)&&(value.operation.startsWith('app/')?[value.projectId,value.labBookId,value.recordId].every(id=>id===null||uuid(id)):value.operation==='lab-books/create'?[value.projectId,value.labBookId].every(uuid)&&value.recordId===null:[value.projectId,value.labBookId,value.recordId].every(uuid))&&validName(value.keyName)&&ACTIVITY_OPERATIONS.includes(value.operation)&&typeof value.title==='string'&&value.title.length<=180;
}
// What the app shows and an agent may learn about a key; never its hash.
export const agentKeySummary=({sha256,format,...summary})=>(void sha256,void format,structuredClone(summary));
export function parseAgentKey(token){
 const match=typeof token==='string'&&token.length<=128?/^obsk_([a-f0-9]{32})_([A-Za-z0-9_-]{43})$/.exec(token):null;if(!match)invalidKey();
 const hex=match[1];return {id:hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20),secret:match[2]};
}

export class AgentKeyStore{
 constructor(directory){this.directory=path.resolve(directory);this.preparing=null;}
 async prepare(){
  if(!this.preparing){const pending=preparePrivateDirectory(this.directory);this.preparing=pending;pending.catch(()=>{if(this.preparing===pending)this.preparing=null;});}
  return this.preparing;
 }
 file(id){if(!uuid(id))invalidKey();return path.join(this.directory,id+'.json');}
 write(operation){return withWriterLease(path.join(this.directory,'keys.lock'),operation);}
 async read(id){
  const file=this.file(id),info=await assertRegular(file,{missing:true});if(!info)return null;
  if(info.size>4096)throw new AppError('AGENT_KEY_DAMAGED');
  let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch{throw new AppError('AGENT_KEY_DAMAGED');}
  refuseNewerFormat(value?.format,1);if(!validRecord(value,id))throw new AppError('AGENT_KEY_DAMAGED');return value;
 }
 async records(){
  if(!await assertRegular(this.directory,{directory:true,missing:true}))return [];
  await this.prepare();const values=[];
  for(const name of await readdir(this.directory)){const match=/^([a-f0-9-]{36})\.json$/.exec(name);if(match&&uuid(match[1])){const value=await this.read(match[1]);if(value)values.push(value);}}
  return values.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 }
 async list(workspaceId){
  if(!uuid(workspaceId))throw new AppError('INVALID');
  return (await this.records()).filter(value=>value.workspaceId===workspaceId).map(agentKeySummary);
 }
 async create({name,workspaceId,scope,access,expiresAt=null},{now=new Date()}={}){
  if(!validName(name)||!uuid(workspaceId)||!validAgentScope(scope)||!['read','write'].includes(access)||expiresAt!==null&&(!instant(expiresAt)||Date.parse(expiresAt)<=now.getTime()))throw new AppError('INVALID');
  await this.prepare();
  return this.write(async()=>{
   if((await this.records()).length>=AGENT_KEY_LIMIT)throw new AppError('AGENT_KEY_LIMIT');
   const id=randomUUID(),secret=randomBytes(32).toString('base64url');
   const value={format:1,id,name,workspaceId,scope:structuredClone(scope),access,createdAt:now.toISOString(),expiresAt,lastUsedAt:null,sha256:secretHash(secret)};
   await atomicWrite(this.file(id),serialize(value));
   return {key:PREFIX+id.replaceAll('-','')+'_'+secret,agentKey:agentKeySummary(value)};
  });
 }
 async revoke(workspaceId,id){
  if(!uuid(workspaceId))throw new AppError('INVALID');await this.prepare();
  return this.write(async()=>{
   const value=await this.read(id);if(!value||value.workspaceId!==workspaceId)throw new AppError('NOT_FOUND');
   await unlink(this.file(id));return {revoked:id};
  });
 }
 // The running app publishes where agents reach it: an address and version, no
 // secret. It changes every time the app starts, so agents read it each time.
 endpointFile(){return path.join(this.directory,'endpoint.json');}
 async publishEndpoint(origin,apiVersion,{now=new Date()}={}){
  await this.prepare();
  await this.write(()=>atomicWrite(this.endpointFile(),serialize({format:1,origin,description:origin+'/api/v1/openapi.json',apiVersion,startedAt:now.toISOString(),processId:process.pid})));
 }
 async withdrawEndpoint(origin){
  if(!await assertRegular(this.directory,{directory:true,missing:true}))return;
  await this.write(async()=>{if((await this.endpoint())?.origin===origin)await unlink(this.endpointFile()).catch(error=>{if(error.code!=='ENOENT')throw error;});});
 }
 async endpoint(){
  const file=this.endpointFile(),info=await assertRegular(file,{missing:true});if(!info)return null;if(info.size>4096)throw new AppError('AGENT_KEY_DAMAGED');
  let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch{throw new AppError('AGENT_KEY_DAMAGED');}
  refuseNewerFormat(value?.format,1);
  if(!value||Object.keys(value).sort().join()!=='apiVersion,description,format,origin,processId,startedAt'||value.format!==1||!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(value.origin)||value.description!==value.origin+'/api/v1/openapi.json'||!instant(value.startedAt)||!Number.isSafeInteger(value.processId))throw new AppError('AGENT_KEY_DAMAGED');
  return value;
 }
 // What agents changed, with the key's name: the owner's record of agent work on
 // this computer. The newest entries are kept; old ones are dropped in bounds.
 activityFile(){return path.join(this.directory,'activity.jsonl');}
 async readActivity(){
  const file=this.activityFile(),info=await assertRegular(file,{missing:true});if(!info)return [];
  if(info.size>ACTIVITY_BYTES)throw new AppError('AGENT_KEY_DAMAGED');
  return (await readFile(file,'utf8')).split(LINE).filter(Boolean).map(line=>{
   let value;try{value=JSON.parse(line);}catch{throw new AppError('AGENT_KEY_DAMAGED');}
   refuseNewerFormat(value?.format,1);if(!validActivity(value))throw new AppError('AGENT_KEY_DAMAGED');return value;
  });
 }
 async recordActivity({key,operation,projectId,labBookId,recordId,title},{now=new Date()}={}){
  const value={format:1,at:now.toISOString(),workspaceId:key.workspaceId,keyId:key.id,keyName:key.name,operation,projectId,labBookId,recordId,title};
  if(!validActivity(value))throw new AppError('INVALID');
  await this.prepare();
  await this.write(async()=>{
   let entries=[...await this.readActivity(),value];if(entries.length>ACTIVITY_LIMIT*2)entries=entries.slice(-ACTIVITY_LIMIT);
   await atomicWrite(this.activityFile(),entries.map(entry=>JSON.stringify(entry)).join(LINE)+LINE);
  });
 }
 async activity(workspaceId,{limit=50}={}){
  if(!uuid(workspaceId)||!Number.isSafeInteger(limit)||limit<1||limit>ACTIVITY_LIMIT)throw new AppError('INVALID');
  if(!await assertRegular(this.directory,{directory:true,missing:true}))return [];
  await this.prepare();return (await this.readActivity()).filter(entry=>entry.workspaceId===workspaceId).slice(-limit).reverse().map(({format,...entry})=>(void format,entry));
 }
 // Unknown, revoked, expired and malformed keys give the same answer.
 async authenticate(token,{now=new Date()}={}){
  const {id,secret}=parseAgentKey(token);
  if(!await assertRegular(this.directory,{directory:true,missing:true}))invalidKey();
  await this.prepare();const value=await this.read(id);
  const expected=Buffer.from(value?.sha256??'0'.repeat(64),'hex'),actual=Buffer.from(secretHash(secret),'hex');
  if(!timingSafeEqual(expected,actual)||!value||value.expiresAt!==null&&Date.parse(value.expiresAt)<=now.getTime())invalidKey();
  if(value.lastUsedAt===null||now.getTime()-Date.parse(value.lastUsedAt)>=USE_INTERVAL){
   await this.write(async()=>{const current=await this.read(id);if(current?.sha256===value.sha256)await atomicWrite(this.file(id),serialize({...current,lastUsedAt:now.toISOString()}));});
  }
  return agentKeySummary(value);
 }
}
