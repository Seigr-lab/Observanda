// Workspace renames retain paged owner proofs and encrypted recovery keys.
// The device journal owns their namespaces before the first catalogue write.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,realpath,unlink} from 'node:fs/promises';
import {Workspace,assertRegular,atomicWrite,digest,serialize,workspaceFile} from './storage.js';
import {ProjectRegistry} from './project-registry.js';
import {ProjectStorage} from './project-storage.js';
import {LabBookStorage} from './lab-book-storage.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {ProjectBookOwners} from './project-book-owners.js';
import {projectRegistryDescendantPrefix} from './project-registry-locations.js';
import {captureWorkspaceCopyDirectory,validWorkspaceCopyDirectory} from './workspace-copy-directory.js';
import {NativePortabilityCollection,createPortabilityCollection,portabilityCollection,releasePortabilityCollection,validPortabilityCollection} from './portability-collection.js';
import {validNativeRelocationOwner} from './native-relocation-state.js';
import {withScratch} from './scratch-work.js';
import {withProjectMembership,assertProjectCreationSettled,assertProjectRelocationsSettled} from './project-membership.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {projectMoveDirectory,assertProjectMoveDirectory} from './project-move-boundaries.js';
import {assertRenameDatabaseOwners} from './workspace-rename-inventory.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {RENAME_MARKER,workspaceRename,renameScope} from './workspace-rename-state.js';
import {catalogueBinding} from './postgres-activation.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {clearVault} from './encryption.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {assertProjectDatabaseStopped} from './project-postgres.js';
import {assertLabBookDatabaseStopped} from './lab-book-postgres.js';
import {AppError} from './errors.js';
const fingerprint=async file=>digest(await readFile(file));
const relative=(root,location)=>path.relative(root,location).split(path.sep).join('/');
const fields=['kind','relative','projectId','labBookId','namespaceId','vaultId'];
export function validNativeWorkspaceRename(value){
 return value.version===2&&value.ownerDirectoryVersion===1&&validWorkspaceCopyDirectory(value.projectDirectory)&&value.projectDirectory.head.ownerId===value.workspaceId&&validPortabilityCollection(value.owners)&&validPortabilityCollection(value.ownerKeys)&&value.owners.id!==value.ownerKeys.id&&(value.phase==='preparing'||value.owners.count===value.ownerKeys.count)&&(value.keysReleased===undefined||value.keysReleased===true&&value.phase==='complete');
}
export class NativeWorkspaceRename{
 constructor(command,workspace,value){this.command=command;this.workspace=workspace;this.value=value;this.registry=new ProjectRegistry(workspace,value.workspaceId);this.owners=portabilityCollection(workspace,value.owners);}
 static async prepare(command,workspace,value,{withProject,withBook,check=async()=>{},checkpoint=async()=>{}}={}){
  const registry=new ProjectRegistry(workspace,value.workspaceId);value.version=2;value.ownerDirectoryVersion=1;value.projectDirectory=await captureWorkspaceCopyDirectory(registry);value.owners=new NativePortabilityCollection(null,randomUUID()).empty();value.ownerKeys=new NativePortabilityCollection(null,randomUUID()).empty();value.phase='preparing';await command.save(value);await checkpoint('owner-journal',value);
  await withScratch(async proofs=>withScratch(async keys=>{
   const capture=async(storage,extra)=>{
    await check(extra);if(await realpath(storage.root)!==storage.root)throw new AppError('UNSAFE');const access=await readAccess(storage.root),binding=await catalogueBinding(storage.root),metadata=(await storage.outline()).metadata;authenticateKeyring(access.value,storage.vault);
    if(storage.vault?.id!==extra.vaultId||binding?.placement!==extra.kind||binding[extra.kind==='project'?'projectId':'labBookId']!==(extra.labBookId??extra.projectId)||metadata.id!==extra.namespaceId||extra.kind==='lab-book'&&metadata.notebooks[0].projectId!==extra.projectId)throw new AppError('DATABASE_LOCATION');
    const item={...extra,relative:relative(workspace.root,storage.root),identity:await projectMoveDirectory(storage.root),accessHash:await fingerprint(path.join(storage.root,'.observanda/access.json')),descriptorHash:await fingerprint(await workspaceFile(storage.root)),sourceId:binding.id};
    if(!validNativeRelocationOwner(item)||!item.relative||!await proofs.add(item.relative,item))throw new AppError('STORAGE_RENAME_STATE');
    await keys.add(item.relative,{...Object.fromEntries(fields.filter(key=>item[key]!==undefined).map(key=>[key,item[key]])),key:storage.vault.key.toString('base64')});return item;
   };
   await withScratch(async pending=>{
    await registry.inspect(async view=>{if(view.revision!==value.projectDirectory.revision)throw new AppError('CONFLICT');for await(const {entry} of view.entries({index:'location',prefix:projectRegistryDescendantPrefix(workspace.root,workspace.root)}))await pending.add(entry.projectId,entry);});
    for(let initial;(initial=await pending.take())!==undefined;){
     if(typeof withProject!=='function')throw new AppError('STORAGE_RENAME_PROJECTS');
     await withProject(initial.projectId,async project=>{
      const entry=await registry.locate(initial.projectId);if(project.root!==entry.root||project.projectId!==entry.projectId||['namespaceId','vaultId','parentId'].some(key=>initial[key]!==entry[key]))throw new AppError('CONFLICT');
      const ready=new ProjectBookOwners(project),books=new LabBookRegistry(project);await ready.ready({renames:false});if(await books.version()==='new')await books.apply('new',[]);
      // Parent is enqueued before its books; its final directory revision is
      // captured after an admitted callback recovers an interrupted book rename.
      const item=await capture(project,{kind:'project',projectId:entry.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,parentId:entry.parentId,summary:entry.summary??null,bookRevision:await books.version()});let count=0;
      let after=null;do{const page=await books.list({after,limit:32});for(const initialBook of page.items){
       if(typeof withBook!=='function')throw new AppError('STORAGE_RENAME_PROJECTS');await withBook(project,initialBook.labBookId,async book=>{
        const entry=await books.locate(initialBook.labBookId);if(book.root!==entry.root||book.labBookId!==entry.labBookId||['namespaceId','vaultId'].some(key=>entry[key]!==initialBook[key]))throw new AppError('CONFLICT');
        await capture(book,{kind:'lab-book',projectId:project.projectId,labBookId:entry.labBookId,namespaceId:entry.namespaceId,vaultId:entry.vaultId});count++;
       });
      }after=page.next;}while(after);
      await ready.ready();await books.inspect(async directory=>{if(directory.count!==count)throw new AppError('CONFLICT');for await(const {entry} of directory.entries()){const saved=await proofs.get(relative(workspace.root,path.join(project.root,entry.directory)));if(!saved||['labBookId','namespaceId','vaultId'].some(key=>entry[key]!==saved[key]))throw new AppError('CONFLICT');}item.bookRevision=directory.revision;});await proofs.put(item.relative,item);
     });
    }
   });
   value.projectDirectory=await captureWorkspaceCopyDirectory(registry);
   const ordered=async function*(){for(let item;(item=await proofs.take())!==undefined;)yield item;};value.owners=await createPortabilityCollection(workspace,ordered(),{id:value.owners.id});await command.save(value);await checkpoint('owners-retained',value);
   value.ownerKeys=await createPortabilityCollection(workspace,keys.items(),{id:value.ownerKeys.id});await command.save(value);await checkpoint('owner-keys-retained',value);
  }));
  const owners=new NativeWorkspaceRename(command,workspace,value);await owners.verifyDirectory();await owners.current();await owners.inventory();value.phase='prepared';await command.save(value);await checkpoint('owners-prepared',value);return owners;
 }
 async verifyDirectory(){
  const value=this.value;if(!validNativeWorkspaceRename(value)||value.owners.count!==value.ownerKeys.count)throw new AppError('STORAGE_RENAME_STATE');
  await this.workspace.catalogue(async store=>{const collection=new NativePortabilityCollection(store,value.owners.id);await collection.checked(value.owners);await collection.verify(value.owners);let ordinal=0,offset=0;
   do{const page=await collection.page(value.owners,{offset});for(const item of page.items){
    if(!validNativeRelocationOwner(item)||!item.relative||item.destinationId!==undefined)throw new AppError('STORAGE_RENAME_STATE');
    const parentId=item.kind==='project'?item.parentId:item.projectId,parent=parentId===null?null:await collection.find(value.owners,'project',parentId),parentRelative=path.posix.dirname(item.relative);
    if(parentId===null){if(parentRelative!=='.')throw new AppError('STORAGE_RENAME_STATE');}
    else{if(!parent||parent.relative!==parentRelative)throw new AppError('STORAGE_RENAME_STATE');const pointer=await collection.index.find({root:value.owners.roots.project},parentId);if(!pointer||(await collection.row(pointer.revision)).ordinal>=ordinal)throw new AppError('STORAGE_RENAME_STATE');}ordinal++;
   }offset=page.next;}while(offset!==null);
  });
 }
 async use(item,operation){
  const saved=await portabilityCollection(this.workspace,this.value.ownerKeys).get(item.relative);if(!saved||fields.some(key=>saved[key]!==item[key])||typeof saved.key!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(saved.key))throw new AppError('STORAGE_RENAME_STATE');const vault={id:saved.vaultId,key:Buffer.from(saved.key,'base64')};
  try{const root=nestedRenameRoot(this.workspace.root,item.relative);await assertProjectMoveDirectory(root,item.identity);if(await realpath(root)!==root||await fingerprint(path.join(root,'.observanda/access.json'))!==item.accessHash)throw new AppError('STORAGE_RENAME_STATE');authenticateKeyring((await readAccess(root)).value,vault);const binding=await catalogueBinding(root);if(binding?.id!==item.sourceId||binding.placement!==item.kind||binding[item.kind==='project'?'projectId':'labBookId']!==(item.labBookId??item.projectId))throw new AppError('DATABASE_LOCATION');const storage=item.kind==='project'?new ProjectStorage(root,item.projectId,vault):new LabBookStorage(root,item.labBookId,vault),metadata=(await storage.outline()).metadata;if(metadata.id!==item.namespaceId||item.kind==='lab-book'&&metadata.notebooks[0].projectId!==item.projectId)throw new AppError('DATABASE_LOCATION');return await operation(storage);
  }finally{clearVault(vault);}
 }
 async current(){
  await this.registry.inspect(async view=>{if(view.revision!==this.value.projectDirectory.revision)throw new AppError('CONFLICT');let count=0;
   for await(const {entry} of view.entries({index:'location',prefix:projectRegistryDescendantPrefix(this.workspace.root,this.workspace.root)})){const item=await this.owners.find('project',entry.projectId);if(!item||entry.root!==nestedRenameRoot(this.workspace.root,item.relative)||['projectId','namespaceId','vaultId','parentId'].some(key=>entry[key]!==item[key]))throw new AppError('CONFLICT');count++;}
   if(count!==(this.value.owners.roots.project?.count??0))throw new AppError('CONFLICT');
  });
  await assertProjectCreationSettled(this.registry,[null]);await assertProjectRelocationsSettled(this.registry,[null]);
  for await(const item of this.owners.entries({index:'project'})){await assertProjectCreationSettled(this.registry,[item.projectId]);await assertProjectRelocationsSettled(this.registry,[item.projectId]);await this.use(item,async project=>{await new ProjectBookOwners(project).ready();if(await new LabBookRegistry(project).version()!==item.bookRevision)throw new AppError('CONFLICT');});}
 }
 async inventory(){return assertRenameDatabaseOwners(this.workspace.root,{has:async root=>root===this.workspace.root||Boolean(await this.owners.get(relative(this.workspace.root,root)))});}
 marker(item){const value=this.value;return {version:item.kind==='project'?2:3,id:value.id,source:nestedRenameRoot(value.source,item.relative),destination:nestedRenameRoot(value.destination,item.relative),parentSource:value.source,parentDestination:value.destination,relative:item.relative,projectId:item.projectId,...(item.kind==='lab-book'?{labBookId:item.labBookId}:{})};}
 async fence({check=async()=>{},checkpoint=async()=>{}}={}){
  const value=this.value;await this.verifyDirectory();
  if(!await workspaceRename(this.workspace.root))await this.workspace.withStorageHandoff(()=>withProjectMembership(this.registry,[null],async()=>{
   await check();await this.current();if(await fingerprint(await workspaceFile(this.workspace.root))!==value.descriptorHash)throw new AppError('STORAGE_RENAME_STATE');await renameScope(null,()=>checkpoint('prepared',value));await atomicWrite(path.join(this.workspace.root,RENAME_MARKER),serialize({version:1,id:value.id,source:value.source,destination:value.destination}));
  }),{existing:true});
  value.phase='frozen';await this.command.save(value);await checkpoint('frozen',value);
 }
 async freeze({check=async()=>{},checkpoint=async()=>{}}={}){
  const value=this.value;await this.verifyDirectory();
  if(!await workspaceRename(this.workspace.root))await this.fence({check,checkpoint});
  for await(const item of this.owners.entries({reverse:true}))await this.use(item,async storage=>{
   const prior=await workspaceRename(storage.root),marker=this.marker(item);if(prior&&serialize(prior)!==serialize(marker))throw new AppError('STORAGE_RENAME_STATE');
   const freeze=()=>storage.withStorageHandoff(async()=>{await check(item);if(item.kind==='project'&&await new LabBookRegistry(storage).version()!==item.bookRevision)throw new AppError('CONFLICT');if(!prior)await atomicWrite(path.join(storage.root,RENAME_MARKER),serialize(marker));},{existing:true});
   if(item.kind==='project')await withProjectLifecycle(this.registry,item.projectId,'open',freeze);else await freeze();await checkpoint(item.kind==='project'?'project-frozen':'book-frozen',value,item.labBookId??item.projectId);
  });
  await this.current();await this.inventory();
  for await(const item of this.owners.entries({reverse:true}))await this.use(item,async storage=>{
   await check(item);const provider=databaseProvider(),method=item.kind==='project'?'stopProjectForRename':'stopLabBookForRename';if(!provider?.[method])throw new AppError('DATABASE_LOCATION');await provider[method](storage.root,item.labBookId??item.projectId,storage.vault,value.id);
   const lease=await workspaceDatabaseLease(path.join(storage.root,'.observanda/postgresql'));try{await (item.kind==='project'?assertProjectDatabaseStopped:assertLabBookDatabaseStopped)(storage.root,item.labBookId??item.projectId,storage.vault);}finally{await lease.close();}await checkpoint(item.kind==='project'?'project-stopped':'book-stopped',value,item.labBookId??item.projectId);
  });
 }
 async verify(){await this.verifyDirectory();await this.current();for await(const item of this.owners.entries())await this.use(item,async()=>{});}
 async clear({prepared=false,checkpoint=async()=>{}}={}){
  const value=this.value;if(value.keysReleased)return;await assertProjectMoveDirectory(this.workspace.root,value.identity);if(await realpath(this.workspace.root)!==this.workspace.root||await fingerprint(path.join(this.workspace.root,'.observanda/access.json'))!==value.accessHash)throw new AppError('STORAGE_RENAME_STATE');authenticateKeyring((await readAccess(this.workspace.root)).value,this.workspace.vault);
  if(!prepared){await this.verifyDirectory();for await(const item of this.owners.entries({reverse:true})){const root=nestedRenameRoot(this.workspace.root,item.relative);await assertProjectMoveDirectory(root,item.identity);if(await fingerprint(path.join(root,'.observanda/access.json'))!==item.accessHash)throw new AppError('STORAGE_RENAME_STATE');const marker=await workspaceRename(root);if(marker){if(serialize(marker)!==serialize(this.marker(item)))throw new AppError('STORAGE_RENAME_STATE');await unlink(path.join(root,RENAME_MARKER));}}}
  await releasePortabilityCollection(this.workspace,value.ownerKeys);await checkpoint('keys-erased',value);
  if(prepared){await releasePortabilityCollection(this.workspace,value.owners);value.owners=new NativePortabilityCollection(null,value.owners.id).empty();value.ownerKeys=new NativePortabilityCollection(null,value.ownerKeys.id).empty();}
  value.phase='complete';value.keysReleased=true;await this.command.save(value);await checkpoint('keys-released',value);
 }
}
