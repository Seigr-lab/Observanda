import path from 'node:path';
import {withMutationFilesSession} from './mutation-files.js';
import {AppError} from './errors.js';

// The worker holds at most one directory handle per depth. File bodies are
// never accumulated while traversing a tree; only small control files use read.
function memberParts(relative){
 if(typeof relative!=='string'||!relative||relative.includes('\\')||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw new AppError('UNSAFE');
 return relative.split('/');
}
export async function nativeMember(root,relative,operation,{create=false,missing=false}={}){
 const parts=memberParts(relative),name=parts.pop(),opened=[];let directory=root;
 try{for(const part of parts){directory=await directory.directory(part,{create,missing});if(!directory)return operation(null,name);opened.push(directory);}return await operation(directory,name);}
 finally{for(const handle of opened.reverse())await handle.close();}
}
// Ordered file inventories tend to share parents. Retain only the most recent
// ancestry, bounded by directory depth, rather than reopening it per file.
export function nativeMemberCursor(root,{create=false,missing=false}={}){
 const parts=[],handles=[];
 async function trim(length){while(handles.length>length){parts.pop();await handles.pop().close();}}
 return {async member(relative){
  const next=memberParts(relative),name=next.pop();let common=0;while(common<parts.length&&common<next.length&&parts[common]===next[common])common++;
  await trim(common);for(let index=common;index<next.length;index++){const handle=await (handles.at(-1)??root).directory(next[index],{create,missing});if(!handle)return {directory:null,name};handles.push(handle);parts.push(next[index]);}
  return {directory:handles.at(-1)??root,name};
 },close:()=>trim(0)};
}
export async function nativeControl(root,relative,{limit=16384,code='UNSAFE'}={}){
 const value=await nativeMember(root,relative,(directory,name)=>directory?.read(name,{limit,missing:true}),{missing:true});if(!value)return null;
 try{return {value:JSON.parse(value.bytes.toString('utf8')),identity:value.identity};}catch{throw new AppError(code);}
}
export async function withNativeTree(directory,operation,{missing=false}={}){
 if(path.resolve(directory)===path.parse(directory).root)throw new AppError('UNSAFE');
 return withMutationFilesSession(async service=>{
  const parent=await service.open(path.dirname(directory));let root;
  try{root=await parent.directory(path.basename(directory),{missing});return await operation(root,{parent,name:path.basename(directory),service});}
  finally{await root?.close();await parent.close();}
 });
}
export async function *nativeTreeFiles(root,relative=''){
 for await(const entry of root.entries()){
  const name=relative+entry.name;
  if(entry.directory){const child=await root.directory(entry.name);try{yield* nativeTreeFiles(child,name+'/');}finally{await child.close();}}
  else yield {name,...await root.stat(entry.name)};
 }
}
export async function retireNativeDirectory(source,target,check){
 if(path.dirname(source)!==path.dirname(target)||source===target)throw new AppError('UNSAFE');
 return withNativeTree(source,async(root,{parent,name})=>{await check(root);await parent.rename(name,parent,path.basename(target),{folder:true,identity:root.identity});});
}
// Retain the recovery marker until every other file has been removed. A retry
// with no marker can remove only the two empty containers, never new content.
export async function removeNativeTree(root,{parent,name},marker,{identity,beforeFile=async()=>{},afterFile=async()=>{},afterFiles=async()=>{}}={}){
 const container=marker.split('/')[0];
 async function remove(directory,relative=''){
  for await(const entry of directory.entries()){
   const file=relative+entry.name;if(file===marker)continue;
   if(entry.directory){const child=await directory.directory(entry.name);let childIdentity;
    try{childIdentity=child.identity;await remove(child,file+'/');}finally{await child.close();}
    if(file!==container)await directory.remove(entry.name,{folder:true,identity:childIdentity});
   }else{const stat=await directory.stat(entry.name);await beforeFile(directory,entry.name,file,stat);await directory.remove(entry.name,{identity:stat.identity});await afterFile(file,stat);}
  }
 }
 if(identity){await remove(root);await afterFiles();await nativeMember(root,marker,(directory,member)=>directory.remove(member,{identity}));}
 const child=await root.directory(container,{missing:true});if(child){const childIdentity=child.identity;await child.close();await root.remove(container,{folder:true,identity:childIdentity});}
 const rootIdentity=root.identity;await root.close();await parent.remove(name,{folder:true,identity:rootIdentity});
}
