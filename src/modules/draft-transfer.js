import {AppError} from '../errors.js';
import {digest,serialize} from '../storage-format.js';
import {exact,uuid,requireValue} from './validation.js';
import {MODULE_BYTES} from './capacity.js';
import {ModuleDrafts} from './drafts.js';
import {DRAFT_CHUNK_BYTES} from '../web/modules/draft-protocol.js';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const root=id=>{requireValue(uuid(id),'Recovery transfer');return '.observanda/module-draft-transfers/'+id;};
// Large *single-item* recovery uses bounded requests. The logical item limit is
// the existing module contract, independent of the small-request transport cap.
export class ModuleDraftTransfer{
 constructor(workspace){this.workspace=workspace;}
 async owner(workspaceId){if((await this.workspace.outline()).metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');}
 async receipt(manifest){
  if(manifest.etag!==null&&(await new ModuleDrafts(this.workspace).read(manifest.id,{expand:false}))?.etag!==manifest.etag)throw new AppError('DRAFT_CHANGED');
  return {etag:manifest.etag};
 }
 async manifest(id){const value=await this.workspace.readMetadata(root(id)+'/manifest.json',4096);if(value===null)throw new AppError('NOT_FOUND');let doc;try{doc=JSON.parse(value);}catch{throw new AppError('MODULE_FORMAT');}if(!exact(doc,['workspaceId','id','baseEtag','size','sha256','etag'])||doc.id!==id||!uuid(doc.workspaceId)||!hash(doc.sha256)||!Number.isSafeInteger(doc.size)||doc.size<1||doc.size>MODULE_BYTES||doc.etag!==null&&!hash(doc.etag)||doc.baseEtag!==null&&!hash(doc.baseEtag))throw new AppError('MODULE_FORMAT');return doc;}
 async start(command){
  requireValue(exact(command,['workspaceId','id','baseEtag','size','sha256'])&&uuid(command.workspaceId)&&uuid(command.id)&&(command.baseEtag===null||hash(command.baseEtag))&&Number.isSafeInteger(command.size)&&command.size>0&&command.size<=MODULE_BYTES&&hash(command.sha256),'Recovery transfer');
  return this.workspace.withLock(async()=>{
   await this.owner(command.workspaceId);const file=root(command.id)+'/manifest.json',raw=await this.workspace.readMetadata(file,4096);
   if(raw!==null){
    const previous=await this.manifest(command.id);
    if(['workspaceId','baseEtag','size','sha256'].every(k=>previous[k]===command[k])){
     return this.receipt(previous);
    }
    // Keep one receipt per checkpoint writer. A new payload can only replace a
    // completed transfer, using the checkpoint's actual current revision.
    if(previous.etag===null)throw new AppError('DRAFT_CHANGED');
   }
   const current=await new ModuleDrafts(this.workspace).read(command.id,{expand:false});
   if((current?.etag??null)!==command.baseEtag)throw new AppError('DRAFT_CHANGED');
   await this.workspace.writeMetadata(file,serialize({...command,etag:null}));return {etag:null};
  });
 }
 async part(command){
  requireValue(exact(command,['workspaceId','id','transferHash','index','bytes','sha256'])&&uuid(command.workspaceId)&&uuid(command.id)&&hash(command.transferHash)&&Number.isSafeInteger(command.index)&&command.index>=0&&typeof command.bytes==='string'&&command.bytes.length<=Math.ceil(DRAFT_CHUNK_BYTES/3)*4&&hash(command.sha256),'Recovery chunk');
  const bytes=Buffer.from(command.bytes,'base64');requireValue(bytes.toString('base64')===command.bytes&&digest(bytes)===command.sha256,'Recovery chunk');
  return this.workspace.withLock(async()=>{
   await this.owner(command.workspaceId);const manifest=await this.manifest(command.id);if(manifest.workspaceId!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
   if(manifest.sha256!==command.transferHash)throw new AppError('DRAFT_CHANGED');
   requireValue(command.index<Math.ceil(manifest.size/DRAFT_CHUNK_BYTES)&&bytes.length===Math.min(DRAFT_CHUNK_BYTES,manifest.size-command.index*DRAFT_CHUNK_BYTES),'Recovery chunk');
   if(manifest.etag)return this.receipt(manifest);
   const file=root(command.id)+'/'+command.index+'.json',existing=await this.workspace.readMetadata(file,2*DRAFT_CHUNK_BYTES);
   if(existing!==null){const old=JSON.parse(existing);if(old.sha256!==command.sha256||old.bytes!==command.bytes)throw new AppError('DRAFT_CHANGED');}
   else await this.workspace.writeMetadata(file,serialize({sha256:command.sha256,bytes:command.bytes}));
   return {index:command.index};
  });
 }
 async finish(command,{signal}={}){
  requireValue(exact(command,['workspaceId','id','transferHash'])&&uuid(command.workspaceId)&&uuid(command.id)&&hash(command.transferHash),'Recovery transfer');
  return this.workspace.withLock(async()=>{
  signal?.throwIfAborted();
  await this.owner(command.workspaceId);const manifest=await this.manifest(command.id);
  if(manifest.workspaceId!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(manifest.sha256!==command.transferHash)throw new AppError('DRAFT_CHANGED');
  if(manifest.etag)return this.receipt(manifest);
  const bytes=Buffer.allocUnsafe(manifest.size),count=Math.ceil(manifest.size/DRAFT_CHUNK_BYTES);
  for(let index=0;index<count;index++){
   signal?.throwIfAborted();
   const raw=await this.workspace.readMetadata(root(command.id)+'/'+index+'.json',2*DRAFT_CHUNK_BYTES);if(raw===null)throw new AppError('DRAFT_CHANGED');
   let part;try{part=JSON.parse(raw);}catch{throw new AppError('MODULE_FORMAT');}
   if(!exact(part,['sha256','bytes'])||!hash(part.sha256)||typeof part.bytes!=='string')throw new AppError('MODULE_FORMAT');
   const chunk=Buffer.from(part.bytes,'base64');
   if(chunk.toString('base64')!==part.bytes||chunk.length!==Math.min(DRAFT_CHUNK_BYTES,manifest.size-index*DRAFT_CHUNK_BYTES)||digest(chunk)!==part.sha256)throw new AppError('MODULE_FORMAT');chunk.copy(bytes,index*DRAFT_CHUNK_BYTES);
  }
  if(digest(bytes)!==manifest.sha256)throw new AppError('MODULE_FORMAT');
  let value;try{value=JSON.parse(bytes);}catch{throw new AppError('MODULE_FORMAT');}
  if(value.workspaceId!==command.workspaceId)throw new AppError('WORKSPACE_CHANGED');
  if(value.id!==command.id||value.etag!==manifest.baseEtag)throw new AppError('DRAFT_CHANGED');
  signal?.throwIfAborted();
  const saved=await new ModuleDrafts(this.workspace).writeLocked(value,{transferred:true});
  // PostgreSQL commits the checkpoint, receipt and removal of staging together.
  // Older file workspaces can replay an exact checkpoint after interruption.
   await this.workspace.writeMetadata(root(command.id)+'/manifest.json',serialize({...manifest,etag:saved.etag}));
   for(let index=0;index<count;index++)await this.workspace.removeMetadata(root(command.id)+'/'+index+'.json');
  signal?.throwIfAborted();
  return {etag:saved.etag};
  });
 }
}
