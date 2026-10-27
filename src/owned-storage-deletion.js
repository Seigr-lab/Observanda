import {assertInventoryObligationsSettled} from './inventory-obligation-lifecycle.js';
// Permanent deletion is authorized against an unlocked workspace, then frozen
// and retired to a unique sibling. Retries never traverse a reused source path.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,opendir,realpath,unlink,rmdir} from 'node:fs/promises';
import {atomicReplace as rename} from './atomic-replace.js';
import {createPersistentDirectory as mkdir,persistDirectories,persistRename,unlinkPersistent} from './filesystem-persistence.js';
import {workspaceFile,assertRegular,atomicWrite,serialize,digest} from './storage.js';
import {assertNotMoving} from './workspace-move-state.js';
import {DELETE_MARKER,workspaceDeletion,assertNotDeleting} from './workspace-delete-state.js';
import {AppError} from './errors.js';
import {operationStage,operationAdvance,operationItem,operationWork,withOperationProgress} from './operation-progress.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';

const uuid=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
const inside=(parent,child)=>{const r=path.relative(parent,child);return r===''||!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);};
const retired=value=>path.join(path.dirname(value.source),'.observanda-delete-'+value.id);
const fingerprint=async file=>{if(!await assertRegular(file,{missing:true}))return digest('absent');return digest(await readFile(file));};
export async function ownedDeletionDirectory(root,children=[]){
 if(!path.isAbsolute(root)||root===path.parse(root).root||await realpath(root)!==root)throw new AppError('UNSAFE');
 await assertRegular(root,{directory:true});await assertRegular(path.join(root,'.observanda'),{directory:true});
 const descriptor=path.basename(await workspaceFile(root));await assertRegular(path.join(root,descriptor));
 for(const name of await readdir(root))if(!['.observanda',descriptor,...children].includes(name))throw new AppError('STORAGE_DELETE_CONTENTS');
 return descriptor;
}
async function *files(root,relative='',{skipDatabase=false}={}){
 const directory=path.join(root,relative);await assertRegular(directory,{directory:true});
 for await(const entry of await opendir(directory)){
  const name=path.posix.join(relative,entry.name),file=path.join(root,name);
  if(!inside(root,file)||file===root)throw new AppError('UNSAFE');
  const stat=await assertRegular(file,{directory:entry.isDirectory()});
  if(stat.isDirectory()){
   // PostgreSQL can rotate its own files until it is stopped. Its whole tree
   // is checked below, after shutdown and before removing the first file.
   if(skipDatabase&&(name==='.observanda/postgresql'||name.endsWith('/.observanda/postgresql')))continue;
   yield* files(root,name,{skipDatabase});
  }else yield {name,file,size:stat.size};
 }
}
export class OwnedStorageDeletions{
 constructor(directory){this.directory=path.resolve(directory);this.busy=false;this.receiptLimit=16384;}
 async inventory(){return {};}
 ownedDirectory(root){return ownedDeletionDirectory(root);}
 handoff(workspace,operation){return workspace.withStorageHandoff(operation,{existing:true});}
 async lease(){await mkdir(this.directory,{recursive:true,mode:0o700});await assertRegular(this.directory,{directory:true});return workspaceDatabaseLease(this.directory);}
 file(id){if(!uuid(id))throw new AppError('STORAGE_DELETE_STATE');return path.join(this.directory,id+'.json');}
 async save(value){await mkdir(this.directory,{recursive:true,mode:0o700});await assertRegular(this.directory,{directory:true});await atomicWrite(this.file(value.id),serialize(value));}
 async text(file){return readFile(file,'utf8');}
 validReceipt(){return true;}
 validPhase(phase){return ['prepared','frozen','retired','complete'].includes(phase);}
 async discard(id){await unlink(this.file(id));}
 async frozen(){}
 async prepareReceipt(){}
 async read(id){
  const file=this.file(id),stat=await assertRegular(file);if(stat.size>this.receiptLimit)throw new AppError('STORAGE_DELETE_STATE');
  let value;try{value=JSON.parse(await this.text(file));}catch{throw new AppError('STORAGE_DELETE_STATE');}
  if(value?.version!==1||value.id!==id||!path.isAbsolute(value.source??'')||path.resolve(value.source)!==value.source||value.source===path.parse(value.source).root||inside(value.source,this.directory)||!this.validPhase(value.phase)||!['observanda.json','workspace.observanda'].includes(value.descriptor)||!['descriptorHash','accessHash'].every(k=>/^[a-f0-9]{64}$/.test(value[k]))||!this.validBinding(value.binding)||typeof value.title!=='string'||typeof value.databaseRemoved!=='boolean'||!this.validReceipt(value))throw new AppError('STORAGE_DELETE_STATE');return value;
 }
 async list(){
  if(!await assertRegular(this.directory,{missing:true,directory:true}))return [];
  const result=[];
  for(const name of await readdir(this.directory))if(name.endsWith('.json')){const item=await this.read(name.slice(0,-5));result.push({id:item.id,source:item.source,title:item.title,phase:item.phase});}
  return result;
 }
 async review(workspace,{protectedPaths=[],recent=[],exceptId=null}={}){
  const source=await realpath(workspace.root);await assertNotDeleting(source);await assertNotMoving(source);
  if([this.directory,...protectedPaths].filter(Boolean).some(p=>inside(source,path.resolve(p))))throw new AppError('STORAGE_DELETE_CONTENTS');
  await assertInventoryObligationsSettled(workspace);
  const inventory=await this.inventory(workspace),descriptor=await this.ownedDirectory(source,inventory),snapshot=await workspace.outline(),binding=await this.binding(source);
  if(!this.validBinding(binding))throw new AppError('DATABASE_LOCATION');
  await this.ready(workspace,binding);
  if((await this.list()).some(item=>item.source===source&&item.phase!=='complete'&&item.id!==exceptId))throw new AppError('STORAGE_DELETE_BUSY');
  for(const item of recent){
   if(path.resolve(item.path)===source)continue;
   if(inside(source,path.resolve(item.path)))throw new AppError('STORAGE_DELETE_CONTENTS');
   if(binding&&binding.placement!=='workspace'&&binding.placement!=='project'){
    // Known aliases of one older shared catalogue must be separated first.
    let other;try{other=await this.binding(item.path);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(other?.id===binding.id)throw new AppError('STORAGE_DELETE_SHARED');
   }
  }
  return {...inventory,source,title:snapshot.metadata.title,etag:snapshot.etag,descriptor,binding,
   descriptorHash:await fingerprint(path.join(source,descriptor)),accessHash:await fingerprint(path.join(source,'.observanda/access.json'))};
 }
 async begin(workspace,review,{id=randomUUID(),onFrozen=async()=>{},checkpoint=async()=>{},onProgress}={}){
  if(!uuid(id))throw new AppError('INVALID');if(!this.validBinding(review?.binding))throw new AppError('DATABASE_LOCATION');if(this.busy)throw new AppError('LOCKED');this.busy=true;
  let lease;try{lease=await this.lease(review.source);return await withOperationProgress(onProgress,async()=>{
   let receipt;
   await this.handoff(workspace,async()=>{
    await this.ready(workspace,await this.binding(review.source));
    await assertInventoryObligationsSettled(workspace);
    if(workspace.root!==review.source||await this.ownedDirectory(review.source,review)!==review.descriptor||(await workspace.outline()).etag!==review.etag||JSON.stringify(await this.binding(review.source))!==JSON.stringify(review.binding)||await fingerprint(path.join(review.source,review.descriptor))!==review.descriptorHash||await fingerprint(path.join(review.source,'.observanda/access.json'))!==review.accessHash)throw new AppError('CONFLICT');
    await operationStage('delete-check',{unit:'files'},async()=>{for await(const item of files(review.source,'',{skipDatabase:true})){operationItem(item.name);operationAdvance();}});
    receipt={...review,title:workspace.vault?.key?'':review.title,version:1,id,phase:'prepared',databaseRemoved:false};
    await this.prepareReceipt(workspace,receipt);await this.save(receipt);await checkpoint('prepared',receipt);
    await atomicWrite(path.join(review.source,DELETE_MARKER),serialize({version:1,id:receipt.id,source:receipt.source}));
    receipt.phase='frozen';await this.save(receipt);
   });
   await this.frozen(receipt);await onFrozen(receipt);await checkpoint('frozen',receipt);
   return this.finish(receipt.id,{vault:workspace.vault,checkpoint,unlocked:true});
  });}finally{await lease?.close();this.busy=false;}
 }
 async finish(id,{vault,checkpoint=async()=>{},onProgress,unlocked=false}={}){
  if(!unlocked&&this.busy)throw new AppError('LOCKED');if(!unlocked)this.busy=true;
  let lease;try{if(!unlocked)lease=await this.lease((await this.read(id)).source);return await withOperationProgress(onProgress,async()=>{
   const value=await this.read(id),target=retired(value);
   if(value.phase==='complete')return {id,source:value.source,complete:true};
   if(await realpath(path.dirname(target))!==path.dirname(target))throw new AppError('UNSAFE');
   let atTarget=!!await assertRegular(target,{directory:true,missing:true});
   if(!atTarget&&value.phase==='retired'){
    // A crash after rmdir must not turn a new folder at the old path into a target.
    await persistDirectories([path.dirname(target)]);value.phase='complete';await this.save(value);return {id,source:value.source,complete:true};
   }
   const root=atTarget?target:value.source,marker=await workspaceDeletion(root);
   if(!marker&&value.phase==='prepared'){
    // Confirmation had not frozen the workspace. No destructive step ran.
    await this.discard(id);return {id,source:value.source,complete:false,cancelled:true};
   }
   if(!marker&&atTarget&&value.phase==='retired'){
    // Only empty directories can remain after removal of the final marker.
    await rmdir(path.join(target,'.observanda')).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(target);
    await persistDirectories([path.dirname(target)]);value.phase='complete';await this.save(value);return {id,source:value.source,complete:true};
   }
   if(!marker||marker.id!==id||marker.source!==value.source)throw new AppError('STORAGE_DELETE_STATE');
   if(!atTarget){
    if(await this.ownedDirectory(root,value)!==value.descriptor||await fingerprint(path.join(root,value.descriptor))!==value.descriptorHash||await fingerprint(path.join(root,'.observanda/access.json'))!==value.accessHash||JSON.stringify(await this.binding(root))!==JSON.stringify(value.binding))throw new AppError('STORAGE_DELETE_STATE');
    await this.frozen(value);
    await operationStage('delete-database',{},async()=>{
     await this.stopDatabase(root,value,vault,id,{checkpoint});
     value.databaseRemoved=true;await this.save(value);
    });
    await checkpoint('database',value);
    await rename(root,target);atTarget=true;value.phase='retired';await this.save(value);await checkpoint('retired',value);
   }else if(!value.databaseRemoved)throw new AppError('STORAGE_DELETE_STATE');
   else if(value.phase!=='retired'){await persistRename(value.source,target);value.phase='retired';await this.save(value);}
   await this.frozen(value);
   await operationStage('delete-count',{unit:'files'},async()=>{
    let total=0;for await(const item of files(target)){operationItem(item.name);operationAdvance();total++;}
    await operationStage('delete-files',{total,unit:'files'},async()=>{
     async function remove(directory){
      await assertRegular(directory,{directory:true});
      for await(const entry of await opendir(directory)){
       const file=path.join(directory,entry.name);if(!inside(target,file)||file===target)throw new AppError('UNSAFE');
       if(file===path.join(target,DELETE_MARKER))continue;
       const stat=await assertRegular(file,{directory:entry.isDirectory()});
       if(stat.isDirectory()){await remove(file);if(file!==path.join(target,'.observanda'))await rmdir(file);}
       else{operationItem(path.relative(target,file));await unlink(file);operationAdvance();operationWork({bytes:stat.size});await checkpoint('file',value);}
      }
     }
     await remove(target);await checkpoint('files',value);
     await unlink(path.join(target,DELETE_MARKER));await rmdir(path.join(target,'.observanda'));await rmdir(target);await persistDirectories([path.dirname(target)]);operationAdvance();
    });
   });
   await checkpoint('removed',value);value.phase='complete';await this.save(value);return {id,source:value.source,complete:true};
  });}finally{await lease?.close();if(!unlocked)this.busy=false;}
 }
 async acknowledge(id){const value=await this.read(id);if(value.phase!=='complete')throw new AppError('STORAGE_DELETE_STATE');await unlinkPersistent(this.file(id));}
}
