import {NativeProjectRelocation,locateNativeRelocation} from './native-project-relocation.js';
import {NativeRelocationOwners} from './native-relocation-owners.js';
// Cross-workspace placement publishes verified destination ownership before
// retiring the source. Each project's and book's access remains independent.
import path from 'node:path';
import {readFile,realpath,rename,unlink} from 'node:fs/promises';
import {ProjectStorage} from './project-storage.js';
import {WorkspaceProjectRename,clearRenamedProjects} from './workspace-project-rename.js';
import {ProjectBookRename,clearRenamedBooks} from './project-book-rename.js';
import {ProjectPlacementTransfer} from './project-placement-transfer.js';
import {projectWorkspaceMoveFile,readProjectWorkspaceMove,saveProjectWorkspaceMove,workspaceMoveScope} from './project-workspace-move-state.js';
import {reserveIncomingProjectMove,releaseIncomingProjectMove} from './project-incoming-moves.js';
import {admitWorkspaceProjectTree,publishWorkspaceProjectTree,movedProjectEntries} from './project-workspace-move-registration.js';
import {recordProjectDeparture} from './project-relocation-directory.js';
import {trackProjectTransfer} from './project-transfer-tasks.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {withProjectMembership,assertProjectCreationSettled,assertProjectRelocationsSettled} from './project-membership.js';
import {withWriterLease} from './writer-lease.js';
import {assertRegular,atomicWrite,digest,serialize,workspaceFile} from './storage.js';
import {storageCreationPath} from './storage-names.js';
import {RENAME_KEYS_FILE,RENAME_BOOK_KEYS_FILE} from './workspace-rename-keys.js';
import {RENAME_MARKER,workspaceRename,renameScope} from './workspace-rename-state.js';
import {directoryIdentity,sameDirectory} from './project-rename-receipt.js';
import {projectMoveDirectory,assertProjectMoveDirectory} from './project-move-boundaries.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {assertRenameDatabaseOwners} from './workspace-rename-inventory.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {researchId} from './web/research-reference.js';
import {operationStage} from './operation-progress.js';
import {AppError} from './errors.js';
const fingerprint=async file=>digest(await readFile(file));
const relative=(base,root)=>path.relative(base,root).split(path.sep).join('/');
const same=(a,b)=>['projectId','namespaceId','vaultId','root','parentId'].every(key=>a?.[key]===b?.[key]);
export class ProjectWorkspaceMoves{
 constructor(registry,targetRegistry,projectId){
  if(!researchId(projectId)||registry.workspaceId===targetRegistry.workspaceId)throw new AppError('INVALID');
  this.registry=registry;this.targetRegistry=targetRegistry;this.projectId=projectId;
 }
 read(){return readProjectWorkspaceMove(this.registry,this.projectId);}
 save(value){return saveProjectWorkspaceMove(this.registry,value);}
 scope(value){return workspaceMoveScope(this.registry,value);}
 helpers(storage,value){return {projects:new WorkspaceProjectRename(storage,{registry:['departing','departed','complete'].includes(value?.phase)?this.targetRegistry:this.registry}),books:new ProjectBookRename(storage,{keyFile:RENAME_BOOK_KEYS_FILE})};}
 async parent(parentId){return parentId===null?this.targetRegistry.workspace.root:(await this.targetRegistry.locate(parentId)).root;}
 async authorizeParent(parentId,withParent){
  if(parentId===null)return;
  if(typeof withParent!=='function')throw new AppError('ACCESS_LOCKED');
  const entry=await this.targetRegistry.locate(parentId);
  await withParent(parentId,async storage=>{if(storage.projectId!==parentId||storage.root!==entry.root||storage.vault?.id!==entry.vaultId)throw new AppError('ACCESS_DENIED');authenticateKeyring((await readAccess(entry.root)).value,storage.vault);});
 }
 async checkTarget(value){
  const registry=this.targetRegistry,target=value.target;
  if(registry.workspaceId!==target.workspaceId||registry.workspace.root!==target.root||registry.workspace.vault?.id!==target.vaultId)throw new AppError('ACCESS_DENIED');
  await assertProjectMoveDirectory(target.root,target.identity);authenticateKeyring((await readAccess(target.root)).value,registry.workspace.vault);
  const descriptor=JSON.parse(await registry.workspace.readFile(await workspaceFile(target.root),'utf8'));
  if(descriptor.workspaceId!==registry.workspaceId)throw new AppError('DATABASE_LOCATION');
  const parent=await this.parent(value.placement.parentId);
  if(relative(target.root,parent)!==target.parentRelative)throw new AppError('CONFLICT');await assertProjectMoveDirectory(parent,target.parentIdentity);
 }
 async locate(value){
  if(value.ownerDirectoryVersion===2)return locateNativeRelocation(this,value);
  const scope=this.scope(value),owner=value.transfer?.owners.find(item=>item.relative==='');
  for(const root of value.version===2?[value.phase==='copying'?scope.source:scope.destination]:[scope.destination,scope.source]){
   const stat=await assertRegular(root,{directory:true,missing:true});if(!stat)continue;
   if(!sameDirectory(value.version===2?await projectMoveDirectory(root):directoryIdentity(stat),value.version===2?(root===scope.source?owner.sourceIdentity:owner.destinationIdentity):value.identity)||await realpath(root)!==root)continue;
   if(await fingerprint(path.join(root,'.observanda/access.json'))!==value.accessHash)throw new AppError('STORAGE_MOVE_STATE');return root;
  }
  throw new AppError('STORAGE_MOVE_STATE');
 }
 async run(storage,{id,parentId=null,expectedParentId,withProject,withBook,withParent,check=async()=>{},checkpoint=async()=>{}}){
  if(storage?.projectId!==this.projectId||!researchId(id)||parentId!==null&&!researchId(parentId)||expectedParentId!==null&&!researchId(expectedParentId))throw new AppError('INVALID');
  const previous=await this.read();if(previous?.ownerDirectoryVersion===2||!previous||['complete','cancelled'].includes(previous.phase)&&previous.id!==id)return new NativeProjectRelocation(this).run(storage,{id,parentId,expectedParentId,withProject,withBook,withParent,check,checkpoint});
  await this.authorizeParent(parentId,withParent);
  return trackProjectTransfer(projectWorkspaceMoveFile(this.registry,this.projectId),()=>withProjectLifecycle(this.registry,this.projectId,'workspace-move',async()=>{
   await check();const prior=await this.read(),fresh=prior?.phase==='prepared'&&!await workspaceRename(this.scope(prior).source);
   if(prior&&prior.phase!=='complete'&&prior.phase!=='cancelled'&&(prior.id!==id||prior.target.workspaceId!==this.targetRegistry.workspaceId||prior.target.root!==this.targetRegistry.workspace.root||prior.placement.parentId!==parentId||prior.parentId!==expectedParentId))throw new AppError('CONFLICT');
   if(prior?.id===id&&!fresh){if(prior.target.workspaceId!==this.targetRegistry.workspaceId||prior.placement.parentId!==parentId||prior.parentId!==expectedParentId)throw new AppError('CONFLICT');return this.finish(prior,storage.vault,{check,checkpoint});}
   const current=await this.registry.state(this.projectId),entry=current.state==='active'?current.entry:null;
   if(!entry||entry.root!==storage.root||entry.vaultId!==storage.vault?.id||entry.parentId!==expectedParentId)throw new AppError('CONFLICT');
   const source=await realpath(storage.root),parent=await this.parent(parentId),destination=storageCreationPath(parent,path.basename(source));
   if(source!==storage.root||path.dirname(source)!==(entry.parentId===null?this.registry.workspace.root:(await this.registry.state(entry.parentId)).entry?.root))throw new AppError('STORAGE_PATH');
   if(await assertRegular(destination,{directory:true,missing:true}))throw new AppError('EXISTS');
   if(fresh)await this.discardPrepared(prior,storage.vault);
   const {projects,books}=this.helpers(storage);let value;
   try{
    await projects.prepare(withProject,withBook);await books.prepare(typeof withBook==='function'?(bookId,use)=>withBook(storage,bookId,use):undefined);
    await assertRenameDatabaseOwners(source,[...books.books.map(book=>path.join(source,book.directory)),...projects.projects.flatMap(item=>{const root=nestedRenameRoot(source,item.relative);return [root,...projects.bookOwners.get(item.projectId).books.map(book=>path.join(root,book.directory))];})]);
    await projects.withStorageHandoff(()=>books.withStorageHandoff(()=>storage.withStorageHandoff(()=>projects.withDirectoryHandoff(()=>withProjectMembership(this.targetRegistry,[parentId],()=>withWriterLease(path.join(source,'.observanda/lab-books.lock'),async()=>{
     await check();await assertProjectCreationSettled(this.targetRegistry,[parentId]);await assertProjectRelocationsSettled(this.targetRegistry,[parentId]);
     const latest=await this.registry.inspect(async view=>{const selected=[];for(const id of [this.projectId,...projects.projects.map(item=>item.projectId)]){const row=await view.get(id);if(row?.state!=='active')throw new AppError('CONFLICT');selected.push(row.entry);}return {revision:view.revision,selected};});if(latest.revision!==projects.revision||!same(entry,latest.selected[0])||await this.parent(parentId)!==parent)throw new AppError('CONFLICT');
     const {metadata}=await storage.outline();if(metadata.id!==entry.namespaceId||metadata.projects[0].title!==path.basename(source))throw new AppError('CONFLICT');authenticateKeyring((await readAccess(source)).value,storage.vault);
     value={version:1,id,workspaceId:this.registry.workspaceId,projectId:this.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,parentId:entry.parentId,placement:{parentId,expectedParentId},source:relative(this.registry.workspace.root,source),destination:relative(this.targetRegistry.workspace.root,destination),identity:directoryIdentity(await assertRegular(source,{directory:true})),accessHash:await fingerprint(path.join(source,'.observanda/access.json')),descriptorHash:await fingerprint(await workspaceFile(source)),phase:'prepared',rootBooks:{},entries:latest.selected.map(({root,...item})=>({...item,relative:relative(source,root)})),target:{root:this.targetRegistry.workspace.root,workspaceId:this.targetRegistry.workspaceId,vaultId:this.targetRegistry.workspace.vault.id,identity:await projectMoveDirectory(this.targetRegistry.workspace.root),parentRelative:relative(this.targetRegistry.workspace.root,parent),parentIdentity:await projectMoveDirectory(parent)}};
     await this.checkTarget(value);await projects.persist(value);await books.persist(id,value.rootBooks);await admitWorkspaceProjectTree(this.targetRegistry,value,destination,{fresh:true});await this.save(value);
     await reserveIncomingProjectMove(this.targetRegistry,value);await checkpoint('prepared',value);await atomicWrite(path.join(source,RENAME_MARKER),serialize({version:1,placement:true,id,source,destination}));
    }),{wait:false}),{parents:[entry.parentId],except:this.projectId}),{existing:true})));
    value.phase='frozen';await this.save(value);await checkpoint('frozen',value);return await this.finish(value,storage.vault,{check,checkpoint});
   }finally{projects.close();books.close();}
  }));
 }
 async discardPrepared(value,vault){
  if(value.ownerDirectoryVersion===2){await new NativeRelocationOwners(this,value,vault).discardPrepared();return releaseIncomingProjectMove(this.targetRegistry,value);}
  const root=this.scope(value).source,stat=await assertRegular(root,{directory:true});if(!sameDirectory(directoryIdentity(stat),value.identity)||await realpath(root)!==root||await workspaceRename(root))throw new AppError('STORAGE_MOVE_STATE');authenticateKeyring((await readAccess(root)).value,vault);
  for(const [owner,name,expected] of [[root,RENAME_KEYS_FILE,value.projectKeysHash],[root,RENAME_BOOK_KEYS_FILE,value.rootBooks.bookKeysHash],...(value.projects??[]).map(item=>[nestedRenameRoot(root,item.relative),RENAME_KEYS_FILE,item.bookKeysHash])]){
   if(!expected)continue;const file=path.join(owner,name);if(await assertRegular(file,{missing:true})){if(await fingerprint(file)!==expected)throw new AppError('STORAGE_MOVE_STATE');await unlink(file);}
  }
  await releaseIncomingProjectMove(this.targetRegistry,value);
 }
 async resume(vault,options={}){
  const value=await this.read();if(!value||value.phase==='cancelled')return null;
  if(value.ownerDirectoryVersion===2)return new NativeProjectRelocation(this).resume(vault,options);
  if(value.phase==='prepared'&&!await workspaceRename(this.scope(value).source))return this.run(new ProjectStorage(this.scope(value).source,this.projectId,vault),{...options,id:value.id,parentId:value.placement.parentId,expectedParentId:value.parentId});
  await this.authorizeParent(value.placement.parentId,options.withParent);
  return trackProjectTransfer(projectWorkspaceMoveFile(this.registry,this.projectId),()=>withProjectLifecycle(this.registry,this.projectId,'workspace-move',async()=>{const latest=await this.read();return latest?this.finish(latest,vault,options):null;}));
 }
 async verify(value,vault){
  const storage=new ProjectStorage(this.scope(value).destination,this.projectId,vault),{projects,books}=this.helpers(storage,value);
  try{await projects.load(this.scope(value));await books.load(value.id,value.rootBooks);if((await storage.outline()).metadata.id!==value.namespaceId)throw new AppError('DATABASE_LOCATION');await projects.verify();await books.verify();}finally{projects.close();books.close();}
 }
 async finish(value,vault,{check=async()=>{},checkpoint=async()=>{}}={}){
  if(value.ownerDirectoryVersion===2)return new NativeProjectRelocation(this).finish(value,vault,{check,checkpoint});
  if(vault?.id!==value.vaultId)throw new AppError('ACCESS_DENIED');
  return renameScope(value.id,async()=>{
   await check();await this.checkTarget(value);
   // Reopening also reclaims this installation's orphaned destination runtime
   // after termination, including recovery after membership was published.
   if((await this.targetRegistry.workspace.outline()).metadata.id!==value.target.workspaceId)throw new AppError('DATABASE_LOCATION');
   const scope=this.scope(value),command={scope:item=>this.scope(item),save:item=>this.save(item),helpers:storage=>this.helpers(storage,value)},transfer=new ProjectPlacementTransfer(command,value,vault,{check,checkpoint});
   if(!['departed','complete'].includes(value.phase)){
    await reserveIncomingProjectMove(this.targetRegistry,value);
    if(value.phase==='copying')await transfer.copy();
    let root=await this.locate(value);authenticateKeyring((await readAccess(root)).value,vault);
    if(root===scope.source){
     if((await workspaceRename(root))?.id!==value.id)throw new AppError('STORAGE_MOVE_STATE');
     const storage=new ProjectStorage(root,this.projectId,vault),{projects,books}=this.helpers(storage,value);
     try{await projects.load(scope);await books.load(value.id,value.rootBooks);await projects.freezeAndStop(scope,{checkpoint});await books.freezeAndStop(scope,{checkpoint});}finally{projects.close();books.close();}
     const provider=databaseProvider();if(!provider?.stopProjectForRename)throw new AppError('DATABASE_LOCATION');await operationStage('rename-close-project',{},()=>provider.stopProjectForRename(root,this.projectId,vault,value.id));
     const lease=await workspaceDatabaseLease(path.join(root,'.observanda/postgresql'));
     try{await assertProjectDatabaseStopped(root,this.projectId,vault);if(await this.locate(value)!==root||await fingerprint(await workspaceFile(root))!==value.descriptorHash)throw new AppError('STORAGE_MOVE_STATE');await check();await this.checkTarget(value);if(await assertRegular(scope.destination,{directory:true,missing:true}))throw new AppError('EXISTS');await checkpoint('stopped',value);}finally{await lease.close();}
     try{await operationStage('place-project-folder',{},()=>rename(root,scope.destination));}catch(error){if(error.code!=='EXDEV')throw error;await transfer.begin();await transfer.copy();}
     await checkpoint('folder-moved',value);value.phase='moved';await this.save(value);
    }
    if(value.version===2)await transfer.activate();
    if(['prepared','frozen','moved'].includes(value.phase)){
     await operationStage('move-project-verify',{},()=>this.verify(value,vault));await this.checkTarget(value);await operationStage('move-project-register',{},()=>publishWorkspaceProjectTree(this.targetRegistry,value,transfer,{check,checkpoint}));value.phase='registered';await this.save(value);await checkpoint('registered',value);
    }
    if(value.version===2&&['registered','retiring','retired'].includes(value.phase))await transfer.retire();
    if(!['registered','retired','departing'].includes(value.phase))throw new AppError('STORAGE_MOVE_STATE');
    value.phase='departing';await this.save(value);await this.checkTarget(value);await operationStage('move-project-verify',{},()=>this.verify(value,vault));if(value.version===2)await transfer.using(scope.destination,owners=>transfer.targets(owners));
    await admitWorkspaceProjectTree(this.targetRegistry,value,scope.destination);await checkpoint('departing',value);await check();
    const entries=value.entries.map(({relative:suffix,...entry})=>({...entry,root:path.join(scope.source,...suffix.split('/'))}));
    await operationStage('move-project-departure',{},()=>recordProjectDeparture(this.registry,entries,{workspaceId:this.targetRegistry.workspaceId,operationId:value.id}));await checkpoint('source-directory',value);value.phase='departed';await this.save(value);await checkpoint('departed',value);
   }
   if(value.phase!=='complete'){await operationStage('move-project-release',{},()=>this.clear(value));await checkpoint('unfrozen',value);value.phase='complete';await this.save(value);await checkpoint('complete',value);}
   await releaseIncomingProjectMove(this.targetRegistry,value);await checkpoint('released',value);value.released=true;await this.save(value);
   return {id:value.id,complete:true,workspaceId:this.targetRegistry.workspaceId,project:movedProjectEntries(value,scope.destination)[0]};
  });
 }
 async clear(value){
  const scope=this.scope(value),root=await this.locate(value);if(root!==scope.destination)throw new AppError('STORAGE_MOVE_STATE');
  await this.targetRegistry.inspect(async view=>{for(const entry of movedProjectEntries(value,root)){const row=await view.get(entry.projectId);if(row?.state!=='active'||!same(entry,row.entry))throw new AppError('CONFLICT');}});
  await clearRenamedProjects(root,scope);await clearRenamedBooks(root,{...value.rootBooks,projectId:this.projectId},scope,RENAME_BOOK_KEYS_FILE);
  const marker=await workspaceRename(root);if(marker){if(marker.id!==value.id)throw new AppError('STORAGE_MOVE_STATE');await unlink(path.join(root,RENAME_MARKER));}
 }
}
