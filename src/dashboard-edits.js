// Pending UI preferences belong to the local installation until the selected
// workspace can accept them. Store only authenticated encrypted intent; never
// write around the workspace's transaction lock or silently rebase a conflict.
import path from 'node:path';
import {mkdir,readFile,readdir,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {assertRegular,atomicWrite,serialize} from './storage.js';
import {seal,unseal} from './encryption.js';
import {withWriterLease} from './writer-lease.js';
import {readWorkspaceDashboard,writeWorkspaceDashboard} from './security/dashboard-storage.js';
import {validDashboard} from './web/dashboard-model.js';
import {dashboardSnapshot} from './preferences.js';
import {AppError} from './errors.js';

const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const aad=id=>'Observanda/pending-dashboard/v1/'+id;
const selected=value=>value?.pending??value?.applying;
export class DashboardEdits{
 constructor(directory){this.directory=path.resolve(directory);}
 async worker(workspace,operation){
  await mkdir(this.directory,{recursive:true,mode:0o700});await assertRegular(this.directory,{directory:true});
  return withWriterLease(path.join(this.directory,workspace.vault.id+'.apply.lock'),operation);
 }
 async transaction(workspace,operation){
  if(!workspace.vault?.key||!uuid.test(workspace.vault.id??''))throw new AppError('ACCESS_LOCKED');
  await mkdir(this.directory,{recursive:true,mode:0o700});await assertRegular(this.directory,{directory:true});
  return withWriterLease(path.join(this.directory,workspace.vault.id+'.lock'),()=>operation());
 }
 async entries(workspace){
  if(!workspace.vault?.key)throw new AppError('ACCESS_LOCKED');
  if(!await assertRegular(this.directory,{directory:true,missing:true}))return [];
  const result=[];
  for(const name of await readdir(this.directory)){
   if(!name.startsWith(workspace.vault.id+'.')||!name.endsWith('.observanda'))continue;
   if(!uuid.test(name.slice(workspace.vault.id.length+1,-11)))throw new AppError('INVALID');
   const file=path.join(this.directory,name);if(!await assertRegular(file,{missing:true}))continue;
   let encrypted;try{encrypted=await readFile(file);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   const bytes=unseal(encrypted,workspace.vault.key,aad(workspace.vault.id));
   let value;try{value=JSON.parse(bytes.toString());}finally{bytes.fill(0);}
   if(value.format!==1||!path.isAbsolute(value.root)||!selected(value)||[value.pending,value.applying].some(command=>command&&(!uuid.test(command.id)||typeof command.etag!=='string'||!validDashboard(command.settings))))throw new AppError('INVALID');
   result.push({file,value});
  }
  return result;
 }
 async find(workspace){const found=(await this.entries(workspace)).filter(item=>item.value.root===workspace.root);if(found.length>1)throw new AppError('CONFLICT');return found[0]??null;}
 async write(workspace,entry){const bytes=Buffer.from(serialize(entry.value));try{await atomicWrite(entry.file,seal(bytes,workspace.vault.key,aad(workspace.vault.id)));}finally{bytes.fill(0);}}
 snapshot(entry){if(!entry)return null;const command=selected(entry.value);return {...dashboardSnapshot(command.settings),id:command.id,state:entry.value.error?'failed':entry.value.applying?'saving':'waiting',error:entry.value.error??null};}
 async read(workspace){return this.snapshot(await this.find(workspace));}
 async submit(workspace,command){
  if(!uuid.test(command?.id??'')||typeof command.etag!=='string'||!validDashboard(command.settings))throw new AppError('INVALID');
  return this.transaction(workspace,async()=>{
   let entry=await this.find(workspace);
   if(entry){
    const previous=selected(entry.value);
    if(previous.id===command.id){if(JSON.stringify(previous.settings)!==JSON.stringify(command.settings))throw new AppError('CONFLICT');return this.snapshot(entry);}
    if(entry.value.error||command.etag!==dashboardSnapshot(previous.settings).etag)throw new AppError('DASHBOARD_CHANGED');
    // Coalesce edits which have not started. If a save is already executing,
    // the next intent depends on exactly the settings that save will commit.
    command={...command,etag:entry.value.pending?.etag??dashboardSnapshot(entry.value.applying.settings).etag};
    entry.value.pending=command;
   }else entry={file:path.join(this.directory,workspace.vault.id+'.'+randomUUID()+'.observanda'),value:{format:1,root:workspace.root,pending:command,applying:null}};
   await this.write(workspace,entry);return this.snapshot(entry);
  });
 }
 async apply(workspace){
  try{return await this.worker(workspace,()=>this.applyOwned(workspace));}catch(error){if(error.code==='LOCKED')return {waiting:true};throw error;}
 }
 async applyOwned(workspace){
  const entry=await this.transaction(workspace,async()=>{
   const found=await this.find(workspace);if(!found||found.value.error)return null;
   if(!found.value.applying){found.value.applying=found.value.pending;found.value.pending=null;await this.write(workspace,found);}
   return found;
  });
  if(!entry)return {idle:true};
  const command=entry.value.applying;
  try{
   // A lost receipt can follow a committed save. Recognize that exact desired
   // state, while preserving the original revision precondition otherwise.
   const current=await readWorkspaceDashboard(workspace);
   if(current.etag!==dashboardSnapshot(command.settings).etag)await writeWorkspaceDashboard(workspace,command.settings,command.etag);
  }catch(error){
   if(error.code==='LOCKED')return {waiting:true};
   await this.transaction(workspace,async()=>{const current=await this.find(workspace);if(current?.value.applying?.id===command.id){current.value.error=error.code??'IO';await this.write(workspace,current);}});
   throw error;
  }
  return this.transaction(workspace,async()=>{
   const current=await this.find(workspace);if(current?.value.applying?.id!==command.id)throw new AppError('CONFLICT');
   if(current.value.pending){current.value.applying=null;await this.write(workspace,current);return {waiting:true};}
   await unlink(current.file);return {completed:true};
  });
 }
 async recordFailure(workspace,id,code){
  return this.transaction(workspace,async()=>{
   const entry=await this.find(workspace);
   // A late worker failure belongs only to the intent it attempted.
   if(!entry||selected(entry.value).id!==id)return false;
   if(!entry.value.error){entry.value.error=code;await this.write(workspace,entry);}
   return true;
  });
 }
 async discard(workspace,id){
  return this.worker(workspace,()=>this.transaction(workspace,async()=>{
   const entry=await this.find(workspace);if(!entry)return;
   if(selected(entry.value).id!==id)throw new AppError('CONFLICT');
   await unlink(entry.file);
  }));
 }
 async retry(workspace,id){
  return this.transaction(workspace,async()=>{
   const entry=await this.find(workspace);if(!entry||selected(entry.value).id!==id)throw new AppError('CONFLICT');
   delete entry.value.error;await this.write(workspace,entry);return this.snapshot(entry);
  });
 }
 async relocate(source,destination){
  if(source.root===destination.root||source.vault.id!==destination.vault.id)return;
  await this.worker(source,()=>this.transaction(source,async()=>{
   const entry=await this.find(source);if(!entry)return;
   if(await this.find(destination))throw new AppError('CONFLICT');
   entry.value.root=destination.root;await this.write(destination,entry);
  }));
 }
}
