import {projectSummaryForBook,reparentConfigurationMetadata} from './configuration-metadata.js';
// Change a book's containing project by relocating its existing directory.
// Current parent metadata changes; retained record revisions keep their identity.
import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {atomicReplace as rename} from './atomic-replace.js';
import {unlinkPersistent as unlink,persistRename} from './filesystem-persistence.js';
import {LabBookRelocationTransfer,validBookRelocationTransfer} from './lab-book-reparent-transfer.js';
import {withProjectMembership} from './project-membership.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {assertNotMoving} from './workspace-move-state.js';
import {projectMoveDirectory} from './project-move-boundaries.js';
import {catalogueBinding} from './postgres-activation.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {LabBookStorage} from './lab-book-storage.js';
import {LabBookRenames} from './lab-book-rename.js';
import {LabBookDeletions} from './lab-book-deletion.js';
import {assertBookTransfersComplete} from './lab-book-transfer-state.js';
import {assertBookPlacementAvailable,reserveBookPlacement,releaseBookPlacement} from './lab-book-placement-state.js';
import {assertRegular,atomicWrite,privateDirectory,serialize,digest,workspaceFile} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {storageCreationPath,validateStorageName} from './storage-names.js';
import {RENAME_MARKER,renameScope,workspaceRename} from './workspace-rename-state.js';
import {assertRenameDatabaseOwners} from './workspace-rename-inventory.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertLabBookDatabaseStopped,LAB_BOOK_DATABASE_DIRECTORY} from './lab-book-postgres.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
const sameBook=(a,b)=>['labBookId','namespaceId','vaultId'].every(key=>a?.[key]===b?.[key]);
const nameKey=name=>['win32','darwin'].includes(process.platform)?name.normalize('NFC').toLowerCase():name;
const hash=async file=>digest(await readFile(file));
const terminal=value=>!value||['complete','cancelled'].includes(value.phase);
export class LabBookReparents{
 constructor(registry,labBookId){if(!researchId(labBookId))throw new AppError('INVALID');this.registry=registry;this.workspace=registry.workspace;this.labBookId=labBookId;this.addresses=new LabBookDirectory(registry);}
 file(){return path.join(this.workspace.root,'.observanda/lab-book-relocations',this.labBookId+'.obsv');}
 async read(){
  await this.workspace.requireStorageKey();const stat=await assertRegular(this.file(),{missing:true});if(!stat)return null;if(stat.size>2*1024*1024)throw new AppError('LIMIT');let value;
  try{value=JSON.parse(await this.workspace.readFile(this.file(),'utf8'));}catch{throw new AppError('STORAGE_RENAME_STATE');}
  if(!value||Object.keys(value).sort().join()!==('accessHash,descriptorHash,directory,id,identity,labBookId,namespaceId,parent,phase,sourceProjectId,sourceVaultId,targetProjectId,targetVaultId,'+(value.version===2?'transfer,':'')+'vaultId,version')||!validBookRelocationTransfer(value)||value.labBookId!==this.labBookId||!['id','labBookId','namespaceId','vaultId','sourceProjectId','sourceVaultId','targetProjectId','targetVaultId'].every(key=>researchId(value[key]))||value.sourceProjectId===value.targetProjectId||!['prepared','frozen','copying','moved','registered','retiring','retired','complete','cancelling','cancelled'].includes(value.phase)||!['accessHash','descriptorHash'].every(key=>/^[a-f0-9]{64}$/.test(value[key]??''))||!value.identity||Object.keys(value.identity).sort().join()!=='dev,ino'||Object.values(value.identity).some(part=>typeof part!=='string')||value.parent?.id!==value.targetProjectId||value.parent.parentId!==null)throw new AppError('STORAGE_RENAME_STATE');
  validateStorageName(value.directory,{nameError:'STORAGE_RENAME_STATE'});if(value.directory.toLowerCase()==='.observanda')throw new AppError('STORAGE_RENAME_STATE');return value;
 }
 async save(value){await privateDirectory(this.workspace.root,'.observanda/lab-book-relocations');await this.workspace.writeFile(this.file(),serialize(value));}
 async roots(value){const source=await this.registry.locate(value.sourceProjectId),target=await this.registry.locate(value.targetProjectId);if(source.vaultId!==value.sourceVaultId||target.vaultId!==value.targetVaultId)throw new AppError('DATABASE_LOCATION');return {source:storageCreationPath(source.root,value.directory),destination:storageCreationPath(target.root,value.directory)};}
 async locate(value){
  const roots=await this.roots(value);
  const candidates=value.version===2?[value.phase==='copying'?roots.source:roots.destination]:[roots.destination,roots.source];
  for(const root of candidates){const expected=value.version===2&&root===roots.destination?value.transfer.identity:value.identity,stat=await assertRegular(root,{directory:true,missing:true});if(!stat||!sameIdentity(value.version===2?await projectMoveDirectory(root):identity(stat),expected))continue;if(await realpath(root)!==root||await hash(path.join(root,'.observanda/access.json'))!==value.accessHash||await hash(await workspaceFile(root))!==value.descriptorHash)throw new AppError('STORAGE_RENAME_STATE');return root;}
  throw new AppError('STORAGE_RENAME_STATE');
 }
 async locked(source,target,directory,operation){
  const journal=await privateDirectory(this.workspace.root,'.observanda/lab-book-relocations');
  return withWriterLease(path.join(journal,this.labBookId+'.lock'),async()=>{
   const parents=[source,target].sort((a,b)=>a.projectId.localeCompare(b.projectId)),locks=[];
   for(const parent of parents){const folder=await privateDirectory(parent.root,'.observanda/lab-book-creation');locks.push(path.join(folder,'book-'+this.labBookId+'.lock'),path.join(folder,'name-'+digest(nameKey(directory))+'.lock'));}
   const take=index=>index===locks.length?operation():withWriterLease(locks[index],()=>take(index+1),{wait:false});return take(0);
  });
 }
 async parents(source,target,value=null){
  if(!source?.projectId||!target?.projectId||source.projectId===target.projectId)throw new AppError('INVALID');
  for(const storage of [source,target]){const entry=await this.registry.locate(storage.projectId);if(entry.root!==storage.root||entry.vaultId!==storage.vault?.id||await realpath(storage.root)!==storage.root)throw new AppError('DATABASE_LOCATION');await assertNotDeleting(storage.root);await assertNotMoving(storage.root);await storage.requireStorageKey();authenticateKeyring((await readAccess(storage.root)).value,storage.vault);}
  if(value&&(value.sourceProjectId!==source.projectId||value.targetProjectId!==target.projectId||value.sourceVaultId!==source.vault.id||value.targetVaultId!==target.vault.id))throw new AppError('CONFLICT');
 }
 async reserve(source,target,value,{save=false}={}){
  return withProjectMembership(this.registry,[source.projectId,target.projectId],async()=>{await this.parents(source,target,value);if(save)await this.save(value);await reserveBookPlacement(source,value);await reserveBookPlacement(target,value);},{wait:false});
 }
 async run(source,target,vault,{id,check=async()=>{},checkpoint=async()=>{}}={}){
  if(!researchId(id)||!vault?.key)throw new AppError('INVALID');await check();await this.parents(source,target);
  const from=new LabBookRegistry(source),to=new LabBookRegistry(target),prior=await this.read();
  if(prior&&!terminal(prior)&&prior.id!==id)throw new AppError('LAB_BOOK_MOVE_PENDING');
  const directory=prior?.id===id?prior.directory:(await from.locate(this.labBookId)).directory;
  return this.locked(source,target,directory,async()=>{
   await check();await this.parents(source,target);let value=await this.read();
   if(value?.id===id){await this.parents(source,target,value);return this.finish(source,target,vault,value,{check,checkpoint});}
   if(!terminal(value))throw new AppError('LAB_BOOK_MOVE_PENDING');
   await assertBookPlacementAvailable(source,this.labBookId,directory);await assertBookPlacementAvailable(target,this.labBookId,directory);await assertBookTransfersComplete(source,this.labBookId);
   if(await new LabBookRenames(source).pending(this.labBookId))throw new AppError('STORAGE_RENAMING');const deletion=await new LabBookDeletions(source,this.labBookId).receipt();if(deletion&&deletion.phase!=='complete')throw new AppError('STORAGE_DELETE_BUSY');
   const entry=await from.locate(this.labBookId),destination=storageCreationPath(target.root,directory),targetBooks=(await to.read()).value;
   if(entry.directory!==directory||entry.vaultId!==vault.id)throw new AppError('CONFLICT');
   if(targetBooks.books.some(book=>book.labBookId===this.labBookId||nameKey(book.directory)===nameKey(directory))||targetBooks.deleted.some(book=>book.labBookId===this.labBookId)||await assertRegular(destination,{directory:true,missing:true}))throw new AppError('EXISTS');
   const previous=targetBooks.relocated?.find(book=>book.labBookId===this.labBookId);if(previous&&!sameBook(previous,entry))throw new AppError('DATABASE_LOCATION');
   const storage=new LabBookStorage(entry.root,this.labBookId,vault);authenticateKeyring((await readAccess(entry.root)).value,vault);await assertRenameDatabaseOwners(entry.root,[]);
   await storage.withStorageHandoff(async()=>{
    await check();const metadata=(await storage.outline()).metadata;if(metadata.id!==entry.namespaceId||metadata.notebooks[0].projectId!==source.projectId)throw new AppError('DATABASE_LOCATION');
    const parent=(await target.outline()).metadata.projects.find(project=>project.id===target.projectId);if(!parent)throw new AppError('DATABASE_LOCATION');
    await this.addresses.register(source.projectId,entry);
    value={version:1,id,labBookId:this.labBookId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,directory,sourceProjectId:source.projectId,sourceVaultId:source.vault.id,targetProjectId:target.projectId,targetVaultId:target.vault.id,parent:{...parent,parentId:null},identity:identity(await assertRegular(entry.root,{directory:true})),accessHash:await hash(path.join(entry.root,'.observanda/access.json')),descriptorHash:await hash(await workspaceFile(entry.root)),phase:'prepared'};
    await this.reserve(source,target,value,{save:true});await checkpoint('prepared',value);
    await atomicWrite(path.join(entry.root,RENAME_MARKER),serialize({version:1,id,source:entry.root,destination,placement:true}));
   },{existing:true});
   value.phase='frozen';await this.save(value);await checkpoint('frozen',value);return this.finish(source,target,vault,value,{check,checkpoint});
  });
 }
 async finish(source,target,vault,value,{check,checkpoint}){
  await this.parents(source,target,value);if(vault.id!==value.vaultId)throw new AppError('ACCESS_DENIED');
  const from=new LabBookRegistry(source),to=new LabBookRegistry(target),roots=await this.roots(value),transfer=new LabBookRelocationTransfer(this,value,vault,{check,checkpoint});
  return renameScope(value.id,async()=>{
   await check();if(value.phase==='complete')return this.complete(source,target,vault,value);if(['cancelling','cancelled'].includes(value.phase))return this.cancel(source,target,vault,value,{checkpoint});
   await this.reserve(source,target,value);
   if(value.phase==='copying')await transfer.copy();
   if(['retiring','retired'].includes(value.phase)){await transfer.retire();value.phase='complete';await this.save(value);await checkpoint('complete',value);return this.complete(source,target,vault,value);}
   let root=await this.locate(value);authenticateKeyring((await readAccess(root)).value,vault);
   if(root===roots.destination&&value.version!==2&&['prepared','frozen'].includes(value.phase))await persistRename(roots.source,roots.destination);
   if(root===roots.source){
    const storage=new LabBookStorage(root,this.labBookId,vault),pending=await workspaceRename(root);
    if(pending&&pending.id!==value.id)throw new AppError('STORAGE_RENAME_STATE');
    if(!pending)await storage.withStorageHandoff(async()=>{await check();await atomicWrite(path.join(root,RENAME_MARKER),serialize({version:1,id:value.id,...roots,placement:true}));},{existing:true});
    const provider=databaseProvider();if(!provider?.stopLabBookForRename)throw new AppError('DATABASE_LOCATION');await provider.stopLabBookForRename(root,this.labBookId,vault,value.id);
    const lease=await workspaceDatabaseLease(path.join(root,LAB_BOOK_DATABASE_DIRECTORY),{});
    try{await assertLabBookDatabaseStopped(root,this.labBookId,vault);if(await this.locate(value)!==root||await assertRegular(roots.destination,{directory:true,missing:true}))throw new AppError('STORAGE_RENAME_STATE');await check();await checkpoint('stopped',value);}finally{await lease.close();}
    try{await rename(root,roots.destination);}catch(error){
     if(error.code!=='EXDEV')throw error;
     value.version=2;value.identity=await projectMoveDirectory(root);value.transfer={sourceId:(await catalogueBinding(root)).id};value.phase='copying';await this.save(value);await checkpoint('copying',value);await transfer.copy();
    }
    root=roots.destination;await checkpoint('renamed',value);value.phase='moved';await this.save(value);
   }
   if((await workspaceRename(root))?.id!==value.id)throw new AppError('STORAGE_RENAME_STATE');
   const storage=new LabBookStorage(root,this.labBookId,vault);
   await storage.withLock(()=>storage.catalogue(async store=>{
    const head=await store.head(),snapshot=await store.snapshot(head);if(snapshot.metadata.id!==value.namespaceId||![value.sourceProjectId,value.targetProjectId].includes(snapshot.metadata.notebooks[0].projectId))throw new AppError('DATABASE_LOCATION');
    if(snapshot.metadata.notebooks[0].projectId===value.targetProjectId)return;
    const current=await store.indexed(snapshot),metadata={...current.metadata,projects:[projectSummaryForBook(value.parent)],notebooks:current.metadata.notebooks.map(book=>({...book,projectId:value.targetProjectId}))};await reparentConfigurationMetadata(store,current.metadata,metadata);await store.validateMetadata(current,metadata);await store.commitChanges(head,current,metadata,[],{now:new Date().toISOString()});
   }));await checkpoint('metadata',value);
   const next=await to.describe(storage,{staged:value.version===2});
   await withWriterLease(path.join(target.root,'.observanda/lab-books.lock'),async()=>{
    const destination=await to.read(),exists=destination.value.books.find(book=>book.labBookId===this.labBookId);
    if(exists&&!sameBook(exists,next))throw new AppError('DATABASE_LOCATION');
    if(!exists)await to.change(destination.revision,data=>({...data,relocated:data.relocated.filter(book=>book.labBookId!==this.labBookId),books:[...data.books,next]}));
   });await checkpoint('attached',value);
   await this.addresses.relocate({...next,projectId:source.projectId},{...next,projectId:target.projectId});await checkpoint('addressed',value);
   await withWriterLease(path.join(source.root,'.observanda/lab-books.lock'),async()=>{
   const original=await from.read(),entry=original.value.books.find(book=>book.labBookId===this.labBookId);
   if(entry){if(!sameBook(entry,next)||entry.directory!==value.directory)throw new AppError('DATABASE_LOCATION');await from.change(original.revision,data=>({...data,books:data.books.filter(book=>book.labBookId!==this.labBookId),relocated:[...data.relocated,{labBookId:this.labBookId,namespaceId:value.namespaceId,vaultId:value.vaultId,projectId:target.projectId,operationId:value.id}]}));}
   else{const moved=original.value.relocated?.find(book=>book.labBookId===this.labBookId);if(!sameBook(moved,next)||moved.operationId!==value.id)throw new AppError('CONFLICT');}
   });
   value.phase='registered';await this.save(value);await checkpoint('registered',value);await check();if(value.version===2)await transfer.retire();value.phase='complete';await this.save(value);await checkpoint('complete',value);return this.complete(source,target,vault,value);
  });
 }
 async cancel(source,target,vault,value,{checkpoint}){
  const roots=await this.roots(value),root=await this.locate(value);if(root!==roots.source)throw new AppError('STORAGE_RENAME_STATE');
  const book=await new LabBookRegistry(source).locate(this.labBookId);if(!sameBook(book,value)||book.root!==root)throw new AppError('CONFLICT');
  authenticateKeyring((await readAccess(root)).value,vault);const marker=await workspaceRename(root);
  if(marker){if(marker.id!==value.id)throw new AppError('STORAGE_RENAME_STATE');await unlink(path.join(root,RENAME_MARKER));}await checkpoint('cancel-unfrozen',value);
  value.phase='cancelled';await this.save(value);await checkpoint('cancelled',value);
  await releaseBookPlacement(target,value);await checkpoint('cancel-target-released',value);await releaseBookPlacement(source,value);
  throw new AppError('STORAGE_RENAME_VOLUME');
 }
 async complete(source,target,vault,value){
  const book=await new LabBookRegistry(target).locate(this.labBookId),address=await this.addresses.read(value.namespaceId);if(!sameBook(book,value)||address?.projectId!==target.projectId||!sameBook(address,value))throw new AppError('CONFLICT');
  authenticateKeyring((await readAccess(book.root)).value,vault);const marker=await workspaceRename(book.root);
  if(marker){if(marker.id!==value.id||await this.locate(value)!==book.root)throw new AppError('STORAGE_RENAME_STATE');if(value.version===2)await new LabBookRelocationTransfer(this,value,vault,{}).activate();await unlink(path.join(book.root,RENAME_MARKER));}
  await releaseBookPlacement(source,value);await releaseBookPlacement(target,value);return {id:value.id,projectId:target.projectId,book,complete:true};
 }
}
