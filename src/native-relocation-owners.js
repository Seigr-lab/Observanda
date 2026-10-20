import {nativeRelocationOwners,verifyNativeRelocationOwners} from './native-relocation-state.js';
export {nativeRelocationOwners,verifyNativeRelocationOwners,validNativeRelocation,validNativeRelocationOwner} from './native-relocation-state.js';
// Selected relocations retain bounded authenticated owner proofs. Recovery keys
// stay encrypted by the selected project, separately from workspace metadata.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,realpath,opendir,unlink} from 'node:fs/promises';
import {NativePortabilityCollection,createPortabilityCollection,portabilityCollection,releasePortabilityCollection,validPortabilityCollection} from './portability-collection.js';
import {ProjectStorage} from './project-storage.js';
import {LabBookStorage} from './lab-book-storage.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {ProjectBookOwners} from './project-book-owners.js';
import {projectRegistryDescendantPrefix} from './project-registry-locations.js';
import {withProjectMembership,assertProjectCreationSettled,assertProjectRelocationsSettled} from './project-membership.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {withWriterLease} from './writer-lease.js';
import {withScratch} from './scratch-work.js';
import {assertRegular,atomicWrite,digest,serialize,workspaceFile} from './storage.js';
import {catalogueBinding} from './postgres-activation.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {clearVault} from './encryption.js';
import {RENAME_MARKER,workspaceRename} from './workspace-rename-state.js';
import {projectMoveDirectory,assertProjectMoveDirectory} from './project-move-boundaries.js';
import {validPlacementIdentity} from './project-placement-transfer-state.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {validateStorageName} from './storage-names.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {assertLabBookDatabaseStopped} from './lab-book-postgres.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
import {validDatabaseRetention} from './workspace-database-retention.js';
const fingerprint=async file=>digest(await readFile(file));
const relative=(root,file)=>path.relative(root,file).split(path.sep).join('/');
export const relocationOwnerRoot=(root,item)=>item.relative?nestedRenameRoot(root,item.relative):root;
export const relocationOwnerId=item=>item.kind==='project'?item.projectId:item.labBookId;
// Bound the traversal as well as the owner records. A declared database may
// travel; an undeclared nested database never becomes incidental move content.
export async function assertNativeRelocationDatabases(root,owners){
 return withScratch(async queue=>{await queue.add('',{relative:''});for(let item; (item=await queue.take())!==undefined;){const directory=path.resolve(root,...item.relative.split('/'));if(directory!==root&&!directory.startsWith(root+path.sep))throw new AppError('UNSAFE');await assertRegular(directory,{directory:true});
  for await(const entry of await opendir(directory)){
   if(entry.isSymbolicLink())throw new AppError('UNSAFE');if(!entry.isDirectory())continue;const suffix=path.posix.join(item.relative,entry.name),child=path.join(directory,entry.name);await assertRegular(child,{directory:true});
   if(path.basename(directory).toLowerCase()==='.observanda'&&entry.name.toLowerCase()==='postgresql'){
    const ownerRelative=relative(root,path.dirname(directory));if(path.basename(directory)!=='.observanda'||entry.name!=='postgresql'||!await owners.get(ownerRelative))throw new AppError('STORAGE_RENAME_PROJECTS');continue;
   }
   await queue.add(suffix,{relative:suffix});
  }
 }});
}
export class NativeRelocationOwners{
 constructor(command,value,vault){this.command=command;this.registry=command.registry;this.value=value;this.vault=vault;this.owners=nativeRelocationOwners(this.registry,value);}
 root(root){return new ProjectStorage(root,this.value.projectId,this.vault);}
 async use(root,item,operation,{keysRoot=root,identity=true}={}){
  let vault=this.vault;
  if(item.relative){const saved=await portabilityCollection(this.root(keysRoot),this.value.ownerKeys).get(item.relative);
   if(!saved||['kind','relative','projectId','labBookId','namespaceId','vaultId'].some(key=>saved[key]!==item[key])||typeof saved.key!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(saved.key))throw new AppError('STORAGE_RENAME_STATE');vault={id:saved.vaultId,key:Buffer.from(saved.key,'base64')};
  }
  try{const location=relocationOwnerRoot(root,item),storage=item.kind==='project'?new ProjectStorage(location,item.projectId,vault):new LabBookStorage(location,item.labBookId,vault);
   if(vault?.id!==item.vaultId)throw new AppError('ACCESS_LOCKED');if(identity)await assertProjectMoveDirectory(location,item.destinationIdentity??item.identity);if(await realpath(location)!==location||await fingerprint(path.join(location,'.observanda/access.json'))!==item.accessHash)throw new AppError('STORAGE_RENAME_STATE');authenticateKeyring((await readAccess(location)).value,vault);
   const binding=await catalogueBinding(location),scope=this.command.scope(this.value),expected=root===scope.destination?item.destinationId??item.sourceId:item.sourceId;if(binding?.id!==expected||binding.placement!==item.kind||binding[item.kind==='project'?'projectId':'labBookId']!==relocationOwnerId(item))throw new AppError('DATABASE_LOCATION');if((await storage.outline()).metadata.id!==item.namespaceId)throw new AppError('DATABASE_LOCATION');return await operation(storage);
  }finally{if(item.relative)clearVault(vault);}
 }
 static async prepare(command,storage,value,{withProject,withBook,check=async()=>{}}={}){
  const registry=command.registry;value.ownerDirectoryVersion=2;value.owners=new NativePortabilityCollection(null,randomUUID()).empty();value.ownerKeys=new NativePortabilityCollection(null,randomUUID()).empty();value.projectRegistryRevision=await registry.version();value.phase='preparing';await command.save(value);
  // The preparing journal owns both UUID namespaces even if either commit is
  // acknowledged only after interruption. No recovery key precedes that journal.
  await withScratch(async proofs=>withScratch(async keys=>withScratch(async projects=>{
   // Credential callbacks may finish an earlier owner rename. Queue identities
   // under a short directory read, then invoke callbacks outside that snapshot.
   await registry.inspect(async view=>{
    if(view.revision!==value.projectRegistryRevision)throw new AppError('CONFLICT');
    const root=await view.get(storage.projectId);if(root?.state!=='active'||root.entry.root!==storage.root||root.entry.vaultId!==storage.vault.id)throw new AppError('CONFLICT');await projects.add(root.entry.projectId,root.entry);
    for await(const {entry} of view.entries({index:'location',prefix:projectRegistryDescendantPrefix(storage.root,registry.workspace.root)})){
     const parent=await view.get(entry.parentId);if(parent?.state!=='active'||path.dirname(entry.root)!==parent.entry.root||parent.entry.root!==storage.root&&!parent.entry.root.startsWith(storage.root+path.sep))throw new AppError('STORAGE_PATH');await projects.add(entry.projectId,entry);
    }
   });
   let rootBooks;
   for(let initial;(initial=await projects.take())!==undefined;){
    const use=async project=>{
     const state=await registry.state(initial.projectId),entry=state.state==='active'?state.entry:null;
     if(!entry||['projectId','namespaceId','vaultId','parentId'].some(key=>entry[key]!==initial[key])||project.root!==entry.root||project.projectId!==entry.projectId||project.vault?.id!==entry.vaultId||entry.root!==storage.root&&!entry.root.startsWith(storage.root+path.sep))throw new AppError('DATABASE_LOCATION');
     const ready=new ProjectBookOwners(project);await ready.ready({renames:false});const books=new LabBookRegistry(project);if(await books.version()==='new')await books.apply('new',[]);const bookRevision=await books.version();
     const capture=async(owner,fields)=>{await check(fields);if(await realpath(owner.root)!==owner.root)throw new AppError('UNSAFE');const access=await readAccess(owner.root),binding=await catalogueBinding(owner.root),metadata=(await owner.outline()).metadata;authenticateKeyring(access.value,owner.vault);
      if(binding?.placement!==fields.kind||binding[fields.kind==='project'?'projectId':'labBookId']!==(fields.labBookId??fields.projectId)||metadata.id!==fields.namespaceId||owner.vault?.id!==fields.vaultId||fields.kind==='lab-book'&&metadata.notebooks[0].projectId!==fields.projectId)throw new AppError('DATABASE_LOCATION');
      const item={...fields,relative:relative(storage.root,owner.root),identity:await projectMoveDirectory(owner.root),accessHash:await fingerprint(path.join(owner.root,'.observanda/access.json')),descriptorHash:await fingerprint(await workspaceFile(owner.root)),sourceId:binding.id};
      if(!await proofs.add(item.relative,item))throw new AppError('STORAGE_RENAME_STATE');
      if(item.relative)await keys.add(item.relative,{kind:item.kind,relative:item.relative,projectId:item.projectId,...(item.labBookId?{labBookId:item.labBookId}:{}),namespaceId:item.namespaceId,vaultId:item.vaultId,key:owner.vault.key.toString('base64')});return item;
     };
     const captured=await capture(project,{kind:'project',projectId:entry.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,parentId:entry.parentId,summary:entry.summary??null,bookRevision});
     const inspectBooks=async()=>{
      let after=null,count=0;do{const page=await books.list({after,limit:32});for(const initial of page.items){
       if(typeof withBook!=='function')throw new AppError('STORAGE_RENAME_PROJECTS');await withBook(project,initial.labBookId,async owner=>{
        const book=await books.locate(initial.labBookId);if(book.vaultId!==initial.vaultId||book.namespaceId!==initial.namespaceId||owner.root!==book.root||owner.labBookId!==book.labBookId)throw new AppError('DATABASE_LOCATION');
        await capture(owner,{kind:'lab-book',projectId:entry.projectId,labBookId:book.labBookId,namespaceId:book.namespaceId,vaultId:book.vaultId});count++;
       });
      }after=page.next;}while(after!==null);
      await ready.ready();await books.inspect(async directory=>{
       if(directory.count!==count)throw new AppError('CONFLICT');for await(const {entry:book} of directory.entries()){const saved=await proofs.get(relative(storage.root,path.join(project.root,book.directory)));if(!saved||saved.kind!=='lab-book'||['labBookId','namespaceId','vaultId'].some(key=>saved[key]!==book[key]))throw new AppError('CONFLICT');}
       await proofs.put(captured.relative,{...captured,bookRevision:directory.revision});
      });
     };
     if(entry.projectId===storage.projectId)rootBooks=inspectBooks;else await inspectBooks();
    };
    if(initial.projectId===storage.projectId)await use(storage);else{if(typeof withProject!=='function')throw new AppError('STORAGE_RENAME_PROJECTS');await withProject(initial.projectId,use);}
   }
   await rootBooks();value.projectRegistryRevision=await registry.version();
   const ordered=async function*(){for(let item;(item=await proofs.take())!==undefined;)yield item;};value.owners=await createPortabilityCollection(registry.workspace,ordered(),{id:value.owners.id});value.ownerKeys=await createPortabilityCollection(storage,keys.items(),{id:value.ownerKeys.id});
  })));
  const selected=new NativeRelocationOwners(command,value,storage.vault);await verifyNativeRelocationOwners(registry,{...value,phase:'prepared'});await selected.current(storage.root);await assertNativeRelocationDatabases(storage.root,selected.owners);value.phase='prepared';await command.save(value);return selected;
 }
 async current(root){
  const value=this.value;await this.registry.inspect(async view=>{let count=0;for await(const item of this.owners.entries({index:'project'})){
   const row=await view.get(item.projectId);if(row?.state!=='active'||['projectId','namespaceId','vaultId','parentId'].some(key=>row.entry[key]!==item[key])||row.entry.root!==relocationOwnerRoot(root,item))throw new AppError('CONFLICT');count++;
   for await(const child of view.entries({index:'parent',prefix:item.projectId+':'})){const saved=await this.owners.find('project',child.entry.projectId);if(!saved||child.entry.root!==relocationOwnerRoot(root,saved)||path.dirname(child.entry.root)!==row.entry.root)throw new AppError('CONFLICT');}
  }
  let physical=1;for await(const row of view.entries({index:'location',prefix:projectRegistryDescendantPrefix(root,this.registry.workspace.root)})){const saved=await this.owners.find('project',row.entry.projectId);if(!saved||row.entry.root!==relocationOwnerRoot(root,saved))throw new AppError('CONFLICT');physical++;}if(physical!==count)throw new AppError('CONFLICT');});
  for await(const item of this.owners.entries({index:'project'}))await this.use(root,item,async storage=>{await new ProjectBookOwners(storage).ready();if(await new LabBookRegistry(storage).version()!==item.bookRevision)throw new AppError('CONFLICT');});
 }
 marker(item){const value=this.value,scope=this.command.scope(value),common={...(value.placement?{placement:true}:{}),id:value.id,source:relocationOwnerRoot(scope.source,item),destination:relocationOwnerRoot(scope.destination,item)};
  return item.relative?{version:item.kind==='project'?2:3,...common,parentSource:scope.source,parentDestination:scope.destination,relative:item.relative,projectId:item.projectId,...(item.labBookId?{labBookId:item.labBookId}:{})}:{version:1,...common};
 }
 async freeze({check=async()=>{},checkpoint=async()=>{}}={}){
  const value=this.value,root=this.command.scope(value).source,rootOwner=await this.owners.get('');
  if(!await workspaceRename(root))await this.root(root).withStorageHandoff(()=>withProjectMembership(this.registry,[value.parentId,value.projectId],async()=>{
   await check();await assertProjectCreationSettled(this.registry,[value.parentId,value.projectId]);await assertProjectRelocationsSettled(this.registry,[value.parentId,value.projectId],{except:value.projectId});await this.current(root);if(await fingerprint(await workspaceFile(root))!==value.descriptorHash)throw new AppError('STORAGE_RENAME_STATE');await atomicWrite(path.join(root,RENAME_MARKER),serialize(this.marker(rootOwner)));
  }),{existing:true});
  value.phase='frozen';await this.command.save(value);await checkpoint('frozen',value);
  // The root fence is observed by every descendant's ordinary admission. Each
  // owner then drains its existing writer before its own persistent fence.
  for await(const item of this.owners.entries({reverse:true})){
   await this.use(root,item,async storage=>{
    const prior=await workspaceRename(storage.root),marker=this.marker(item);if(prior&&serialize(prior)!==serialize(marker))throw new AppError('STORAGE_RENAME_STATE');
    const freeze=()=>storage.withStorageHandoff(async()=>{await check(item);if(item.kind==='project'&&await new LabBookRegistry(storage).version()!==item.bookRevision)throw new AppError('CONFLICT');if(!prior)await atomicWrite(path.join(storage.root,RENAME_MARKER),serialize(marker));},{existing:true});
    if(item.relative&&item.kind==='project')await withProjectLifecycle(this.registry,item.projectId,'open',freeze);else await freeze();
    if(item.relative)await checkpoint(item.kind==='project'?'project-frozen':'book-frozen',value,relocationOwnerId(item));
   });
  }
  await this.current(root);await assertNativeRelocationDatabases(root,this.owners);
  // Load each key before stopping that owner. Root is stopped last: it owns
  // the encrypted key pages, but no decrypted key survives its callback.
  for await(const item of this.owners.entries({reverse:true}))await this.use(root,item,async storage=>{
   await check(item);const provider=databaseProvider(),method=item.kind==='project'?'stopProjectForRename':'stopLabBookForRename';if(!provider?.[method])throw new AppError('DATABASE_LOCATION');await provider[method](storage.root,relocationOwnerId(item),storage.vault,value.id);
   const lease=await workspaceDatabaseLease(path.join(storage.root,'.observanda/postgresql'));try{await (item.kind==='project'?assertProjectDatabaseStopped:assertLabBookDatabaseStopped)(storage.root,relocationOwnerId(item),storage.vault);}finally{await lease.close();}
   if(item.relative)await checkpoint(item.kind==='project'?'project-stopped':'book-stopped',value,relocationOwnerId(item));
  });
  await checkpoint('stopped',value);
 }
 async verify(root){for await(const item of this.owners.entries())await this.use(root,item,async storage=>{if((await storage.outline()).metadata.id!==item.namespaceId||item.kind==='project'&&await new LabBookRegistry(storage).version()!==item.bookRevision)throw new AppError('STORAGE_RENAME_STATE');});}
 async clear(root,{atSource=false,checkpoint=async()=>{}}={}){
  const value=this.value;if(value.keysReleased)return;
  for await(const item of this.owners.entries({reverse:true})){
   const location=relocationOwnerRoot(root,item);await assertProjectMoveDirectory(location,atSource?item.identity:item.destinationIdentity??item.identity);if(await fingerprint(path.join(location,'.observanda/access.json'))!==item.accessHash)throw new AppError('STORAGE_RENAME_STATE');const marker=await workspaceRename(location);
   if(marker){if(serialize(marker)!==serialize(this.marker(item)))throw new AppError('STORAGE_RENAME_STATE');if(item.relative)await unlink(path.join(location,RENAME_MARKER));}
  }
  if(atSource){await checkpoint('cancel-projects-cleared',value);await checkpoint('cancel-books-cleared',value);}
  await releasePortabilityCollection(this.root(root),value.ownerKeys);await checkpoint('keys-erased',value);
  const marker=await workspaceRename(root);if(marker){if(serialize(marker)!==serialize(this.marker(await this.owners.get(''))))throw new AppError('STORAGE_RENAME_STATE');await unlink(path.join(root,RENAME_MARKER));}
  await checkpoint(atSource?'cancel-unfrozen':'unfrozen',value);if(atSource)value.phase='cancelled';value.keysReleased=true;await this.command.save(value);
 }
 async discardPrepared(){const value=this.value,root=this.command.scope(value).source;if(await workspaceRename(root))throw new AppError('STORAGE_RENAME_STATE');authenticateKeyring((await readAccess(root)).value,this.vault);await assertProjectMoveDirectory(root,value.identity);await releasePortabilityCollection(this.root(root),value.ownerKeys);if(value.phase==='preparing'){await releasePortabilityCollection(this.registry.workspace,value.owners);value.owners=new NativePortabilityCollection(null,value.owners.id).empty();value.ownerKeys=new NativePortabilityCollection(null,value.ownerKeys.id).empty();}value.phase='cancelled';value.keysReleased=true;await this.command.save(value);}
}
