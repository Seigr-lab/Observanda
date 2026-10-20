// External relocation preserves independently registered descendant projects.
// The journal holds bounded native roots; each book is fenced, copied and
// retired using its own identity without retaining all keys or writer leases.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,realpath,rename,unlink,opendir} from 'node:fs/promises';
import {NativeProjectMoveBooks} from './native-project-book-move.js';
import {assertWorkspaceProjectMoveOwner} from './workspace-project-move-owner.js';
import {NativePortabilityCollection,createPortabilityCollection,portabilityCollection,releasePortabilityCollection,validPortabilityCollection} from './portability-collection.js';
import {ProjectStorage} from './project-storage.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {ProjectBookOwners} from './project-book-owners.js';
import {captureProjectBookCopyDirectory} from './native-project-book-copy.js';
import {copyProjectOwnerLocation,projectTransferReceipt} from './project-transfer.js';
import {projectRegistryDescendantPrefix,assertProjectTransferDestination} from './project-registry-locations.js';
import {ownedProjectFolderPaged,projectMoveDirectory,assertProjectMoveDirectory} from './project-move-boundaries.js';
import {removeRetiredProject} from './project-move-retirement.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {withProjectMembership,assertProjectCreationSettled,assertProjectRelocationsSettled} from './project-membership.js';
import {requireStorageName,storageFolderName} from './storage-names.js';
import {withWriterLease} from './writer-lease.js';
import {withScratch} from './scratch-work.js';
import {assertRegular,atomicWrite,privateDirectory,digest,serialize,workspaceFile} from './storage.js';
import {catalogueBinding,catalogueActivation,CATALOGUE_ARCHIVE} from './postgres-activation.js';
import {databaseRetention,validDatabaseRetention,verifyDatabaseRetention} from './workspace-database-retention.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {MOVE_SOURCE,moveSource,ownedMoveScope} from './workspace-move-state.js';
import {resolveLocation} from './locations.js';
import {validOwnerDirectoryHead} from './owner-directory-model.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const inside=(parent,child)=>{const part=path.relative(parent,child);return part!==''&&part!=='..'&&!part.startsWith('..'+path.sep)&&!path.isAbsolute(part);};
const relative=(root,child)=>path.relative(root,child).split(path.sep).join('/');
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identity=value=>value&&Object.keys(value).sort().join()==='dev,ino'&&['dev','ino'].every(key=>/^[0-9]+$/.test(value[key]));
const terminal=value=>['complete','cancelled'].includes(value.phase);
export function validateNativeProjectMove(value){
 if(value?.version!==3||![value.id,value.projectId,value.namespaceId,value.vaultId,value.sourceId].every(researchId)||!['preparing','prepared','frozen','copying','verified','adopted','retired','releasing','complete','cancelled','cancelling','cancel-releasing'].includes(value.phase)||![value.source,value.destination].every(root=>typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root&&root!==path.parse(root).root)||value.source===value.destination||inside(value.source,value.destination)||inside(value.destination,value.source)||!identity(value.sourceDirectory)||!hash(value.accessHash)||value.parentId!==null&&!researchId(value.parentId)||!Number.isSafeInteger(value.retainedCount)||value.retainedCount<0||!validPortabilityCollection(value.retained))throw new AppError('STORAGE_MOVE_STATE');
 if(value.workspaceMoveId!==undefined&&(!researchId(value.workspaceMoveId)||typeof value.workspaceMoveDestination!=='string'||!path.isAbsolute(value.workspaceMoveDestination)||path.resolve(value.workspaceMoveDestination)!==value.workspaceMoveDestination||!inside(value.workspaceMoveDestination,value.destination)||!hash(value.workspaceMoveRevision))||value.workspaceMoveId===undefined&&(value.workspaceMoveDestination!==undefined||value.workspaceMoveRevision!==undefined))throw new AppError('STORAGE_MOVE_STATE');
 if(value.bookOwners!==undefined&&!validPortabilityCollection(value.bookOwners)||value.bookKeys!==undefined&&!validPortabilityCollection(value.bookKeys))throw new AppError('STORAGE_MOVE_STATE');
 if(!['preparing','cancelled','cancelling','cancel-releasing'].includes(value.phase)&&(!validPortabilityCollection(value.bookOwners)||!validPortabilityCollection(value.bookKeys)||value.bookOwners.count!==value.bookKeys.count||value.bookDirectory?.version!==1||!validOwnerDirectoryHead(value.bookDirectory.head)||value.bookDirectory.revision!==digest(serialize(value.bookDirectory.head))||value.bookDirectory.head?.kind!=='books'||value.bookDirectory.head.ownerId!==value.projectId||(value.bookDirectory.head.roots?.active?.count??0)!==value.bookOwners.count))throw new AppError('STORAGE_MOVE_STATE');
 if(['verified','adopted','retired','releasing','complete'].includes(value.phase)&&(!researchId(value.destinationId)||!identity(value.destinationDirectory)||!validDatabaseRetention(value.retention)))throw new AppError('STORAGE_MOVE_STATE');
 if(value.keysReleased!==undefined&&(value.keysReleased!==true||!terminal(value)))throw new AppError('STORAGE_MOVE_STATE');return value;
}
export function projectMoveAccessOwners(workspace,value){
 const root={kind:'project',relative:'',projectId:value.projectId,namespaceId:value.namespaceId,vaultId:value.vaultId},books=value.version===3?portabilityCollection(workspace,value.bookOwners):null;
 return {async find(index,id){if((index==='project'||index==='identity')&&id===root.projectId)return root;if(index!=='identity')return null;if(books)return books.find('identity',id);const book=value.books?.find(item=>item.labBookId===id);return book?{...book,kind:'lab-book',relative:book.directory,projectId:value.projectId}:null;}};
}
export function projectMoveBoundaryState(workspace,value){
 const collection=portabilityCollection(workspace,value.retained);let previous=null,prefixValue=null;
 const find=async relative=>{const prefix=relative.split('/')[0];let head;if(prefix===previous)head=prefixValue;else{head=await collection.get(prefix);previous=prefix;prefixValue=head;}return relative===prefix?head:head?collection.get(relative):null;};
 return {collection,count:value.retainedCount,contains:async relative=>(await find(relative))?.kind==='boundary',protects:async relative=>Boolean(await find(relative))};
}
export async function captureProjectMoveBoundaries(registry,source,{id=randomUUID()}={}){
 let count=0;const ref=await withScratch(async rows=>{
  await registry.inspect(async view=>{let previous=null;for await(const {entry} of view.entries({index:'location',prefix:projectRegistryDescendantPrefix(source,registry.workspace.root)})){
   if(previous&&inside(previous,entry.root))continue;const name=relative(source,entry.root);if(!inside(source,entry.root)||name==='.observanda'||['.observanda/postgresql','.observanda/database-transition'].some(engine=>name===engine||name.startsWith(engine+'/')))throw new AppError('STORAGE_PATH');previous=entry.root;
   for(let parent=path.posix.dirname(name);parent!=='.';parent=path.posix.dirname(parent))await rows.add(parent,{kind:'container',relative:parent});
   if(!await rows.add(name,{kind:'boundary',relative:name,projectId:entry.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId}))throw new AppError('STORAGE_PATH');count++;
  }});return createPortabilityCollection(registry.workspace,rows.items(),{id});
 });return {ref,count};
}
export async function assertProjectMoveDatabases(root,boundaries,books){
 return withScratch(async pending=>{await pending.add('',{relative:''});for(let item;(item=await pending.take())!==undefined;){
  const directory=path.join(root,item.relative);await assertRegular(directory,{directory:true});for await(const child of await opendir(directory)){
   if(child.isSymbolicLink())throw new AppError('UNSAFE');if(!child.isDirectory())continue;const name=path.posix.join(item.relative,child.name);await assertRegular(path.join(root,name),{directory:true});if(await boundaries.contains(name))continue;
   if(path.posix.basename(item.relative).toLowerCase()==='.observanda'&&child.name.toLowerCase()==='postgresql'){const owner=path.posix.dirname(item.relative);if(path.posix.basename(item.relative)!=='.observanda'||child.name!=='postgresql'||owner!=='.'&&!await books.get(owner))throw new AppError('STORAGE_MOVE_CONTENTS');continue;}
   await pending.add(name,{relative:name});
  }
 }});
}
export class NativeProjectMove{
 constructor(command){this.command=command;this.registry=command.registry;this.workspace=command.workspace;}
 async cancel(storage,{id,checkpoint=async()=>{}}){
  const value=await this.command.read(storage.projectId);if(value?.version!==3||value.id!==id)throw new AppError('NOT_FOUND');if(value.workspaceMoveId)throw new AppError('STORAGE_PROJECT_BUSY');if(value.phase==='cancelled')return value;if(!['preparing','prepared','frozen','copying','verified','cancelling','cancel-releasing'].includes(value.phase))throw new AppError('STORAGE_PROJECT_BUSY');
  const entry=await this.registry.locate(storage.projectId);if(entry.root!==value.source||storage.root!==value.source||storage.vault?.id!==value.vaultId)throw new AppError('CONFLICT');
  return ownedMoveScope(value,async()=>{
   await this.source(value,storage.vault);const rootMarker=await moveSource(value.source),expected={id:value.id,destination:value.destination};if(rootMarker&&serialize(rootMarker)!==serialize(expected))throw new AppError('STORAGE_MOVE_STATE');
   const books=value.bookOwners?new NativeProjectMoveBooks(this.command,value,storage.vault):null;
   if(value.phase!=='cancel-releasing'){
    if(['frozen','copying','verified'].includes(value.phase)&&!rootMarker)throw new AppError('STORAGE_MOVE_STATE');
    if(rootMarker){if(!books)throw new AppError('STORAGE_MOVE_STATE');await books.verifyOwners();for await(const item of books.owners.entries())await books.use(value.source,item,async owner=>{const marker=await moveSource(owner.root);if(marker&&(marker.id!==id||marker.destination!==path.join(value.destination,item.directory)))throw new AppError('STORAGE_MOVE_STATE');});}
    value.phase='cancelling';await this.command.save(value);await checkpoint('cancelling');
    if(rootMarker)for await(const item of books.owners.entries()){
     const root=path.join(value.source,item.directory);await assertProjectMoveDirectory(root,item.identity);const marker=await moveSource(root);if(marker){if(marker.id!==id||marker.destination!==path.join(value.destination,item.directory))throw new AppError('STORAGE_MOVE_STATE');await unlink(path.join(root,MOVE_SOURCE));}await checkpoint('book-unfrozen',item.labBookId);
    }
    value.phase='cancel-releasing';await this.command.save(value);
   }
   if(value.bookKeys){
    // A verified or partly initialized destination may already hold the copied
    // key collection. Only its exact transfer receipt authorizes erasing it.
    const target=new ProjectStorage(value.destination,value.projectId,storage.vault);let binding=await catalogueBinding(value.destination);const activation=await catalogueActivation(value.destination);
    if(binding||activation){
     const receipt=await projectTransferReceipt(target);if(receipt?.id!==id||receipt.portable||receipt.source!==value.source||receipt.sourceId!==value.sourceId||receipt.namespaceId!==value.namespaceId)throw new AppError('STORAGE_MOVE_STATE');
     if(value.destinationDirectory)await assertProjectMoveDirectory(value.destination,value.destinationDirectory);else{value.destinationDirectory=await projectMoveDirectory(value.destination);await this.command.save(value);}authenticateKeyring((await readAccess(value.destination)).value,storage.vault);
     // Relocation streams directly into the native database. It never writes
     // an archive; an unexpected archive is not owned by this cancellation.
     if(await assertRegular(path.join(value.destination,CATALOGUE_ARCHIVE),{missing:true}))throw new AppError('STORAGE_MOVE_STATE');
     if(!binding){let empty=false,db;try{
      const descriptor=JSON.parse(await target.readFile(await workspaceFile(value.destination),'utf8'));
      db=await target.openCatalogue({restore:async()=>{empty=true;throw new AppError('STORAGE_INCOMPLETE');},validate:connection=>target.catalogueStore(connection).verify(descriptor)});
     }catch(error){if(!empty)throw error;}finally{await db?.close();}binding=await catalogueBinding(value.destination);}
     if(binding){if(binding.placement!=='project'||binding.projectId!==value.projectId||value.destinationId&&binding.id!==value.destinationId)throw new AppError('STORAGE_MOVE_STATE');await releasePortabilityCollection(target,value.bookKeys);}
    }
    await releasePortabilityCollection(storage,value.bookKeys);
   }
   await checkpoint('cancel-keys-erased');const marker=await moveSource(value.source);if(marker){if(serialize(marker)!==serialize(expected))throw new AppError('STORAGE_MOVE_STATE');await unlink(path.join(value.source,MOVE_SOURCE));}await checkpoint('cancel-unfrozen');value.keysReleased=true;value.phase='cancelled';await this.command.save(value);return value;
  });
 }
 async initial(projectId,vault,{id,path:input,withBook,workspaceMoveId,workspaceMove}){
  const entry=await this.registry.locate(projectId),source=await realpath(entry.root),destination=await resolveLocation(input);if(workspaceMoveId===undefined)await assertProjectTransferDestination(this.registry,destination);else if(!workspaceMove||workspaceMove.value.id!==workspaceMoveId)throw new AppError('STORAGE_MOVE_STATE');if(inside(source,destination)||inside(destination,source)||source===destination)throw new AppError('STORAGE_PATH');requireStorageName(destination,storageFolderName(source));
  const storage=new ProjectStorage(source,projectId,vault);await new ProjectBookOwners(storage).ready();const pin=await captureProjectBookCopyDirectory(new LabBookRegistry(storage));if((pin.head.roots.active?.count??0)&&typeof withBook!=='function'){const error=new AppError('ACCESS_LOCKED');error.operationNotStarted=true;throw error;}
  const access=await readAccess(source),binding=await catalogueBinding(source);authenticateKeyring(access.value,vault);if(entry.vaultId!==vault.id||binding?.placement!=='project'||binding.projectId!==projectId)throw new AppError('DATABASE_LOCATION');
  const value={version:3,id,projectId,source,destination,vaultId:vault.id,namespaceId:entry.namespaceId,parentId:entry.parentId,sourceId:binding.id,sourceDirectory:await projectMoveDirectory(source),accessHash:digest(await readFile(path.join(source,'.observanda/access.json'))),retained:new NativePortabilityCollection(null,randomUUID()).empty(),retainedCount:0,phase:'preparing',...(workspaceMoveId?{workspaceMoveId,workspaceMoveDestination:workspaceMove.value.destination,workspaceMoveRevision:workspaceMove.value.directory.revision}:{})};if(workspaceMoveId)await assertWorkspaceProjectMoveOwner(this.registry,value,workspaceMove);await this.command.save(value);return value;
 }
 async currentBoundaries(value,boundaries){
  let count=0;await this.registry.inspect(async view=>{let previous=null;for await(const {entry} of view.entries({index:'location',prefix:projectRegistryDescendantPrefix(value.source,this.workspace.root)})){
   if(previous&&inside(previous,entry.root))continue;previous=entry.root;const saved=await boundaries.collection.get(relative(value.source,entry.root));if(saved?.kind!=='boundary'||['projectId','namespaceId','vaultId'].some(key=>saved[key]!==entry[key]))throw new AppError('CONFLICT');count++;
  }});if(count!==value.retainedCount)throw new AppError('CONFLICT');
 }
 async source(value,vault,{refreshAccess=false}={}){const storage=new ProjectStorage(value.source,value.projectId,vault);await assertProjectMoveDirectory(storage.root,value.sourceDirectory);const accessHash=digest(await readFile(path.join(storage.root,'.observanda/access.json')));if(!refreshAccess&&accessHash!==value.accessHash||(await catalogueBinding(storage.root))?.id!==value.sourceId)throw new AppError('STORAGE_MOVE_STATE');authenticateKeyring((await readAccess(storage.root)).value,vault);if(refreshAccess&&accessHash!==value.accessHash){value.accessHash=accessHash;await this.command.save(value);}return storage;}
 async target(value,vault){const storage=new ProjectStorage(value.destination,value.projectId,vault);await assertProjectMoveDirectory(storage.root,value.destinationDirectory);authenticateKeyring((await readAccess(storage.root)).value,vault);const binding=await catalogueBinding(storage.root),metadata=await storage.catalogue(async store=>(await store.snapshot()).metadata);if(binding?.placement!=='project'||binding.projectId!==value.projectId||binding.id!==value.destinationId||metadata.id!==value.namespaceId)throw new AppError('DATABASE_LOCATION');return storage;}
 async run(projectId,vault,options,prior){
  const {id,resume=false,checkpoint=async()=>{},onAdopt=async()=>{},onCopiedBook,adoptOnly=false,withBook}=options;let value=prior;
  if(!value||value.id!==id){if(value&&!terminal(value))throw new AppError('CONFLICT');if(resume||adoptOnly)throw new AppError('NOT_FOUND');value=await this.initial(projectId,vault,options);}
  if(options.workspaceMoveId!==undefined&&options.workspaceMoveId!==value.workspaceMoveId)throw new AppError('CONFLICT');if(value.workspaceMoveId)await assertWorkspaceProjectMoveOwner(this.registry,value,options.workspaceMove);
  if(value.vaultId!==vault.id||options.path!==undefined&&await resolveLocation(options.path)!==value.destination)throw new AppError('CONFLICT');if(terminal(value)){if(value.phase==='complete'){await this.target(value,vault);await onAdopt(await this.registry.locate(projectId));}return value;}
  if(['cancelling','cancel-releasing'].includes(value.phase))return this.cancel(new ProjectStorage(value.source,projectId,vault),{id,checkpoint});
  return ownedMoveScope(value,async()=>{
   if(prior?.id===id&&value.phase==='prepared'&&!await moveSource(value.source)){
    if(value.bookOwners.count&&typeof withBook!=='function')throw new AppError('ACCESS_LOCKED');value.phase='preparing';await this.command.save(value);
   }
   if(value.phase==='preparing'){
    if(await moveSource(value.source))throw new AppError('STORAGE_MOVE_STATE');const source=await this.source(value,vault,{refreshAccess:true});if(value.bookKeys)await releasePortabilityCollection(source,value.bookKeys);
    const retained=await captureProjectMoveBoundaries(this.registry,value.source,{id:value.retained.id});value.retained=retained.ref;value.retainedCount=retained.count;await this.command.save(value);
    const books=await NativeProjectMoveBooks.prepare(this.command,value,vault,withBook),boundaries=projectMoveBoundaryState(this.workspace,value);await ownedProjectFolderPaged(source.root,{boundaries,books:books.owners});await assertProjectMoveDatabases(source.root,boundaries,books.owners);for await(const item of books.owners.entries())if(await boundaries.protects(item.directory))throw new AppError('STORAGE_PATH');value.phase='prepared';await this.command.save(value);await checkpoint('prepared');
   }
   const books=new NativeProjectMoveBooks(this.command,value,vault),boundaries=projectMoveBoundaryState(this.workspace,value);
   if(value.phase==='releasing'){await this.target(value,vault);await onAdopt(await this.registry.locate(projectId));await books.clear(value.destination);await checkpoint('keys-erased');value.keysReleased=true;value.phase='complete';await this.command.save(value);await checkpoint('complete');return value;}
   await books.verifyOwners();await boundaries.collection.verify();
   if(['prepared','frozen'].includes(value.phase)){
    if(adoptOnly)return value;const source=await this.source(value,vault);await privateDirectory(source.root,'.observanda/lab-book-creation');
    await withWriterLease(path.join(source.root,'.observanda/lab-books.lock'),()=>source.withStorageHandoff(()=>withProjectMembership(this.registry,[value.parentId,value.projectId],async()=>{
     if(value.workspaceMoveId)await assertWorkspaceProjectMoveOwner(this.registry,value,options.workspaceMove);await assertProjectCreationSettled(this.registry,[value.projectId]);await assertProjectRelocationsSettled(this.registry,[value.projectId],{except:projectId});await books.current();await this.currentBoundaries(value,boundaries);await ownedProjectFolderPaged(source.root,{boundaries,books:books.owners});await assertProjectMoveDatabases(source.root,boundaries,books.owners);
     const marker=await moveSource(source.root),expected={id,destination:value.destination};if(marker&&serialize(marker)!==serialize(expected))throw new AppError('STORAGE_MOVE_STATE');if(!marker)await atomicWrite(path.join(source.root,MOVE_SOURCE),serialize(expected));value.phase='frozen';await this.command.save(value);await checkpoint('root-frozen');await books.freeze(checkpoint);await books.current();value.phase='copying';await this.command.save(value);await checkpoint('owners-frozen');
    }),{existing:true,moveId:id}));
   }
   let fresh=false;
   if(value.phase==='copying'){
    if(adoptOnly)return value;const source=await this.source(value,vault);if(value.destinationDirectory)await assertProjectMoveDirectory(value.destination,value.destinationDirectory);await books.current();await this.currentBoundaries(value,boundaries);
    const excludeProject=async root=>{const name=relative(value.source,root);return await boundaries.contains(name)||Boolean(await books.owners.get(name));},boundaryRevision=digest(serialize({books:value.bookDirectory,retained:value.retained}));
    await copyProjectOwnerLocation(source,value.destination,{id,relocation:true,retainIncomplete:true,excludeProject,boundaryRevision,checkpoint:async(stage,...args)=>{if(stage==='files'){const identity=await projectMoveDirectory(value.destination);if(value.destinationDirectory&&serialize(value.destinationDirectory)!==serialize(identity))throw new AppError('STORAGE_MOVE_STATE');value.destinationDirectory=identity;await this.command.save(value);}await checkpoint('copy:'+stage,...args);},onVerified:async(target,receipt)=>{
     const binding=await catalogueBinding(target.root);if(receipt.namespaceId!==value.namespaceId||receipt.sourceId!==value.sourceId||value.destinationId&&value.destinationId!==binding?.id)throw new AppError('STORAGE_MOVE_STATE');value.destinationId=binding.id;value.destinationDirectory=await projectMoveDirectory(target.root);value.retention=await source.catalogue(store=>databaseRetention(store.db));await this.command.save(value);
    }});
    await books.copy(checkpoint);await books.activate();await unlink(path.join(value.destination,'.observanda/copy-in-progress')).catch(error=>{if(error.code!=='ENOENT')throw error;});value.phase='verified';await this.command.save(value);fresh=true;await checkpoint('verified');await checkpoint('frozen');
   }
   const target=await this.target(value,vault);await books.verify({retention:!fresh,onCopiedBook});if(!fresh)await verifyDatabaseRetention(target,value.retention);
   if(value.phase==='verified'){
    for(let attempt=0;;attempt++){const current=await this.registry.state(projectId),entry=current.state==='active'?current.entry:null;if(entry?.vaultId!==value.vaultId||entry.namespaceId!==value.namespaceId||![value.source,value.destination].includes(entry.root))throw new AppError('CONFLICT');if(entry.root===value.destination)break;try{await this.registry.relocate(target,{from:value.source,expected:current.revision});break;}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}}
    await onAdopt(await this.registry.locate(projectId));
    for await(const book of books.owners.entries())await new LabBookDirectory(this.registry).register(projectId,book);await checkpoint('registry');value.phase='adopted';await this.command.save(value);await checkpoint('adopted');
   }
   await onAdopt(await this.registry.locate(projectId));if(adoptOnly)return value;if((await this.registry.locate(projectId)).root!==value.destination)throw new AppError('CONFLICT');
   const retired=path.join(path.dirname(value.source),'.observanda-project-move-'+id),nested=boundaries.count>0;
   if(value.phase==='adopted'){
    if(!nested&&await assertRegular(retired,{directory:true,missing:true})){await assertProjectMoveDirectory(retired,value.sourceDirectory);const marker=await moveSource(retired);if(marker?.id!==id||marker.destination!==value.destination)throw new AppError('STORAGE_MOVE_STATE');}
    else{const source=await this.source(value,vault);await this.currentBoundaries(value,boundaries);await ownedProjectFolderPaged(source.root,{boundaries,books:books.owners});await assertProjectMoveDatabases(source.root,boundaries,books.owners);await books.stop(checkpoint);const provider=databaseProvider();if(!provider?.stopProjectForMove)throw new AppError('DATABASE_RUNTIME');await provider.stopProjectForMove(source.root,projectId,vault,id);const lease=await workspaceDatabaseLease(path.join(source.root,'.observanda/postgresql'));try{await assertProjectDatabaseStopped(source.root,projectId,vault);}finally{await lease.close();}await checkpoint('stopped');if(!nested){await rename(source.root,retired);await checkpoint('renamed');}}
    value.phase='retired';await this.command.save(value);await checkpoint('retired');
   }
   if(value.phase!=='retired')throw new AppError('STORAGE_MOVE_STATE');let previousOwner=null,previousOwned=false;const ownerRelative=async relative=>{const slash=relative.indexOf('/');if(slash<0||relative.startsWith('.observanda/'))return relative;const name=relative.slice(0,slash);let owned;if(name===previousOwner)owned=previousOwned;else{owned=Boolean(await books.owners.get(name));previousOwner=name;previousOwned=owned;}return owned?relative.slice(slash+1):relative;};
   await this.workspace.withCatalogueConnections(()=>removeRetiredProject(value,{boundaryState:boundaries,ownerRelative,verify:!fresh,checkpoint}));value.phase='releasing';await this.command.save(value);await checkpoint('releasing');await books.clear(value.destination);await checkpoint('keys-erased');value.keysReleased=true;value.phase='complete';await this.command.save(value);await checkpoint('complete');return value;
  });
 }
}
