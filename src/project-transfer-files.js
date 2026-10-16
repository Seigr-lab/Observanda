// Bounded, authenticated file receipts make interrupted copies reconcilable.
// A batch is durable before any replacement or removal it authorizes.
import path from 'node:path';
import {isStorageTemporary} from './storage-temporary.js';
import {createHash} from 'node:crypto';
import {opendir,unlink} from 'node:fs/promises';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {workspaceFiles,hashWorkspaceFile} from './workspace-inventory.js';
import {copyFileProgress} from './copy-file-progress.js';
import {atomicReplace} from './atomic-replace.js';
import {withScratch} from './scratch-work.js';
import {operationTransferred} from './operation-progress.js';
import {AppError} from './errors.js';
export const PROJECT_TRANSFER_FILES='.observanda/project-transfer-files';
const limit=4*1024*1024,batchSize=64;
const fingerprint=value=>value===null||value&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&/^[a-f0-9]{64}$/.test(value.sha256??'');
const same=(a,b)=>a===null?b===null:b!==null&&a.bytes===b.bytes&&a.sha256===b.sha256;
const relative=value=>typeof value==='string'&&value.length<=32768&&!value.includes('\\')&&!value.includes('\0')&&!path.isAbsolute(value)&&!path.posix.isAbsolute(value)&&path.posix.normalize(value)===value&&!value.split('/').some(part=>['..','.',''].includes(part));
async function measured(file){const stat=await assertRegular(file,{missing:true});return stat?{bytes:stat.size,sha256:await hashWorkspaceFile(file)}:null;}
export async function reconcileProjectFiles(source,target,receipt,{controls,receiptDirectory=PROJECT_TRANSFER_FILES,projectRoots,checkpoint=async()=>{}}){
 const directory=await privateDirectory(target.root,receiptDirectory),staging=await privateDirectory(target.root,receiptDirectory+'/staging');
 return withScratch(async work=>{
  let page=0;
  // Filenames are deterministic; a receipt gap or an extra file is corruption.
  let pages=0;for await(const entry of await opendir(directory)){if(entry.name==='staging'){await assertRegular(path.join(directory,entry.name),{directory:true});continue;}if(isStorageTemporary(entry.name)){const file=path.join(directory,entry.name);await assertRegular(file);await unlink(file);continue;}if(!/^\d{10}\.obsv$/.test(entry.name)||!entry.isFile())throw new AppError('STORAGE_COPY');pages++;}
  for(;page<pages;page++){
   const file=path.join(directory,String(page).padStart(10,'0')+'.obsv');if((await assertRegular(file)).size>limit)throw new AppError('STORAGE_COPY');
   const value=JSON.parse(await target.readFile(file,'utf8'));
   if(value?.version!==1||value.id!==receipt.id||value.page!==page||!Array.isArray(value.entries)||!value.entries.length||value.entries.length>batchSize)throw new AppError('STORAGE_COPY');
   for(const entry of value.entries){
    if(!relative(entry?.path)||controls.has(entry.path)||entry.path.startsWith(receiptDirectory+'/')||!fingerprint(entry.before)||!fingerprint(entry.after))throw new AppError('STORAGE_COPY');
    const prior=await work.get(entry.path);if(prior&&!same(prior.after,entry.before))throw new AppError('STORAGE_COPY');
    await work.put(entry.path,entry);
   }
  }
  let batch=[];
  const temporary=relative=>path.join(staging,createHash('sha256').update(relative).digest('hex')+'.part');
  async function outputFor(relative){await assertRegular(target.root,{directory:true});const parent=path.posix.dirname(relative);if(parent!=='.')await privateDirectory(target.root,parent);return path.join(target.root,relative);}
  async function flush(){
   if(!batch.length)return;const entries=batch.map(({path,before,after})=>({path,before,after})),raw=serialize({version:1,id:receipt.id,page,entries});if(Buffer.byteLength(raw)>limit-128)throw new AppError('LIMIT');
   await target.writeFile(path.join(directory,String(page).padStart(10,'0')+'.obsv'),raw);page++;await checkpoint('file-receipt');
   for(const entry of batch){
    const output=await outputFor(entry.path);if(!same(await measured(output),entry.before))throw new AppError('CONFLICT');
    if(!entry.after){if(await assertRegular(output,{missing:true}))await unlink(output);}
    else if(entry.replace)await atomicReplace(temporary(entry.path),output);
    await work.put(entry.path,{path:entry.path,before:entry.before,after:entry.after,seen:true});
    if(entry.after)operationTransferred({files:1,bytes:entry.replace?0:entry.after.bytes});await checkpoint('file',entry.path);
   }
   batch=[];
  }
  for await(const file of workspaceFiles(source.root,{includeDatabase:false,hashFiles:false,projectRoots})){
   if(controls.has(file.path))continue;
   const output=await outputFor(file.path);
   const prior=await work.get(file.path),before=await measured(output);
   if(prior&&!same(before,prior.after)&&!same(before,prior.before))throw new AppError('CONFLICT');
   // A pending batch may not have published its previous 'after' bytes yet.
   // Finish that exact step before appending a later source revision.
   if(prior&&!same(before,prior.after)){
    const pending=temporary(file.path);
    if(prior.after){if(!same(await measured(pending),prior.after))throw new AppError('STORAGE_COPY');await atomicReplace(pending,output);}
    else if(before)await unlink(output);
   }
   const current=prior?prior.after:before;
   let after,replace=false;
   if(current){
    after={bytes:file.bytes,sha256:await hashWorkspaceFile(path.join(source.root,file.path))};
    if(!prior&&!same(current,after))throw new AppError('CONFLICT');
   }
   if(!current||!same(current,after)){
    const pending=temporary(file.path);if(await assertRegular(pending,{missing:true}))await unlink(pending);
    const copied=await copyFileProgress(path.join(source.root,file.path),pending,{size:file.bytes,name:file.path,checksum:true,onBytes:bytes=>operationTransferred({bytes})});
    after={bytes:file.bytes,sha256:copied.sha256};if(!same(await measured(pending),after))throw new AppError('STORAGE_COPY');replace=true;
   }
   if(prior&&same(current,after)){await work.put(file.path,{...prior,seen:true});operationTransferred({files:1,bytes:after.bytes});}
   else{batch.push({path:file.path,before:current,after,replace});if(batch.length===batchSize)await flush();}
  }
  await flush();
  for await(const entry of work.items()){
   if(entry.seen)continue;
   const output=await outputFor(entry.path),current=await measured(output);
   if(!same(current,entry.after)&&!same(current,entry.before))throw new AppError('CONFLICT');
   if(!same(current,entry.after)){
    if(entry.after){if(!same(await measured(temporary(entry.path)),entry.after))throw new AppError('STORAGE_COPY');await atomicReplace(temporary(entry.path),output);}
    else if(current)await unlink(output);
   }
   if(entry.after===null)continue;
   batch.push({path:entry.path,before:entry.after,after:null,replace:false});if(batch.length===batchSize)await flush();
  }
  await flush();
  if(receipt.filesVersion!==1)await retireLegacyStages(target.root,receipt.id);
  for await(const entry of await opendir(staging)){const file=path.join(staging,entry.name);if(!/^[a-f0-9]{64}\.part$/.test(entry.name))throw new AppError('STORAGE_COPY');await assertRegular(file);await unlink(file);}
 });
}

// Receipts from before batched staging can leave one reserved stream beside a
// destination file. Retire only this command's exact temporary name.
async function retireLegacyStages(root,id){
 const name='.stream-project-'+id;
 async function remove(directory,top=false){
  await assertRegular(directory,{directory:true});
  for await(const entry of await opendir(directory)){
   const file=path.join(directory,entry.name);
   if(entry.name===name){await assertRegular(file);await unlink(file);continue;}
   if(top){if(entry.name==='.observanda')await remove(file);continue;}
   if(entry.isSymbolicLink())throw new AppError('UNSAFE');
   if(entry.isDirectory()&&!['postgresql','database-transition','project-transfer-files'].includes(entry.name))await remove(file);
  }
 }
 await remove(root,true);
}
