import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {opendir,unlink,rmdir} from 'node:fs/promises';
import {privateDirectory,digest,assertRegular} from '../storage.js';
import {isStorageTemporary} from '../storage-temporary.js';
import {FileContent,writeContent,contentStream,contentSize,contentHash,contentBuffer} from '../file-content.js';
import {uuid,exact} from '../modules/validation.js';
import {AppError} from '../errors.js';
import {validTransferPart} from './research-transfer.js';
const valid=condition=>{if(!condition)throw new AppError('COLLABORATION_PACKAGE');};
const reviewPart=(kind,name)=>kind==='description'&&name==='selection'||kind==='metadata'&&/^\.observanda\/reviews\/figure-chunks\/[a-f0-9]{64}\.json$/.test(name);
const validPart=(kind,name,scope)=>scope==='reviews'?reviewPart(kind,name):validTransferPart(kind,name);
const descriptor=(value,scope)=>{
 valid(exact(value,['kind','name','size','sha256','index'])&&validPart(value.kind,value.name,scope)&&Number.isSafeInteger(value.index)&&value.index>=0&&(scope==='reviews'||value.index<100000)&&Number.isSafeInteger(value.size)&&value.size>=0&&value.size<=2**41&&/^[a-f0-9]{64}$/.test(value.sha256));return value;
};

// Transport staging is local and encrypted. Research metadata and immutable
// originals are admitted only after the complete package has authenticated.
export class ExchangeParts{
 constructor(workspace,id=randomUUID(),{scope='collaboration',write=operation=>operation()}={}){if(!uuid(id)||!['collaboration','reviews'].includes(scope))throw new AppError('INVALID');this.workspace=workspace;this.id=id;this.scope=scope;this.write=write;this.prefix=(scope==='reviews'?'.observanda/reviews/parts/':'.observanda/collaboration/staging/')+id;this.count=0;this.bytes=0;}
 async descriptor(kind,name){valid(validPart(kind,name,this.scope));const raw=await this.workspace.readMetadata(this.prefix+'/names/'+digest(kind+'/'+name)+'.json',2048);if(raw===null)return null;const item=descriptor(JSON.parse(raw),this.scope);valid(item.kind===kind&&item.name===name);return item;}
 async add({kind,name,content}){
  const old=await this.descriptor(kind,name),size=contentSize(content),sha256=contentHash(content);
  if(old){if(old.size!==size||old.sha256!==sha256)throw new AppError('COLLABORATION_PACKAGE');return old;}
  return this.receive({kind,name,size,sha256},contentStream(content));
 }
 async receive(info,source){
  descriptor({...info,index:this.count},this.scope);if(this.bytes+info.size>2**41)throw new AppError('LIMIT');
  if(await this.descriptor(info.kind,info.name))throw new AppError('COLLABORATION_PACKAGE');
  if(['description','record','metadata'].includes(info.kind)&&info.size>(info.kind==='metadata'?16:2)*1024*1024)throw new AppError('LIMIT');
  const directory=await privateDirectory(this.workspace.root,this.prefix),index=this.count++,file=path.join(directory,index+'.blob');
  const saved=await writeContent(this.workspace,file,source,{maxBytes:info.size||1});
  if(saved.size!==info.size||saved.sha256!==info.sha256)throw new AppError('COLLABORATION_PACKAGE');
  const entry={...info,index};await this.write(async()=>{await this.workspace.writeMetadata(this.prefix+'/items/'+index+'.json',JSON.stringify(entry));await this.workspace.writeMetadata(this.prefix+'/names/'+digest(info.kind+'/'+info.name)+'.json',JSON.stringify(entry));});this.bytes+=saved.size;return entry;
 }
 content(item){descriptor(item,this.scope);return new FileContent(this.workspace,path.join(this.workspace.root,this.prefix,item.index+'.blob'),item.size,item.sha256);}
 async value(kind,name){const item=await this.descriptor(kind,name);if(!item)throw new AppError('COLLABORATION_PACKAGE');if(item.size>16*1024*1024)throw new AppError('LIMIT');return JSON.parse((await contentBuffer(this.content(item))).toString('utf8'));}
 async finish(extra,{write=this.write}={}){await write(()=>this.workspace.writeMetadata(this.prefix+'/head.json',JSON.stringify({count:this.count,bytes:this.bytes,...extra})));}
 async open(){const raw=await this.workspace.readMetadata(this.prefix+'/head.json',8192);valid(!!raw);const head=JSON.parse(raw);valid(Number.isSafeInteger(head.count)&&head.count>=1&&(this.scope==='reviews'||head.count<=100000)&&Number.isSafeInteger(head.bytes)&&head.bytes>=0&&head.bytes<=2**41&&['incoming','outgoing','base'].includes(head.direction)&&/^[a-f0-9]{64}$/.test(head.selectionHash));this.count=head.count;this.bytes=head.bytes;return head;}
 async *items(){
  let bytes=0;const native=await this.workspace.storageKind()==='catalogue';
  for(let offset=0;offset<this.count;offset+=32){
   const read=async()=>{
    const rows=[];for(let i=offset;i<Math.min(this.count,offset+32);i++){
     const raw=await this.workspace.readMetadata(this.prefix+'/items/'+i+'.json',2048);valid(!!raw);const item=descriptor(JSON.parse(raw),this.scope);valid(item.index===i);rows.push(item);
    }return rows;
   };
   // A cross-owner stream must not open one source connection per descriptor.
   // Release each bounded read snapshot before yielding file content.
   const rows=await (native?this.workspace.catalogue(read):read());for(const item of rows){bytes+=item.size;yield item;}
  }
  valid(bytes===this.bytes);
 }
 async *entries(){for await(const item of this.items())yield {...item,content:this.content(item)};}
 async discardUncommitted(){
  if(await this.workspace.readMetadata(this.prefix+'/head.json',8192)!==null)return;
  let directory=this.workspace.root;
  for(const component of this.prefix.split('/')){directory=path.join(directory,component);if(!await assertRegular(directory,{directory:true,missing:true}))return;}
  for await(const entry of await opendir(directory)){
   if(!/^\d+\.blob$/.test(entry.name)&&!isStorageTemporary(entry.name))throw new AppError('UNSAFE');
   const file=path.join(directory,entry.name);await assertRegular(file);await unlink(file);
  }
  await rmdir(directory);
 }
}
