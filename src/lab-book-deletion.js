import {assertBookPlacementAvailable} from './lab-book-placement-state.js';
import {assertBookTransfersComplete} from './lab-book-transfer-state.js';
// Permanent deletion is scoped to one authenticated book. The project keeps
// its recovery receipt and deleted identity; sibling data is never traversed.
import path from 'node:path';
import {opendir} from 'node:fs/promises';
import {isStorageTemporary} from './storage-temporary.js';
import {projectTransferRunning,trackProjectTransfer} from './project-transfer-tasks.js';
import {OwnedStorageDeletions} from './owned-storage-deletion.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookStorage} from './lab-book-storage.js';
import {LabBookRenames} from './lab-book-rename.js';
import {catalogueBinding} from './postgres-activation.js';
import {validLabBookCatalogueBinding} from './lab-book-catalogue-owner.js';
import {assertRegular,privateDirectory,serialize} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {workspaceDeletion} from './workspace-delete-state.js';
import {databaseProvider} from './workspace-database-context.js';
import {assertLabBookDatabaseStopped} from './lab-book-postgres.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export class LabBookDeletions extends OwnedStorageDeletions{
 constructor(project,labBookId){
  if(!researchId(labBookId))throw new AppError('INVALID');
  super(path.join(project.root,'.observanda/lab-book-deletion-leases',labBookId));this.project=project;this.labBookId=labBookId;this.registry=new LabBookRegistry(project);
 }
 file(id){if(!researchId(id))throw new AppError('STORAGE_DELETE_STATE');return path.join(this.project.root,'.observanda/lab-book-deletions',this.labBookId+'.obsv');}
 text(file){return this.project.readFile(file,'utf8');}
 async save(value){const save=async()=>{await privateDirectory(this.project.root,'.observanda/lab-book-deletions');return this.project.writeFile(this.file(value.id),serialize(value));};return value.phase==='prepared'?withWriterLease(path.join(this.project.root,'.observanda/lab-books.lock'),save):save();}
 binding(root){return catalogueBinding(root);}
 validBinding(value){return validLabBookCatalogueBinding(value)&&value.labBookId===this.labBookId;}
 validReceipt(value){return value.labBookId===this.labBookId&&value.projectId===this.project.projectId&&researchId(value.vaultId)&&researchId(value.namespaceId)&&path.dirname(value.source)===this.project.root&&value.directory===path.basename(value.source);}
 async receipt(){const file=this.file(this.labBookId),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>16384)throw new AppError('STORAGE_DELETE_STATE');let id;try{id=JSON.parse(await this.text(file)).id;}catch{throw new AppError('STORAGE_DELETE_STATE');}return this.read(id);}
 async list(){const value=await this.receipt();return value?[{id:value.id,source:value.source,phase:value.phase}]:[];}
 async ready(storage,binding){
  const entry=await this.registry.locate(this.labBookId);
  if(storage.labBookId!==this.labBookId||!this.validBinding(binding)||entry.root!==storage.root||entry.vaultId!==storage.vault?.id||path.dirname(storage.root)!==this.project.root)throw new AppError('DATABASE_LOCATION');
  authenticateKeyring((await readAccess(storage.root)).value,storage.vault);
 }
 frozen(value){return this.registry.retire(value,value.id);}
 async authenticationRoot(value){
  if(!value||value.phase==='complete')return null;
  const target=path.join(this.project.root,'.observanda-delete-'+value.id),marker=await workspaceDeletion(target);
  if(marker?.id===value.id&&marker.source===value.source&&value.databaseRemoved||value.phase==='retired')return null;
  return value.source;
 }
 async stopDatabase(root,value,vault,id){
  if(vault?.id!==value.vaultId)throw new AppError('ACCESS_DENIED');const provider=databaseProvider();if(!provider?.stopLabBookForDeletion)throw new AppError('DATABASE_LOCATION');
  await provider.stopLabBookForDeletion(root,this.labBookId,vault,id);const lease=await workspaceDatabaseLease(path.join(root,'.observanda/postgresql'));
  try{await assertLabBookDatabaseStopped(root,this.labBookId,vault);}finally{await lease.close();}
 }
 async run(vault,{id,expectedName,check=async()=>{},checkpoint=async()=>{},onProgress}={}){
  if(!researchId(id)||typeof expectedName!=='string')throw new AppError('INVALID');
  const directory=await privateDirectory(this.project.root,'.observanda/lab-book-creation');
  return trackProjectTransfer(this.file(id),()=>withWriterLease(path.join(directory,'book-'+this.labBookId+'.lock'),async()=>{
   await check();await assertBookPlacementAvailable(this.project,this.labBookId);await assertBookTransfersComplete(this.project,this.labBookId);let value=await this.receipt();
   if(value?.id===id){
    if(value.directory!==expectedName)throw new AppError('CONFLICT');
    if(value.phase==='complete')return {id,labBookId:this.labBookId,complete:true};
    if(value.phase==='prepared'&&!await workspaceDeletion(value.source)){await this.discard(id);value=null;}
    else return {...await this.finish(id,{vault,checkpoint,onProgress}),labBookId:this.labBookId};
   }else if(value&&value.phase!=='complete')throw new AppError('STORAGE_DELETE_BUSY');
   const entry=await this.registry.locate(this.labBookId);if(entry.directory!==expectedName)throw new AppError('CONFLICT');
   if(await new LabBookRenames(this.project).pending(this.labBookId))throw new AppError('STORAGE_RENAMING');
   const storage=new LabBookStorage(entry.root,this.labBookId,vault),siblings=(await this.registry.read()).value.books.filter(book=>book.labBookId!==this.labBookId).map(book=>this.registry.location(book).root);
   await this.ready(storage,await this.binding(entry.root));
   const review={...await this.review(storage,{protectedPaths:[this.project.root,...siblings]}),projectId:this.project.projectId,labBookId:this.labBookId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,directory:entry.directory};
   await check();return {...await this.begin(storage,review,{id,checkpoint,onProgress}),labBookId:this.labBookId};
  }));
 }
}

// Listing recovery reads only a bounded page of small encrypted receipts.
export async function pendingLabBookDeletions(project,{after=null,limit=20}={}){
 if(after!==null&&!researchId(after)||!Number.isInteger(limit)||limit<1||limit>50)throw new AppError('INVALID');
 const directory=path.join(project.root,'.observanda/lab-book-deletions');if(!await assertRegular(directory,{directory:true,missing:true}))return {items:[],next:null};
 const ids=[];
 for await(const entry of await opendir(directory)){
  if(isStorageTemporary(entry.name))continue;
  if(!entry.isFile()||!entry.name.endsWith('.obsv')||!researchId(entry.name.slice(0,-5)))throw new AppError('STORAGE_DELETE_STATE');
  const id=entry.name.slice(0,-5);if(after&&id<=after)continue;ids.push(id);ids.sort();if(ids.length>limit+1)ids.pop();
 }
 const more=ids.length>limit;if(more)ids.pop();const items=[];
 for(const labBookId of ids){const value=await new LabBookDeletions(project,labBookId).receipt();if(value&&value.phase!=='complete')items.push({id:value.id,labBookId,name:value.directory,phase:value.phase,running:projectTransferRunning(new LabBookDeletions(project,labBookId).file(value.id))});}
 return {items,next:more?ids.at(-1):null};
}
