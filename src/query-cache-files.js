import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {windowsMutationFiles} from './windows-mutation-files.js';
import {posixMutationFiles} from './posix-mutation-files.js';
import {nativeResources} from './native-resource-budget.js';
import {diskCapacity} from './disk-capacity.js';
import {seal,unseal} from './encryption.js';
import {QueryCachePressure} from './query-result-sort.js';
import {AppError} from './errors.js';
const FILES=['a.data','a.runs','b.data','b.runs','pages'],ALLOCATION=64*1024*1024,WORKSPACE_BYTES=512*1024*1024,MAX_ENTRIES=8,OVERHEAD=128*1024;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value),pressure=()=>{throw new QueryCachePressure();};
const aad=(vault,id)=>'Observanda/query-cache-owner/v1/'+vault.id+'/'+id;
const namespaceAAD=vault=>'Observanda/query-cache-namespace/v1/'+vault.id;
let shared;
const activeLeases=new Map();
async function acquireService(){
 if(!shared){const permit=nativeResources.reserve('buffer',96*1024*1024),entry={users:0,permit};entry.opening=(process.platform==='win32'?windowsMutationFiles():posixMutationFiles());void entry.opening.catch(()=>{});shared=entry;}
 const entry=shared;entry.users++;let service,released=false;
 const release=async()=>{if(released)return;released=true;if(--entry.users)return;if(shared===entry)shared=null;try{await (service??await entry.opening).close();entry.permit.release();}catch(error){entry.permit.uncertainExit();throw error;}};
 try{service=await entry.opening;return {service,release};}catch(error){await release().catch(()=>{});throw error;}
}
async function write(handle,bytes,at=0){let offset=0;while(offset<bytes.length){const result=await handle.write(bytes,offset,bytes.length-offset,at+offset);if(!result.bytesWritten)throw new AppError('IO');offset+=result.bytesWritten;}}
async function read(handle,at,size){const bytes=Buffer.allocUnsafe(size);let offset=0;while(offset<size){const result=await handle.read(bytes,offset,size-offset,at+offset);if(!result.bytesRead)throw new AppError('CATALOGUE_DAMAGED');offset+=result.bytesRead;}return bytes;}
async function closeAll(operations){let failure;for(const operation of operations)try{await operation();}catch(error){failure??=error;}if(failure)throw failure;}
async function namespace(cache,root,vault,admission=null){
 const saved=await cache.read('namespace',{limit:2048,missing:true});if(!saved)return false;let value;
 try{value=JSON.parse(unseal(saved.bytes,vault.key,namespaceAAD(vault)));}catch{return false;}
 return value?.version===1&&Object.keys(value).sort().join()==='admissionIdentity,cacheIdentity,rootIdentity,version'&&value.rootIdentity===root.identity&&value.cacheIdentity===cache.identity&&(admission??await cache.stat('admission')).identity===value.admissionIdentity;
}
async function ownership(directory,vault,id,rootIdentity,cacheIdentity){
 const saved=await directory.read('owner',{limit:16384,missing:true});if(!saved)return null;let value;
 try{value=JSON.parse(unseal(saved.bytes,vault.key,aad(vault,id)));}catch{pressure();}
 if(!value||Object.keys(value).sort().join()!=='allocation,cacheIdentity,createdAt,directoryIdentity,files,id,leaseIdentity,rootIdentity,version'||value.version!==1||value.id!==id||value.rootIdentity!==rootIdentity||value.cacheIdentity!==cacheIdentity||value.directoryIdentity!==directory.identity||value.allocation!==ALLOCATION||!Number.isSafeInteger(value.createdAt)||Object.keys(value.files??{}).sort().join()!==[...FILES].sort().join()||typeof value.leaseIdentity!=='string'||Object.values(value.files).some(identity=>typeof identity!=='string'))pressure();
 return {value,ownerIdentity:saved.identity};
}
async function inspectFiles(directory,receipt,{lease=null,busy=false}={}){
 const expected=new Set([...FILES,'owner','lease']),found=new Set();let bytes=OVERHEAD;
 for await(const entry of directory.entries()){if(entry.directory||!expected.has(entry.name)||found.has(entry.name))pressure();found.add(entry.name);}
 if(found.size!==expected.size)pressure();
 for(const file of FILES){const stat=await directory.stat(file);if(stat.identity!==receipt.value.files[file]||!Number.isSafeInteger(stat.bytes)||stat.bytes<0)pressure();bytes+=stat.bytes;}
 if(!busy&&(lease??await directory.stat('lease')).identity!==receipt.value.leaseIdentity||!busy&&process.platform!=='win32'&&(await directory.stat('lease')).identity!==receipt.value.leaseIdentity||(await directory.stat('owner')).identity!==receipt.ownerIdentity||bytes>receipt.value.allocation)pressure();
 return bytes;
}
async function removeProved(cache,directory,receipt,lease){
 await inspectFiles(directory,receipt,{lease});
 for(const file of FILES)await directory.remove(file,{identity:receipt.value.files[file]});
 await directory.remove('owner',{identity:receipt.ownerIdentity});await lease.close();await directory.remove('lease',{identity:receipt.value.leaseIdentity});
 const identity=directory.identity;await directory.close();await cache.remove(receipt.value.id,{folder:true,identity});
}

