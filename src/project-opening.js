import {ProjectImports} from './project-import.js';
import {projectRegistryLocationKey} from './project-registry-locations.js';
import {readProjectArchiveIdentity} from './project-archive.js';
import {projectPortableReferences} from './project-portable-references.js';
import {ProjectReferenceAliases} from './project-reference-aliases.js';
import {withProjectLifecycle} from './project-lifecycle.js';
import {researchId} from './web/research-reference.js';
import {realpath} from 'node:fs/promises';
import {resolveLocation} from './locations.js';
import {catalogueBinding} from './postgres-activation.js';
import {validProjectCatalogueBinding} from './project-catalogue-owner.js';
import {ProjectStorage} from './project-storage.js';
import {readAccess,verifyAccess} from './access.js';
import {clearVault} from './encryption.js';
import {AppError} from './errors.js';
// Registered projects reopen in place. A newly selected folder enters the
// recoverable import workflow so its physical nesting matches the workspace.
export class ProjectOpening{
 constructor(registry,deviceStore){this.registry=registry;this.deviceStore=deviceStore;}
 async open(command,options={}){
  if(typeof command?.path!=='string')throw new AppError('INVALID');
  const root=await resolveLocation(command.path),located=await this.registry.state(projectRegistryLocationKey(root,this.registry.workspace.root),{index:'location'}),existing=located.state==='active'?located.entry:null;
  if(!existing)return new ProjectImports(this.registry,this.deviceStore).run(command,options);
  if(command.parentId!==undefined&&command.parentId!==existing.parentId)throw new AppError('CONFLICT');
  const {owners,parentId,...selected}=command;return this.openRegistered(selected,options);
 }
 async openRegistered(command,{check=async()=>{},identified=()=>{},opened=async()=>{},checkpoint=async()=>{}}={}){
  if(!command||Object.keys(command).sort().join()!=='id,password,path,recovery,username'||!researchId(command.id)||['username','password','recovery'].some(key=>typeof command[key]!=='string'||command[key].length>1024))throw new AppError('INVALID');
  await check();const root=await resolveLocation(command.path),workspaceRoot=await realpath(this.registry.workspace.root);
  if(workspaceRoot!==this.registry.workspace.root)throw new AppError('UNSAFE');
  const boundary=()=>this.registry.assertRoot(root,{existing:true});
  await boundary();let binding=await catalogueBinding(root);
  if(binding&&!validProjectCatalogueBinding(binding))throw new AppError('PROJECT_FOLDER');
  if(binding){const prior=await this.registry.state(binding.projectId);if(prior.state==='active'&&prior.entry.root!==root)throw new AppError('PROJECT_LOCATION_EXISTS');}
  const access=await readAccess(root);if(access.value.formatVersion!==3)throw new AppError('ACCESS_FORMAT');let vault;
  try{
   vault=await verifyAccess(access,command.username,command.password,{deviceStore:this.deviceStore,recovery:command.recovery});await check();
   const identity=binding??await readProjectArchiveIdentity(root,vault);
  return await withProjectLifecycle(this.registry,identity.projectId,'open',async()=>{
  const registered=await this.registry.state(identity.projectId);if(registered.state==='active'&&registered.entry.root!==root)throw new AppError('PROJECT_LOCATION_EXISTS');
  identified(identity.projectId);await check();
   const storage=new ProjectStorage(root,identity.projectId,vault);
   if(!binding&&(await storage.outline()).metadata.id!==identity.namespaceId)throw new AppError('DATABASE_LOCATION');
   const entry=await this.registry.describe(storage,null);
   if(!binding){if(entry.namespaceId!==identity.namespaceId)throw new AppError('DATABASE_LOCATION');binding=await catalogueBinding(root);if(!validProjectCatalogueBinding(binding)||binding.projectId!==identity.projectId)throw new AppError('DATABASE_LOCATION');}
   const portable=await projectPortableReferences(storage,entry),aliases=new ProjectReferenceAliases(this.registry.workspace);
   const currentOwner=async()=>{await check();if(await realpath(root)!==root||(await readAccess(root)).etag!==access.etag||JSON.stringify(await catalogueBinding(root))!==JSON.stringify(binding))throw new AppError('CONFLICT');};
   await currentOwner();await checkpoint('read');let saved;
   for(let attempt=0;;attempt++){
    await currentOwner();await boundary();const current=await this.registry.inspect(async view=>{
     const row=await view.get(entry.projectId),existing=row?.state==='active'?row.entry:null;
     if(!existing)for(const [index,key] of [['location',projectRegistryLocationKey(root,this.registry.workspace.root)],['namespace',entry.namespaceId],['vault',entry.vaultId]]){
      const other=await view.get(key,{index});if(other&&other.entry.projectId!==entry.projectId)throw new AppError('DATABASE_LOCATION');
     }
     return {revision:view.revision,aliases:view.aliases,existing};
    }),existing=current.existing;
    if(existing){if(existing.root!==root)throw new AppError('PROJECT_LOCATION_EXISTS');if(existing.vaultId!==entry.vaultId||existing.namespaceId!==entry.namespaceId)throw new AppError('DATABASE_LOCATION');saved=existing;if(!portable)break;}
    try{
     const root=portable?await aliases.prepare(current.aliases??null,portable.owner,portable.targets()):current.aliases??null;await currentOwner();
     if(existing){if(JSON.stringify(root)!==JSON.stringify(current.aliases??null))await this.registry.apply(current.revision,[],{aliases:root});}
     else await this.registry.registerExisting(current.revision,entry,{aliases:root});saved=existing??entry;break;
    }
    catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
   }
   await checkpoint('registered');await currentOwner();await opened(saved,access,vault);return {project:saved};
  });
  }finally{clearVault(vault);}
 }
}
