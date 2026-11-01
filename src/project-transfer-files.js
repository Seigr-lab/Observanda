// Bounded, authenticated file receipts make interrupted copies reconcilable.
// A batch is durable before any replacement or removal it authorizes.
import path from 'node:path';
import {isStorageTemporary} from './storage-temporary.js';
import {privateDirectory,serialize} from './storage.js';
import {workspaceFiles} from './workspace-inventory.js';
import {withNativeDestination} from './native-destination.js';
import {withNativeProjectTransferFiles} from './native-project-transfer-files.js';
import {withScratch} from './scratch-work.js';
import {operationTransferred} from './operation-progress.js';
import {AppError} from './errors.js';
export const PROJECT_TRANSFER_FILES='.observanda/project-transfer-files';
const limit=4*1024*1024,batchSize=64;
const fingerprint=value=>value===null||value&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&/^[a-f0-9]{64}$/.test(value.sha256??'');
const same=(a,b)=>a===null?b===null:b!==null&&a.bytes===b.bytes&&a.sha256===b.sha256;
const contentFingerprint=value=>value===null?null:{bytes:value.bytes,sha256:value.sha256};
const relative=value=>typeof value==='string'&&value.length<=32768&&!value.includes('\\')&&!value.includes('\0')&&!path.isAbsolute(value)&&!path.posix.isAbsolute(value)&&path.posix.normalize(value)===value&&!value.split('/').some(part=>['..','.',''].includes(part));
export async function reconcileProjectFiles(source,target,receipt,{controls,receiptDirectory=PROJECT_TRANSFER_FILES,projectRoots,excludeProject,checkpoint=async()=>{}}){
 return withNativeDestination(target.root,async admitted=>{
 await admitted.admit({identity:receipt.destinationIdentity,internalIdentity:receipt.internalIdentity});
 receipt.destinationIdentity??=admitted.identity;receipt.internalIdentity??=admitted.internalIdentity;
 const directory=await privateDirectory(target.root,receiptDirectory);await privateDirectory(target.root,receiptDirectory+'/staging');
 const result=await withNativeProjectTransferFiles(source,admitted,receiptDirectory,files=>withScratch(async work=>{
  let page=0;
  // Filenames are deterministic; a receipt gap or an extra file is corruption.
  let pages=0;for await(const entry of files.receipts.entries()){if(entry.name==='staging'){if(!entry.directory)throw new AppError('UNSAFE');continue;}if(entry.directory)throw new AppError('STORAGE_COPY');if(isStorageTemporary(entry.name)){const stat=await files.receipts.stat(entry.name);await files.receipts.remove(entry.name,{identity:stat.identity});continue;}if(!/^\d{10}\.obsv$/.test(entry.name))throw new AppError('STORAGE_COPY');pages++;}
  for(;page<pages;page++){
   const name=String(page).padStart(10,'0')+'.obsv',file=path.join(directory,name);if((await files.receipts.stat(name)).bytes>limit)throw new AppError('STORAGE_COPY');
   const value=JSON.parse(await target.readFile(file,'utf8',limit));
   if(value?.version!==1||value.id!==receipt.id||value.page!==page||!Array.isArray(value.entries)||!value.entries.length||value.entries.length>batchSize)throw new AppError('STORAGE_COPY');
   for(const entry of value.entries){
    if(!relative(entry?.path)||controls.has(entry.path)||entry.path.startsWith(receiptDirectory+'/')||!fingerprint(entry.before)||!fingerprint(entry.after))throw new AppError('STORAGE_COPY');
    const prior=await work.get(entry.path);if(prior&&!same(prior.after,entry.before))throw new AppError('STORAGE_COPY');
    await work.put(entry.path,entry);
   }
  }
  let batch=[];
  async function flush(){
   if(!batch.length)return;const entries=batch.map(({path,before,after})=>({path,before:contentFingerprint(before),after:contentFingerprint(after)})),raw=serialize({version:1,id:receipt.id,page,entries});if(Buffer.byteLength(raw)>limit-128)throw new AppError('LIMIT');
   await target.writeFile(path.join(directory,String(page).padStart(10,'0')+'.obsv'),raw);page++;await checkpoint('file-receipt');
   for(const entry of batch){
    const current=await files.hash(entry.path);if(!same(current,entry.before))throw new AppError('CONFLICT');
    if(!entry.after)await files.remove(entry.path,current);
    else if(entry.replace)await files.publish(entry.path,entry.after);
    await work.put(entry.path,{path:entry.path,before:entry.before,after:entry.after,seen:true});
    if(entry.after)operationTransferred({files:1,bytes:entry.replace?0:entry.after.bytes});await checkpoint('file',entry.path);
   }
   batch=[];
  }
  for await(const file of workspaceFiles(source.root,{includeDatabase:false,hashFiles:false,projectRoots,excludeProject})){
   if(controls.has(file.path))continue;
   const prior=await work.get(file.path),before=await files.hash(file.path);
   if(prior&&!same(before,prior.after)&&!same(before,prior.before))throw new AppError('CONFLICT');
   // A pending batch may not have published its previous 'after' bytes yet.
   // Finish that exact step before appending a later source revision.
   if(prior&&!same(before,prior.after)){
    if(prior.after)await files.publish(file.path,prior.after);
    else if(before)await files.remove(file.path,before);
   }
   const current=prior?prior.after:before;
   let after,replace=false;
   if(current){
    after=await files.sourceHash(file.path);if(after.bytes!==file.bytes)throw new AppError('STORAGE_COPY');after={bytes:after.bytes,sha256:after.sha256};
    if(!prior&&!same(current,after))throw new AppError('CONFLICT');
   }
   if(!current||!same(current,after)){
    await files.discardStage(file.path);after=await files.copy(file);if(!same(await files.stageHash(file.path),after))throw new AppError('STORAGE_COPY');replace=true;
   }
   if(prior&&same(current,after)){await work.put(file.path,{...prior,seen:true});operationTransferred({files:1,bytes:after.bytes});}
   else{batch.push({path:file.path,before:current,after,replace});if(batch.length===batchSize)await flush();}
  }
  await flush();
  for await(const entry of work.items()){
   if(entry.seen)continue;
   const current=await files.hash(entry.path);
   if(!same(current,entry.after)&&!same(current,entry.before))throw new AppError('CONFLICT');
   if(!same(current,entry.after)){
    if(entry.after)await files.publish(entry.path,entry.after);
    else if(current)await files.remove(entry.path,current);
   }
   if(entry.after===null)continue;
   batch.push({path:entry.path,before:entry.after,after:null,replace:false});if(batch.length===batchSize)await flush();
  }
  await flush();
  if(receipt.filesVersion!==1)await retireLegacyStages(admitted,receipt.id);
  for await(const entry of files.staging.entries()){if(entry.directory||!/^[a-f0-9]{64}\.part$/.test(entry.name))throw new AppError('STORAGE_COPY');const stat=await files.staging.stat(entry.name);await files.staging.remove(entry.name,{identity:stat.identity});}
 }));await admitted.assertNamed();return result;
 });
}

// Receipts from before batched staging can leave one reserved stream beside a
// destination file. Retire only this command's exact temporary name.
async function retireLegacyStages(admitted,id){
 const name='.stream-project-'+id;
 async function remove(directory,top=false){
  for await(const entry of directory.entries()){
   if(entry.name===name){const stat=await directory.stat(entry.name);await directory.remove(entry.name,{identity:stat.identity});continue;}
   if(top){if(entry.name==='.observanda')await remove(admitted.internalDirectory);continue;}
   if(entry.directory&&!['postgresql','database-transition','project-transfer-files','lab-book-transfer-files'].includes(entry.name)){const child=await directory.directory(entry.name);try{await remove(child);}finally{await child.close();}}
  }
 }
 await remove(admitted.directory,true);
}
