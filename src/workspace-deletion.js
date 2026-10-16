import {assertInventoryObligationsSettled} from './inventory-obligation-lifecycle.js';
import {assertRenameDatabaseOwners} from './workspace-rename-inventory.js';
import {WorkspaceProjectDeletion} from './workspace-project-deletion.js';
import {ProjectRegistry} from './project-registry.js';
import {validateRenameProjects} from './rename-owner-receipts.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {deletionScope} from './workspace-delete-state.js';
import {researchId} from './web/research-reference.js';
import {mkdir} from 'node:fs/promises';
import {workspaceFolderName} from './workspace-names.js';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {OwnedStorageDeletions,ownedDeletionDirectory} from './owned-storage-deletion.js';
import {catalogueBinding} from './postgres-activation.js';
import {openCatalogue} from './postgres.js';
import {databaseProvider} from './workspace-database-context.js';
import {databaseConversionState} from './workspace-database-receipt.js';
import {readMoveReceipt} from './workspace-move.js';
import {Workspace,assertRegular,digest,serialize} from './storage.js';
import {unseal} from './encryption.js';
import {AppError} from './errors.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
async function readyForDeletion(workspace,binding){
 const conversion=await databaseConversionState(workspace),move=await readMoveReceipt(workspace.root);
 if(conversion&&conversion.phase!=='complete'||move&&move.phase!=='complete'||binding?.placement!=='workspace'&&await assertRegular(path.join(workspace.root,'.observanda/postgresql/service.observanda'),{missing:true}))throw new AppError('STORAGE_DELETE_BUSY');
}
export class WorkspaceDeletions extends OwnedStorageDeletions{
 constructor(directory,{command=false}={}){super(directory);this.command=command;this.receiptLimit=16*1024*1024;}
 async lease(source){const directory=path.join(this.directory,'owners',digest(path.resolve(source)));await mkdir(directory,{recursive:true,mode:0o700});await assertRegular(directory,{directory:true});return workspaceDatabaseLease(directory);}
 async inventory(workspace){
  if((await this.binding(workspace.root))?.placement!=='workspace')return {};
  const metadata=(await workspace.outline()).metadata,registry=new ProjectRegistry(workspace,metadata.id),directory=await registry.read(),roots=new Map(directory.value.projects.map(item=>[item.projectId,item.root])),projectDirectories=[];
  for(const entry of directory.value.projects){
   const relative=path.relative(workspace.root,entry.root);if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))continue;
   const parent=entry.parentId===null?workspace.root:roots.get(entry.parentId);if(path.dirname(entry.root)!==parent)throw new AppError('STORAGE_DELETE_CONTENTS');
   projectDirectories.push(relative.split(path.sep).join('/'));
  }
  return {workspaceId:metadata.id,projectRegistryRevision:directory.revision,projectDirectories:projectDirectories.sort()};
 }
 validReceipt(value){
  if(value.projectDirectories!==undefined){if(!researchId(value.workspaceId)||typeof value.projectRegistryRevision!=='string'||!Array.isArray(value.projectDirectories)||value.projectDirectories.length>50000||new Set(value.projectDirectories).size!==value.projectDirectories.length)return false;for(const relative of value.projectDirectories)nestedRenameRoot(value.source,relative);}
  if(value.projects!==undefined){validateRenameProjects(value.projects);if(!/^[a-f0-9]{64}$/.test(value.projectKeysHash??'')||serialize(value.projects.map(item=>item.relative).sort())!==serialize(value.projectDirectories))return false;}
  return true;
 }
 ownedDirectory(root,value){return ownedDeletionDirectory(root,[...new Set((value?.projectDirectories??[]).map(relative=>relative.split('/')[0]))]);}
 handoff(workspace,operation){
  if(!this.owners)return super.handoff(workspace,operation);
  return this.owners.withStorageHandoff(()=>workspace.withStorageHandoff(()=>this.owners.withDirectoryHandoff(async()=>{
   const roots=this.owners.projects.flatMap(item=>{const root=nestedRenameRoot(workspace.root,item.relative);return [root,...this.owners.bookOwners.get(item.projectId).books.map(book=>path.join(root,book.directory))];});
   await assertRenameDatabaseOwners(workspace.root,roots,{stage:'delete-check-owners',errorCode:'STORAGE_DELETE_CONTENTS'});return operation();
  }),{existing:true}),{checkOwner:assertInventoryObligationsSettled});
 }
 prepareReceipt(workspace,value){return this.owners?.persist(value);}
 async begin(workspace,review,options={}){
  if(!this.command)return new WorkspaceDeletions(this.directory,{command:true}).begin(workspace,review,options);
  try{
   if(review.binding?.placement==='workspace'){
    this.owners=new WorkspaceProjectDeletion(workspace);await this.owners.prepare(options.withProject,options.withBook);
    if(this.owners.revision!==review.projectRegistryRevision||serialize(this.owners.projects.map(item=>item.relative).sort())!==serialize(review.projectDirectories))throw new AppError('CONFLICT');
   }
   return await super.begin(workspace,review,options);
  }finally{this.owners?.close();this.owners=null;}
 }
 finish(id,options){return this.command?super.finish(id,options):new WorkspaceDeletions(this.directory,{command:true}).finish(id,options);}

 async review(workspace,options){const plan=await super.review(workspace,options);return {...plan,title:workspaceFolderName(plan.source)};}
 binding(root){return catalogueBinding(root);}
 validBinding(value){return value===null||/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value?.id??'')&&[1,2].includes(value?.version);}
 ready(workspace,binding){return readyForDeletion(workspace,binding);}
 async stopDatabase(root,value,vault,id,{checkpoint=async()=>{}}={}){
 if(value.binding?.placement==='workspace'){
  const owners=new WorkspaceProjectDeletion(new Workspace(root,vault));
  try{await deletionScope(id,async()=>{await owners.load(value);await owners.stop(value,{checkpoint});});}finally{owners.close();}
  const provider=databaseProvider();if(provider?.stopWorkspaceForDeletion)await provider.stopWorkspaceForDeletion(root,vault,id);else await provider?.closeWorkspace(root);
  const databaseLease=await workspaceDatabaseLease(path.join(root,'.observanda/postgresql'));
  try{
   const bytes=unseal(await readFile(path.join(root,'.observanda/postgresql/service.observanda')),vault?.key,'Observanda/workspace-postgresql/v1/'+vault?.id);
   try{const service=JSON.parse(bytes.toString());if(service.workspaceId!==vault.id||service.running!==false)throw new AppError('DATABASE_WORKSPACE_RUNNING');}finally{bytes.fill(0);}
  }finally{await databaseLease.close();}
 }else if(value.binding&&!value.databaseRemoved){
  const env=databaseProvider()?await databaseProvider().environment(root,{vault}):undefined;
  let db;
  try{
   db=await openCatalogue(root,{detached:true,deleteId:id,env});
   await db.run('BEGIN');await db.lock();await db.run("SET LOCAL lock_timeout='3s'");
   await db.run('DROP SCHEMA "'+db.schema+'" CASCADE');await db.run('COMMIT');
  }catch(error){if(error.code!=='CATALOGUE_UNAVAILABLE')throw error;}finally{await db?.close();}
 }

 }
}
