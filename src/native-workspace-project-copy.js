// Current workspace copies retain one authenticated directory pin. Independent
// owners and their destinations stream through the existing transfer engine.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {Workspace,privateDirectory,assertRegular,serialize,digest,workspaceFile} from './storage.js';
import {ProjectRegistry} from './project-registry.js';
import {NativeOwnerDirectory} from './owner-directory.js';
import {WorkspaceCopyRecovery} from './workspace-copy-recovery.js';
import {captureWorkspaceCopyDirectory,withWorkspaceCopyDirectory,visitWorkspaceCopyPlacements,workspaceCopyExclusion,workspaceCopyChildRoots} from './workspace-copy-directory.js';
import {assertInventoryObligationsSettled} from './inventory-obligation-lifecycle.js';
import {assertProjectRelocationsSettled} from './project-membership.js';
import {ProjectBookCopy} from './project-book-copy.js';
import {readAccess} from './access.js';
import {copyPlan,copyWorkspace,encryptedCopy,transferDestination,resolveLocation} from './locations.js';
import {copyProjectLocation,projectTransferReceipt} from './project-transfer.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {databaseProvider} from './workspace-database-context.js';
import {backupCatalogue} from './postgres.js';
import {validateNativeCopyAdoptions,reconcileNativeCopiedProjectConversions} from './workspace-project-conversion-copy.js';
import {retainCopiedProjectCommands} from './workspace-project-continuations.js';
import {operationStage,operationAdvance,operationItem,operationTransfer} from './operation-progress.js';
const within=(parent,child)=>{const r=path.relative(parent,child);return r===''||r!=='..'&&!r.startsWith('..'+path.sep)&&!path.isAbsolute(r);};
const same=(a,b)=>['projectId','root','namespaceId','vaultId','parentId'].every(key=>a?.[key]===b?.[key]);
export class NativeWorkspaceProjectCopy{
 constructor(owner){this.owner=owner;this.source=owner.source;}
 async matching(left,right){return withWorkspaceCopyDirectory(this.source,left,first=>withWorkspaceCopyDirectory(this.source,right,async second=>{
  if(first.count!==second.count)throw new AppError('CONFLICT');for await(const {entry} of first.entries()){const row=await second.get(entry.projectId);if(row?.state!=='active'||!same(entry,row.entry))throw new AppError('CONFLICT');}
 }));}
 async prepare(destination,{portable=false}={}){
  const owner=this.owner;await owner.check();await assertInventoryObligationsSettled(this.source);const outline=await this.source.outline();this.sourceRevision=outline.etag;this.registry=new ProjectRegistry(this.source,outline.metadata.id);
  const original=await captureWorkspaceCopyDirectory(this.registry);
  await withWorkspaceCopyDirectory(this.source,original,async view=>{
   if(view.count&&typeof owner.withProject!=='function')throw new AppError('ACCESS_LOCKED');await assertProjectRelocationsSettled(this.registry,[null]);
   await visitWorkspaceCopyPlacements(view,this.source.root,destination,async entry=>{
    if(within(entry.root,destination)||within(destination,entry.root))throw new AppError('STORAGE_PATH');await assertProjectRelocationsSettled(this.registry,[entry.projectId]);
    await owner.withProject(entry.projectId,async storage=>{
     await owner.check();if(portable){const access=await readAccess(storage.root);if(!access.value.password&&!access.value.recovery)throw new AppError('STORAGE_PORTABLE_PROJECT_ACCESS',[entry.summary?.title??path.basename(entry.root)]);}
     const metadata=(await storage.outline()).metadata;if(!same(entry,{projectId:storage.projectId,root:storage.root,vaultId:storage.vault.id,namespaceId:metadata.id,parentId:entry.parentId}))throw new AppError('CONFLICT');
     const books=new ProjectBookCopy(storage);try{await books.prepare(typeof owner.withBook==='function'?(id,use)=>owner.withBook(storage,id,use):undefined,{portable});}finally{books.close();}
    });
   });
  });
  this.directory=await captureWorkspaceCopyDirectory(this.registry);await this.matching(original,this.directory);await owner.check();return this.directory;
 }
 async plan(input,{inspect=true,onProgress,portable=false}={}){
  const destination=await resolveLocation(input),recovery=new WorkspaceCopyRecovery(this.source,destination),retained=await recovery.plan();
  if(retained){if(!!retained.portable!==portable)throw new AppError('CONFLICT');await this.prepare(destination,{portable});return retained;}
  const empty=await recovery.emptyPreparation(),location=empty?{source:this.source.root,destination,inventorySalt:randomUUID()}:await transferDestination(this.source.root,input);await this.prepare(destination,{portable});
  const plan=inspect&&!empty?await withWorkspaceCopyDirectory(this.source,this.directory,view=>copyPlan(this.source.root,input,{vault:this.source.vault,onProgress,excludeProject:workspaceCopyExclusion(view,this.source.root)})):location;
  return {...plan,projectPlacement:2,...(portable?{portable:true}:{}),projectRegistryRevision:this.directory.revision,sourceRevision:this.sourceRevision};
 }
 async exportPortable(input){
  const destination=await resolveLocation(input),recovery=new WorkspaceCopyRecovery(this.source,destination),retained=await recovery.read();
  if(retained?.phase==='published'&&retained.plan.portable===true){
   if(await assertRegular(recovery.marker,{missing:true}))throw new AppError('STORAGE_INCOMPLETE');
   // The completed bundle owns the pinned directory too. Rebase its decoded
   // relative locations to the original source only for placement validation;
   // successful export recovery must not require the original source folder.
   await withWorkspaceCopyDirectory(recovery.target,retained.directory,view=>{
    const rowAtSource=row=>row?{...row,entry:{...row.entry,root:within(destination,row.entry.root)?path.join(this.source.root,path.relative(destination,row.entry.root)):row.entry.root}}:row;
    const sourceView={...view,get:async(...args)=>rowAtSource(await view.get(...args)),entries:async function*(options){for await(const row of view.entries(options))yield rowAtSource(row);}};
    return visitWorkspaceCopyPlacements(sourceView,this.source.root,destination,async()=>{});
   });return destination;
  }
  return this.copy(await this.plan(destination,{portable:true,inspect:false}));
 }
 async copy(plan,options={}){
  if(plan.source!==this.source.root)throw new AppError('WORKSPACE_CHANGED');const owner=this.owner,portable=plan.portable===true,encryption=options.encryption;
  if(portable&&(options.activateCatalogue||encryption)||!!plan.encrypted!==!!encryption)throw new AppError('INVALID');await this.prepare(plan.destination,{portable});
  const recovery=new WorkspaceCopyRecovery(this.source,plan.destination,{checkpoint:owner.checkpoint,encryptionAccess:encryption?.access}),retained=await recovery.read();
  if(!retained&&plan.sourceRevision!==undefined&&plan.sourceRevision!==this.sourceRevision)throw new AppError('CONFLICT');
  if(retained){if(retained.version!==4||!!retained.plan.encrypted!==!!encryption)throw new AppError('CONFLICT');await this.matching(retained.directory,this.directory);this.directory=retained.directory;}
  if(plan.projectRegistryRevision!==undefined&&plan.projectRegistryRevision!==this.directory.revision)throw new AppError('CONFLICT');plan={...plan,projectRegistryRevision:this.directory.revision};
  const {beforePublish,beforeSnapshot,afterSnapshotVerified,encryption:ignored,...rest}=options,copy=encryption?(saved,settings)=>encryptedCopy(saved,encryption.access,encryption.vault,this.source.vault,settings):copyWorkspace;
  return withWorkspaceCopyDirectory(this.source,this.directory,view=>recovery.run(plan,this.directory,checkpoint=>copy(checkpoint.state.plan,{
   ...rest,recovery:checkpoint,vault:this.source.vault,excludeProject:workspaceCopyExclusion(view,this.source.root),
   beforeSnapshot:async()=>{await validateNativeCopyAdoptions(this.source,this.directory,{current:true});if(beforeSnapshot)await beforeSnapshot();},
   afterSnapshotVerified:async destination=>{if(afterSnapshotVerified)await afterSnapshotVerified(destination);},
   beforePublish:async target=>{await this.copyProjects(target,checkpoint,{portable});if(beforePublish)await beforePublish(target);}
  })));
 }
 async copyProjects(target,recovery,{portable=false}={}){
  const owner=this.owner,pin=this.directory;operationTransfer(null);
  await withWorkspaceCopyDirectory(this.source,pin,view=>operationStage('copy-workspace-projects',{unit:'projects',total:view.count},()=>visitWorkspaceCopyPlacements(view,this.source.root,target.root,async entry=>{
   await owner.check();const destination=entry.destination,relative=path.relative(target.root,destination);if(!relative||!within(target.root,destination))throw new AppError('STORAGE_PATH');if(path.dirname(relative)!=='.')await privateDirectory(target.root,path.dirname(relative).split(path.sep).join('/'));
   const name=entry.summary?.title??path.basename(entry.root);operationItem(name);operationTransfer({phase:'checking',files:0,bytes:0,owner:name});
   try{await withProjectLifecycle(this.registry,entry.projectId,'copy',()=>owner.withProject(entry.projectId,async storage=>{
    if(!same(entry,await this.registry.locate(entry.projectId))||storage.root!==entry.root||storage.vault.id!==entry.vaultId)throw new AppError('CONFLICT');
    const copied=await copyProjectLocation(storage,destination,{id:recovery.transferId(entry.projectId),portable,withBook:typeof owner.withBook==='function'?(id,use)=>owner.withBook(storage,id,use):undefined,onCopiedBook:owner.onCopiedBook,projectRoots:await workspaceCopyChildRoots(view,this.source.root,entry.root),checkpoint:(stage,file)=>owner.checkpoint('project-'+stage,{projectId:entry.projectId,file})});
    try{const namespace=portable?(await projectTransferReceipt(copied)).namespaceId:(await copied.outline()).metadata.id;if(namespace!==entry.namespaceId||copied.projectId!==entry.projectId)throw new AppError('DATABASE_LOCATION');if(!portable)await owner.onCopiedProject(copied);}finally{await databaseProvider()?.closeProject(destination);}
    await owner.check();
   }));}finally{operationTransfer(null);}
   await owner.checkpoint('project',entry.projectId);operationAdvance();
  })));
  // A detached target transaction also supports archive-only portable bundles.
  // Its verified archive is written before closing the temporary schema.
  const db=await target.openCatalogue({detached:true});try{
   await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ');const store=target.catalogueStore(db);
   await target.inspectCatalogue(store,async()=>{
    await validateNativeCopyAdoptions(target,pin);const directory=new NativeOwnerDirectory(store,{kind:'projects',ownerId:pin.head.ownerId}),current=await directory.head({required:true});
    await withWorkspaceCopyDirectory(this.source,pin,async view=>{
     // Staging entries is encrypted scratch; no growing array enters the receipt.
     const {withScratch}=await import('./scratch-work.js');await withScratch(async staged=>{
      await visitWorkspaceCopyPlacements(view,this.source.root,target.root,entry=>staged.add(entry.projectId,{state:'active',entry:{...entry,root:entry.destination}}));
      const changes=async function*(){for await(const change of staged.items()){delete change.entry.destination;yield change;}};
      const expected=await directory.applyBatch(pin.head,changes()),expectedRevision=digest(serialize(expected));if(current.revision!==pin.revision&&current.revision!==expectedRevision)throw new AppError('CONFLICT');await directory.publish(expected);
     });
    });
    await reconcileNativeCopiedProjectConversions(target,pin,recovery.state.id,{checkpoint:owner.checkpoint});await retainCopiedProjectCommands(target,recovery.state.id,{checkpoint:owner.checkpoint});
    const descriptor=JSON.parse(await target.readFile(await workspaceFile(target.root),'utf8'));await store.verify(descriptor);await db.run('COMMIT');await backupCatalogue(target.root,target.root,{connection:db});
   });
  }catch(error){await db.run('ROLLBACK').catch(()=>{});throw error;}finally{await db.close();}
  await owner.checkpoint('workspace-registry');
 }
}
