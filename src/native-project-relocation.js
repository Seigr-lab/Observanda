import {persistRename} from './filesystem-persistence.js';
// A selected native relocation uses the established rename/copy phases and
// markers; only its owner inventory, keys and progress are paged.
import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {atomicReplace as rename} from './atomic-replace.js';
import {NativeRelocationOwners,nativeRelocationOwners,verifyNativeRelocationOwners} from './native-relocation-owners.js';
import {NativeRelocationTransfer} from './native-relocation-transfer.js';
import {admitNativeWorkspaceTree,publishNativeWorkspaceTree,publishNativeProjectLocation,nativeMovedProjectEntry,nativeDepartureOwners} from './native-relocation-publication.js';
import {recordProjectDeparture} from './project-relocation-directory.js';
import {reserveIncomingProjectMove,releaseIncomingProjectMove} from './project-incoming-moves.js';
import {selectedProjectPlacement,checkPlacementParent} from './project-placement.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {withProjectMembership,assertProjectCreationSettled,assertProjectRelocationsSettled} from './project-membership.js';
import {trackProjectTransfer} from './project-transfer-tasks.js';
import {projectRenameFile} from './project-rename-receipt.js';
import {projectWorkspaceMoveFile} from './project-workspace-move-state.js';
import {workspaceRename,renameScope} from './workspace-rename-state.js';
import {ProjectStorage} from './project-storage.js';
import {projectMoveDirectory} from './project-move-boundaries.js';
import {assertRegular,digest,serialize,workspaceFile} from './storage.js';
import {storageCreationPath} from './storage-names.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {validateIndexedMetadata} from './catalogue-metadata.js';
import {discardConfigurationCheckpoint} from './configuration-commands.js';
import {AppError} from './errors.js';
const fingerprint=async file=>digest(await readFile(file));
const relative=(root,file)=>path.relative(root,file).split(path.sep).join('/');
export async function locateNativeRelocation(command,value){
 const scope=command.scope(value),owner=value.copied?await nativeRelocationOwners(command.registry,value).get(''):null;
 for(const root of value.copied?[value.phase==='copying'?scope.source:scope.destination]:[scope.destination,scope.source]){
  if(!await assertRegular(root,{directory:true,missing:true}))continue;const expected=value.copied?(root===scope.source?owner.identity:owner.destinationIdentity):value.identity,actual=await projectMoveDirectory(root);
  if(actual.dev!==expected?.dev||actual.ino!==expected?.ino)continue;if(await fingerprint(path.join(root,'.observanda/access.json'))!==value.accessHash)throw new AppError('STORAGE_RENAME_STATE');return root;
 }throw new AppError('STORAGE_RENAME_STATE');
}
export class NativeProjectRelocation{
 constructor(command){this.command=command;this.registry=command.registry;this.cross=Boolean(command.targetRegistry);}
 async run(storage,options){
  const command=this.command,{id,withProject,withBook,check=async()=>{},checkpoint=async()=>{}}=options;
  if(this.cross)await command.authorizeParent(options.parentId??null,options.withParent);
  const file=this.cross?projectWorkspaceMoveFile(this.registry,command.projectId):projectRenameFile(this.registry,command.projectId);
  return trackProjectTransfer(file,()=>withProjectLifecycle(this.registry,command.projectId,this.cross?'workspace-move':'rename',async()=>{
   await check();let prior=await command.read();
   if(prior?.id===id&&prior.phase!=='preparing'&&prior.phase!=='cancelled'&&!(prior.phase==='prepared'&&!await workspaceRename(command.scope(prior).source))){
    if(this.cross?(prior.target.workspaceId!==command.targetRegistry.workspaceId||prior.placement.parentId!==(options.parentId??null)||prior.parentId!==options.expectedParentId):(path.posix.basename(prior.source)!==options.expectedName||path.posix.basename(prior.destination)!==options.name||serialize(prior.settings??null)!==serialize(options.settings??null)||serialize(prior.placement??null)!==serialize(options.placement??null)))throw new AppError('CONFLICT');
    if(prior.phase==='prepared'&&!await workspaceRename(command.scope(prior).source))await this.authorizePrepared(prior,storage.vault,{withProject,withBook});return this.finish(prior,storage.vault,{check,checkpoint});
   }
   if(prior?.id===id&&prior.phase==='cancelled'&&prior.cancelReason==='volume')throw new AppError('STORAGE_RENAME_VOLUME');
   if(prior&&!['complete','cancelled','preparing','prepared'].includes(prior.phase))throw new AppError('CONFLICT');
   if(prior&&['preparing','prepared'].includes(prior.phase)){await new NativeRelocationOwners(command,prior,storage.vault).discardPrepared();if(this.cross)await releaseIncomingProjectMove(command.targetRegistry,prior);}
   const current=await this.registry.state(command.projectId),entry=current.state==='active'?current.entry:null;
   if(!entry||entry.root!==storage.root||entry.vaultId!==storage.vault?.id||this.cross&&entry.parentId!==options.expectedParentId||!this.cross&&path.basename(entry.root)!==options.expectedName)throw new AppError('CONFLICT');
   const source=await realpath(storage.root),location=this.cross?{parent:await command.parent(options.parentId??null),parentId:options.parentId??null}:await selectedProjectPlacement(this.registry,entry,options.name,options.placement??null),destination=this.cross?storageCreationPath(location.parent,path.basename(source)):location.destination;
   if(source!==storage.root||path.dirname(source)!==(entry.parentId===null?this.registry.workspace.root:(await this.registry.state(entry.parentId)).entry?.root))throw new AppError('STORAGE_PATH');if(source===destination)return {project:entry,complete:true};
   if(await assertRegular(destination,{directory:true,missing:true})&&await realpath(destination)!==source)throw new AppError('EXISTS');
   const outline=await storage.outline();if(outline.metadata.id!==entry.namespaceId||outline.metadata.projects[0].title!==path.basename(source))throw new AppError('CONFLICT');authenticateKeyring((await readAccess(source)).value,storage.vault);
   if(options.settings){if(options.settings.etag!==outline.etag)throw new AppError('CONFLICT');await storage.catalogue(async store=>validateIndexedMetadata(store,await store.snapshot(outline.etag),{...outline.metadata,title:options.name,projects:[options.settings.project],entries:[]}));}
   const value={version:1,id,projectId:entry.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,parentId:entry.parentId,source:relative(this.registry.workspace.root,source),destination:relative(this.cross?command.targetRegistry.workspace.root:this.registry.workspace.root,destination),identity:await projectMoveDirectory(source),accessHash:await fingerprint(path.join(source,'.observanda/access.json')),descriptorHash:await fingerprint(await workspaceFile(source)),phase:'preparing',...(!this.cross?{settings:options.settings??null}:{workspaceId:this.registry.workspaceId})};
   if(this.cross){value.placement={parentId:location.parentId,expectedParentId:entry.parentId};value.target={root:command.targetRegistry.workspace.root,workspaceId:command.targetRegistry.workspaceId,vaultId:command.targetRegistry.workspace.vault.id,identity:await projectMoveDirectory(command.targetRegistry.workspace.root),parentRelative:relative(command.targetRegistry.workspace.root,location.parent),parentIdentity:await projectMoveDirectory(location.parent)};await command.checkTarget(value);}
   else if(options.placement){value.placement=options.placement;value.placementParent={relative:relative(this.registry.workspace.root,location.parent),...await projectMoveDirectory(location.parent)};}
   const selected=await NativeRelocationOwners.prepare(command,storage,value,{withProject,withBook,check});
   if(this.cross){await admitNativeWorkspaceTree(command.targetRegistry,selected,{fresh:true});await reserveIncomingProjectMove(command.targetRegistry,value,{owners:selected.owners});}
   await checkpoint('prepared',value);return this.finish(value,storage.vault,{check,checkpoint});
  }));
 }
 async authorizePrepared(value,vault,{withProject,withBook}){
  const selected=new NativeRelocationOwners(this.command,value,vault),source=this.command.scope(value).source;
  for await(const item of selected.owners.entries()){
   const check=async storage=>{if(storage.root!==path.join(source,...item.relative.split('/'))||storage.vault?.id!==item.vaultId)throw new AppError('ACCESS_DENIED');authenticateKeyring((await readAccess(storage.root)).value,storage.vault);};
   if(item.kind==='project'&&item.relative&&withProject)await withProject(item.projectId,check);
   if(item.kind==='lab-book'&&withBook){const parent=await selected.owners.find('project',item.projectId);await selected.use(source,parent,storage=>withBook(storage,item.labBookId,check));}
  }
 }
 async resume(vault,options={}){
  const value=await this.command.read();if(!value||value.phase==='cancelled')return null;
  if(value.phase==='preparing'||value.phase==='prepared'&&!await workspaceRename(this.command.scope(value).source)&&options.withProject&&options.withBook)return this.run(new ProjectStorage(this.command.scope(value).source,value.projectId,vault),{...options,id:value.id,...(this.cross?{parentId:value.placement.parentId,expectedParentId:value.parentId}:{name:path.posix.basename(value.destination),expectedName:path.posix.basename(value.source),settings:value.settings,placement:value.placement??null})});
  if(this.cross)await this.command.authorizeParent(value.placement.parentId,options.withParent);
  const file=this.cross?projectWorkspaceMoveFile(this.registry,value.projectId):projectRenameFile(this.registry,value.projectId);
  return trackProjectTransfer(file,()=>withProjectLifecycle(this.registry,value.projectId,this.cross?'workspace-move':'rename',async()=>{const latest=await this.command.read();if(latest.phase==='prepared'&&!await workspaceRename(this.command.scope(latest).source))await this.authorizePrepared(latest,vault,options);return this.finish(latest,vault,options);}));
 }
 async settings(storage,value){
  const name=path.basename(storage.root);await storage.withLock(()=>storage.catalogue(async store=>{
   const head=await store.head(),snapshot=await store.snapshot(head);if(snapshot.metadata.id!==value.namespaceId)throw new AppError('STORAGE_RENAME_STATE');
   if(snapshot.metadata.title===name&&snapshot.metadata.projects[0].title===name&&(!value.settings||serialize(snapshot.metadata.projects[0])===serialize(value.settings.project)))return;if(value.settings&&head!==value.settings.etag)throw new AppError('CONFLICT');
   const current=await store.indexed(snapshot),metadata={...current.metadata,title:name,projects:value.settings?[value.settings.project]:current.metadata.projects.map(project=>({...project,title:name}))};await store.validateMetadata(current,metadata,{records:[]});await store.commitChanges(head,current,metadata,[],{now:new Date().toISOString()});if(value.settings?.checkpoint)await discardConfigurationCheckpoint(store,{workspaceId:metadata.id,projectId:value.projectId,notebookId:null,slot:'labBookTemplate'},value.settings.checkpoint);
  }));
 }
 async finish(value,vault,{check=async()=>{},checkpoint=async()=>{}}={}){
  if(vault?.id!==value.vaultId)throw new AppError('ACCESS_DENIED');const command=this.command,scope=command.scope(value),selected=new NativeRelocationOwners(command,value,vault),transfer=new NativeRelocationTransfer(selected,{check,checkpoint});
  return renameScope(value.id,async()=>{
   const target=async()=>this.cross?command.checkTarget(value):checkPlacementParent(this.registry,value);await check();await target();
   if(value.phase==='cancelling'){await selected.clear(scope.source,{atSource:true,checkpoint});await checkpoint('cancelled',value);throw new AppError('STORAGE_RENAME_VOLUME');}
   if(value.phase!=='complete')await verifyNativeRelocationOwners(this.registry,value);
   if(this.cross&&(await command.targetRegistry.workspace.outline()).metadata.id!==value.target.workspaceId)throw new AppError('DATABASE_LOCATION');
   if(!['departed','complete'].includes(value.phase)){
    if(this.cross)await reserveIncomingProjectMove(command.targetRegistry,value,{owners:selected.owners});
    if(value.phase==='copying')await transfer.copy();let root=await locateNativeRelocation(command,value);authenticateKeyring((await readAccess(root)).value,vault);
    if(root===scope.destination&&!value.copied&&['prepared','frozen'].includes(value.phase))await persistRename(scope.source,scope.destination);
    if(root===scope.source){
     await selected.freeze({check,checkpoint});await check();await target();if(await assertRegular(scope.destination,{directory:true,missing:true})&&await realpath(scope.destination)!==scope.source)throw new AppError('EXISTS');
     try{await rename(root,scope.destination);}catch(error){if(error.code!=='EXDEV')throw error;if(!value.placement){value.phase='cancelling';value.cancelReason='volume';await command.save(value);await checkpoint('cancelling',value);await selected.current(scope.source);await selected.clear(scope.source,{atSource:true,checkpoint});await checkpoint('cancelled',value);throw new AppError('STORAGE_RENAME_VOLUME');}await transfer.begin();await transfer.copy();}
     await checkpoint(this.cross?'folder-moved':'renamed',value);value.phase='moved';await command.save(value);root=scope.destination;
    }
    if(value.copied)await transfer.activate();
    if(['prepared','frozen','moved'].includes(value.phase)){
     await selected.verify(scope.destination);await check();
     if(this.cross){await target();await publishNativeWorkspaceTree(command.targetRegistry,selected,{check,checkpoint});}
     else{await this.settings(new ProjectStorage(scope.destination,value.projectId,vault),value);await checkpoint('metadata',value);await publishNativeProjectLocation(this.registry,selected);}
     value.phase='registered';await command.save(value);await checkpoint('registered',value);
    }
    if(value.copied&&['registered','retiring','retired'].includes(value.phase))await transfer.retire();
    if(this.cross){
     if(!['registered','retired','departing'].includes(value.phase))throw new AppError('STORAGE_MOVE_STATE');value.phase='departing';await command.save(value);await target();await selected.verify(scope.destination);if(value.copied)await transfer.verify();await admitNativeWorkspaceTree(command.targetRegistry,selected);await checkpoint('departing',value);await check();
     await recordProjectDeparture(this.registry,nativeDepartureOwners(selected),{workspaceId:command.targetRegistry.workspaceId,operationId:value.id});await checkpoint('source-directory',value);value.phase='departed';await command.save(value);await checkpoint('departed',value);
    }
   }
   if(this.cross&&value.phase!=='complete')await selected.clear(scope.destination,{checkpoint});
   if(value.phase!=='complete'){value.phase='complete';await command.save(value);await checkpoint('complete',value);}
   await selected.clear(scope.destination,{checkpoint});if(this.cross){await releaseIncomingProjectMove(command.targetRegistry,value);await checkpoint('released',value);value.released=true;await command.save(value);}
   return {id:value.id,complete:true,...(this.cross?{workspaceId:value.target.workspaceId}:{}),project:await (this.cross?command.targetRegistry:this.registry).locate(value.projectId)};
  });
 }
}
