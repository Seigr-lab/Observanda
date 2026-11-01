import {createRequire} from 'node:module';
import {fstatSync,readSync,writeSync,fsyncSync,ftruncateSync} from 'node:fs';
import {createHash} from 'node:crypto';
// A separate process isolates synchronous filesystem calls and owns every fd.
// Disconnect/cancellation cannot leave native descriptors in the app process.
const parentPort={on:process.on.bind(process),postMessage:value=>process.connected&&process.send(value)},native=createRequire(import.meta.url)(process.argv[2]),handles=new Map();let next=0;
process.once('disconnect',()=>{for(const value of handles.values())native.close(value);handles.clear();process.exit(0);});
const fail=code=>{throw Object.assign(new Error(code),{code});};
const handle=id=>handles.get(id)??fail('IO');
const stat=(value,{folder=false,links=false}={})=>{const result=fstatSync(native.fd(value),{bigint:true});if(folder?!result.isDirectory():!result.isFile()||result.nlink<1n||result.nlink>BigInt(links?2:1))fail('UNSAFE');return result;};
const identity=value=>value.dev+':'+value.ino;
const summary=value=>({bytes:Number(value.size),identity:identity(value),links:Number(value.nlink)});
const same=(a,b)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>a[key]===b[key]);
const expected=(value,command)=>{if(command.identity&&identity(value)!==command.identity)fail('CONFLICT');};
function saved(value,folder){const id=++next;handles.set(id,value);return {id,identity:identity(stat(value,{folder}))};}
function opened(parent,name,folder=false,mode=folder?0:2){const value=native.child(parent,name,mode);try{stat(value,{folder,links:true});return value;}catch(error){native.close(value);throw error;}}
const buffer=Buffer.allocUnsafe(1048576);
function hash(value,command){
 const before=stat(value,command),hash=createHash('sha256'),fd=native.fd(value);let position=0;
 try{for(;;){const count=readSync(fd,buffer,0,buffer.length,position);if(!count)break;position+=count;hash.update(buffer.subarray(0,count));}
  const after=stat(value,command);if(!same(before,after))fail('LOCAL_EXPORT_CHANGED');return {...summary(after),sha256:hash.digest('hex')};
 }finally{buffer.fill(0);}
}
function write(fd,bytes,position){let offset=0;while(offset<bytes.length){const count=writeSync(fd,bytes,offset,bytes.length-offset,position+offset);if(!count)fail('IO');offset+=count;}}
function execute(c){
 if(c.operation==='root')return saved(native.root(c.path),true);
 const parent=handle(c.directory);
 if(c.operation==='close'){native.close(parent);handles.delete(c.directory);return {};}
 if(c.operation==='directory')return saved(opened(parent,c.name,true,c.exclusive?5:c.create?1:0),true);
 if(c.operation==='list')return native.entries(parent,c.restart);
 if(c.operation==='file-open')return saved(opened(parent,c.name,false,c.mode==='exclusive'?4:c.mode==='update'?3:2),false);
 if(c.operation==='lease')return saved(native.lease(parent,c.name),false);
 if(c.operation.startsWith('file-')){
  const before=stat(parent),fd=native.fd(parent);
  if(c.operation==='file-stat')return {dev:String(before.dev),ino:String(before.ino),size:String(before.size),nlink:String(before.nlink),mtimeNs:String(before.mtimeNs),ctimeNs:String(before.ctimeNs)};
  if(c.operation==='file-read'){if(!Number.isSafeInteger(c.bytes)||c.bytes<0||c.bytes>1114112||!Number.isSafeInteger(c.position)||c.position<0)fail('INVALID');const bytes=Buffer.allocUnsafe(c.bytes),count=readSync(fd,bytes,0,bytes.length,c.position);stat(parent);return {data:bytes.subarray(0,count)};}
  if(c.operation==='file-write'){if(!Number.isSafeInteger(c.position)||c.position<0||c.data.length>1114112)fail('INVALID');write(fd,c.data,c.position);stat(parent);return {bytesWritten:c.data.length};}
  if(c.operation==='file-sync'){fsyncSync(fd);return {};}
  if(c.operation==='file-truncate'){if(!Number.isSafeInteger(c.bytes)||c.bytes<0)fail('INVALID');ftruncateSync(fd,c.bytes);return {};}
  fail('INVALID');
 }
 if(c.operation==='copy'){
  const source=opened(handle(c.sourceDirectory),c.source),before=stat(source);let target,complete=false,targetIdentity;
  try{if(Number(before.size)!==c.bytes)fail('STORAGE_COPY');target=opened(parent,c.name,false,4);targetIdentity=identity(stat(target));const sha=createHash('sha256');let position=0,reported=0;
   for(;;){const count=readSync(native.fd(source),buffer,0,buffer.length,position);if(!count)break;if(position+count>c.bytes)fail('STORAGE_COPY');sha.update(buffer.subarray(0,count));write(native.fd(target),buffer.subarray(0,count),position);position+=count;if(position-reported>=8388608){parentPort.postMessage({progress:position});reported=position;}}
   if(position!==c.bytes||sha.digest('hex')!==c.sha256||!same(before,stat(source)))fail('STORAGE_COPY');stat(target);fsyncSync(native.fd(target));complete=true;return {bytes:position,sha256:c.sha256};
  }finally{buffer.fill(0);native.close(source);if(target){native.close(target);if(!complete)try{execute({operation:'delete',directory:c.directory,name:c.name,identity:targetIdentity});}catch{}}}
 }
 const value=opened(parent,c.name,!!c.folder);
 try{
  const before=stat(value,c);expected(before,c);
  if(c.operation==='stat')return summary(before);
  if(c.operation==='hash')return hash(value,c);
  if(c.operation==='read'){if(!Number.isSafeInteger(c.limit)||c.limit<0||c.limit>65536||before.size>BigInt(c.limit))fail('UNSAFE');const bytes=Buffer.alloc(Number(before.size));let offset=0;while(offset<bytes.length){const count=readSync(native.fd(value),bytes,offset,bytes.length-offset,offset);if(!count)fail('CONFLICT');offset+=count;}if(!same(before,stat(value)))fail('CONFLICT');return {data:bytes,identity:identity(before)};}
  const target=c.operation==='delete'?parent:handle(c.targetDirectory),name=c.operation==='delete'?c.name:c.target;
  if(!['rename','link','delete'].includes(c.operation))fail('INVALID');
  // Both parents stay anchored. POSIX has no unlink-by-inode primitive;
  // basename replacement can cause a conflict, but cannot follow an escape.
  native.mutate(parent,c.name,target,name,c.operation==='rename'?(c.replace?3:0):c.operation==='link'?1:2,!!c.folder);return {};
 }finally{native.close(value);}
}
parentPort.on('message',command=>{try{parentPort.postMessage({result:execute(command)});}catch(error){parentPort.postMessage({error:error.code??'IO'});}});
parentPort.postMessage({ready:true});
