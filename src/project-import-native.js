// Bounded selected-project adoption. Control receipts contain native roots;
// credentials are opened one independent owner at a time.
import path from 'node:path';
import {unlink} from 'node:fs/promises';
import {ProjectImportInventory,importOwnerStorage} from './project-import-inventory.js';
import {projectImportFile,projectImportOwners,saveProjectImport,reserveProjectImport} from './project-import-state.js';
import {createPortabilityCollection} from './portability-collection.js';
import {projectTreeCollection,writeProjectTree} from './project-tree-manifest.js';
import {ProjectStorage} from './project-storage.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {copyProjectOwnerLocation} from './project-transfer.js';
import {copyLabBookLocation} from './lab-book-transfer.js';
import {withProjectMembership} from './project-membership.js';
import {projectPortableReferences} from './project-portable-references.js';
import {ProjectReferenceAliases} from './project-reference-aliases.js';
import {acceptRelocatedProject} from './project-relocation-directory.js';
import {assertRegular,privateDirectory,serialize,digest} from './storage.js';
import {catalogueBinding,CATALOGUE_ARCHIVE} from './postgres-activation.js';
import {hashWorkspaceFile} from './workspace-inventory.js';
import {databaseProvider} from './workspace-database-context.js';
import {assertInventoryObligationsSettled} from './inventory-obligation-lifecycle.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {withWriterLease} from './writer-lease.js';
import {resolveLocation} from './locations.js';
import {storageCreationPath,storageFolderName} from './storage-names.js';
import {trackProjectTransfer} from './project-transfer-tasks.js';
import {withScratch} from './scratch-work.js';
import {withOperationProgress,operationStage,operationSequence,operationItem,operationAdvance} from './operation-progress.js';
import {AppError} from './errors.js';
const inside=(root,child)=>{const relative=path.relative(root,child);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const ownerRoot=(root,entry)=>path.join(root,...entry.relative.split('/'));
export class NativeProjectImport{
 constructor(owner){this.owner=owner;this.registry=owner.registry;this.workspace=owner.workspace;}
 async use(inventory,root,entry,operation,{complete=false}={}){const {vault}=await inventory.unlock(ownerRoot(root,entry),entry.relative,complete?{vaultId:entry.vaultId}:entry);try{const storage=importOwnerStorage(ownerRoot(root,entry),entry,vault);return await storage.withCatalogueConnections(()=>operation(storage));}finally{inventory.forget(entry.relative);}}
 run(command,options,supplied){return this.workspace.withCatalogueConnections(()=>this.perform(command,options,supplied));}
 async perform(command,{resume=false,check=async()=>{},checkpoint=async()=>{},opened=async()=>{},onProgress}={},supplied){
  const owner=this.owner,inventory=new ProjectImportInventory(owner.deviceStore,supplied),directory=await privateDirectory(this.workspace.root,'.observanda/project-imports');
  try{return await trackProjectTransfer(projectImportFile(this.registry,command.id),()=>withWriterLease(path.join(directory,command.id+'.lock'),async()=>{
   await check();let value=await owner.read(command.id);const fresh=!value||value.accessOnly===true;if(value?.phase==='cancelled')return owner.cancelled(value);if(value?.phase==='cancelling')throw new AppError('STORAGE_INCOMPLETE');if(resume&&!value)throw new AppError('NOT_FOUND');
   if(fresh){
    const authorization=value?.access,prior=value;
    if(prior){command={...command,path:prior.source,parentId:prior.parentId};if(serialize(identity(await assertRegular(prior.source,{directory:true})))!==serialize(prior.sourceIdentity))throw new AppError('CONFLICT');}
    if(typeof command.path!=='string')throw new AppError('INVALID');const source=await resolveLocation(command.path);if(inside(source,this.workspace.root))throw new AppError('STORAGE_PATH');
    const parentId=command.parentId??null,destination=storageCreationPath(await owner.parent(parentId),storageFolderName(source));if(source!==destination&&(inside(this.workspace.root,source)||inside(source,destination)||inside(destination,source)))throw new AppError('STORAGE_PATH');
    const inspected=await inventory.inspectNative(source,this.workspace,{id:command.id});value={version:2,id:command.id,source,destination,parentId,sourceIdentity:identity(await assertRegular(source,{directory:true})),destinationIdentity:null,manifest:inspected.manifest,owners:inspected.owners,phase:'prepared',...(authorization?{access:authorization}:{})};
   }else if(command.path!==undefined&&await resolveLocation(command.path)!==value.source||command.parentId!==undefined&&command.parentId!==value.parentId)throw new AppError('CONFLICT');
   const owners=projectImportOwners(this.registry,value);
   // Authenticate the complete command before admitting any destination writes;
   // decrypted owner keys do not accumulate across this traversal.
   for await(const entry of owners.entries())await this.use(inventory,entry.copied?value.destination:value.source,entry,async()=>{}, {complete:value.phase==='complete'});
   const locks=async function*(workspace){for(const kind of ['lab-book','project']){const directory=await privateDirectory(workspace.root,kind==='lab-book'?'.observanda/lab-book-directory':'.observanda/project-import-addresses');for await(const entry of owners.entries({index:'namespace'}))if(entry.kind===kind)yield path.join(directory,entry.namespaceId+'.lock');}};
   const iterator=locks(this.workspace)[Symbol.asyncIterator](),take=async()=>{const item=await iterator.next();return item.done?perform():withWriterLease(item.value,take,{wait:false});};
   const perform=async()=>{
    if(fresh)await withProjectMembership(this.registry,[value.parentId],async()=>{await check();await owner.admit(value,{fresh:true});if(value.destination!==value.source&&await assertRegular(value.destination,{directory:true,missing:true}))throw new AppError('EXISTS');await saveProjectImport(this.registry,value);});
    await owner.admit(value);await check();if(value.phase==='complete')return owner.complete(value,inventory,opened);await reserveProjectImport(this.registry,value);await owner.prepareDestination(value);
    return withOperationProgress(onProgress,()=>operationSequence('import-project-tree',['copy-files','import-project-owners','import-project-register'],async()=>{
     await checkpoint('prepared',value);
     await operationStage('import-project-owners',{unit:'items',total:owners.count},async()=>{
      for await(const entry of owners.entries()){
       operationItem(entry.relative||path.basename(value.destination));await check();const destination=ownerRoot(value.destination,entry);
       await this.use(inventory,entry.copied?value.destination:value.source,entry,async storage=>{
        const target=importOwnerStorage(destination,entry,storage.vault);
        try{
         if(!entry.copied){
          if(serialize(identity(await assertRegular(value.source,{directory:true})))!==serialize(value.sourceIdentity))throw new AppError('CONFLICT');authenticateKeyring((await readAccess(storage.root)).value,storage.vault);
          if(storage.root!==destination){if(entry.archiveDigest)await owner.copyArchive(storage,target,entry,checkpoint);else await (entry.kind==='project'?copyProjectOwnerLocation:copyLabBookLocation)(storage,destination,{id:entry.transferId,retainIncomplete:true,...(entry.kind==='project'?{boundaryRevision:digest(serialize({manifest:value.manifest,relative:entry.relative})),excludeProject:async candidate=>{const relative=path.relative(value.source,candidate).split(path.sep).join('/');return candidate!==storage.root&&!!await owners.get(relative);}}:{}),checkpoint:(stage,file)=>checkpoint('owner-'+stage,{relative:entry.relative,file})});}
          entry.copied=true;await owners.update(entry.relative,{copied:true});await saveProjectImport(this.registry,value);await checkpoint('owner-copied',entry);
         }
         if(!entry.restored){
          if(entry.archiveDigest&&!await catalogueBinding(destination)&&await hashWorkspaceFile(path.join(destination,CATALOGUE_ARCHIVE))!==entry.archiveDigest){await owners.update(entry.relative,{copied:false});await saveProjectImport(this.registry,value);throw new AppError('STORAGE_COPY');}
          const db=await operationStage(entry.kind+'-database-import',{},()=>target.openCatalogue());await db.close();const metadata=await target.catalogue(async store=>(await store.snapshot()).metadata);
          if(metadata.id!==entry.namespaceId||metadata.title!==path.basename(destination)||entry.kind==='project'&&(metadata.projects[0]?.id!==entry.projectId||metadata.projects[0]?.title!==path.basename(destination))||entry.kind==='lab-book'&&(metadata.notebooks[0]?.id!==entry.labBookId||metadata.notebooks[0]?.projectId!==entry.projectId||metadata.notebooks[0]?.title!==path.basename(destination)))throw new AppError('DATABASE_LOCATION');
          entry.restored=true;await owners.update(entry.relative,{restored:true});await saveProjectImport(this.registry,value);await checkpoint('owner-restored',entry);
         }
         if(entry.archiveDigest)await assertInventoryObligationsSettled(target);
        }finally{await (entry.kind==='project'?databaseProvider()?.closeProject(destination):databaseProvider()?.closeLabBook(destination));}
       });operationAdvance();
      }
     });
     if(value.phase==='prepared'){value.phase='copied';await saveProjectImport(this.registry,value);}await checkpoint('copied',value);
     await operationStage('import-project-register',{},()=>this.register(value,owners,inventory,{check,checkpoint}));return owner.complete(value,inventory,opened);
    }));
   };try{return await take();}finally{await iterator.return?.();}
  }));}finally{inventory.close();}
 }
 async register(value,owners,inventory,{check,checkpoint}){
  await check();await this.owner.admit(value);const aliases=new ProjectReferenceAliases(this.workspace),tree=projectTreeCollection(this.workspace,value.manifest);
  await withScratch(async staged=>{
   for await(const item of owners.entries({index:'project'}))await this.use(inventory,value.destination,item,async storage=>{
    const parentId=item.relative?(await tree.find('project',item.projectId)).parentId:value.parentId,entry=await this.registry.describe(storage,parentId,{staged:true});if(entry.namespaceId!==item.namespaceId||entry.vaultId!==item.vaultId)throw new AppError('DATABASE_LOCATION');await staged.add(entry.projectId,entry);
   });
   for await(const item of owners.entries())if(item.kind==='lab-book'){
    const parent=await owners.find('project',item.projectId);await this.use(inventory,value.destination,parent,project=>this.use(inventory,value.destination,item,book=>new LabBookRegistry(project).describe(book,{staged:true})));
   }
   const root=await owners.get('');await this.use(inventory,value.destination,root,async storage=>{
    const projects=await createPortabilityCollection(storage,tree.entries(),{id:root.projectId});await writeProjectTree(storage,{...value.manifest,projects});
   });
   await withProjectMembership(this.registry,[value.parentId],async()=>{for(let attempt=0;;attempt++){
    const current=await this.registry.inspect(view=>({revision:view.revision,aliases:view.aliases}));let references=current.aliases??null;
    for await(const item of owners.entries({index:'project'}))await this.use(inventory,value.destination,item,async storage=>{const bundle=await projectPortableReferences(storage,await staged.get(item.projectId));if(bundle)references=await aliases.prepare(references,bundle.owner,bundle.targets());});
    await this.owner.admit(value);await check();try{
     await this.registry.applyBatch(current.revision,(async function*(){for await(const entry of staged.items())yield {state:'active',entry};})(),{aliases:references,check:async(directory,head)=>{for await(const entry of staged.items()){const row=await directory.find(head,entry.projectId);if(row?.state==='deleted')throw new AppError('DATABASE_LOCATION');if(row?.state==='active'&&['root','parentId','vaultId','namespaceId'].some(key=>row.entry[key]!==entry[key]))throw new AppError('CONFLICT');acceptRelocatedProject({relocated:row?.state==='relocated'?[row.entry]:[]},entry);}}});break;
    }catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
   }});
  });
  value.phase='registered';await saveProjectImport(this.registry,value);await checkpoint('registered',value);
  for await(const item of owners.entries())if(item.kind==='lab-book')await new LabBookDirectory(this.registry).register(item.projectId,item);await checkpoint('addressed',value);
  for await(const item of owners.entries())await unlink(path.join(ownerRoot(value.destination,item),'.observanda/copy-in-progress')).catch(error=>{if(error.code!=='ENOENT')throw error;});
  value.phase='complete';await saveProjectImport(this.registry,value);await checkpoint('complete',value);
 }
}