// Every retained result owns only filesystem leases, never a catalogue handle.
// The signed-in vault proves cleanup authority over a fixed set of opaque files;
// unknown names, substituted identities and unproven crash debris are preserved.
export async function openQueryCacheFiles(workspace,{check=()=>{},signal}={}){
 check();const {vault,root:rootPath}=workspace;if(!Buffer.isBuffer(vault?.key))throw new AppError('ACCESS_LOCKED');
 let serviceOwner,root,internal,cache,admission,directory,lease,ticket,receipt,id,closed=false,closing;const handles=new Map(),sizes=new Map();let bytes=OVERHEAD;
 const closeParents=()=>closeAll([()=>cache?.close(),()=>internal?.close(),()=>root?.close(),()=>serviceOwner?.release()]);
 try{
  serviceOwner=await acquireService();root=await serviceOwner.service.open(workspace.root);internal=await root.directory('.observanda');cache=await internal.directory('query-cache',{missing:true});let created=false;
  if(!cache){try{cache=await internal.directory('query-cache',{create:true,exclusive:true});created=true;}catch(error){if(error.code!=='EEXIST')throw error;cache=await internal.directory('query-cache');}}
  if(!created&&!await namespace(cache,root,vault))pressure();admission=await cache.lease('admission');
  if(created){const file=await cache.file('namespace',{mode:'exclusive'});try{await write(file,seal(Buffer.from(JSON.stringify({version:1,rootIdentity:root.identity,cacheIdentity:cache.identity,admissionIdentity:admission.identity})),vault.key,namespaceAAD(vault)));await file.sync();}finally{await file.close();}}
  if(!await namespace(cache,root,vault,admission))pressure();let count=0,reserved=0;
  for await(const entry of cache.entries()){
   check();if(['admission','namespace'].includes(entry.name)&&!entry.directory)continue;if(!entry.directory||!uuid(entry.name)||++count>MAX_ENTRIES)pressure();
   const child=await cache.directory(entry.name);let oldLease;
   try{
    const prior=await ownership(child,vault,entry.name,root.identity,cache.identity);if(!prior)pressure();
    try{oldLease=await child.lease('lease');}catch(error){if(error.code!=='EBUSY')throw error;}
    if(oldLease){await removeProved(cache,child,prior,oldLease);oldLease=null;count--;}
    else{await inspectFiles(child,prior,{busy:true});reserved+=prior.value.allocation;}
   }finally{await oldLease?.close();await child.close();}
  }
  if(count>=MAX_ENTRIES||reserved+ALLOCATION>WORKSPACE_BYTES)pressure();
  ticket=await diskCapacity.reserve(workspace.root,ALLOCATION,{reserveBytes:64*1024*1024,refreshBytes:4*1024*1024,signal});check();
  id=randomUUID();directory=await cache.directory(id,{create:true,exclusive:true});lease=await directory.lease('lease');const files={};
  for(const file of FILES){const handle=await directory.file(file,{mode:'exclusive'});handles.set(file,handle);sizes.set(file,0);files[file]=handle.identity;}
  const value={version:1,id,rootIdentity:root.identity,cacheIdentity:cache.identity,directoryIdentity:directory.identity,leaseIdentity:lease.identity,createdAt:Date.now(),allocation:ALLOCATION,files},owner=await directory.file('owner',{mode:'exclusive'});
  try{await write(owner,seal(Buffer.from(JSON.stringify(value)),vault.key,aad(vault,id)));await owner.sync();receipt={value,ownerIdentity:owner.identity};}finally{await owner.close();}
  activeLeases.set(directory.identity,lease);
  await admission.close();admission=null;
  const named=async()=>{check();const current=await serviceOwner.service.open(rootPath);let child,namespace,member;try{if(current.identity!==root.identity)pressure();child=await current.directory('.observanda');if(child.identity!==internal.identity)pressure();namespace=await child.directory('query-cache');if(namespace.identity!==cache.identity)pressure();member=await namespace.directory(id);if(member.identity!==directory.identity)pressure();}finally{await closeAll([()=>member?.close(),()=>namespace?.close(),()=>child?.close(),()=>current.close()]);}};
  return {id,async assertNamed(){if(closed)pressure();await named();},
   async read(file,at,size){check();if(closed||!handles.has(file)||!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(size)||size<0||size>512*1024+44||at+size>sizes.get(file))throw new AppError('CATALOGUE_DAMAGED');return read(handles.get(file),at,size);},
   async write(file,at,data){check();if(closed||!handles.has(file)||!Buffer.isBuffer(data)||!Number.isSafeInteger(at)||at<0||data.length>512*1024+44)pressure();const length=Math.max(sizes.get(file),at+data.length),growth=length-sizes.get(file);if(bytes+growth>ALLOCATION)pressure();await ticket.write(growth,()=>write(handles.get(file),data,at));sizes.set(file,length);bytes+=growth;},
   async truncate(file,size){check();if(closed||!handles.has(file)||!Number.isSafeInteger(size)||size<0||size>sizes.get(file))pressure();await handles.get(file).truncate(size);bytes-=sizes.get(file)-size;sizes.set(file,size);},
   async finish(){check();for(const handle of handles.values())await handle.sync();ticket.release();ticket=null;await named();},
   close(){if(closing)return closing;closed=true;return closing=(async()=>{let failure;try{await closeAll([...handles.values()].map(handle=>()=>handle.close()));handles.clear();await removeProved(cache,directory,receipt,lease);lease=null;}catch(error){failure=error;}finally{activeLeases.delete(directory.identity);ticket?.release();await closeAll([()=>lease?.close(),()=>directory?.close(),closeParents]);}if(failure)throw failure;})();}
  };
 }catch(error){
  try{for(const handle of handles.values())await handle.close();if(receipt){await removeProved(cache,directory,receipt,lease);lease=null;}}catch{/* Only the authenticated fixed tree is eligible for a later cleanup retry. */}
  finally{if(directory)activeLeases.delete(directory.identity);ticket?.release();await lease?.close();await directory?.close();await admission?.close();await closeParents();}
   if(error instanceof QueryCachePressure)throw error;if(['EBUSY','WORKLOAD_BUSY','STORAGE_FULL','ENOSPC','EDQUOT'].includes(error.code))throw new QueryCachePressure('Query cache admission unavailable',{cause:error});throw error;
 }
}

// Inventories skip only a currently authenticated, dedicated transient tree.
// Without a current key or proof, callers retain the ordinary inventory path.
export async function verifiedQueryCacheNamespace(rootPath,vault){
 if(!Buffer.isBuffer(vault?.key))return false;let owner,root,internal,cache;
 try{
  owner=await acquireService();root=await owner.service.open(rootPath);internal=await root.directory('.observanda');cache=await internal.directory('query-cache',{missing:true});if(!cache||!await namespace(cache,root,vault))return false;let count=0;
  for await(const entry of cache.entries()){
   if(['admission','namespace'].includes(entry.name)&&!entry.directory)continue;if(!entry.directory||!uuid(entry.name)||++count>MAX_ENTRIES)return false;
   const child=await cache.directory(entry.name);try{const receipt=await ownership(child,vault,entry.name,root.identity,cache.identity);if(!receipt)return false;await inspectFiles(child,receipt,{lease:activeLeases.get(child.identity)});}finally{await child.close();}
  }
  return true;
 }catch{return false;}finally{await cache?.close();await internal?.close();await root?.close();await owner?.release();}
}
