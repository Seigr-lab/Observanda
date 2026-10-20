// Parent lifecycle commands share a bounded inventory of independently owned
// project and book directories. Record and evidence contents are not scanned.
import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {withProjectLifecycle} from './project-lifecycle.js';
import {ProjectRegistry} from './project-registry.js';
import {projectRegistryDescendantPrefix} from './project-registry-locations.js';
import {ProjectStorage} from './project-storage.js';
import {ProjectBookOwners} from './project-book-owners.js';
import {validateRenameProjects} from './rename-owner-receipts.js';
import {withProjectMembership,assertProjectCreationSettled,assertProjectRelocationsSettled} from './project-membership.js';
import {withWriterLease} from './writer-lease.js';
import {catalogueBinding} from './postgres-activation.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {cloneVault,clearVault} from './encryption.js';
import {assertRegular,digest,serialize} from './storage.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {AppError} from './errors.js';
const hash=async file=>digest(await readFile(file));
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
export class WorkspaceProjectOwners {
 bookOwner(storage){return new ProjectBookOwners(storage);}
 constructor(workspace,{registry=null,missingAccessCode='STORAGE_RENAME_PROJECTS'}={}){this.workspace=workspace;this.missingAccessCode=missingAccessCode;this.registry=registry;this.externalRegistry=Boolean(registry);this.keys=new Map();this.bookOwners=new Map();}
 async prepare(withProject,withBook){
  const metadata=(await this.workspace.outline()).metadata;
  this.registry??=new ProjectRegistry(this.workspace,metadata.id);const prefix=projectRegistryDescendantPrefix(this.workspace.root,this.registry.workspace.root);
  const nested=await this.registry.inspect(async view=>{const items=[];for await(const row of view.entries({index:'location',prefix}))items.push(row.entry);return items;});nested.sort((a,b)=>a.root.length-b.root.length||a.projectId.localeCompare(b.projectId));
  if(nested.length&&typeof withProject!=='function')throw new AppError(this.missingAccessCode);
  const projects=[],capturedParents=new Map();
  for(const selected of nested){
   await withProject(selected.projectId,async storage=>{
    await withProjectLifecycle(this.registry,selected.projectId,'open',async()=>{});const entry=await this.registry.locate(selected.projectId);capturedParents.set(entry.projectId,entry.parentId);
    if(storage.root!==entry.root||storage.projectId!==entry.projectId||storage.vault?.id!==entry.vaultId)throw new AppError('CONFLICT');
    if(await realpath(entry.root)!==entry.root)throw new AppError('UNSAFE');
    const outline=await storage.outline(),binding=await catalogueBinding(entry.root),access=await readAccess(entry.root);
    if(outline.metadata.id!==entry.namespaceId||binding?.placement!=='project'||binding.projectId!==entry.projectId)throw new AppError('DATABASE_LOCATION');
    authenticateKeyring(access.value,storage.vault);
    const relative=path.relative(this.workspace.root,entry.root).split(path.sep).join('/');nestedRenameRoot(this.workspace.root,relative);
    projects.push({projectId:entry.projectId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,relative,identity:identity(await assertRegular(entry.root,{directory:true})),accessHash:await hash(path.join(entry.root,'.observanda/access.json'))});
    this.keys.set(entry.projectId,cloneVault(storage.vault));
    const books=this.bookOwner(new ProjectStorage(storage.root,storage.projectId,this.keys.get(entry.projectId)));this.bookOwners.set(entry.projectId,books);await books.prepare(typeof withBook==='function'?(id,use)=>withBook(storage,id,use):undefined);
   });
  }
  const captured=new Map(projects.map(item=>[item.projectId,nestedRenameRoot(this.workspace.root,item.relative)])),expected=new Map(nested.map(entry=>[entry.projectId,{...entry,root:captured.get(entry.projectId),parentId:capturedParents.get(entry.projectId)}]));
  let directory=await this.registry.inspect(async view=>{
   let count=0;for await(const {entry} of view.entries({index:'location',prefix})){
    const saved=expected.get(entry.projectId);if(!saved||['projectId','root','namespaceId','vaultId','parentId'].some(key=>saved[key]!==entry[key]))throw new AppError('CONFLICT');count++;
   }
   if(count!==nested.length)throw new AppError('CONFLICT');return {revision:view.revision,native:view.native};
  });
  if(projects.length&&!directory.native)directory=await this.registry.apply(directory.revision,[]);
  this.revision=directory.revision;this.projects=validateRenameProjects(projects);return this.projects;
 }
 async withStorageHandoff(operation,{checkOwner}={}){
  const entries=[...this.projects].sort((a,b)=>a.projectId.localeCompare(b.projectId));
  const next=async index=>{
   if(index===entries.length)return operation();const item=entries[index],storage=await this.checked(item);
   return withProjectLifecycle(this.registry,item.projectId,'open',()=>storage.withStorageHandoff(async()=>{await this.checked(item);await checkOwner?.(storage);return this.bookOwners.get(item.projectId).withStorageHandoff(()=>next(index+1),{checkOwner});},{existing:true}));
  };
  return next(0);
 }
 async withDirectoryHandoff(operation,{parents:extraParents=[],except=null}={}){
  const entries=[...this.projects].sort((a,b)=>a.projectId.localeCompare(b.projectId));
  const next=index=>index===entries.length?operation():withWriterLease(path.join(nestedRenameRoot(this.workspace.root,entries[index].relative),'.observanda/lab-books.lock'),()=>next(index+1));
  const parents=[this.externalRegistry?this.workspace.projectId:null,...entries.map(item=>item.projectId),...extraParents];
  return withProjectMembership(this.registry,parents,async()=>{await assertProjectCreationSettled(this.registry,parents);await assertProjectRelocationsSettled(this.registry,parents,{except});return next(0);});
 }
 async checked(item){
  const root=nestedRenameRoot(this.workspace.root,item.relative),stat=await assertRegular(root,{directory:true});
  if(await realpath(root)!==root||serialize(identity(stat))!==serialize(item.identity)||await hash(path.join(root,'.observanda/access.json'))!==item.accessHash)throw new AppError('STORAGE_RENAME_STATE');
  const key=this.keys.get(item.projectId);if(!key)throw new AppError('ACCESS_LOCKED');authenticateKeyring((await readAccess(root)).value,key);
  const binding=await catalogueBinding(root);if(binding?.placement!=='project'||binding.projectId!==item.projectId)throw new AppError('DATABASE_LOCATION');
  return new ProjectStorage(root,item.projectId,key);
 }
 close(){for(const books of this.bookOwners.values())books.close();this.bookOwners.clear();for(const key of this.keys.values())clearVault(key);this.keys.clear();}
}
