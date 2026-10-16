import {assertInventoryObligationsSettled} from './inventory-obligation-lifecycle.js';
import {initializeWorkspaceSettings} from './workspace-settings.js';
import {withProjectModuleInitialization} from './project-module-initialization.js';
import {withRetiredRecordCopy} from './project-retired-records.js';
import {workspaceCreationPath,requireWorkspaceName,validateWorkspaceName} from './workspace-names.js';
import {workspaceFiles,workspaceInventory,hashWorkspaceFile as fileHash} from './workspace-inventory.js';
import {CATALOGUE_FILE,CATALOGUE_ARCHIVE,rekeyCatalogue,isCatalogue,verifyCatalogueArchive,openCatalogue} from './research-catalogue.js';
import {backupCatalogue,hasCatalogue,requireDatabase} from './postgres.js';
import {describeContent,writeContent} from './file-content.js';
import {clearVault} from './encryption.js';
import path from 'node:path';
import os from 'node:os';
import {mkdir,readdir,readFile,open,rename,unlink,rmdir,realpath} from 'node:fs/promises';
import {copyFileProgress} from './copy-file-progress.js';
import {withOperationProgress,operationStage,operationAdvance,operationTransfer,operationTransferred} from './operation-progress.js';
import {randomUUID} from 'node:crypto';
import {Workspace,workspaceFile,WORKSPACE_FILE,assertRegular,atomicWrite,serialize} from './storage.js';
import {validateNotebook} from './model.js';
import {validDashboard} from './web/dashboard-model.js';
import {AppError} from './errors.js';
import {readAccess,takeCreatedVault,isEncryptedAccess} from './access.js';
import {assertNotMoving} from './workspace-move-state.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {catalogueBinding,publishCatalogueBinding} from './postgres-activation.js';

