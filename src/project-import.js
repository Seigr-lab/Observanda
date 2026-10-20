import {NativeProjectImport} from './project-import-native.js';
import {assertInventoryObligationsSettled} from './inventory-obligation-lifecycle.js';
import {incomingProjectMove,assertIncomingProjectMovesSettled,assertIncomingProjectAddresses} from './project-incoming-moves.js';
import {acceptRelocatedProject} from './project-relocation-directory.js';
// Adopt a selected project tree into its literal containing folder. Transport
// and activation belong to each independent owner; registration is published
// only after all those owners can open at their final destinations.
import {prepareImportDestination} from './import-destination.js';
import {ImportDiscard} from './import-discard.js';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readdir,unlink,realpath} from 'node:fs/promises';
import {ProjectImportInventory,importOwnerStorage} from './project-import-inventory.js';
import {projectImportFile,readProjectImport,saveProjectImport,pendingProjectImports,reserveProjectImport,releaseProjectImport,projectImportOwners} from './project-import-state.js';
import {ProjectStorage} from './project-storage.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {copyProjectOwnerLocation} from './project-transfer.js';
import {copyLabBookLocation} from './lab-book-transfer.js';
import {writeProjectTree} from './project-tree-manifest.js';
import {reconcileProjectFiles} from './project-transfer-files.js';
import {withProjectMembership} from './project-membership.js';
import {projectPortableReferences} from './project-portable-references.js';
import {ProjectReferenceAliases} from './project-reference-aliases.js';
import {assertRegular,atomicWrite,privateDirectory,serialize} from './storage.js';
import {catalogueBinding,CATALOGUE_FILE,CATALOGUE_ACTIVATION,CATALOGUE_ARCHIVE} from './postgres-activation.js';
import {hashWorkspaceFile} from './workspace-inventory.js';
import {databaseProvider} from './workspace-database-context.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {withWriterLease} from './writer-lease.js';
import {resolveLocation} from './locations.js';
import {storageCreationPath,storageFolderName} from './storage-names.js';
import {researchId} from './web/research-reference.js';
import {trackProjectTransfer,projectTransferRunning} from './project-transfer-tasks.js';
import {withOperationProgress,operationStage,operationSequence,operationItem,operationAdvance} from './operation-progress.js';
import {AppError} from './errors.js';
const within=(root,child)=>{const relative=path.relative(root,child);return relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const ownerRoot=(root,entry)=>path.join(root,...entry.relative.split('/'));
const credentials=command=>{
 if(!command||!researchId(command.id)||Object.keys(command).some(key=>!['id','path','parentId','username','password','recovery','owners'].includes(key))||['username','password','recovery'].some(key=>typeof command[key]!=='string'||command[key].length>1024)||command.parentId!==undefined&&command.parentId!==null&&!researchId(command.parentId)||command.owners!==undefined&&(!Array.isArray(command.owners)||command.owners.length>8192))throw new AppError('INVALID');
 const values=[{relative:'',username:command.username,password:command.password,recovery:command.recovery},...(command.owners??[])];const paths=new Set();
 for(const item of values){if(Object.keys(item).sort().join()!=='password,recovery,relative,username'||typeof item.relative!=='string'||item.relative.length>16384||paths.has(item.relative)||['username','password','recovery'].some(key=>typeof item[key]!=='string'||item[key].length>1024))throw new AppError('INVALID');paths.add(item.relative);}return values;
};
export class ProjectImports{
 constructor(registry,deviceStore){this.registry=registry;this.workspace=registry.workspace;this.deviceStore=deviceStore;}
 read(id){return readProjectImport(this.registry,id);}
 header(id){return readProjectImport(this.registry,id,{metadataOnly:true});}
 async pending({after=null,limit=20}={}){if(after!==null&&!researchId(after)||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new AppError('INVALID');const list=[];for await(const value of pendingProjectImports(this.registry,{metadataOnly:true})){if(after!==null&&value.id<=after)continue;list.push(value);list.sort((a,b)=>a.id.localeCompare(b.id));if(list.length>limit+1)list.pop();}const more=list.length>limit;if(more)list.pop();const registered=await this.registry.inspect(async view=>{const ids=new Set();for(const value of list)if((await view.get(value.manifest.projectId))?.state==='active')ids.add(value.manifest.projectId);return ids;});return {items:list.map(value=>({id:value.id,name:path.basename(value.destination),parentId:value.parentId,phase:value.phase,inPlace:value.source===value.destination,cancellable:!['registered','complete'].includes(value.phase)&&!registered.has(value.manifest.projectId),running:projectTransferRunning(projectImportFile(this.registry,value.id))})),next:more?list.at(-1).id:null};}
 async parent(parentId){return parentId===null?await realpath(this.workspace.root):(await this.registry.locate(parentId)).root;}
 async admit(value,{fresh=false}={}){
  if(storageCreationPath(await this.parent(value.parentId),path.basename(value.destination))!==value.destination)throw new AppError('CONFLICT');
  await assertIncomingProjectMovesSettled(this.registry,[value.parentId]);const owners=projectImportOwners(this.registry,value);await assertIncomingProjectAddresses(this.registry,owners);
  let projectCount=0;
  await this.registry.inspect(async view=>{for await(const owner of projectImportOwners(this.registry,value).entries()){if(owner.kind==='project')projectCount++;
   const root=ownerRoot(value.destination,owner),selected=await view.get(owner.projectId),existing=selected?.state==='active'?selected.entry:null;
   if(owner.kind==='project'&&await incomingProjectMove(this.registry,owner.projectId))throw new AppError('STORAGE_PROJECT_BUSY');
   if(owner.kind==='project')acceptRelocatedProject({relocated:selected?.state==='relocated'?[selected.entry]:[]},owner);
   if(owner.kind==='project'&&existing&&(fresh||existing.root!==root||existing.namespaceId!==owner.namespaceId||existing.vaultId!==owner.vaultId))throw new AppError('PROJECT_LOCATION_EXISTS');
   if(selected?.state==='deleted')throw new AppError('DATABASE_LOCATION');
   for(const [index,id] of [['namespace',owner.namespaceId],['vault',owner.vaultId],['location',this.registry.locationKey(root)]]){
    const row=await view.get(id,{index});if(row&&(row.state==='deleted'&&index!=='location'||row.state==='active'&&row.entry.projectId!==owner.projectId))throw new AppError('DATABASE_LOCATION');
   }
   const book=await new LabBookDirectory(this.registry).read(owner.namespaceId);if(book&&(owner.kind!=='lab-book'||book.projectId!==owner.projectId||book.labBookId!==owner.labBookId||book.vaultId!==owner.vaultId))throw new AppError('DATABASE_LOCATION');
  }});
  for await(const pending of pendingProjectImports(this.registry)){if(pending.id===value.id)continue;if(within(pending.destination,value.destination)||within(value.destination,pending.destination))throw new AppError('STORAGE_PROJECT_BUSY');for await(const entry of projectImportOwners(this.registry,pending).entries())if(await owners.find('namespace',entry.namespaceId)||await owners.find('vault',entry.vaultId))throw new AppError('STORAGE_PROJECT_BUSY');}
  if(!projectCount)throw new AppError('STORAGE_COPY');
 }
 async run(command,{resume=false,check=async()=>{},checkpoint=async()=>{},opened=async()=>{},onProgress,credentialSource}={}){
  const validated=credentialSource??credentials(command),current=await this.read(command.id);if(!current||current.version===2)return new NativeProjectImport(this).run(command,{resume,check,checkpoint,opened,onProgress},validated);
  const supplied=credentialSource??credentials(command),inventory=new ProjectImportInventory(this.deviceStore,supplied),directory=await privateDirectory(this.workspace.root,'.observanda/project-imports');
  try{return await trackProjectTransfer(projectImportFile(this.registry,command.id),()=>withWriterLease(path.join(directory,command.id+'.lock'),async()=>{
   await check();let value=await this.read(command.id);const fresh=!value;if(value?.phase==='cancelled')return this.cancelled(value);if(value?.phase==='cancelling')throw new AppError('STORAGE_INCOMPLETE');if(resume&&!value)throw new AppError('NOT_FOUND');
   if(!value){
    if(typeof command.path!=='string')throw new AppError('INVALID');const source=await resolveLocation(command.path);if(within(source,this.workspace.root))throw new AppError('STORAGE_PATH');const inspected=await inventory.inspect(source),parentId=command.parentId??null,destination=storageCreationPath(await this.parent(parentId),storageFolderName(source));
    if(source!==destination&&(within(this.workspace.root,source)||within(source,destination)||within(destination,source)))throw new AppError('STORAGE_PATH');
    value={version:1,id:command.id,source,destination,parentId,sourceIdentity:identity(await assertRegular(source,{directory:true})),destinationIdentity:null,manifest:inspected.manifest,owners:inspected.owners.map(entry=>({...entry,transferId:randomUUID(),copied:false,restored:false})),phase:'prepared'};

   }else{
    if(command.path!==undefined&&await resolveLocation(command.path)!==value.source||command.parentId!==undefined&&command.parentId!==value.parentId)throw new AppError('CONFLICT');
    for(const entry of value.owners)await inventory.unlock(ownerRoot(entry.copied?value.destination:value.source,entry),entry.relative,value.phase==='complete'?{vaultId:entry.vaultId}:entry);
   }
   const locks=[];for(const entry of value.owners){const directory=await privateDirectory(this.workspace.root,entry.kind==='lab-book'?'.observanda/lab-book-directory':'.observanda/project-import-addresses');locks.push(path.join(directory,entry.namespaceId+'.lock'));}locks.sort();
   const take=index=>index===locks.length?perform():withWriterLease(locks[index],()=>take(index+1),{wait:false});
   const perform=async()=>{
   if(fresh)await withProjectMembership(this.registry,[value.parentId],async()=>{await check();await this.admit(value,{fresh:true});if(value.destination!==value.source&&await assertRegular(value.destination,{directory:true,missing:true}))throw new AppError('EXISTS');await saveProjectImport(this.registry,value);});
   await this.admit(value);await check();if(value.phase==='complete')return this.complete(value,inventory,opened);await reserveProjectImport(this.registry,value);await this.prepareDestination(value);
   const result=await withOperationProgress(onProgress,()=>operationSequence('import-project-tree',['copy-files','import-project-owners','import-project-register'],async()=>{
    await checkpoint('prepared',value);
    await operationStage('import-project-owners',{unit:'items',total:value.owners.length},async()=>{
     for(const entry of value.owners){operationItem(entry.relative||path.basename(value.destination));await check();const vault=inventory.keys.get(entry.relative),destination=ownerRoot(value.destination,entry),target=importOwnerStorage(destination,entry,vault);
      try{
       if(!entry.copied){
        if(serialize(identity(await assertRegular(value.source,{directory:true})))!==serialize(value.sourceIdentity))throw new AppError('CONFLICT');const source=importOwnerStorage(ownerRoot(value.source,entry),entry,vault);authenticateKeyring((await readAccess(source.root)).value,vault);
        if(source.root!==destination){if(entry.archiveDigest)await this.copyArchive(source,target,entry,checkpoint);else await (entry.kind==='project'?copyProjectOwnerLocation:copyLabBookLocation)(source,destination,{id:entry.transferId,retainIncomplete:true,projectRoots:entry.kind==='project'?value.manifest.projects.map(item=>ownerRoot(value.source,item)).filter(root=>root!==source.root&&within(source.root,root)):[],checkpoint:(stage,file)=>checkpoint('owner-'+stage,{relative:entry.relative,file})});}
        entry.copied=true;await saveProjectImport(this.registry,value);await checkpoint('owner-copied',entry);
       }
       if(!entry.restored){
        if(entry.archiveDigest&&!await catalogueBinding(destination)&&await hashWorkspaceFile(path.join(destination,CATALOGUE_ARCHIVE))!==entry.archiveDigest){entry.copied=false;await saveProjectImport(this.registry,value);throw new AppError('STORAGE_COPY');}
        const db=await operationStage(entry.kind+'-database-import',{},()=>target.openCatalogue());await db.close();const metadata=await target.catalogue(async store=>(await store.snapshot()).metadata);
        if(metadata.id!==entry.namespaceId||metadata.title!==path.basename(destination)||entry.kind==='project'&&(metadata.projects[0]?.id!==entry.projectId||metadata.projects[0]?.title!==path.basename(destination))||entry.kind==='lab-book'&&(metadata.notebooks[0]?.id!==entry.labBookId||metadata.notebooks[0]?.projectId!==entry.projectId||metadata.notebooks[0]?.title!==path.basename(destination)))throw new AppError('DATABASE_LOCATION');
        entry.restored=true;await saveProjectImport(this.registry,value);await checkpoint('owner-restored',entry);
       }
       if(entry.archiveDigest)await assertInventoryObligationsSettled(target);
      }finally{await (entry.kind==='project'?databaseProvider()?.closeProject(destination):databaseProvider()?.closeLabBook(destination));}
      operationAdvance();
     }
    });
    if(value.phase==='prepared'){value.phase='copied';await saveProjectImport(this.registry,value);}await checkpoint('copied',value);
    await operationStage('import-project-register',{},async()=>{
     await check();await this.admit(value);const entries=[],aliases=new ProjectReferenceAliases(this.workspace),portable=[];
     for(const item of value.owners.filter(item=>item.kind==='project')){
      const storage=new ProjectStorage(ownerRoot(value.destination,item),item.projectId,inventory.keys.get(item.relative));
      const parentId=item.relative?value.manifest.projects.find(project=>project.projectId===item.projectId).parentId:value.parentId,entry=await this.registry.describe(storage,parentId,{staged:true});if(entry.namespaceId!==item.namespaceId||entry.vaultId!==item.vaultId)throw new AppError('DATABASE_LOCATION');entries.push(entry);portable.push(await projectPortableReferences(storage,entry));
     }
     for(const item of value.owners.filter(item=>item.kind==='lab-book')){const parent=entries.find(entry=>entry.projectId===item.projectId),storage=new ProjectStorage(parent.root,parent.projectId,inventory.keys.get(value.owners.find(owner=>owner.kind==='project'&&owner.projectId===parent.projectId).relative));await new LabBookRegistry(storage).describe(importOwnerStorage(ownerRoot(value.destination,item),item,inventory.keys.get(item.relative)),{staged:true});}
     const rootStorage=new ProjectStorage(value.destination,value.manifest.projectId,inventory.keys.get(''));await writeProjectTree(rootStorage,value.manifest);
     await withProjectMembership(this.registry,[value.parentId],async()=>{for(let attempt=0;;attempt++){
      const current=await this.registry.inspect(view=>({revision:view.revision,aliases:view.aliases}));let references=current.aliases??null;for(const bundle of portable)if(bundle)references=await aliases.prepare(references,bundle.owner,bundle.targets());await this.admit(value);await check();
      try{await this.registry.applyBatch(current.revision,(async function*(){for(const entry of entries)yield {state:'active',entry};})(),{aliases:references,check:async(directory,head)=>{for(const entry of entries){const row=await directory.find(head,entry.projectId);if(row?.state==='deleted')throw new AppError('DATABASE_LOCATION');if(row?.state==='active'&&['root','parentId','vaultId','namespaceId'].some(key=>row.entry[key]!==entry[key]))throw new AppError('CONFLICT');acceptRelocatedProject({relocated:row?.state==='relocated'?[row.entry]:[]},entry);}}});break;}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
     }});value.phase='registered';await saveProjectImport(this.registry,value);await checkpoint('registered',value);
     for(const item of value.owners.filter(item=>item.kind==='lab-book'))await new LabBookDirectory(this.registry).register(item.projectId,item);await checkpoint('addressed',value);
     for(const item of value.owners)await unlink(path.join(ownerRoot(value.destination,item),'.observanda/copy-in-progress')).catch(error=>{if(error.code!=='ENOENT')throw error;});
     value.phase='complete';await saveProjectImport(this.registry,value);await checkpoint('complete',value);
    });return this.complete(value,inventory,opened);
   }));return result;
   };return take(0);
  }));}finally{inventory.close();}
 }
 async cancelled(value){if(value.access)await saveProjectImport(this.registry,value);await releaseProjectImport(this.registry,value);return {id:value.id,cancelled:true};}
 async cancel(command,{check=async()=>{},checkpoint=async()=>{},onProgress,credentialSource}={}){
  const supplied=credentialSource??credentials(command);if(command.path!==undefined||command.parentId!==undefined)throw new AppError('INVALID');
  const inventory=new ProjectImportInventory(this.deviceStore,supplied),directory=await privateDirectory(this.workspace.root,'.observanda/project-imports');
  try{return await trackProjectTransfer(projectImportFile(this.registry,command.id),()=>withWriterLease(path.join(directory,command.id+'.lock'),async()=>{
   await check();const value=await this.read(command.id);if(!value)throw new AppError('NOT_FOUND');if(value.phase==='cancelled')return this.cancelled(value);
   if(value.accessOnly){await check();value.phase='cancelled';await saveProjectImport(this.registry,value);return this.cancelled(value);}
   if(['registered','complete'].includes(value.phase))throw new AppError('CONFLICT');
   return withProjectMembership(this.registry,[value.parentId],async()=>{
    if(storageCreationPath(await this.parent(value.parentId),path.basename(value.destination))!==value.destination)throw new AppError('CONFLICT');
    await this.registry.inspect(async view=>{for await(const owner of projectImportOwners(this.registry,value).entries()){if((await view.get(owner.projectId))?.state==='active'||(await view.get(this.registry.locationKey(ownerRoot(value.destination,owner)),{index:'location'}))?.state==='active')throw new AppError('CONFLICT');}});
    const discard=new ImportDiscard(this.workspace,value.id);
    if(value.source!==value.destination&&value.destinationIdentity){
     if(await discard.needsKeys()){
      if(serialize(identity(await assertRegular(value.source,{directory:true})))!==serialize(value.sourceIdentity))throw new AppError('CONFLICT');
      for await(const entry of projectImportOwners(this.registry,value).entries()){await inventory.unlock(ownerRoot(value.source,entry),entry.relative,{vaultId:entry.vaultId});if(value.version===2)inventory.forget(entry.relative);}
     }
     await check();value.phase='cancelling';await saveProjectImport(this.registry,value);await discard.run(value,value.version===2?{get:async relative=>{inventory.close();const entry=await projectImportOwners(this.registry,value).get(relative);return (await inventory.unlock(ownerRoot(value.source,entry),relative,{vaultId:entry.vaultId})).vault;}}:inventory.keys,{check,checkpoint,onProgress});
    }
    await check();value.phase='cancelled';await saveProjectImport(this.registry,value);await checkpoint('cancelled',value);return this.cancelled(value);
   },{wait:false});
  },{wait:false}));}finally{inventory.close();}
 }
 async prepareDestination(value){return prepareImportDestination(value,()=>saveProjectImport(this.registry,value));}
 async copyArchive(source,target,entry,checkpoint){
  if(!await assertRegular(target.root,{directory:true,missing:true}))await mkdir(target.root,{mode:0o700});
  if(!await assertRegular(path.join(target.root,'.observanda'),{directory:true,missing:true})){if((await readdir(target.root)).length)throw new AppError('EXISTS');await mkdir(path.join(target.root,'.observanda'),{mode:0o700});}
  await atomicWrite(path.join(target.root,'.observanda/copy-in-progress'),'importing owner\n');const prefix=entry.kind==='project'?'project':'lab-book';
  await reconcileProjectFiles(source,target,{id:entry.transferId,filesVersion:1},{controls:new Set([CATALOGUE_FILE,CATALOGUE_ACTIVATION,'.observanda/'+prefix+'-transfer.observanda','.observanda/'+prefix+'-transfer.lock']),receiptDirectory:'.observanda/'+prefix+'-transfer-files',checkpoint:(stage,file)=>checkpoint('owner-'+stage,{relative:entry.relative,file})});
 }
 async complete(value,inventory,opened){
  // Grants remain available through opened callbacks; the authenticated receipt
  // owns their cleanup until the caller has finished using them.
  await unlink(projectImportFile(this.registry,value.id)).catch(error=>{if(error.code!=='ENOENT')throw error;});await releaseProjectImport(this.registry,value);const projects=value.version===1?[]:null;let project=null,projectCount=0;
  try{for await(const item of projectImportOwners(this.registry,value).entries()){
   const root=ownerRoot(value.destination,item),vault=inventory.keys.get(item.relative)??(await inventory.unlock(root,item.relative,{vaultId:item.vaultId})).vault,access=await readAccess(root);
   try{authenticateKeyring(access.value,vault);if(item.kind==='project'){const entry=await this.registry.locate(item.projectId);if(entry.root!==root||entry.namespaceId!==item.namespaceId||entry.vaultId!==item.vaultId)throw new AppError('CONFLICT');projectCount++;if(item.relative==='')project=entry;projects?.push(entry);await opened(entry,access,vault);}else await opened({...item,root},access,vault);}finally{if(value.version===2)inventory.forget(item.relative);}
  }}finally{if(value.access){value.access.erasing=true;await saveProjectImport(this.registry,value);}}return {id:value.id,project,...(projects?{projects}:{projectCount}),complete:true};
 }
}
