import {discardConfigurationCheckpoint} from './configuration-commands.js';
import {ProjectPlacementTransfer} from './project-placement-transfer.js';
import {trackProjectTransfer} from './project-transfer-tasks.js';
import {projectPlacementLocation,checkPlacementParent} from './project-placement.js';
import {validateIndexedMetadata} from './catalogue-metadata.js';
import {operationStage} from './operation-progress.js';
// A project rename carries its existing nested owners. Only names, registry
// locations and recovery receipts change; record and evidence bytes stay put.
import path from 'node:path';
import {readFile,realpath,rename,unlink} from 'node:fs/promises';
import {ProjectStorage} from './project-storage.js';
import {WorkspaceProjectRename,clearRenamedProjects} from './workspace-project-rename.js';
import {ProjectBookRename,clearRenamedBooks} from './project-book-rename.js';
import {RENAME_KEYS_FILE,RENAME_BOOK_KEYS_FILE} from './workspace-rename-keys.js';
import {projectRenameFile,readProjectRename,locateProjectRename,directoryIdentity,sameDirectory,validProjectRenameSettings} from './project-rename-receipt.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {withWriterLease} from './writer-lease.js';
import {assertRegular,atomicWrite,privateDirectory,digest,serialize,workspaceFile} from './storage.js';
import {validateStorageName} from './storage-names.js';
import {RENAME_MARKER,workspaceRename,renameScope} from './workspace-rename-state.js';
import {assertRenameDatabaseOwners} from './workspace-rename-inventory.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const fingerprint=async file=>digest(await readFile(file));
const relative=(base,root)=>path.relative(base,root).split(path.sep).join('/');
export class ProjectRenames{
 constructor(registry,projectId){if(!researchId(projectId))throw new AppError('INVALID');this.registry=registry;this.projectId=projectId;}
 read(){return readProjectRename(this.registry,this.projectId);}
 async save(value){await privateDirectory(this.registry.workspace.root,'.observanda/project-renames');await this.registry.workspace.writeFile(projectRenameFile(this.registry,this.projectId),serialize(value));}
 scope(value){return {...value,source:nestedRenameRoot(this.registry.workspace.root,value.source),destination:nestedRenameRoot(this.registry.workspace.root,value.destination)};}
 helpers(storage){return {projects:new WorkspaceProjectRename(storage,{registry:this.registry}),books:new ProjectBookRename(storage,{keyFile:RENAME_BOOK_KEYS_FILE})};}
 async run(storage,{id,name,expectedName,settings=null,placement=null,withProject,withBook,check=async()=>{},checkpoint=async()=>{}}){
  if(settings!==null&&(!validProjectRenameSettings(settings)||settings.project?.id!==this.projectId||settings.project.title!==name||settings.project.parentId!=null))throw new AppError('INVALID');
  if(storage?.projectId!==this.projectId||!researchId(id))throw new AppError('INVALID');validateStorageName(name);validateStorageName(expectedName);if(placement&&name!==expectedName)throw new AppError('INVALID');
  return trackProjectTransfer(projectRenameFile(this.registry,this.projectId),()=>withProjectLifecycle(this.registry,this.projectId,'rename',async()=>{
   await check();let prior=await this.read();
   const fresh=prior?.phase==='prepared'&&!await workspaceRename(this.scope(prior).source);
   if(prior?.phase==='cancelled'){if(prior.id===id&&prior.cancelReason==='volume')throw new AppError('STORAGE_RENAME_VOLUME');prior=null;}
   if(prior?.id===id&&!fresh){if(path.posix.basename(prior.source)!==expectedName||path.posix.basename(prior.destination)!==name||serialize(prior.settings??null)!==serialize(settings)||serialize(prior.placement??null)!==serialize(placement))throw new AppError('CONFLICT');return this.finish(prior,storage.vault,{check,checkpoint});}
   if(prior&&!fresh&&prior.phase!=='complete')throw new AppError('STORAGE_RENAMING');
   const current=await this.registry.read(),entry=current.value.projects.find(p=>p.projectId===this.projectId);
   if(!entry||entry.root!==storage.root||entry.vaultId!==storage.vault?.id||path.basename(entry.root)!==expectedName)throw new AppError('CONFLICT');
   const source=await realpath(storage.root),location=projectPlacementLocation(this.registry,current.value,entry,name,placement),destination=location.destination,parent=entry.parentId===null?this.registry.workspace.root:current.value.projects.find(p=>p.projectId===entry.parentId)?.root;
   if(source!==storage.root||path.dirname(source)!==parent)throw new AppError('STORAGE_PATH');
   if(source===destination)return {project:entry,complete:true};
   const existing=await assertRegular(destination,{directory:true,missing:true});if(existing&&await realpath(destination)!==source)throw new AppError('EXISTS');
   const {projects,books}=this.helpers(storage);let value;
   try{
    await projects.prepare(withProject,withBook);await books.prepare(typeof withBook==='function'?(bookId,use)=>withBook(storage,bookId,use):undefined);
    await assertRenameDatabaseOwners(source,[...books.books.map(book=>path.join(source,book.directory)),...projects.projects.flatMap(item=>{const root=nestedRenameRoot(source,item.relative);return [root,...projects.bookOwners.get(item.projectId).books.map(book=>path.join(root,book.directory))];})]);
    await projects.withStorageHandoff(()=>books.withStorageHandoff(()=>storage.withStorageHandoff(()=>projects.withDirectoryHandoff(()=>withWriterLease(path.join(source,'.observanda/lab-books.lock'),()=>withWriterLease(path.join(this.registry.workspace.root,'.observanda/project-registry.lock'),async()=>{
     await check();const latest=await this.registry.read();if(projectPlacementLocation(this.registry,latest.value,entry,name,placement).destination!==destination)throw new AppError('CONFLICT');if(latest.revision!==projects.revision)throw new AppError('CONFLICT');const {metadata,etag}=await storage.outline();if(settings){if(settings.etag!==etag)throw new AppError('CONFLICT');await storage.catalogue(async store=>validateIndexedMetadata(store,await store.snapshot(etag),{...metadata,title:name,projects:[settings.project],entries:[]}));}
     if(metadata.id!==entry.namespaceId||metadata.projects[0].title!==expectedName)throw new AppError('CONFLICT');authenticateKeyring((await readAccess(source)).value,storage.vault);
     value={version:1,id,projectId:this.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,parentId:entry.parentId,...(placement?{placement,placementParent:{relative:relative(this.registry.workspace.root,location.parent),...directoryIdentity(await assertRegular(location.parent,{directory:true}))}}:{}),source:relative(this.registry.workspace.root,source),destination:relative(this.registry.workspace.root,destination),identity:directoryIdentity(await assertRegular(source,{directory:true})),accessHash:await fingerprint(path.join(source,'.observanda/access.json')),descriptorHash:await fingerprint(await workspaceFile(source)),phase:'prepared',settings,rootBooks:{}};
     if(fresh)await this.discardPrepared(prior,storage.vault);
     await projects.persist(value);await books.persist(id,value.rootBooks);await this.save(value);await checkpoint('prepared',value);
     await atomicWrite(path.join(source,RENAME_MARKER),serialize({version:1,...(placement?{placement:true}:{}),id,source,destination}));
    })),{parents:[entry.parentId,location.parentId],except:this.projectId}),{existing:true})));
    value.phase='frozen';await this.save(value);await checkpoint('frozen',value);return await this.finish(value,storage.vault,{check,checkpoint});
   }finally{projects.close();books.close();}
  }));
 }
 async cancelPrepared(vault,{check=async()=>{}}={}){return withProjectLifecycle(this.registry,this.projectId,'rename',async()=>{await check();const value=await this.read();if(!value||value.phase==='cancelled')return;if(value.phase!=='prepared')throw new AppError('STORAGE_RENAMING');await this.discardPrepared(value,vault);});}
 async discardPrepared(value,vault){
  const root=this.scope(value).source,stat=await assertRegular(root,{directory:true});if(!sameDirectory(directoryIdentity(stat),value.identity)||await realpath(root)!==root||await workspaceRename(root))throw new AppError('STORAGE_RENAME_STATE');authenticateKeyring((await readAccess(root)).value,vault);
  const files=[[root,RENAME_KEYS_FILE,value.projectKeysHash],[root,RENAME_BOOK_KEYS_FILE,value.rootBooks.bookKeysHash],...(value.projects??[]).map(item=>[nestedRenameRoot(root,item.relative),RENAME_KEYS_FILE,item.bookKeysHash])];
  for(const [owner,name,expected] of files){if(!expected)continue;const file=path.join(owner,name);if(await assertRegular(file,{missing:true})&&await fingerprint(file)===expected)await unlink(file);}
  value.phase='cancelled';await this.save(value);
 }
 async resume(vault,options={}){
  const value=await this.read();if(!value||value.phase==='cancelled')return null;
  if(value.phase==='prepared'&&!await workspaceRename(this.scope(value).source)){
   if(options.withProject&&options.withBook)return this.run(new ProjectStorage(this.scope(value).source,this.projectId,vault),{...options,id:value.id,name:path.posix.basename(value.destination),expectedName:path.posix.basename(value.source),settings:value.settings??null,placement:value.placement??null});
   // Nothing was fenced: reconstruct admission from current metadata. Old
   // capabilities authorize only the same owners, never a newly added child.
   const source=this.scope(value).source,storage=new ProjectStorage(source,this.projectId,vault),{projects,books}=this.helpers(storage);
   try{
    await projects.load(this.scope(value));await books.load(value.id,value.rootBooks);
    return await this.run(storage,{...options,id:value.id,name:path.posix.basename(value.destination),expectedName:path.posix.basename(value.source),settings:value.settings??null,placement:value.placement??null,withProject:options.withProject??(async(id,use)=>{const item=projects.projects?.find(p=>p.projectId===id);if(!item){const error=new AppError('ACCESS_LOCKED');error.projectId=id;throw error;}return use(await projects.checked(item));}),withBook:options.withBook??(async(parent,id,use)=>{const owner=parent.projectId===this.projectId?books:projects.bookOwners.get(parent.projectId),item=owner?.books.find(book=>book.labBookId===id);if(!item){const error=new AppError('ACCESS_LOCKED');error.projectId=parent.projectId;error.labBookId=id;throw error;}return use(await owner.checked(item));})});
   }finally{projects.close();books.close();}
  }
  return trackProjectTransfer(projectRenameFile(this.registry,this.projectId),()=>withProjectLifecycle(this.registry,this.projectId,'rename',async()=>{const latest=await this.read();return latest?this.finish(latest,vault,options):null;}));
 }
 async finish(value,vault,{check=async()=>{},checkpoint=async()=>{}}={}){
  if(vault?.id!==value.vaultId)throw new AppError('ACCESS_DENIED');
  return renameScope(value.id,async()=>{
   if(value.phase==='cancelling')return this.cancelFrozen(value,vault,{check,checkpoint});
   const transfer=new ProjectPlacementTransfer(this,value,vault,{check,checkpoint});
   await checkPlacementParent(this.registry,value);
   if(value.phase==='copying')await transfer.copy();
   if(['registered','retiring','retired'].includes(value.phase)){await transfer.retire();value.phase='complete';await this.save(value);await checkpoint('complete',value);const root=this.scope(value).destination;await this.clear(root,value);return {id:value.id,project:await this.registry.locate(this.projectId),complete:true};}
   const scope=this.scope(value);let root=await locateProjectRename(this.registry,value);authenticateKeyring((await readAccess(root)).value,vault);await check();
   if(value.phase==='complete'){await this.clear(root,value);return {id:value.id,project:await this.registry.locate(this.projectId),complete:true};}
   if(value.version===2)await transfer.activate();
   const marker=await workspaceRename(root);if(marker&&marker.id!==value.id)throw new AppError('STORAGE_RENAMING');
   if(!marker){
    if(value.phase!=='prepared'||root!==scope.source)throw new AppError('STORAGE_RENAME_STATE');
    const storage=new ProjectStorage(root,this.projectId,vault);await storage.withStorageHandoff(async()=>{
     if(await fingerprint(await workspaceFile(root))!==value.descriptorHash)throw new AppError('STORAGE_RENAME_STATE');
     await atomicWrite(path.join(root,RENAME_MARKER),serialize({version:1,...(value.placement?{placement:true}:{}),id:value.id,source:scope.source,destination:scope.destination}));
    },{existing:true});
   }
   if(root===scope.source){
    const storage=new ProjectStorage(root,this.projectId,vault),{projects,books}=this.helpers(storage);
    try{await projects.load(scope);await books.load(value.id,value.rootBooks);await projects.freezeAndStop(scope,{checkpoint});await books.freezeAndStop(scope,{checkpoint});}finally{projects.close();books.close();}
    const provider=databaseProvider();if(!provider?.stopProjectForRename)throw new AppError('DATABASE_LOCATION');await operationStage('rename-close-project',{},()=>provider.stopProjectForRename(root,this.projectId,vault,value.id));
    const lease=await workspaceDatabaseLease(path.join(root,'.observanda/postgresql'));
    try{
     await assertProjectDatabaseStopped(root,this.projectId,vault);if(await locateProjectRename(this.registry,value)!==root||await fingerprint(await workspaceFile(root))!==value.descriptorHash||await realpath(path.dirname(root))!==path.dirname(root))throw new AppError('STORAGE_RENAME_STATE');
     const target=await assertRegular(scope.destination,{directory:true,missing:true});if(target&&await realpath(scope.destination)!==root)throw new AppError('EXISTS');await check();await checkpoint('stopped',value);
    }finally{await lease.close();}
    await checkPlacementParent(this.registry,value);
    try{await operationStage(value.placement?'place-project-folder':'rename-project-folder',{},()=>rename(root,scope.destination));}
    catch(error){if(error.code!=='EXDEV')throw error;if(!value.placement){value.phase='cancelling';value.cancelReason='volume';await this.save(value);await checkpoint('cancelling',value);return this.cancelFrozen(value,vault,{check,checkpoint});}await transfer.begin();await transfer.copy();await transfer.activate();}
    root=scope.destination;await checkpoint('renamed',value);value.phase='moved';await this.save(value);
   }
   const storage=new ProjectStorage(root,this.projectId,vault),{projects,books}=this.helpers(storage);
   try{await projects.load(scope);await books.load(value.id,value.rootBooks);await projects.verify();await books.verify();}finally{projects.close();books.close();}
   const name=path.basename(root);
   await operationStage('rename-project-settings',{},()=>storage.withLock(()=>storage.catalogue(async store=>{
    const head=await store.head(),snapshot=await store.snapshot(head);if(snapshot.metadata.id!==value.namespaceId)throw new AppError('STORAGE_RENAME_STATE');
    if(snapshot.metadata.title===name&&snapshot.metadata.projects[0].title===name&&(!value.settings||serialize(snapshot.metadata.projects[0])===serialize(value.settings.project)))return;
    if(value.settings&&head!==value.settings.etag)throw new AppError('CONFLICT');
    const current=await store.indexed(snapshot),metadata={...current.metadata,title:name,projects:value.settings?[value.settings.project]:current.metadata.projects.map(project=>({...project,title:name}))};await store.validateMetadata(current,metadata,{records:[]});await store.commitChanges(head,current,metadata,[],{now:new Date().toISOString()});if(value.settings?.checkpoint)await discardConfigurationCheckpoint(store,{workspaceId:metadata.id,projectId:this.projectId,notebookId:null,slot:'labBookTemplate'},value.settings.checkpoint);
   })));await checkpoint('metadata',value);
   for(let attempt=0;;attempt++){
    const current=await this.registry.read(),entries=[{projectId:this.projectId,namespaceId:value.namespaceId,vaultId:value.vaultId,relative:''},...(value.projects??[])];
    for(const item of entries){const entry=current.value.projects.find(p=>p.projectId===item.projectId),suffix=item.relative?item.relative.split('/'):[];if(!entry||entry.namespaceId!==item.namespaceId||entry.vaultId!==item.vaultId||![path.join(scope.source,...suffix),path.join(scope.destination,...suffix)].includes(entry.root))throw new AppError('CONFLICT');}
    try{await this.registry.change(current.revision,data=>{for(const item of entries){const entry=data.projects.find(p=>p.projectId===item.projectId);entry.root=path.join(scope.destination,...(item.relative?item.relative.split('/'):[]));if(item.projectId===this.projectId){if(value.placement){if(![value.parentId,value.placement.parentId].includes(entry.parentId))throw new AppError('CONFLICT');entry.parentId=value.placement.parentId;}if(entry.summary)entry.summary.title=name;}}return data;});break;}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
   }
   if(value.version===2){value.phase='registered';await this.save(value);}
   await checkpoint('registered',value);if(value.version===2)await transfer.retire();value.phase='complete';await this.save(value);await checkpoint('complete',value);await this.clear(root,value);return {id:value.id,project:await this.registry.locate(this.projectId),complete:true};
  });
 }
 async cancelFrozen(value,vault,{check=async()=>{},checkpoint=async()=>{}}={}){
  const scope=this.scope(value),root=await locateProjectRename(this.registry,value);if(root!==scope.source||value.cancelReason!=='volume')throw new AppError('STORAGE_RENAME_STATE');
  authenticateKeyring((await readAccess(root)).value,vault);await check();
  const current=await this.registry.read(),owners=[{projectId:this.projectId,namespaceId:value.namespaceId,vaultId:value.vaultId,relative:''},...(value.projects??[])];
  for(const item of owners){const entry=current.value.projects.find(p=>p.projectId===item.projectId);if(!entry||entry.root!==path.join(root,...(item.relative?item.relative.split('/'):[]))||entry.namespaceId!==item.namespaceId||entry.vaultId!==item.vaultId||item.projectId===this.projectId&&entry.parentId!==value.parentId)throw new AppError('STORAGE_RENAME_STATE');}
  await clearRenamedProjects(root,scope,{atSource:true});await checkpoint('cancel-projects-cleared',value);
  await clearRenamedBooks(root,{...value.rootBooks,projectId:this.projectId},scope,RENAME_BOOK_KEYS_FILE);await checkpoint('cancel-books-cleared',value);
  const marker=await workspaceRename(root);if(marker){if(marker.id!==value.id||marker.source!==root||marker.destination!==scope.destination)throw new AppError('STORAGE_RENAME_STATE');await unlink(path.join(root,RENAME_MARKER));}await checkpoint('cancel-unfrozen',value);
  value.phase='cancelled';await this.save(value);await checkpoint('cancelled',value);throw new AppError('STORAGE_RENAME_VOLUME');
 }
 async clear(root,value){
  if(root!==this.scope(value).destination||await locateProjectRename(this.registry,value)!==root)throw new AppError('STORAGE_RENAME_STATE');
  const scope=this.scope(value);await clearRenamedProjects(root,scope);await clearRenamedBooks(root,{...value.rootBooks,projectId:this.projectId},scope,RENAME_BOOK_KEYS_FILE);
  const marker=await workspaceRename(root);if(marker){if(marker.id!==value.id)throw new AppError('STORAGE_RENAME_STATE');await unlink(path.join(root,RENAME_MARKER));}
 }
}