export const defaultLocation=()=>path.join(os.homedir(),'Observanda','notebooks','default');
export const preferencesLocation=()=>path.join(os.homedir(),'.observanda','preferences.json');
export {readPreferences,readPreference,rememberLocation,rememberInterface} from './preferences.js';
export async function resolveLocation(input){
  if(typeof input!=='string'||!input.trim()||input.length>4096||/[\x00-\x1f]/.test(input)||!path.isAbsolute(input)||/^\\\\[?.]\\/.test(input))throw new AppError('STORAGE_PATH');
  const location=path.resolve(input.trim());if(location===path.parse(location).root)throw new AppError('STORAGE_PATH');
  const stat=await assertRegular(location,{missing:true,directory:true});
  if(stat)return realpath(location);
  // A missing share/mount must never be silently replaced by recursively created folders.
  const parent=await realpath(path.dirname(location));return path.join(parent,path.basename(location));
}
export async function namedWorkspaceLocation({parent,root,name}){
 validateWorkspaceName(name);
 const input=parent!==undefined?workspaceCreationPath(parent,name):requireWorkspaceName(root,name);
 if(path.dirname(input)===path.dirname(defaultLocation()))await mkdir(path.dirname(input),{recursive:true,mode:0o700});
 // The resolved filesystem spelling is authoritative, including an existing
 // empty destination with different casing on a case-insensitive volume.
 return requireWorkspaceName(await resolveLocation(input),name);
}
export async function inspectLocation(input){
  const root=await resolveLocation(input),stat=await assertRegular(root,{missing:true,directory:true});
  if(!stat)return {root,kind:'new',protected:false};
  await assertNotMoving(root);
  await assertNotDeleting(root);
  const items=await readdir(root);
  if(items.includes('.observanda')){
    await assertRegular(path.join(root,'.observanda'),{directory:true});
    if(await assertRegular(path.join(root,'.observanda','copy-in-progress'),{missing:true}))throw new AppError('STORAGE_INCOMPLETE');
  }
  if(items.includes('observanda.json')||items.includes(WORKSPACE_FILE)){
    const access=await readAccess(root);if(!isEncryptedAccess(access.value))await new Workspace(root).read();return {root,kind:'workspace',protected:!!access.value.password,encrypted:isEncryptedAccess(access.value)};
  }
  return {root,kind:items.length?'occupied':'empty',protected:false};
}
export async function probeLocation(input){
  if(input===defaultLocation()){await assertRegular(os.homedir(),{directory:true});await mkdir(path.dirname(input),{recursive:true,mode:0o700});}
  const info=await inspectLocation(input),parent=info.kind==='new'?path.dirname(info.root):info.root;
  const temporary=path.join(parent,'.observanda-probe-'+randomUUID());
  await mkdir(temporary,{mode:0o700});
  try{
    const a=path.join(temporary,'a'),b=path.join(temporary,'b');
    const handle=await open(a,'wx',0o600);try{await handle.writeFile('Observanda storage check');await handle.sync();}finally{await handle.close();}
    await rename(a,b);if(await readFile(b,'utf8')!=='Observanda storage check')throw new AppError('IO');
    const lock=path.join(temporary,'lock');await mkdir(lock);let exclusive=false;try{await mkdir(lock);}catch(e){if(e.code==='EEXIST')exclusive=true;else throw e;}
    await rmdir(lock);if(!exclusive)throw new AppError('IO');
    return {...info,writable:true};
  }finally{for(const name of ['a','b'])await unlink(path.join(temporary,name)).catch(e=>{if(e.code!=='ENOENT')throw e;});await rmdir(temporary);}
}
export {browseFolders} from './folder-browser.js';
export async function createFolder(parent,name){
  if(typeof parent!=='string'||!path.isAbsolute(parent)||typeof name!=='string'||!name.trim()||name!==name.trim()||name.length>160||/[<>:"/\\|?*\x00-\x1f]/.test(name)||/[. ]$/.test(name)||/^(\.{1,2}|con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(name))throw new AppError('FOLDER_NAME');
  const base=await realpath(parent);await assertRegular(base,{directory:true});
  const target=path.join(base,name);if(path.dirname(target)!==base)throw new AppError('FOLDER_NAME');
  try{await mkdir(target,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new AppError('FOLDER_EXISTS');throw error;}
  return {folder:target};
}
export function storageMap(root,preferencesFile,dataFile='observanda.json',{catalogue=false}={}){
  return {root,preferencesFile:preferencesFile??null,locations:[
    ['Research records, projects, themes and pages',dataFile],['Saved research revisions','.observanda/revisions'],['PostgreSQL catalogue binding',CATALOGUE_FILE],['Portable encrypted research archive',CATALOGUE_ARCHIVE],['Original media and prepared copies','.observanda/media'],['Resources and planning','.observanda/modules.json'],['Module revision history','.observanda/module-history'],['Module recovery checkpoints','.observanda/module-drafts'],['Laboratory records','.observanda/laboratory.json'],['Laboratory revision history','.observanda/laboratory-history'],['Publishing destinations','.observanda/publishing.json'],['Publishing receipts','.observanda/publishing-receipts.json'],['Encrypted access grants','.observanda/access.json'],['Workspace dashboard settings','.observanda/dashboard.observanda']
  ].filter(([,relative])=>!catalogue||![ '.observanda/revisions','.observanda/modules.json','.observanda/module-history','.observanda/module-drafts','.observanda/laboratory.json','.observanda/laboratory-history','.observanda/publishing.json','.observanda/publishing-receipts.json','.observanda/dashboard.observanda'].includes(relative)).map(([label,relative])=>({label:catalogue&&relative===dataFile?'Encrypted workspace descriptor':label,path:path.join(root,relative)}))};
}
export async function initializeLocation(input,book,access,suppliedVault,{dashboard,populate}={}){
  if(populate!==undefined&&(typeof populate!=='function'||!isEncryptedAccess(access)))throw new AppError('INVALID');
  const vault=suppliedVault??takeCreatedVault(access);
  if(isEncryptedAccess(access)&&(!vault?.key||vault.id!==access.vaultId))throw new AppError('ACCESS_LOCKED');
  try{
  validateNotebook(book);if(dashboard!==undefined&&!validDashboard(dashboard))throw new AppError('INVALID');if(isEncryptedAccess(access))await requireDatabase();
  const info=await probeLocation(input);
  if(!['new','empty'].includes(info.kind))throw new AppError('EXISTS');
  if(info.kind==='new')await mkdir(info.root,{mode:0o700});
  const ws=new Workspace(info.root,vault);
  await ws.withLock(async()=>{
    if((await readdir(info.root)).some(name=>name!=='.observanda'))throw new AppError('EXISTS');
    const marker=path.join(info.root,'.observanda','copy-in-progress');await atomicWrite(marker,'initializing\n');
    await atomicWrite(path.join(info.root,'.observanda','access.json'),serialize(access));
    if(isEncryptedAccess(access))await ws.initializeResearch(book,{},async workspace=>{
      await workspace.catalogue(store=>withProjectModuleInitialization(store,book.id,({root})=>initializeWorkspaceSettings(root,{dashboard})));
      if(populate)await populate(workspace);
    });
    else{
      await ws.writeFile(await workspaceFile(info.root),serialize(book));
      validateNotebook(JSON.parse(await ws.readFile(await workspaceFile(info.root),'utf8')));
      if(dashboard)await ws.writeMetadata('.observanda/dashboard.observanda',serialize(dashboard));
    }
    await unlink(marker);
  });
  return info.root;
  }finally{if(!suppliedVault)clearVault(vault);}
}
const within=(parent,child)=>{const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
export async function workspaceManifest(root){
 const files=await Array.fromAsync(workspaceFiles(root));return files.sort((a,b)=>a.path.localeCompare(b.path));
}
async function reviewedInventory(plan,options){
 const current=await workspaceInventory(plan.source,plan.inventorySalt,{projectRoots:plan.projectRoots??[],...options});
 if(current.fingerprint!==plan.fingerprint||current.fileCount!==plan.fileCount||current.bytes!==plan.bytes)throw new AppError('CONFLICT');
 return current;
}
export async function transferDestination(root,input){
  const destination=await resolveLocation(input),source=await realpath(root);
  if(within(source,destination)||within(destination,source))throw new AppError('STORAGE_PATH');
  if(await assertRegular(destination,{missing:true,directory:true})&&(await readdir(destination)).length)throw new AppError('EXISTS');
  return {source,destination,inventorySalt:randomUUID()};
}
export async function copyPlan(root,input,{onProgress,vault=null,projectRoots=[]}={}){
 return withOperationProgress(onProgress,async()=>{
  const plan=await transferDestination(root,input),inventory=await operationStage('review-workspace',{},()=>new Workspace(plan.source,vault).withStorageHandoff(()=>workspaceInventory(plan.source,plan.inventorySalt,{projectRoots}),{detached:true,existing:true}));
  return {...plan,...inventory,...(projectRoots.length?{projectRoots}: {})};
 });
}
export async function copyWorkspaceTo(root,input,options={}){
 return withOperationProgress(options.onProgress,async()=>copyWorkspace(await transferDestination(root,input),options));
}
// A native picker can return a newly created empty folder. Claim it exclusively
// before copying, and recheck after the claim so another app cannot populate it unnoticed.
export async function prepareCopyDestination(expected){
  const destination=await resolveLocation(expected);
  if(destination!==expected)throw new AppError('EXISTS');
  if(await assertRegular(destination,{missing:true,directory:true})){
    if((await readdir(destination)).length)throw new AppError('EXISTS');
  }else await mkdir(destination,{mode:0o700});
  try{await mkdir(path.join(destination,'.observanda'),{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new AppError('EXISTS');throw error;}
  const marker=path.join(destination,'.observanda','copy-in-progress');await atomicWrite(marker,'incomplete\n');
  if((await readdir(destination)).some(name=>name!=='.observanda'))throw new AppError('EXISTS');
  return {destination,marker};
}
export async function copyWorkspace(plan,{vault=null,onProgress,afterCopy,afterVerified,reuseCatalogue=false,activateCatalogue=false,beforePublish,recovery,beforeSnapshot,afterSnapshotVerified,relocation=false}={}){
  if(typeof relocation!=='boolean')throw new AppError('INVALID');
  if(reuseCatalogue&&(activateCatalogue||beforePublish||recovery))throw new AppError('INVALID');
  return withOperationProgress(onProgress,()=>operationStage('copy-workspace',{},async()=>{
   let publication;
   const result=recovery?.snapshotReady?(publication={destination:plan.destination,marker:recovery.marker},plan.destination):await new Workspace(plan.source,vault).withStorageHandoff(async()=>{
    if(!relocation)await assertInventoryObligationsSettled(new Workspace(plan.source,vault));
    if(beforeSnapshot)await beforeSnapshot();
    operationTransfer({phase:'checking',files:0,bytes:0,totalFiles:plan.transferFiles??plan.fileCount,totalBytes:plan.fileBytes??plan.bytes});
    let destination,marker;
    const catalogue=await hasCatalogue(plan.source);
    await workspaceInventory(plan.source,plan.inventorySalt,{projectRoots:plan.projectRoots??[],expected:plan.fingerprint?plan:undefined,consume:async(inventory,items)=>{
     Object.assign(plan,inventory);
     ({destination,marker}=recovery?await recovery.prepare(plan):await prepareCopyDestination(plan.destination));
     operationTransfer({phase:'copying',totalFiles:inventory.transferFiles,totalBytes:inventory.fileBytes});
     await operationStage('copy-files',{total:inventory.transferFiles,unit:'files'},async()=>{for await(const file of items()){
      if([CATALOGUE_FILE,CATALOGUE_ARCHIVE].includes(file.path))continue;
      const target=path.join(destination,file.path);if(!within(destination,target))throw new AppError('UNSAFE');
      if(recovery)await recovery.copyFile(file);
      else {
       await mkdir(path.dirname(target),{recursive:true,mode:0o700});
       await assertRegular(path.join(plan.source,file.path));
       await copyFileProgress(path.join(plan.source,file.path),target,{size:file.bytes,name:file.path,onBytes:bytes=>operationTransferred({bytes})});
       if(await fileHash(target)!==file.sha256)throw new AppError('STORAGE_COPY');
      }
      operationTransferred({files:1});operationAdvance();
     }});
    }});
    operationTransfer({phase:'verifying'});
    await reviewedInventory(plan);
    if(catalogue&&reuseCatalogue){
      // A move keeps the installation's database. Verify that database against
      // the copied files below while the destination is still marked incomplete.
      await publishCatalogueBinding(destination,(await catalogueBinding(plan.source)).id);
    }else if(catalogue){
      if(!recovery?.databaseReady)await backupCatalogue(plan.source,destination);
    }
    if(recovery&&!recovery.databaseReady)await recovery.database();
    const access=await readAccess(destination);if(!isEncryptedAccess(access.value))validateNotebook(JSON.parse(await readFile(await workspaceFile(destination),'utf8')));
    if(vault?.key){
      const target=new Workspace(destination,vault),descriptor=JSON.parse(await target.readFile(await workspaceFile(destination),'utf8'));
      if(catalogue||isCatalogue(descriptor))await withRetiredRecordCopy(new Workspace(plan.source,vault),target,async()=>{
        if(activateCatalogue){
          // Restore and fully verify the independent database exactly once.
          // Opening the verified destination can then reuse its committed binding.
          const checked=await target.openCatalogue();await checked.close();
        }else await verifyCatalogueArchive(target,descriptor);
      });
    }else if(catalogue){
      if(activateCatalogue||reuseCatalogue)throw new AppError('ACCESS_LOCKED');
      const checked=await openCatalogue(destination,{detached:true});await checked.close();
    }
    // Independent project owners copy after this workspace snapshot is closed.
    // Keep the destination incomplete until every required owner is ready.
    if(afterSnapshotVerified)await afterSnapshotVerified(destination);
    if(recovery)await recovery.snapshot();
    if(beforePublish){publication={destination,marker};return destination;}
    await unlink(marker);if(afterVerified)await afterVerified(destination);return destination;
   },{detached:true,existing:true});
   if(publication){await beforePublish(new Workspace(publication.destination,vault));if(recovery)await recovery.published();await unlink(publication.marker);if(afterVerified)await afterVerified(publication.destination);}
   // Stop or relocate an owned database only after its source transaction and
   // connection have closed. A commit cannot be made against a stopped server.
   return afterCopy?afterCopy(result):result;
  }));
}

// Encrypt only into a new, marked destination. Source bytes are never replaced or deleted.
export async function encryptedCopy(plan,access,vault,sourceVault=null,{onProgress}={}){
  if(!isEncryptedAccess(access)||!vault?.key||vault.id!==access.vaultId)throw new AppError('ACCESS_LOCKED');
  return withOperationProgress(onProgress,()=>operationStage('copy-workspace',{},()=>new Workspace(plan.source,sourceVault).withStorageHandoff(async()=>{
    await assertInventoryObligationsSettled(new Workspace(plan.source,sourceVault));
    await reviewedInventory(plan);
    const {destination,marker}=await prepareCopyDestination(plan.destination);
    const source=new Workspace(plan.source,sourceVault),target=new Workspace(destination,vault);
    await atomicWrite(path.join(destination,'.observanda','access.json'),serialize(access));
    const catalogue=await hasCatalogue(plan.source);
    await reviewedInventory(plan,{visit:async file=>{
      if(file.path==='.observanda/access.json'||[CATALOGUE_FILE,CATALOGUE_ARCHIVE].includes(file.path))return;
      const relative=file.path==='observanda.json'&&access.formatVersion===3?WORKSPACE_FILE:file.path;const output=path.join(destination,relative);if(!within(destination,output))throw new AppError('UNSAFE');
      await mkdir(path.dirname(output),{recursive:true,mode:0o700});
      const content=await describeContent(source,path.join(plan.source,file.path));const written=await writeContent(target,output,content.stream());
      const verified=await describeContent(target,output);if(written.size!==content.size||verified.size!==content.size||verified.sha256!==content.sha256)throw new AppError('STORAGE_COPY');
    }});
    await reviewedInventory(plan);
    const copied=JSON.parse(await target.readFile(await workspaceFile(destination),'utf8'));
    // Rekey verifies this descriptor and the target in its creation transaction.
    // Nothing can open the destination until its copy marker is removed below.
    if(catalogue)await rekeyCatalogue(source,target,copied);
    else if(isCatalogue(copied))await verifyCatalogueArchive(target,copied);
    else validateNotebook(copied);
    await unlink(marker);return destination;
  },{detached:true})));
}
