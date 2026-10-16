import {ProjectBookCopy} from './project-book-copy.js';
import {copyProjectAdoptions,reconcileCopiedProjectConversions} from './workspace-project-conversion-copy.js';
import {retainCopiedProjectCommands} from './workspace-project-continuations.js';
import {readAccess} from './access.js';
// A workspace copy includes its registered independent owners. File copying
// excludes nested owners; each project's own transfer verifies its database.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectCopyRoots} from './project-copy-boundaries.js';
import {WorkspaceCopyRecovery} from './workspace-copy-recovery.js';
import {ProjectRegistry} from './project-registry.js';
import {copyProjectLocation,projectTransferReceipt} from './project-transfer.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {copyPlan,copyWorkspace,transferDestination,resolveLocation} from './locations.js';
import {databaseProvider} from './workspace-database-context.js';
import {privateDirectory,serialize,assertRegular} from './storage.js';
import {operationStage,operationAdvance,operationItem,operationTransfer} from './operation-progress.js';
import {AppError} from './errors.js';
const within=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const same=(a,b)=>['projectId','root','namespaceId','vaultId'].every(key=>a?.[key]===b?.[key]);

export class WorkspaceProjectCopy {
  constructor(source,{withProject,withBook,onCopiedBook=async()=>{},onCopiedProject=async()=>{},check=async()=>{},checkpoint=async()=>{}}={}){this.source=source;this.withProject=withProject;this.withBook=withBook;this.onCopiedBook=onCopiedBook;this.onCopiedProject=onCopiedProject;this.check=check;this.checkpoint=checkpoint;}
  async prepare(destination,{portable=false}={}) {
    await this.check();
    const outline=await this.source.outline();this.sourceRevision=outline.etag;
    this.registry=new ProjectRegistry(this.source,outline.metadata.id);
    const original=await this.registry.read();
    if(original.value.projects.length&&typeof this.withProject!=='function')throw new AppError('ACCESS_LOCKED');
    for(const entry of original.value.projects) {
      if(within(entry.root,destination)||within(destination,entry.root))throw new AppError('STORAGE_PATH');
      await this.withProject(entry.projectId,async storage=>{
        await this.check();
        if(portable){const access=await readAccess(storage.root);if(!access.value.password&&!access.value.recovery)throw new AppError('STORAGE_PORTABLE_PROJECT_ACCESS',[entry.summary?.title??path.basename(entry.root)]);}
        const metadata=(await storage.outline()).metadata;
        if(!same(entry,{projectId:storage.projectId,root:storage.root,vaultId:storage.vault.id,namespaceId:metadata.id}))throw new AppError('CONFLICT');
        const books=new ProjectBookCopy(storage);try{await books.prepare(typeof this.withBook==='function'?(id,use)=>this.withBook(storage,id,use):undefined,{portable});}finally{books.close();}
      });
    }
    // Opening a selected owner can refresh its display cache. Establish the
    // copy receipt after those authenticated reads, and recheck membership.
    const current=await this.registry.read();
    if(current.value.projects.length!==original.value.projects.length||original.value.projects.some(entry=>!same(entry,current.value.projects.find(other=>other.projectId===entry.projectId))))throw new AppError('CONFLICT');
    this.directory=current;this.projectRoots=current.value.projects.map(entry=>entry.root).filter(root=>within(this.source.root,root));
    await this.check();return current;
  }
  async plan(input,{inspect=true,onProgress,portable=false}={}) {
    const destination=await resolveLocation(input),recovery=new WorkspaceCopyRecovery(this.source,destination),retained=await recovery.plan();
    if(retained){if(!!retained.portable!==portable)throw new AppError('CONFLICT');await this.prepare(destination,{portable});return retained;}
    const emptyPreparation=await recovery.emptyPreparation(),location=emptyPreparation?{source:this.source.root,destination,inventorySalt:randomUUID()}:await transferDestination(this.source.root,input);await this.prepare(location.destination,{portable});
    const plan=inspect&&!emptyPreparation?await copyPlan(this.source.root,input,{vault:this.source.vault,onProgress,projectRoots:this.projectRoots}):location;
    return {...plan,...(portable?{portable:true}:{}),projectRoots:this.projectRoots,projectRegistryRevision:this.directory.revision,sourceRevision:this.sourceRevision};
  }
  async exportPortable(input) {
    const destination=await resolveLocation(input),recovery=new WorkspaceCopyRecovery(this.source,destination),retained=await recovery.read();
    if(retained?.phase==='published'&&retained.plan.portable===true){
      if(await assertRegular(recovery.marker,{missing:true}))throw new AppError('STORAGE_INCOMPLETE');return destination;
    }
    return this.copy(await this.plan(destination,{portable:true,inspect:false}));
  }
  async copy(plan,options={}) {
    if(plan.source!==this.source.root)throw new AppError('WORKSPACE_CHANGED');
    const portable=plan.portable===true;if(portable&&options.activateCatalogue)throw new AppError('INVALID');
    await this.prepare(plan.destination,{portable});
    const recovery=new WorkspaceCopyRecovery(this.source,plan.destination,{checkpoint:this.checkpoint}),retained=await recovery.read();
    if(!retained&&plan.sourceRevision!==undefined&&plan.sourceRevision!==this.sourceRevision)throw new AppError('CONFLICT');
    if(retained){
      this.registry.validate(retained.directory.value);
      const entries=retained.directory.value.projects;
      if(entries.length!==this.directory.value.projects.length||entries.some(entry=>!same(entry,this.directory.value.projects.find(other=>other.projectId===entry.projectId))))throw new AppError('CONFLICT');
      this.directory=retained.directory;this.projectRoots=retained.plan.projectRoots??[];
    }
    if(plan.projectRegistryRevision!==undefined&&plan.projectRegistryRevision!==this.directory.revision)throw new AppError('CONFLICT');
    const {beforePublish,beforeSnapshot,afterSnapshotVerified,...rest}=options;
    return recovery.run({...plan,projectRoots:this.projectRoots},this.directory,async checkpoint=>copyWorkspace({...checkpoint.state.plan,projectRoots:this.projectRoots},{
      ...rest,recovery:checkpoint,vault:this.source.vault,
      beforeSnapshot:async()=>{await copyProjectAdoptions(this.source,this.directory);if(beforeSnapshot)await beforeSnapshot();},
      afterSnapshotVerified:async destination=>{
        checkpoint.state.adoptions=await copyProjectAdoptions(this.source,this.directory);
        if(afterSnapshotVerified)await afterSnapshotVerified(destination);
      },
      beforePublish:async target=>{
        await this.copyProjects(target,checkpoint,{portable});
        const adoptions=checkpoint.state.adoptions??await copyProjectAdoptions(this.source,this.directory);
        await reconcileCopiedProjectConversions(target,this.registry.workspaceId,adoptions,checkpoint.state.id,{checkpoint:this.checkpoint});
        await retainCopiedProjectCommands(target,checkpoint.state.id,{checkpoint:this.checkpoint});
        if(beforePublish)await beforePublish(target);
      }
    }));
  }
  async copyProjects(target,recovery,{portable=false}={}) {
    const copied=new ProjectRegistry(target,this.registry.workspaceId),initial=await copied.read();
    if(!this.directory.value.projects.length)return;
    const locations=new Map();operationTransfer(null);
    await operationStage('copy-workspace-projects',{unit:'projects',total:this.directory.value.projects.length},async()=>{
      for(const entry of [...this.directory.value.projects].sort((a,b)=>a.root.length-b.root.length)) {
        await this.check();
        const relative=within(this.source.root,entry.root)?path.relative(this.source.root,entry.root):path.join('projects',entry.projectId,path.basename(entry.root));
        if(!relative||relative==='.observanda')throw new AppError('STORAGE_PATH');
        const destination=path.resolve(target.root,relative);
        if(!within(target.root,destination)||destination===target.root)throw new AppError('STORAGE_PATH');
        if(path.dirname(relative)!=='.')await privateDirectory(target.root,path.dirname(relative).split(path.sep).join('/'));
        const name=entry.summary?.title??path.basename(entry.root);operationItem(name);
        operationTransfer({phase:'checking',files:0,bytes:0,owner:name});
        try {await withProjectLifecycle(this.registry,entry.projectId,'copy',()=>this.withProject(entry.projectId,async storage=>{
          if(!same(entry,await this.registry.locate(entry.projectId))||storage.root!==entry.root||storage.vault.id!==entry.vaultId)throw new AppError('CONFLICT');
          const owner=await copyProjectLocation(storage,destination,{id:recovery.transferId(entry.projectId),portable,withBook:typeof this.withBook==='function'?(id,use)=>this.withBook(storage,id,use):undefined,onCopiedBook:this.onCopiedBook,projectRoots:projectCopyRoots(entry.root,this.directory.value.projects),checkpoint:(stage,file)=>this.checkpoint('project-'+stage,{projectId:entry.projectId,file})});
          try {
            const metadata=portable?{id:(await projectTransferReceipt(owner)).namespaceId}:(await owner.outline()).metadata;
            if(metadata.id!==entry.namespaceId||owner.projectId!==entry.projectId)throw new AppError('DATABASE_LOCATION');
            if(!portable)await this.onCopiedProject(owner);
          } finally {
            // The completed bundle carries cleanly stopped project databases.
            // Only the newly created destination instance is closed.
            await databaseProvider()?.closeProject(destination);
          }
          await this.check();locations.set(entry.projectId,destination);
        }));}finally{operationTransfer(null);}
        await this.checkpoint('project',entry.projectId);operationAdvance();
      }
    });
    const expected=structuredClone(this.directory.value);expected.version=6;expected.deleted??=[];expected.aliases??=null;
    for(const entry of expected.projects){entry.summary??=null;entry.root=locations.get(entry.projectId);}
    // Publishing the registry and recording the bundle checkpoint are separate
    // atomic writes. Accept the exact already-published registry on recovery.
    if(serialize(initial.value)===serialize(expected))return;
    if(initial.revision!==this.directory.revision)throw new AppError('CONFLICT');
    const next=await copied.change(initial.revision,()=>expected);
    await this.checkpoint('workspace-registry');
    if(next.value.projects.some(entry=>!within(target.root,entry.root)))throw new AppError('STORAGE_COPY');
    // Every source identity and parent remains the same; only its physical
    // destination changes. The registry encodes these destinations relatively.
    const withoutRoots=value=>value.projects.map(({root,...entry})=>entry);
    if(serialize(withoutRoots(next.value))!==serialize(withoutRoots(initial.value)))throw new AppError('STORAGE_COPY');
  }
}
