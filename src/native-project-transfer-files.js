import path from 'node:path';
import {createHash} from 'node:crypto';
import {withMutationFilesSession} from './mutation-files.js';
import {nativeMemberCursor} from './native-storage-tree.js';
import {writeFilePart} from './segmented-file-io.js';
import {databaseRequestSignal} from './database-request-context.js';
import {operationStage,operationAdvance,operationWork,operationTransferred} from './operation-progress.js';
import {AppError} from './errors.js';

const stable=(a,b)=>['size','mtimeNs','ctimeNs','ino','dev','nlink'].every(key=>a[key]===b[key]);
// Fresh originals are hashed while being copied, never read a second time just
// to supply a checksum. One bounded buffer and the most recent ancestry are held.
export function withNativeProjectTransferFiles(source,admitted,receiptDirectory,operation){
 return withMutationFilesSession(async service=>{
  const root=await service.open(source.root),input=nativeMemberCursor(root),output=nativeMemberCursor(admitted.directory,{create:true}),internal=nativeMemberCursor(admitted.internalDirectory,{create:true});
  try{return await admitted.member(path.join(admitted.root,receiptDirectory,'.receipt-admission'),async receipts=>{
   const staging=await receipts.directory('staging');
   const parents=new Map();
   const assertParent=async value=>{if(value)await admitted.member(path.join(admitted.root,value.path),directory=>{if(directory.identity!==value.directory.identity)throw new AppError('STORAGE_COPY');});};
   const member=async relative=>{
    const cursor=relative.startsWith('.observanda/')?internal:output,previous=parents.get(cursor);
    if(previous&&path.posix.dirname(previous.path)!==path.posix.dirname(relative))await assertParent(previous);
    const value=await cursor.member(cursor===internal?relative.slice('.observanda/'.length):relative);parents.set(cursor,{...value,path:relative});return value;
   };
   const stageName=relative=>createHash('sha256').update(relative).digest('hex')+'.part';
   const hash=async relative=>{const {directory,name}=await member(relative);return directory.hash(name,{missing:true});};
   const remove=async(relative,value)=>{if(!value)return;const {directory,name}=await member(relative);await directory.remove(name,{identity:value.identity});};
   const discardStage=async relative=>{const name=stageName(relative),value=await staging.stat(name,{missing:true});if(value)await staging.remove(name,{identity:value.identity});};
   const publish=async(relative,expected)=>{
    const name=stageName(relative),saved=await staging.hash(name),target=await member(relative);
    if(saved.bytes!==expected.bytes||saved.sha256!==expected.sha256)throw new AppError('STORAGE_COPY');
    await staging.rename(name,target.directory,target.name,{identity:saved.identity,replace:true});
   };
   const copy=file=>operationStage('copy-file',{total:file.bytes,unit:'bytes',item:file.path},async()=>{
    if(!Number.isSafeInteger(file.bytes)||file.bytes<0)throw new AppError('STORAGE_COPY');
    const {directory,name}=await input.member(file.path),sourceFile=await directory.file(name),stage=stageName(file.path),signal=databaseRequestSignal(),buffer=Buffer.allocUnsafe(1024*1024);let destination,identity,complete=false;
    try{
     const before=await sourceFile.stat({bigint:true});if(before.nlink!==1n||before.size!==BigInt(file.bytes))throw new AppError('STORAGE_COPY');
     destination=await staging.file(stage,{mode:'exclusive'});identity=destination.identity;let position=0;const digest=createHash('sha256');
     for(;;){signal?.throwIfAborted();const {bytesRead}=await sourceFile.read(buffer,0,buffer.length,position);if(!bytesRead)break;if(position+bytesRead>file.bytes)throw new AppError('STORAGE_COPY');const bytes=buffer.subarray(0,bytesRead);await writeFilePart(destination,bytes,position);digest.update(bytes);position+=bytesRead;operationTransferred({bytes:bytesRead});operationAdvance(bytesRead);operationWork({bytes:bytesRead});}
     signal?.throwIfAborted();if(position!==file.bytes||!stable(before,await sourceFile.stat({bigint:true}))||(await directory.stat(name)).identity!==sourceFile.identity)throw new AppError('STORAGE_COPY');
     await destination.sync();complete=true;return {bytes:position,sha256:digest.digest('hex')};
    }finally{buffer.fill(0);try{await destination?.close();}finally{await sourceFile.close();if(!complete&&identity)await staging.remove(stage,{identity}).catch(()=>{});}}
   });
   try{const result=await operation({receipts,staging,member,hash,remove,stageHash:relative=>staging.hash(stageName(relative),{missing:true}),discardStage,publish,copy,sourceHash:async relative=>{const {directory,name}=await input.member(relative);return directory.hash(name);}});for(const parent of parents.values())await assertParent(parent);await admitted.member(path.join(admitted.root,receiptDirectory,'staging/.stage-admission'),directory=>{if(directory.identity!==staging.identity)throw new AppError('STORAGE_COPY');});return result;}
   finally{await staging.close();}
  });}finally{await internal.close();await output.close();await input.close();await root.close();}
 });
}
