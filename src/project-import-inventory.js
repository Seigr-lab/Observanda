import {createPortabilityCollection,portabilityCollection} from './portability-collection.js';
import {withScratch} from './scratch-work.js';
import {workspaceCopyTransferId} from './workspace-copy-directory.js';
import {withProjectTree,validateNativeProjectTree} from './project-tree-manifest.js';
import {inspectArchivedOwnerDirectory} from './owner-directory-archive.js';
// Discover the selected physical tree through owner descriptors and encrypted
// membership. No workspace database or unrelated project payload is consulted.
import path from 'node:path';
import {readdir,realpath} from 'node:fs/promises';
import {Workspace,assertRegular,serialize} from './storage.js';
import {ProjectStorage} from './project-storage.js';
import {LabBookStorage} from './lab-book-storage.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {readProjectTree,validateProjectTree} from './project-tree-manifest.js';
import {readProjectArchiveIdentity} from './project-archive.js';
import {readLabBookArchiveIdentity} from './lab-book-archive.js';
import {catalogueBinding} from './postgres-activation.js';
import {readAccess,verifyAccess} from './access.js';
import {clearVault} from './encryption.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {assertNotMoving} from './workspace-move-state.js';
import {validateStorageName} from './storage-names.js';
import {AppError} from './errors.js';
export const importOwnerStorage=(root,entry,vault)=>entry.kind==='project'?new ProjectStorage(root,entry.projectId,vault):new LabBookStorage(root,entry.labBookId,vault);
export class ProjectImportInventory{
 constructor(deviceStore,credentials){this.deviceStore=deviceStore;this.credentials=credentials;this.keys=new Map();}
 async unlock(root,relative,expected){
  const access=await readAccess(root),credential=this.credentials.find(item=>item.relative===relative)??{username:'',password:'',recovery:''};let vault;
  try{vault=await verifyAccess(access,credential.username,credential.password,{deviceStore:this.deviceStore,recovery:credential.recovery});}
  catch(error){if(['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN','AUTH'].includes(error.code)){const failure=new AppError('PROJECT_IMPORT_ACCESS',[relative,path.basename(root)]);failure.operationNotStarted=true;throw failure;}throw error;}
  if(expected&&(vault.id!==expected.vaultId||typeof expected.accessEtag==='string'&&access.etag!==expected.accessEtag)){clearVault(vault);throw new AppError('CONFLICT');}
  clearVault(this.keys.get(relative));this.keys.set(relative,vault);return {access,vault};
 }
 async owner(root,relative,kind,expected){
  validateStorageName(path.basename(root));await assertNotDeleting(root);await assertNotMoving(root);
  if(await realpath(root)!==root)throw new AppError('UNSAFE');
  if(await assertRegular(path.join(root,'.observanda/copy-in-progress'),{missing:true}))throw new AppError('STORAGE_INCOMPLETE');
  const {access,vault}=await this.unlock(root,relative),binding=await catalogueBinding(root),identity=binding??await (kind==='project'?readProjectArchiveIdentity:readLabBookArchiveIdentity)(root,vault,{verify:false});
  if(binding&&binding.placement!==kind)throw new AppError('DATABASE_LOCATION');
  const ownerId=kind==='project'?'projectId':'labBookId',storage=importOwnerStorage(root,{kind,[ownerId]:identity[ownerId]},vault);
  const namespaceId=binding?(await storage.outline()).metadata.id:identity.namespaceId;
  const entry={kind,relative,[ownerId]:identity[ownerId],namespaceId,vaultId:vault.id,accessEtag:access.etag,archiveDigest:binding?null:identity.archiveDigest};
  if(expected&&['namespaceId','vaultId',ownerId].some(key=>entry[key]!==expected[key]))throw new AppError('DATABASE_LOCATION');
  return {entry,storage};
 }
 async inspect(root){
  const first=await this.owner(root,'','project'),owners=[first.entry],projects=[],queue=[{...first,parentId:null}],namespaces=new Set([first.entry.namespaceId]),ids=new Set([first.entry.projectId]);
  const admit=entry=>{if(owners.length>=8192||namespaces.has(entry.namespaceId)||ids.has(entry.kind==='project'?entry.projectId:entry.labBookId))throw new AppError('STORAGE_COPY');namespaces.add(entry.namespaceId);ids.add(entry.kind==='project'?entry.projectId:entry.labBookId);owners.push(entry);};
  for(let index=0;index<queue.length;index++){
   const current=queue[index],relative=current.entry.relative,registry=new LabBookRegistry(current.storage);
   const inspect=operation=>current.entry.archiveDigest?inspectArchivedOwnerDirectory(registry,current.entry.archiveDigest,operation):registry.inspect(operation);
   await inspect(async listed=>{
   for await(const {entry:book} of listed.entries()){const childRelative=[relative,book.directory].filter(Boolean).join('/'),bookOwner=await this.owner(path.join(current.storage.root,book.directory),childRelative,'lab-book',book);bookOwner.entry.projectId=current.entry.projectId;admit(bookOwner.entry);}
   for(const folder of (await readdir(current.storage.root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    if(folder.name==='.observanda'||(await listed.get(listed.nameKey(folder.name),{index:'location'}))?.state==='active')continue;
    if(!folder.isDirectory()&&!folder.isSymbolicLink())continue;
    const childRoot=path.join(current.storage.root,folder.name);await assertRegular(childRoot,{directory:true});
    if(!await assertRegular(path.join(childRoot,'.observanda/access.json'),{missing:true}))continue;
    if(queue.length>=4096)throw new AppError('LIMIT');const childRelative=[relative,folder.name].filter(Boolean).join('/'),child=await this.owner(childRoot,childRelative,'project');admit(child.entry);child.parentId=current.entry.projectId;queue.push(child);
    projects.push({projectId:child.entry.projectId,namespaceId:child.entry.namespaceId,vaultId:child.entry.vaultId,parentId:child.parentId,relative:childRelative});
   }
   });
  }
  const manifest=validateProjectTree({version:1,projectId:first.entry.projectId,namespaceId:first.entry.namespaceId,vaultId:first.entry.vaultId,projects}),retained=first.entry.archiveDigest?await readProjectTree(first.storage,first.entry):null;
  if(retained&&serialize(retained)!==serialize(manifest))throw new AppError('STORAGE_COPY');return {manifest,owners};
 }
 forget(relative){clearVault(this.keys.get(relative));this.keys.delete(relative);}
 close(){for(const key of this.keys.values())clearVault(key);this.keys.clear();}
// The destination owns staging pages. Archived sources are inspected in encrypted
// scratch and are never restored merely to discover or validate their owners.
 async inspectNative(root,workspace,{id}){
 const first=await this.owner(root,'','project'),header={projectId:first.entry.projectId,namespaceId:first.entry.namespaceId,vaultId:first.entry.vaultId},sourceArchive=first.entry.archiveDigest;
 this.forget('');let owners;
 owners=await withScratch(queue=>createPortabilityCollection(workspace,async append=>{
  const add=async(entry,parentId)=>{const row={...entry,...(entry.kind==='project'?{parentId}:{}),transferId:workspaceCopyTransferId(id,entry.namespaceId),copied:false,restored:false};await append(row);return row;};
  await add(first.entry,null);await queue.add(first.entry.projectId,{entry:first.entry,parentId:null});
  for(let pending;(pending=await queue.take())!==undefined;){
   const currentRoot=path.join(root,...pending.entry.relative.split('/')),{vault}=await this.unlock(currentRoot,pending.entry.relative,pending.entry),storage=importOwnerStorage(currentRoot,pending.entry,vault),registry=new LabBookRegistry(storage),inspect=operation=>pending.entry.archiveDigest?inspectArchivedOwnerDirectory(registry,pending.entry.archiveDigest,operation):registry.inspect(operation);
   try{await inspect(async listed=>{
    for await(const {entry:book} of listed.entries()){
     const relative=[pending.entry.relative,book.directory].filter(Boolean).join('/');try{const found=await this.owner(path.join(currentRoot,book.directory),relative,'lab-book',book);await add({...found.entry,projectId:pending.entry.projectId});}finally{this.forget(relative);}
    }
    // opendir bounds physical enumeration independently of tree size.
    const {opendir}=await import('node:fs/promises');for await(const folder of await opendir(currentRoot)){
     if(folder.name==='.observanda'||(await listed.get(listed.nameKey(folder.name),{index:'location'}))?.state==='active'||!folder.isDirectory()&&!folder.isSymbolicLink())continue;
     const childRoot=path.join(currentRoot,folder.name);await assertRegular(childRoot,{directory:true});if(!await assertRegular(path.join(childRoot,'.observanda/access.json'),{missing:true}))continue;
     const relative=[pending.entry.relative,folder.name].filter(Boolean).join('/');try{const child=await this.owner(childRoot,relative,'project');await add(child.entry,pending.entry.projectId);if(!await queue.add(child.entry.projectId,{entry:child.entry,parentId:pending.entry.projectId}))throw new AppError('STORAGE_COPY');}finally{this.forget(relative);}
    }
   });}finally{this.forget(pending.entry.relative);}
  }
 }));
 const collection=portabilityCollection(workspace,owners),projects=await createPortabilityCollection(workspace,(async function*(){for await(const row of collection.entries())if(row.kind==='project')yield {kind:'project',relative:row.relative,projectId:row.projectId,namespaceId:row.namespaceId,vaultId:row.vaultId,parentId:row.parentId};})()),manifest=validateProjectTree({version:2,...header,projects}),tree=portabilityCollection(workspace,projects);
 await validateNativeProjectTree(tree,manifest);
 if(sourceArchive){const {vault}=await this.unlock(root,'',first.entry);try{const source=importOwnerStorage(root,first.entry,vault),retained=await readProjectTree(source,first.entry);if(retained)await withProjectTree(source,retained,async previous=>{
   if(previous.count!==tree.count)throw new AppError('STORAGE_COPY');for await(const entry of previous.entries()){const actual=await tree.get(entry.relative);if(!actual||['projectId','namespaceId','vaultId','parentId','relative'].some(key=>actual[key]!==entry[key]))throw new AppError('STORAGE_COPY');}
  },{archiveDigest:sourceArchive});}finally{this.forget('');}}
 return {manifest,owners};
 }

}
