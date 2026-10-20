import {assertInventoryObligationsSettled} from './inventory-obligation-lifecycle.js';
import {assertRenameDatabaseOwners} from './workspace-rename-inventory.js';
import {ProjectChildPreservation,validatePreservedChildren,insideProject,physicalProjectDescendants} from './project-child-preservation.js';
import {directoryIdentity,sameDirectory} from './project-rename-receipt.js';
import {isStorageTemporary} from './storage-temporary.js';
// One portable project owns this deletion. The workspace holds only an
// encrypted recovery receipt and a stable deleted-identity reference.
import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {ProjectBookDeletion} from './project-book-deletion.js';
import {validateRenameBooks} from './rename-owner-receipts.js';
import {withProjectMembership,projectDeletionMembership,assertProjectCreationSettled,assertProjectRelocationsSettled} from './project-membership.js';
import {withWriterLease} from './writer-lease.js';
import {OwnedStorageDeletions,ownedDeletionDirectory} from './owned-storage-deletion.js';
import {ProjectStorage} from './project-storage.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {projectTransferRunning,trackProjectTransfer} from './project-transfer-tasks.js';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {catalogueBinding} from './postgres-activation.js';
import {validProjectCatalogueBinding} from './project-catalogue-owner.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {workspaceDeletion,deletionScope} from './workspace-delete-state.js';
import {databaseProvider} from './workspace-database-context.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const summary=value=>({id:value.id,projectId:value.projectId,source:value.source,phase:value.phase});
export class ProjectDeletions extends OwnedStorageDeletions{
 constructor(registry,projectId){
  if(!researchId(projectId))throw new AppError('INVALID');
  super(path.join(registry.workspace.root,'.observanda/project-deletion-leases',projectId));this.registry=registry;this.workspace=registry.workspace;this.projectId=projectId;this.receiptLimit=16*1024*1024;
 }
 file(id){if(!researchId(id))throw new AppError('STORAGE_DELETE_STATE');return path.join(this.workspace.root,'.observanda/project-deletions',this.projectId+'.obsv');}
 text(file){return this.workspace.readFile(file,'utf8');}
 async save(value){await privateDirectory(this.workspace.root,'.observanda/project-deletions');return this.workspace.writeFile(this.file(value.id),serialize(value));}
 binding(root){return catalogueBinding(root);}
 validBinding(value){return validProjectCatalogueBinding(value)&&value.projectId===this.projectId;}
 validPhase(phase){return phase==='preserving'||super.validPhase(phase);}
 validReceipt(value){
  if(value.phase==='preserving'){validatePreservedChildren(value.preserveChildren,value.source,this.workspace.root);if(!['dev','ino'].every(key=>typeof value.identity?.[key]==='string'))return false;}
  if(value.books!==undefined){validateRenameBooks(value.books);if(typeof value.bookRegistryRevision!=='string'||value.books.length&&!/^[a-f0-9]{64}$/.test(value.bookKeysHash??''))return false;}
  return value.projectId===this.projectId&&researchId(value.vaultId)&&researchId(value.namespaceId);
 }
 ownedDirectory(root,value){return ownedDeletionDirectory(root,[...(value?.books??this.bookOwners?.books??[]).map(book=>book.directory),...(this.preservation?.children??[]).map(child=>child.directory)]);}
 handoff(storage,operation){
  return withProjectMembership(this.registry,[this.projectId],async()=>{
   await assertProjectCreationSettled(this.registry,[this.projectId]);await assertProjectRelocationsSettled(this.registry,[this.projectId]);
   return this.bookOwners.withStorageHandoff(()=>storage.withStorageHandoff(()=>withWriterLease(path.join(storage.root,'.observanda/lab-books.lock'),async()=>{await assertRenameDatabaseOwners(storage.root,this.bookOwners.books.map(book=>path.join(storage.root,book.directory)),{stage:'delete-check-owners',errorCode:'STORAGE_DELETE_CONTENTS'});return operation();}),{existing:true}),{checkOwner:assertInventoryObligationsSettled});
  });
 }
 prepareReceipt(storage,value){return this.bookOwners.persist(value.id,value);}
 async receipt(){
  const file=this.file(this.projectId),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>this.receiptLimit)throw new AppError('STORAGE_DELETE_STATE');
  let id;try{id=JSON.parse(await this.text(file)).id;}catch{throw new AppError('STORAGE_DELETE_STATE');}return this.read(id);
 }
 async list(){const value=await this.receipt();return value?[summary(value)]:[];}
 async status(){
  const value=await this.receipt();if(!value)return null;const result={...summary(value),running:projectTransferRunning(this.file(this.projectId))};
  if(!result.running&&value.phase!=='complete')try{const root=await this.authenticationRoot(value);if(root){const {value:access}=await readAccess(root);result.password=!!access.password;result.username=access.username;}}catch{/* Recovery reports an unavailable source when the command is resumed. */}
  return result;
 }
 async authenticationRoot(value){
  if(!value||['retired','complete'].includes(value.phase))return null;
  const target=path.join(path.dirname(value.source),'.observanda-delete-'+value.id),marker=await workspaceDeletion(target);
  if(marker?.id===value.id&&marker.source===value.source&&value.databaseRemoved)return null;
  return value.source;
 }
 async ready(storage,binding){
  const entry=await this.registry.locate(this.projectId);if(storage.projectId!==this.projectId||!this.validBinding(binding)||entry.root!==storage.root||entry.vaultId!==storage.vault?.id)throw new AppError('DATABASE_LOCATION');
  // Containing owners are expected in the physical hierarchy. Descendants
  // still require their own lifecycle before this owner can be removed.
  await this.registry.assertRoot(storage.root,{existing:true,excludeRoots:(this.preservation?.children??[]).map(child=>path.join(storage.root,child.directory))});
  authenticateKeyring((await readAccess(storage.root)).value,storage.vault);
 }
 async frozen(value){await this.registry.retire({projectId:this.projectId,root:value.source,vaultId:value.vaultId,namespaceId:value.namespaceId},value.id);}
 async stopDatabase(root,value,vault,id,{checkpoint=async()=>{}}={}){
  if(vault?.id!==value.vaultId)throw new AppError('ACCESS_DENIED');
  const provider=databaseProvider();if(!provider?.stopProjectForDeletion)throw new AppError('DATABASE_LOCATION');
  const books=new ProjectBookDeletion(new ProjectStorage(root,this.projectId,vault));
  try{await deletionScope(id,async()=>{await books.load(value);await books.stop(value,{checkpoint});});}finally{books.close();}
  await provider.stopProjectForDeletion(root,this.projectId,vault,id);
  const lease=await workspaceDatabaseLease(path.join(root,'.observanda/postgresql'));
  try{await assertProjectDatabaseStopped(root,this.projectId,vault);}finally{await lease.close();}
 }
 async run(vault,{id,expectedRoot,checkpoint=async()=>{},onProgress,check=async()=>{},onFrozen=async()=>{},withProject,withBook,placeChild}={}){
  if(!researchId(id)||expectedRoot!==undefined&&typeof expectedRoot!=='string')throw new AppError('INVALID');
  return trackProjectTransfer(this.file(this.projectId),()=>withProjectLifecycle(this.registry,this.projectId,'delete',()=>projectDeletionMembership(id,async()=>{
   await check();let value=await this.receipt();
   if(value?.id===id){
    if(expectedRoot!==undefined&&value.source!==expectedRoot)throw new AppError('CONFLICT');
    if(value.phase==='complete')return {id,projectId:this.projectId,complete:true};
    if(value.phase==='prepared'&&!await workspaceDeletion(value.source)){await this.discard(id);value=null;}
    else if(value.phase!=='preserving'){await onFrozen(value);const result=await this.finish(id,{vault,checkpoint,onProgress});return {...result,projectId:this.projectId};}
   }else if(value&&value.phase!=='complete')throw new AppError('STORAGE_DELETE_BUSY');else value=null;
   const entry=await this.registry.locate(this.projectId);if(expectedRoot!==undefined&&entry.root!==expectedRoot)throw new AppError('CONFLICT');
   const storage=new ProjectStorage(entry.root,this.projectId,vault);
   if(value&&(value.source!==storage.root||value.vaultId!==vault?.id||!sameDirectory(directoryIdentity(await assertRegular(storage.root,{directory:true})),value.identity)))throw new AppError('CONFLICT');
   this.bookOwners=new ProjectBookDeletion(storage);this.preservation=new ProjectChildPreservation(this.registry,storage);
   try{
    await this.bookOwners.prepare(typeof withBook==='function'?(bookId,use)=>withBook(storage,bookId,use):undefined);
    const children=await this.preservation.prepare(value?.preserveChildren,{withProject,withBook});
    const review=async()=>{
     const members=await physicalProjectDescendants(this.registry,storage.root),retained=this.preservation?.children??[];
     return {...await this.review(storage,{exceptId:id,protectedPaths:[this.workspace.root,...members.filter(p=>p.projectId!==this.projectId&&!retained.some(child=>p.projectId===child.projectId||insideProject(path.join(storage.root,child.directory),p.root))).map(p=>p.root)]}),projectId:this.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId};
    };
    if(children.length){
     const initial=await review();if(value&&initial.accessHash!==value.accessHash)throw new AppError('CONFLICT');
     await check();await withProjectMembership(this.registry,[this.projectId],async()=>{
      await assertProjectCreationSettled(this.registry,[this.projectId]);await assertProjectRelocationsSettled(this.registry,[this.projectId]);
      const current=await this.registry.inspect(async view=>{const entries=[];for await(const row of view.entries({index:'parent',prefix:this.projectId+':'}))if(insideProject(storage.root,row.entry.root))entries.push(row.entry);return entries;});
      if(current.some(p=>!children.some(child=>child.projectId===p.projectId&&path.join(storage.root,child.directory)===p.root)))throw new AppError('CONFLICT');
      await this.save({...initial,title:'',version:1,id,phase:'preserving',databaseRemoved:false,identity:directoryIdentity(await assertRegular(storage.root,{directory:true})),preserveChildren:children});
     });await checkpoint('preserving',children);
     await this.preservation.run({withProject,withBook,check,checkpoint,placeChild});
    }
    this.preservation=null;const plan=await review();
    await check();return {...await this.begin(storage,plan,{id,checkpoint,onProgress,onFrozen}),projectId:this.projectId};
   }finally{this.bookOwners.close();this.bookOwners=null;this.preservation=null;}
  })));
 }

}
export async function pendingProjectDeletions(registry,{after=null,limit=20}={}){
 if(after!==null&&!researchId(after)||!Number.isInteger(limit)||limit<1||limit>50)throw new AppError('INVALID');
 const directory=path.join(registry.workspace.root,'.observanda/project-deletions');if(!await assertRegular(directory,{directory:true,missing:true}))return {items:[],next:null};
 // Keep only one page of candidate IDs while scanning the small receipt directory.
 const ids=[];for await(const entry of await opendir(directory)){
  if(isStorageTemporary(entry.name))continue;
  if(!entry.isFile()||!entry.name.endsWith('.obsv'))throw new AppError('STORAGE_DELETE_STATE');const id=entry.name.slice(0,-5);if(!researchId(id))throw new AppError('STORAGE_DELETE_STATE');if(after&&id<=after)continue;
  ids.push(id);ids.sort();if(ids.length>limit+1)ids.pop();
 }
 const more=ids.length>limit;if(more)ids.pop();const items=[];
 for(const id of ids){const value=await new ProjectDeletions(registry,id).status();if(value&&value.phase!=='complete')items.push(value);}
 return {items,next:more?ids.at(-1):null};
}
