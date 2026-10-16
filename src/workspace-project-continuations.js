// A copied workspace owns new physical locations. Commands targeting the old
// locations remain evidence, never executable recovery in the copied workspace.
import path from 'node:path';
import {opendir,unlink} from 'node:fs/promises';
import {assertRegular,privateDirectory} from './storage.js';
import {researchId} from './web/research-reference.js';
import {isStorageTemporary} from './storage-temporary.js';
import {AppError} from './errors.js';
const commands={copy:'project-copies',archive:'project-archives',move:'project-moves',delete:'project-deletions'};
export async function retainCopiedProjectCommands(target,id,{checkpoint=async()=>{}}={}){
 if(!researchId(id))throw new AppError('INVALID');
 await assertRegular(path.join(target.root,'.observanda/copy-in-progress'));
 for(const [kind,folder] of Object.entries(commands)){
  const directory=path.join(target.root,'.observanda',folder);
  if(!await assertRegular(directory,{directory:true,missing:true}))continue;
  for await(const entry of await opendir(directory)){
   const file=path.join(directory,entry.name),stat=await assertRegular(file);
   if(isStorageTemporary(entry.name))continue;
   if(entry.name.endsWith('.lock')){await unlink(file);continue;}
   const projectId=entry.name.slice(0,-5);
   if(!entry.name.endsWith('.obsv')||!researchId(projectId)||stat.size>(kind==='move'?16*1024*1024:32768))throw new AppError('STORAGE_COPY');
   const raw=await target.readFile(file,'utf8');let value;
   try{value=JSON.parse(raw);}catch{throw new AppError('STORAGE_COPY');}
   if(!researchId(value?.id)||value.projectId!==projectId||![1,2].includes(value.version)||typeof value.phase!=='string')throw new AppError('STORAGE_COPY');
   await retainCopiedProjectCommand(target,id,kind,path.posix.join('.observanda',folder,entry.name),{checkpoint});
  }
 }
}

export async function retainCopiedProjectCommand(target,id,kind,relative,{checkpoint=async()=>{}}={}){
 if(!researchId(id)||!/^[a-z-]+$/.test(kind)||!/^\.observanda\/project-[a-z-]+\/[a-z0-9-]+\.obsv$/.test(relative))throw new AppError('INVALID');
 const file=path.join(target.root,relative),stat=await assertRegular(file,{missing:true});if(!stat)return;
 if(stat.size>16*1024*1024)throw new AppError('STORAGE_COPY');
 const raw=await target.readFile(file,'utf8'),history=await privateDirectory(target.root,`.observanda/project-command-history/${id}/${kind}/${path.posix.basename(path.posix.dirname(relative))}`),archived=path.join(history,path.basename(relative));
 if(await assertRegular(archived,{missing:true})){if(await target.readFile(archived,'utf8')!==raw)throw new AppError('STORAGE_COPY');}
 else await target.writeFile(archived,raw);
 await checkpoint('workspace-project-command',{kind,file:relative});await unlink(file);
}
