import {withSeparateScratchConnections} from './scratch-connection.js';
import {projectMoveDirectory} from './project-move-boundaries.js';
import {NativeWorkspaceRename,validNativeWorkspaceRename} from './workspace-native-rename.js';
import {ProjectRegistry} from './project-registry.js';
import {operationStage} from './operation-progress.js';
// A rename moves the existing directory; it never copies its database or media.
// The device journal locates the workspace after a crash on either side of the
// filesystem rename. The workspace marker fences other writers until recovery.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {atomicReplace as rename} from './atomic-replace.js';
import {createPersistentDirectory as mkdir,unlinkPersistent as unlink,persistRename} from './filesystem-persistence.js';
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
// Strictly below: a case-only rename on a case-insensitive volume is not nested.
const below=(parent,child)=>{const relative=path.relative(parent,child);return relative!==''&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const fingerprint=async file=>digest(await readFile(file));
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
export class WorkspaceRenames{
 constructor(directory,{relocate=async()=>{}}={}){this.directory=path.resolve(directory);this.relocate=relocate;}
 file(id){if(!uuid(id))throw new AppError('STORAGE_RENAME_STATE');return path.join(this.directory,id+'.json');}
 async read(id){
  const file=this.file(id),stat=await assertRegular(file);if(stat.size>16*1024*1024)throw new AppError('STORAGE_RENAME_STATE');
  let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch{throw new AppError('STORAGE_RENAME_STATE');}
  if(value?.version!==2||value.id!==id||!['preparing','prepared','frozen','moved','complete'].includes(value.phase)||![value.source,value.destination].every(root=>typeof root==='string'&&path.isAbsolute(root)&&path.resolve(root)===root&&root!==path.parse(root).root)||value.source===value.destination||below(value.source,value.destination)||below(value.destination,value.source)||!uuid(value.workspaceId)||!value.identity||!['dev','ino'].every(key=>typeof value.identity[key]==='string')||!['accessHash','descriptorHash'].every(key=>/^[a-f0-9]{64}$/.test(value[key])))throw new AppError('STORAGE_RENAME_STATE');
  if(stat.size>32768||!validNativeWorkspaceRename(value))throw new AppError('STORAGE_RENAME_STATE');
  // Rename journals record owners in the workspace database, never as nested project lists.
  if(value.projects!==undefined)throw new AppError('STORAGE_RENAME_STATE');
  return value;
 }
 async save(value){
  await atomicWrite(this.file(value.id),serialize(value));
  if(['preparing','prepared'].includes(value.phase))for(const root of [value.source,value.destination])await atomicWrite(path.join(this.directory,digest(root)+'.pointer'),value.id);
 }
 async locked(operation){await mkdir(this.directory,{recursive:true,mode:0o700});await assertRegular(this.directory,{directory:true});return withWriterLease(path.join(this.directory,'write.lock'),operation);}
 async journal(root){
  const file=path.join(this.directory,digest(root)+'.pointer'),stat=await assertRegular(file,{missing:true});if(!stat)return null;
  if(stat.size!==36)throw new AppError('STORAGE_RENAME_STATE');
  const value=await this.read(await readFile(file,'utf8'));if(![value.source,value.destination].includes(root))throw new AppError('STORAGE_RENAME_STATE');
  return value;
 }
 async pending(root){const value=await this.journal(root);return value?.phase==='complete'&&!await workspaceRename(value.destination)?null:value;}
 async recovery(root){
  const value=await this.journal(root);if(!value)return null;
  if(value.phase==='complete'){
   if(await workspaceRename(value.destination)){return {value,root:await this.locate(value)};}
   if(root===value.source&&await this.completedSource(value.destination)===value.source)return {value,root:value.destination};
   return null;
  }
  if(['preparing','prepared'].includes(value.phase)&&!await workspaceRename(value.source)){
   const stat=await assertRegular(value.source,{directory:true});
   if(await realpath(value.source)!==value.source||!sameIdentity(await projectMoveDirectory(value.source),value.identity)||await fingerprint(path.join(value.source,'.observanda/access.json'))!==value.accessHash)throw new AppError('STORAGE_RENAME_STATE');
   return {value,root:value.source};
  }
  return {value,root:await this.locate(value)};
 }
 async discard(value,vault){
  // Clearing keeps a completed receipt so its existing path pointers remain valid.
  return new NativeWorkspaceRename(this,new Workspace(value.source,vault),value).clear({prepared:true});
 }
 async locate(value){
  for(const root of [value.destination,value.source]){
   const stat=await assertRegular(root,{directory:true,missing:true});if(!stat)continue;
   if(await realpath(root)!==root||!sameIdentity(await projectMoveDirectory(root),value.identity))continue;
   const marker=await workspaceRename(root);
   if(marker?.id===value.id&&marker.source===value.source&&marker.destination===value.destination&&await fingerprint(path.join(root,'.observanda/access.json'))===value.accessHash)return root;
  }
  throw new AppError('STORAGE_RENAME_STATE');
 }
 async resolvedRoot(root){const value=await this.pending(root);if(!value)return root;if(['preparing','prepared'].includes(value.phase)&&!await workspaceRename(value.source))return root;return this.locate(value);}
 // A new parent moves the whole stopped workspace folder on the same volume:
 // its database cluster, cluster identity and every owner binding travel with
 // it unchanged. Projects and lab books are fenced and verified as for a rename.
 // The workspace database stops while its folder moves. Scratch work for the
 // rename therefore uses the separate scratch database, never this workspace's.
 begin(...args){return withSeparateScratchConnections(()=>this.beginUnscoped(...args));}
 resume(...args){return withSeparateScratchConnections(()=>this.resumeUnscoped(...args));}
 async beginUnscoped(workspace,name,{checkpoint=async()=>{},protectedPaths=[],withProject,withBook,check=async()=>{},parent}={}){
  return this.locked(async()=>{
   const source=await realpath(workspace.root),destination=workspaceCreationPath(parent===undefined?path.dirname(source):await realpath(parent),name);
   if(below(source,destination))throw new AppError('STORAGE_PATH');
   if(source===destination){await synchronizeWorkspaceName(workspace);return {source,destination,complete:true};}
   if(source!==workspace.root||[this.directory,...protectedPaths].filter(Boolean).some(p=>inside(source,path.resolve(p))))throw new AppError('STORAGE_PATH');
   if(typeof withProject!=='function'){
    const metadata=(await workspace.outline()).metadata;
    await new ProjectRegistry(workspace,metadata.id).inspect(async view=>{for await(const {entry} of view.entries())if(inside(source,entry.root))throw new AppError('STORAGE_RENAME_PROJECTS');});
   }
   const existing=await assertRegular(destination,{directory:true,missing:true});
   if(existing&&await realpath(destination)!==source)throw new AppError('EXISTS');
   const conversion=await databaseConversionState(workspace),move=await readMoveReceipt(source);
   if(conversion&&conversion.phase!=='complete'||move&&move.phase!=='complete')throw new AppError('STORAGE_RENAME_BUSY');
   if(await this.pending(source))throw new AppError('STORAGE_RENAMING');
   // Only an unlocked database-backed workspace can be renamed.
   if(!workspace.vault)throw new AppError('ACCESS_LOCKED');
   if(await workspace.storageKind()!=='catalogue')throw new AppError('STORAGE_UPGRADE_REQUIRED');
   const value={version:2,id:randomUUID(),source,destination,workspaceId:(await workspace.outline()).metadata.id,identity:await projectMoveDirectory(source),descriptorHash:await fingerprint(await workspaceFile(source)),accessHash:await fingerprint(path.join(source,'.observanda/access.json')),completedMove:move,phase:'preparing'};
   try{const owners=await NativeWorkspaceRename.prepare(this,workspace,value,{withProject,withBook,check,checkpoint});await renameScope(value.id,()=>owners.fence({check,checkpoint}));return await this.finishLocked(value,workspace.vault,{checkpoint,check});}
   catch(error){if(!await workspaceRename(source)&&await assertRegular(this.file(value.id),{missing:true})){try{await this.discard(await this.read(value.id),workspace.vault);}catch{/* The journal retains cleanup authority for the next authenticated resume. */}}throw error;}
  });
 }
 async resumeUnscoped(root,vault,options={}){
  return this.locked(async()=>{const value=await this.pending(root);if(!value)return {source:root,destination:root,complete:true};
   if(['preparing','prepared'].includes(value.phase)&&!await workspaceRename(value.source)){await this.discard(value,vault);return {source:root,destination:root,complete:true};}
   return this.finishLocked(value,vault,options);
  });
 }
 async finishLocked(value,vault,{checkpoint=async()=>{},check=async()=>{}}={}){
  return renameScope(value.id,async()=>{
   let root=await this.locate(value);
   if(value.phase==='complete'){await this.clearCompleted(root,vault,{checkpoint});return {id:value.id,source:value.source,destination:root,complete:true};}
   if(root===value.destination&&['prepared','frozen'].includes(value.phase))await persistRename(value.source,value.destination);
   if(root===value.source){
    await new NativeWorkspaceRename(this,new Workspace(root,vault),value).freeze({checkpoint,check});
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
     // Windows realpath may omit the trailing separator of a UNC share root.
     const parent=path.dirname(root),target=path.dirname(value.destination);
     if(path.resolve(await realpath(parent))!==path.resolve(parent)||path.resolve(await realpath(target))!==path.resolve(target)||await this.locate(value)!==root)throw new AppError('STORAGE_RENAME_STATE');
     const existing=await assertRegular(value.destination,{directory:true,missing:true});if(existing&&await realpath(value.destination)!==root)throw new AppError('EXISTS');
     await checkpoint('stopped',value);
     // Windows requires every handle below the directory to be closed. The
     // durable rename marker is checked before and after database admission.
     await lease?.close();lease=null;await operationStage('rename-folder',{},()=>rename(root,value.destination));root=value.destination;
     await checkpoint('renamed',value);value.phase='moved';await this.save(value);
    }finally{await lease?.close();}
   }
   if(value.completedMove){if(value.completedMove.phase!=='complete'||value.completedMove.destination!==value.source)throw new AppError('STORAGE_RENAME_STATE');await atomicWrite(path.join(root,MOVE_RECEIPT),serialize({...value.completedMove,destination:root}));}
   const workspace=new Workspace(root,vault);
   await new NativeWorkspaceRename(this,workspace,value).verify();
   await checkpoint('projects-verified',value);
   const outline=await workspace.outline();
   if(outline.metadata.id!==value.workspaceId)throw new AppError('STORAGE_RENAME_STATE');
   await operationStage('rename-settings',{},()=>synchronizeWorkspaceName(workspace));await checkpoint('metadata',value);
   await this.relocate(value.source,value.destination,workspace);await checkpoint('bindings',value);
   // Persist completion before removing the fence. Recovery at this boundary
   // may remove only its own marker, never change a reused original path.
   value.phase='complete';await this.save(value);await checkpoint('complete',value);
   await new NativeWorkspaceRename(this,workspace,value).clear({checkpoint});await unlink(path.join(root,RENAME_MARKER));return {id:value.id,source:value.source,destination:root,complete:true};
  });
 }
 async completedSource(root){
  const pointer=path.join(this.directory,digest(root)+'.pointer'),stat=await assertRegular(pointer,{missing:true});if(!stat)return null;
  if(stat.size!==36)throw new AppError('STORAGE_RENAME_STATE');
  const value=await this.read(await readFile(pointer,'utf8'));if(value.phase!=='complete'||value.destination!==root)return null;
  const destination=await assertRegular(root,{directory:true,missing:true});
  if(!destination||!sameIdentity(await projectMoveDirectory(root),value.identity)||await fingerprint(path.join(root,'.observanda/access.json'))!==value.accessHash)return null;
  // Directory registration follows the physical rename. Recover that last
  // boundary too, but retain an original path reused by a different folder.
  const source=await realpath(value.source).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  return source===null||source===root?value.source:null;
 }
 async clearCompleted(root,vault,{checkpoint=async()=>{}}={}){
  const marker=await workspaceRename(root);if(!marker)return;
  const value=await this.read(marker.id);if(value.phase!=='complete'||await this.locate(value)!==root)throw new AppError('STORAGE_RENAME_STATE');
  if(!vault&&!value.keysReleased)return;await renameScope(value.id,()=>new NativeWorkspaceRename(this,new Workspace(root,vault),value).clear({checkpoint}));await unlink(path.join(root,RENAME_MARKER));
 }
}
