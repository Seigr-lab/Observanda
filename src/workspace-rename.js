import {clearRenamedBooks} from './project-book-rename.js';
import {assertRenameDatabaseOwners} from './workspace-rename-inventory.js';
import {decodeProjectRegistryLocations} from './project-registry-locations.js';
import {WorkspaceProjectRename,validateRenameProjects,clearRenamedProjects} from './workspace-project-rename.js';
import {RENAME_KEYS_FILE} from './workspace-rename-keys.js';
import {operationStage} from './operation-progress.js';
// A rename moves the existing directory; it never copies its database or media.
// The device journal locates the workspace after a crash on either side of the
// filesystem rename. The workspace marker fences other writers until recovery.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,realpath,rename,unlink} from 'node:fs/promises';
import {Workspace,assertRegular,atomicWrite,serialize,digest,workspaceFile} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {workspaceFolderName,workspaceCreationPath} from './workspace-names.js';
import {synchronizeWorkspaceName} from './workspace-name-state.js';
import {RENAME_MARKER,workspaceRename,renameScope} from './workspace-rename-state.js';
import {catalogueBinding} from './postgres-activation.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {databaseConversionState} from './workspace-database-receipt.js';
import {readMoveReceipt} from './workspace-move.js';
import {MOVE_RECEIPT} from './workspace-move-state.js';
import {unseal} from './encryption.js';
import {AppError} from './errors.js';
const uuid=id=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
const inside=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
const fingerprint=async file=>digest(await readFile(file));
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
export class WorkspaceRenames{
 constructor(directory,{relocate=async()=>{}}={}){this.directory=path.resolve(directory);this.relocate=relocate;}
 file(id){if(!uuid(id))throw new AppError('STORAGE_RENAME_STATE');return path.join(this.directory,id+'.json');}
 async read(id){
  const file=this.file(id),stat=await assertRegular(file);if(stat.size>16*1024*1024)throw new AppError('STORAGE_RENAME_STATE');
  let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch{throw new AppError('STORAGE_RENAME_STATE');}
  if(value?.version!==1||value.id!==id||!['prepared','frozen','moved','complete'].includes(value.phase)||![value.source,value.destination].every(root=>typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root&&root!==path.parse(root).root)||path.dirname(value.source)!==path.dirname(value.destination)||value.source===value.destination||!uuid(value.workspaceId)||!value.identity||!['dev','ino'].every(key=>typeof value.identity[key]==='string')||!['accessHash','descriptorHash'].every(key=>/^[a-f0-9]{64}$/.test(value[key])))throw new AppError('STORAGE_RENAME_STATE');
  if(value.projects!==undefined){validateRenameProjects(value.projects);if(!/^[a-f0-9]{64}$/.test(value.projectKeysHash??'')||!/^[a-f0-9]{64}$/.test(value.projectRegistryRevision??''))throw new AppError('STORAGE_RENAME_STATE');}
  return value;
 }
 async save(value){
  await atomicWrite(this.file(value.id),serialize(value));
  if(value.phase==='prepared')for(const root of [value.source,value.destination])await atomicWrite(path.join(this.directory,digest(root)+'.pointer'),value.id);
 }
 async locked(operation){await mkdir(this.directory,{recursive:true,mode:0o700});await assertRegular(this.directory,{directory:true});return withWriterLease(path.join(this.directory,'write.lock'),operation);}
 async pending(root){
  const file=path.join(this.directory,digest(root)+'.pointer'),stat=await assertRegular(file,{missing:true});if(!stat)return null;
  if(stat.size!==36)throw new AppError('STORAGE_RENAME_STATE');
  const value=await this.read(await readFile(file,'utf8'));if(![value.source,value.destination].includes(root))throw new AppError('STORAGE_RENAME_STATE');
  return value.phase==='complete'?null:value;
 }
 async discard(value){
  // No parent fence was published, so none of the projects was frozen.
  if(value.projects?.length){
   const root=value.source,stat=await assertRegular(root,{directory:true});
   if(!sameIdentity(identity(stat),value.identity)||await fingerprint(path.join(root,'.observanda/access.json'))!==value.accessHash)throw new AppError('STORAGE_RENAME_STATE');
   for(const item of value.projects)await clearRenamedBooks(path.resolve(root,...item.relative.split('/')),item,value);
   const file=path.join(root,RENAME_KEYS_FILE);if(await assertRegular(file,{missing:true})){if(await fingerprint(file)!==value.projectKeysHash)throw new AppError('STORAGE_RENAME_STATE');await unlink(file);}
  }
  // Keep a completed receipt so its existing path pointers remain valid.
  value.phase='complete';await this.save(value);
 }
 async locate(value){
  for(const root of [value.destination,value.source]){
   const stat=await assertRegular(root,{directory:true,missing:true});if(!stat)continue;
   if(await realpath(root)!==root||!sameIdentity(identity(stat),value.identity))continue;
   const marker=await workspaceRename(root);
   if(marker?.id===value.id&&marker.source===value.source&&marker.destination===value.destination&&await fingerprint(path.join(root,'.observanda/access.json'))===value.accessHash)return root;
  }
  throw new AppError('STORAGE_RENAME_STATE');
 }
 async resolvedRoot(root){const value=await this.pending(root);if(!value)return root;if(value.phase==='prepared'&&!await workspaceRename(value.source))return root;return this.locate(value);}
 async begin(workspace,name,{checkpoint=async()=>{},protectedPaths=[],withProject,withBook}={}){
  return this.locked(async()=>{
   const source=await realpath(workspace.root),destination=workspaceCreationPath(path.dirname(source),name);
   if(source===destination){await synchronizeWorkspaceName(workspace);return {source,destination,complete:true};}
   if(source!==workspace.root||[this.directory,...protectedPaths].filter(Boolean).some(p=>inside(source,path.resolve(p))))throw new AppError('STORAGE_PATH');
   if(typeof withProject!=='function'){
    const file=path.join(source,'.observanda/project-registry.observanda');
    if(await assertRegular(file,{missing:true})){
     const registry=decodeProjectRegistryLocations(JSON.parse(await workspace.readFile(file,'utf8')),source);
     if(!Array.isArray(registry.projects))throw new AppError('FORMAT');
     if(registry.projects.some(entry=>typeof entry.root!=='string'||inside(source,entry.root)))throw new AppError('STORAGE_RENAME_PROJECTS');
    }
   }
   const existing=await assertRegular(destination,{directory:true,missing:true});
   if(existing&&await realpath(destination)!==source)throw new AppError('EXISTS');
   const conversion=await databaseConversionState(workspace),move=await readMoveReceipt(source);
   if(conversion&&conversion.phase!=='complete'||move&&move.phase!=='complete')throw new AppError('STORAGE_RENAME_BUSY');
   if(await this.pending(source))throw new AppError('STORAGE_RENAMING');
   const projects=new WorkspaceProjectRename(workspace);
   try{
   await projects.prepare(withProject,withBook);
   await assertRenameDatabaseOwners(source,projects.projects.flatMap(item=>{const root=path.resolve(source,...item.relative.split('/'));return [root,...(projects.bookOwners.get(item.projectId)?.books??[]).map(book=>path.join(root,book.directory))];}));
   const id=randomUUID();let value;
   await projects.withStorageHandoff(()=>projects.withDirectoryHandoff(()=>withWriterLease(path.join(source,'.observanda/project-registry.lock'),()=>workspace.withStorageHandoff(async()=>{
    const outline=await workspace.outline();
    value={version:1,id,source,destination,workspaceId:outline.metadata.id,identity:identity(await assertRegular(source,{directory:true})),descriptorHash:await fingerprint(await workspaceFile(source)),accessHash:await fingerprint(path.join(source,'.observanda/access.json')),completedMove:move,phase:'prepared'};
    await projects.persist(value);await this.save(value);await checkpoint('prepared',value);
    await atomicWrite(path.join(source,RENAME_MARKER),serialize({version:1,id,source,destination}));
   },{existing:true}))));
   value.phase='frozen';await this.save(value);await checkpoint('frozen',value);
   return await this.finishLocked(value,workspace.vault,{checkpoint});
   }finally{projects.close();}
  });
 }
 async resume(root,vault,options={}){
  return this.locked(async()=>{const value=await this.pending(root);if(!value)return {source:root,destination:root,complete:true};
   if(value.phase==='prepared'&&!await workspaceRename(value.source)){await this.discard(value);return {source:root,destination:root,complete:true};}
   return this.finishLocked(value,vault,options);
  });
 }
 async finishLocked(value,vault,{checkpoint=async()=>{}}={}){
  return renameScope(value.id,async()=>{
   let root=await this.locate(value);
   if(root===value.source){
    const projects=new WorkspaceProjectRename(new Workspace(root,vault));
    try{await projects.load(value);await projects.freezeAndStop(value,{checkpoint});}finally{projects.close();}
    if(await fingerprint(await workspaceFile(root))!==value.descriptorHash)throw new AppError('STORAGE_RENAME_STATE');
    const binding=await catalogueBinding(root);let lease;
    try{
     if(binding?.placement==='workspace'){
      const provider=databaseProvider();if(!provider?.stopWorkspaceForRename)throw new AppError('DATABASE_LOCATION');
      await operationStage('rename-stop-database',{},()=>provider.stopWorkspaceForRename(root,vault,value.id));
      lease=await workspaceDatabaseLease(path.join(root,'.observanda/postgresql'),{});
      const bytes=unseal(await readFile(path.join(root,'.observanda/postgresql/service.observanda')),vault?.key,'Observanda/workspace-postgresql/v1/'+vault?.id);
      try{const service=JSON.parse(bytes.toString());if(service.workspaceId!==vault.id||service.running!==false)throw new AppError('DATABASE_WORKSPACE_RUNNING');}finally{bytes.fill(0);}
     }
     if(await realpath(path.dirname(root))!==path.dirname(root)||await this.locate(value)!==root)throw new AppError('STORAGE_RENAME_STATE');
     const existing=await assertRegular(value.destination,{directory:true,missing:true});if(existing&&await realpath(value.destination)!==root)throw new AppError('EXISTS');
     await checkpoint('stopped',value);
     // Windows requires every handle below the directory to be closed. The
     // durable rename marker is checked before and after database admission.
     await lease?.close();lease=null;await operationStage('rename-folder',{},()=>rename(root,value.destination));root=value.destination;
     await checkpoint('renamed',value);value.phase='moved';await this.save(value);
    }finally{await lease?.close();}
   }
   if(value.completedMove){if(value.completedMove.phase!=='complete'||value.completedMove.destination!==value.source)throw new AppError('STORAGE_RENAME_STATE');await atomicWrite(path.join(root,MOVE_RECEIPT),serialize({...value.completedMove,destination:root}));}
   const workspace=new Workspace(root,vault),projects=new WorkspaceProjectRename(workspace);
   try{await projects.load(value);await projects.verify();await checkpoint('projects-verified',value);}finally{projects.close();}
   const outline=await workspace.outline();
   if(outline.metadata.id!==value.workspaceId)throw new AppError('STORAGE_RENAME_STATE');
   await operationStage('rename-settings',{},()=>synchronizeWorkspaceName(workspace));await checkpoint('metadata',value);
   await this.relocate(value.source,value.destination,workspace);await checkpoint('bindings',value);
   // Persist completion before removing the fence. Recovery at this boundary
   // may remove only its own marker, never change a reused original path.
   value.phase='complete';await this.save(value);await checkpoint('complete',value);
   await clearRenamedProjects(root,value);await unlink(path.join(root,RENAME_MARKER));return {id:value.id,source:value.source,destination:root,complete:true};
  });
 }
 async completedSource(root){
  const pointer=path.join(this.directory,digest(root)+'.pointer'),stat=await assertRegular(pointer,{missing:true});if(!stat)return null;
  if(stat.size!==36)throw new AppError('STORAGE_RENAME_STATE');
  const value=await this.read(await readFile(pointer,'utf8'));if(value.phase!=='complete'||value.destination!==root)return null;
  const destination=await assertRegular(root,{directory:true,missing:true});
  if(!destination||!sameIdentity(identity(destination),value.identity)||await fingerprint(path.join(root,'.observanda/access.json'))!==value.accessHash)return null;
  // Directory registration follows the physical rename. Recover that last
  // boundary too, but retain an original path reused by a different folder.
  const source=await realpath(value.source).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  return source===null||source===root?value.source:null;
 }
 async clearCompleted(root){
  const marker=await workspaceRename(root);if(!marker)return;
  const value=await this.read(marker.id);if(value.phase!=='complete'||await this.locate(value)!==root)throw new AppError('STORAGE_RENAME_STATE');
  await clearRenamedProjects(root,value);await unlink(path.join(root,RENAME_MARKER));
 }
}
