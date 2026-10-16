import path from 'node:path';
import {lstat,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {AppError} from '../errors.js';
import {privateDirectory,assertRegular} from '../storage.js';
import {writeContent,describeContent} from '../file-content.js';
import {withWorkspaceMetadataBatch} from '../metadata-batch.js';
import {MetadataFeed} from '../metadata-feed.js';
import {checkedSourcePath,sourceChunks,sourceStamp} from './source-files.js';
import {importId,hashValue} from './import-model.js';

const prefix='.observanda/migration/';
const fail=()=>{throw new AppError('IMPORT_DAMAGED');};
export const objectSlot=index=>String(index).padStart(5,'0');
export class ImportStore{
 constructor(workspace){this.workspace=workspace;}
 feed(){return new MetadataFeed(this.workspace,prefix+'batch-list');}
 async addBatch(batch){
  const feed=this.feed();await feed.ensureLocked();const item={id:batch.id,createdAt:batch.createdAt};
  await this.write('batch-list/'+batch.id,item);await feed.putLocked(item);
 }
 async read(name,{optional=false}={}){
  const raw=await this.workspace.readMetadata(prefix+name+'.json',16*1024*1024);
  if(raw===null){if(optional)return null;throw new AppError('NOT_FOUND');}
  try{return JSON.parse(raw);}catch{fail();}
 }
 write(name,value){return this.workspace.writeMetadata(prefix+name+'.json',JSON.stringify(value));}
 locked(operation){return this.workspace.withLock(()=>withWorkspaceMetadataBatch(this.workspace,operation));}
 async batch(id){if(!importId(id))throw new AppError('INVALID');const batch=await this.read('batches/'+id);if(batch.id!==id||batch.version!==1)fail();return batch;}
 async bound(command){
  const batch=await this.batch(command.id),{metadata}=await this.workspace.outline();
  if(command.workspaceId!==metadata.id||batch.workspaceId!==metadata.id)throw new AppError('WORKSPACE_CHANGED');return batch;
 }
 object(id,index){if(!importId(id)||!Number.isInteger(index)||index<0||index>=10000)throw new AppError('INVALID');return this.read('objects/'+id+'/'+objectSlot(index));}
 putObject(id,index,value){return this.write('objects/'+id+'/'+objectSlot(index),value);}
 async original(sha256,{signal}={}){
  if(!hashValue(sha256))throw new AppError('INVALID');
  const info=await this.read('originals/'+sha256);if(info.sha256!==sha256||!importId(info.storageId))fail();
  const file=path.join(await privateDirectory(this.workspace.root,'.observanda/materials/originals/'+info.storageId),info.storageId+'.original');
  await assertRegular(file);const content=await describeContent(this.workspace,file,{signal});
  if(content.sha256!==info.sha256||content.size!==info.bytes)fail();return content;
 }
 async retain(file,source,{signal,onProgress=()=>{}}={}){
  const existing=await this.read('originals/'+file.sha256,{optional:true});
  if(existing){const content=await this.original(file.sha256,{signal});await content.verify();return;}
  const selected=await checkedSourcePath(source,file.path),stat=await lstat(selected,{bigint:true}),known={kind:'file',size:Number(stat.size),stamp:sourceStamp(stat)};
  if(known.size!==file.bytes)throw new AppError('INVENTORY_CHANGED');
  const storageId=randomUUID(),folder=await privateDirectory(this.workspace.root,'.observanda/materials/originals/'+storageId),output=path.join(folder,storageId+'.original');
  let retained=false,read=0;
  async function* chunks(){for await(const chunk of sourceChunks(source,file.path,known,{signal})){read+=chunk.length;await onProgress({phase:'staging',path:file.path,bytesRead:read,totalBytes:file.bytes});yield chunk;}}
  try{
   const result=await writeContent(this.workspace,output,chunks(),{maxBytes:file.bytes||1,signal});
   if(result.sha256!==file.sha256||result.size!==file.bytes)throw new AppError('INVENTORY_CHANGED');
   await this.locked(async()=>{
    if(await this.read('originals/'+file.sha256,{optional:true}))return;
    await this.write('originals/'+file.sha256,{sha256:file.sha256,bytes:file.bytes,storageId});retained=true;
   });
  }finally{if(!retained&&await assertRegular(output,{missing:true}))await unlink(output);}
 }
 async page(command){
  const batch=await this.bound(command),offset=command.offset??0;
  if(!Number.isInteger(offset)||offset<0||offset>batch.count)throw new AppError('INVALID');
  const items=[];for(let i=offset;i<Math.min(offset+20,batch.count);i++){
   const row=await this.object(batch.id,i),p=row.reviewEdit===batch.edit?row.prepared:null;
   items.push({index:i,id:row.source.id,revision:row.source.revision,title:row.mapping.title,kind:row.source.mapping?.kind??row.source.kind,
    disposition:row.mapping.disposition,current:row.mapping.current,reason:row.mapping.reason,problem:row.reviewEdit===batch.edit?row.problem??null:null,reversal:row.reversal??null,
    recordId:batch.state==='committed'&&row.mapping.current?p?.record?.id??null:null,
    prepared:p?{action:p.action,conflicts:p.conflicts,changed:p.changed,conversion:p.conversion,sourceChanged:p.sourceChanged}:null});
  }
  return {batch,items,offset,next:offset+items.length<batch.count?offset+items.length:null};
 }
 async list(workspaceId,{after=null}={}){
  const {metadata}=await this.workspace.outline();if(workspaceId!==metadata.id)throw new AppError('WORKSPACE_CHANGED');
  const page=await this.feed().page({cursor:after,limit:20}),items=[];for(const ref of page.items)items.push(await this.batch(ref.id));return {...page,items};
 }
}
