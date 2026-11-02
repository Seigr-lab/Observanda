import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {withMutationFilesSession,nativeMutationSupported} from './mutation-files.js';
import {outputName,sameFile} from './local-export-files.js';
import {contentStream,contentSize,contentHash} from './file-content.js';
import {diskCapacity} from './disk-capacity.js';
import {AppError} from './errors.js';

// One worker per export operation, bounded handles per member and bounded I/O.
// The original pathname is used only to admit a root and inspect disk capacity;
// every content read and namespace mutation below uses opened directory handles.
const active=new AsyncLocalStorage();
export const exportDirectoryIdentity=value=>typeof value==='string'&&/^\d+:\d+$/.test(value);
async function namedRoot(service,plan,root){
 if(plan.directoryIdentity!==undefined&&plan.directoryIdentity!==root.identity)throw new AppError('LOCAL_EXPORT_CHANGED');
 const current=await service.open(plan.directory);try{if(current.identity!==root.identity)throw new AppError('LOCAL_EXPORT_CHANGED');}finally{await current.close();}
}
export function withNativeExport(plan,operation){
 if(!nativeMutationSupported)throw new AppError('UNSAFE');
 return withMutationFilesSession(async service=>{
  const existing=active.getStore();
  if(existing){if(existing.directory!==plan.directory)throw new AppError('UNSAFE');await namedRoot(service,plan,existing.root);const result=await operation(existing.root);await namedRoot(service,plan,existing.root);return result;}
  const root=await service.open(plan.directory);
  try{
   if(plan.directoryIdentity!==undefined&&plan.directoryIdentity!==root.identity)throw new AppError('LOCAL_EXPORT_CHANGED');
   const result=await active.run({directory:plan.directory,root},()=>operation(root));await namedRoot(service,plan,root);return result;
  }finally{await root.close();}
 // An encrypted source may itself be streamed by a native helper. The
 // destination protocol waits for incoming bytes while a write is in flight;
 // reads cannot share that same request channel or neither side can progress.
 },{independent:!active.getStore()});
}
async function member(root,relative,{create=false}={},operation){
 const parts=outputName(relative).split('/'),name=parts.pop(),opened=[];let directory=root;
 try{for(const part of parts){directory=await directory.directory(part,{create,missing:!create});if(!directory)return operation(null,name);opened.push(directory);}return await operation(directory,name);}
 finally{for(const directory of opened.reverse())await directory.close();}
}
const temporary=(name,id,kind)=>'.observanda-'+id+'-'+kind+'-'+name;
export const nativeExportFingerprint=(root,name)=>member(root,name,{},async(directory,member)=>directory?directory.hash(member,{missing:true}):null);
async function installed(directory,name,stage){
 const actual=await directory.hash(name,{links:true,missing:true});if(!actual)return null;
 if(actual.links!==1){const source=await directory.stat(stage,{links:true,missing:true});if(actual.links!==2||source?.identity!==actual.identity)throw new AppError('UNSAFE');}return actual;
}
async function removeMatching(directory,name,expected,{links=false}={}){
 const actual=await directory.hash(name,{links,missing:true});if(!actual)return;
 if(!sameFile(actual,expected))throw new AppError('LOCAL_EXPORT_CHANGED');await directory.remove(name,{links,identity:actual.identity});
}
export async function stageNativeFiles(plan,candidate,checkpoint,changes){return withNativeExport(plan,async root=>{
 for await(const change of changes()){
  if(!change.after||change.kind==='unchanged')continue;
  await member(root,change.path,{create:true},async(directory,name)=>{
   const stage=temporary(name,plan.id,'new'),existing=await directory.hash(stage,{missing:true});
   if(existing){if(sameFile(existing,change.after))return;await directory.remove(stage,{identity:existing.identity});}
   const content=await candidate.files.get(change.path),reservation=await diskCapacity.reserve(path.dirname(path.join(plan.directory,change.path)),contentSize(content));
   try{await directory.write(stage,contentStream(content),{bytes:contentSize(content),sha256:contentHash(content),onWrite:(size,write)=>reservation.write(size,write)});}finally{reservation.release();}
   await checkpoint('staged',change.path);
  });
 }
});}
export async function checkNativeOriginals(plan,changes){return withNativeExport(plan,async root=>{
 for await(const change of changes())await member(root,change.path,{},async(directory,name)=>{if(!sameFile(directory?await directory.hash(name,{missing:true}):null,change.before))throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);});
});}
export async function applyNativeFiles(plan,checkpoint,applied,changes){return withNativeExport(plan,async root=>{
 let ordinal=0;
 for await(const change of changes()){
  const index=ordinal++;
  await member(root,change.path,{create:!!change.after},async(directory,name)=>{
   if(!directory){if(change.after===null&&index<plan.applied){await applied(index+1);return;}throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);}
   const old=temporary(name,plan.id,'old'),stage=temporary(name,plan.id,'new');let actual=await installed(directory,name,stage),backup=await directory.hash(old,{missing:true});
   if(index<plan.applied&&!sameFile(actual,change.after))throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
   if(sameFile(actual,change.after)){
    if(backup&&!sameFile(backup,change.before))throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
    if(change.kind!=='unchanged'&&index>=plan.applied){
     if(change.before&&!backup)throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
     if(change.after){const saved=await directory.stat(stage,{links:true,missing:true});if(saved?.identity!==actual.identity)throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);}
    }await applied(index+1);return;
   }
   if(change.kind==='unchanged'||actual&&!sameFile(actual,change.before)||backup&&!sameFile(backup,change.before)||actual&&backup)throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
   if(actual){
    await directory.rename(name,directory,old,{identity:actual.identity});await checkpoint('moved',change.path);backup=await directory.hash(old);
    if(!sameFile(backup,change.before)){await directory.link(old,directory,name).then(()=>directory.remove(old,{links:true})).catch(()=>{});throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);}
   }else if(change.before&&!backup)throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);
   if(change.after){const saved=await directory.hash(stage,{links:true});if(!sameFile(saved,change.after))throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);await directory.link(stage,directory,name,{links:true,identity:saved.identity});await checkpoint('installed',change.path);}
   await applied(index+1);
  });
 }
 for await(const change of changes())await member(root,change.path,{},async(directory,name)=>{if(!sameFile(directory?await installed(directory,name,temporary(name,plan.id,'new')):null,change.after))throw new AppError('LOCAL_EXPORT_CHANGED',[change.path]);});
});}
export async function cleanNativeFiles(plan,changes){return withNativeExport(plan,async root=>{
 for await(const change of changes())await member(root,change.path,{},async(directory,name)=>{if(!directory)return;await removeMatching(directory,temporary(name,plan.id,'new'),change.after,{links:true});await removeMatching(directory,temporary(name,plan.id,'old'),change.before);});
});}
export async function discardNativeFiles(plan,changes){return withNativeExport(plan,async root=>{
 for await(const change of changes())await member(root,change.path,{},async(directory,name)=>{
  if(!directory)return;
  if(await directory.stat(temporary(name,plan.id,'old'),{missing:true}))throw new AppError('LOCAL_EXPORT_RECOVER');
  const stage=temporary(name,plan.id,'new'),actual=await directory.stat(stage,{missing:true});
  // Interrupted writes can be incomplete. Only the opened, single-link stage
  // belongs to this discard; originals and installed links remain untouched.
  if(actual)await directory.remove(stage,{identity:actual.identity});
 });
});}
