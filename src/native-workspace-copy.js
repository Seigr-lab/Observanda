import path from 'node:path';
import {withMutationFilesSession} from './mutation-files.js';
import {nativeMemberCursor} from './native-storage-tree.js';
import {operationStage,operationAdvance,operationWork,operationTransferred} from './operation-progress.js';
import {AppError} from './errors.js';
import {nativeDestination} from './native-destination.js';
const matches=(actual,file)=>actual?.bytes===file.bytes&&actual.sha256===file.sha256;

// Share roots and one worker across the inventory stream. Each file still has
// an exclusive destination, source checksum, flush and destination verification.
export async function withNativeWorkspaceCopy(sourcePath,destinationPath,operation){
 return withMutationFilesSession(async service=>{
  const source=await service.open(sourcePath),selected=nativeDestination(destinationPath),admitted=selected?.root===path.resolve(destinationPath)?selected:null;let destination,inputCursor,outputCursor,internalCursor,sequence=Promise.resolve(),closed=false;
  try{if(admitted){await admitted.assertNamed();destination=admitted.directory;internalCursor=nativeMemberCursor(admitted.internalDirectory,{create:true});}else destination=await service.open(destinationPath);
   inputCursor=nativeMemberCursor(source);outputCursor=nativeMemberCursor(destination,{create:true});
   const copy=async(file,{temporary}={})=>{
    const {directory:input,name:sourceName}=await inputCursor.member(file.path),{directory:output,name}=await (internalCursor&&file.path.startsWith('.observanda/')?internalCursor.member(file.path.slice('.observanda/'.length)):outputCursor.member(file.path));
    if(temporary){
     const prior=await output.hash(name,{missing:true});if(prior){if(!matches(prior,file))throw new AppError('STORAGE_COPY');operationTransferred({bytes:file.bytes});return;}
     const previous=await output.stat(temporary,{missing:true});if(previous)await output.remove(temporary,{identity:previous.identity});
    }
    const target=temporary??name;let completed=0;
    await operationStage('copy-file',{total:file.bytes,unit:'bytes',item:file.path},async()=>{
     const progress=bytes=>{const delta=bytes-completed;completed=bytes;operationTransferred({bytes:delta});operationAdvance(delta);operationWork({bytes:delta});};
     await output.copy(input,sourceName,target,{bytes:file.bytes,sha256:file.sha256,onProgress:progress});progress(file.bytes);
    });
    const verified=await operationStage('verify-file',{total:file.bytes,unit:'bytes',item:path.posix.basename(file.path)},async()=>{const value=await output.hash(target);operationAdvance(value.bytes);operationWork({bytes:value.bytes});return value;});
    if(!matches(verified,file))throw new AppError('STORAGE_COPY');
    if(temporary)await output.rename(temporary,output,name,{identity:verified.identity});
   };
   return await operation((...args)=>{if(closed)throw new AppError('IO');const pending=sequence.then(()=>copy(...args));sequence=pending.catch(()=>{});return pending;});
  }finally{closed=true;await sequence;await internalCursor?.close();await outputCursor?.close();await inputCursor?.close();if(!admitted)await destination?.close();await source.close();}
 });
}
