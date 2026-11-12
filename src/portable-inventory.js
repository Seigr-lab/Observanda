import path from 'node:path';
import {createHash} from 'node:crypto';
import {withNativeDestination} from './native-destination.js';
import {nativeTreeFiles} from './native-storage-tree.js';
import {hashWorkspaceFile} from './workspace-inventory.js';
import {WORKSPACE_COPY_LEASE,WORKSPACE_COPY_RECEIPT,PORTABLE_RESTORE_RECEIPT} from './workspace-transfer-controls.js';
import {adaptiveReadMap} from './adaptive-reads.js';
import {withScratch} from './scratch-work.js';
import {operationAdvance,operationStage} from './operation-progress.js';
import {AppError} from './errors.js';

const marker='.observanda/copy-in-progress';
const version=1;
export function portableInventoryDigest(){
 const hash=createHash('sha256');let files=0,bytes=0;
 return {
  file(row){files++;bytes+=row[1];if(!Number.isSafeInteger(bytes))throw new AppError('LIMIT');hash.update(JSON.stringify(row)+'\n');},
  finish(){return {version,files,bytes,sha256:hash.digest('hex')};}
 };
}
export function validPortableInventory(value){
 return value?.version===version&&/^[a-f0-9]{64}$/.test(value.sha256)&&
  Number.isSafeInteger(value.files)&&value.files>0&&Number.isSafeInteger(value.bytes)&&value.bytes>=0;
}

// Include every owner's archive, original, publication and transfer receipt.
// Only the outer transfer's own mutable bookkeeping is outside the digest.
// The encrypted scratch index gives identical ordering after a physical copy.
export function portableInventory(root,id,{sealing=false,consume,signal}={}){
 return withNativeDestination(root,async scope=>{
  await scope.admit();
  if(!sealing&&await scope.stat(path.join(root,marker),{missing:true}))throw new AppError('STORAGE_INCOMPLETE');
  function include(name,entry){
   signal?.throwIfAborted();
   if(name===marker&&sealing||name===WORKSPACE_COPY_RECEIPT||name===WORKSPACE_COPY_LEASE||name===PORTABLE_RESTORE_RECEIPT){
    if(entry.directory)throw new AppError('UNSAFE');
    return false;
   }
   if(name===marker||name.endsWith('/'+marker))throw new AppError('STORAGE_INCOMPLETE');
   return true;
  }
  const result=await operationStage('source-check',{unit:'files'},()=>withScratch(async index=>{
   let rows=[];
   async function flush(){
    if((await index.addMany(rows)).size!==rows.length)throw new AppError('STORAGE_COPY');
    rows=[];
   }
   const hashed=adaptiveReadMap(nativeTreeFiles(scope.directory,'',include),async(file,signal)=>{
    const sha256=await hashWorkspaceFile(path.join(root,file.name),{signal,reportProgress:false});
    return [file.name,[file.name,file.bytes,sha256]];
   },{signal});
   for await(const row of hashed){
    rows.push(row);if(rows.length===32)await flush();operationAdvance();
   }
   if(rows.length)await flush();
   const digest=portableInventoryDigest();
   for await(const row of index.items())digest.file(row);
   const result=digest.finish();
   if(!validPortableInventory(result))throw new AppError('STORAGE_COPY');
   if(consume)await consume(result,()=>index.items());
   return result;
  },{keySalt:id,signal}));
  await scope.assertNamed();
  if(!validPortableInventory(result))throw new AppError('STORAGE_COPY');
  return result;
 });
}
