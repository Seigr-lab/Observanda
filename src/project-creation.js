import {configurationCreationOptions,hasConfigurationCreation,validCreationConfiguration,prepareCreationConfiguration,populateCreationConfiguration,discardCreationConfiguration,localConfigurationSource} from './configuration-creation.js';
import {incomingProjectMove} from './project-incoming-moves.js';
import {withProjectMembership} from './project-membership.js';
import {validateStorageName,requireStorageName,storageCreationPath} from './storage-names.js';
import {assertProjectRoot} from './project-root-boundaries.js';
// A creation request survives both service restart and a lost HTTP reply.
// Its workspace journal owns only the request and wrapped access grants; all
// project content, originals and database files belong to the selected root.
import {withProjectModuleInitialization} from './project-module-initialization.js';
import path from 'node:path';
import {readdir,unlink} from 'node:fs/promises';
import {ACCESS_LIMIT} from './security/keyring.js';
import {initializeProjectLocation} from './project-storage.js';
import {assertRegular,privateDirectory,serialize,digest} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {createNotebook,validateNotebook,MAX_BYTES} from './model.js';
import {createWorkspaceAccess,takeCreatedVault,verifyAccess} from './access.js';
import {clearVault} from './encryption.js';
import {resolveLocation} from './locations.js';
import {researchId} from './web/research-reference.js';
import {revisionText} from './web/revision-model.js';
import {AppError} from './errors.js';
const active=new Set(),intentLimit=2*MAX_BYTES+ACCESS_LIMIT+16384;
export class ProjectCreation{
 constructor(registry,deviceStore,{withConfigurationSource=localConfigurationSource(registry.workspace)}={}){this.registry=registry;this.workspace=registry.workspace;this.deviceStore=deviceStore;this.withConfigurationSource=withConfigurationSource;}
 file(id,completed=false){if(!researchId(id))throw new AppError('INVALID');return path.join(this.workspace.root,'.observanda',completed?'project-created':'project-creation',id+'.obsv');}
 async read(id){
  for(const completed of [true,false]){
   const file=this.file(id,completed);if(!await assertRegular(path.dirname(file),{directory:true,missing:true}))continue;const stat=await assertRegular(file,{missing:true});if(!stat)continue;if(stat.size>intentLimit+256)throw new AppError('FORMAT');let intent;
   try{intent=JSON.parse(await this.workspace.readFile(file,'utf8'));}catch(error){if(error instanceof SyntaxError)throw new AppError('FORMAT');throw error;}
   if(!intent||!['prepared','attached'].includes(intent.phase)||!researchId(intent.projectId)||!/^[a-f0-9]{64}$/.test(intent.fingerprint??''))throw new AppError('FORMAT');
   if(intent.version===1){if(intent.configuration!==undefined&&!validCreationConfiguration(intent.configuration))throw new AppError('FORMAT');if(intent.moduleLayout!==undefined&&intent.moduleLayout!=='domains-and-authoring-v1'||!intent.book||intent.book.projects?.length!==1||intent.book.projects[0].id!==intent.projectId||!path.isAbsolute(intent.root??'')||path.resolve(intent.root)!==intent.root||intent.parentId!==null&&!researchId(intent.parentId)||!researchId(intent.access?.vaultId)||!researchId(intent.book.id))throw new AppError('FORMAT');}
   else if(intent.version!==2||intent.phase!=='attached'||!researchId(intent.namespaceId)||!researchId(intent.vaultId))throw new AppError('FORMAT');
   return {intent,file,completed};
  }
  return null;
 }
 async acknowledge(id,intent){
  const entry=await this.registry.locate(intent.projectId);
  if(entry.namespaceId!==(intent.namespaceId??intent.book.id)||entry.vaultId!==(intent.vaultId??intent.access.vaultId))throw new AppError('CONFLICT');return {project:entry};
 }
 async finish(id,intent,file){
  await discardCreationConfiguration(this.workspace,intent.configuration);
  const directory=await privateDirectory(this.workspace.root,'.observanda/project-created'),target=path.join(directory,id+'.obsv');
  const receipt={version:2,fingerprint:intent.fingerprint,phase:'attached',projectId:intent.projectId,namespaceId:intent.namespaceId??intent.book.id,vaultId:intent.vaultId??intent.access.vaultId};
  // Authenticate against the receipt's final path before retiring the intent.
  // A crash between these writes leaves a readable completed receipt.
  if(intent.version!==2||file!==target)await this.workspace.writeFile(target,serialize(receipt));
  await unlink(this.file(id)).catch(error=>{if(error.code!=='ENOENT')throw error;});
 }
 async pending({after=null,limit=20}={}){
  if(after!==null&&!researchId(after)||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new AppError('INVALID');
  const directory=path.join(this.workspace.root,'.observanda/project-creation');if(!await assertRegular(directory,{directory:true,missing:true}))return {items:[],next:null};
  const ids=(await readdir(directory)).filter(name=>name.endsWith('.obsv')&&researchId(name.slice(0,-5))).map(name=>name.slice(0,-5)).filter(id=>after===null||id>after).sort();
  const items=[],registered=(await this.registry.read()).value.projects;let next=null;
  for(const [index,id] of ids.entries()){
   let saved=await this.read(id);const adopted=saved?.intent.phase==='prepared'&&registered.some(entry=>entry.projectId===saved.intent.projectId);
   if(saved&&!active.has(this.file(id))&&(adopted||saved.intent.phase==='attached')){
    try{await withWriterLease(path.join(directory,id+'.lock'),async()=>{
     // A retry may have completed while discovery waited for its short lease.
     // Re-read the receipt so discovery cannot recreate a consumed request.
     const current=await this.read(id);if(!current)return;
     await this.acknowledge(id,current.intent);await this.finish(id,current.intent,current.file);
    });saved=await this.read(id);}catch(error){if(error.code!=='LOCKED')throw error;}
   }
   if(saved?.intent.phase==='prepared'){const value=saved.intent;
    items.push({id,projectId:value.projectId,title:value.book.projects[0].title,path:value.root,username:value.access.username,password:!!value.access.password,running:active.has(this.file(id))});}
   if(items.length===limit){if(index<ids.length-1)next=id;break;}
  }
  return {items,next};
 }
 async resume(command,options={}){
  if(!command||Object.keys(command).sort().join()!=='id,password,username'||!researchId(command.id)||typeof command.username!=='string'||typeof command.password!=='string')throw new AppError('INVALID');
  const saved=await this.read(command.id);if(!saved)throw new AppError('NOT_FOUND');
  if(saved.intent.phase==='attached')return withWriterLease(path.join(this.workspace.root,'.observanda/project-creation',command.id+'.lock'),async()=>{await options.check?.();const current=await this.read(command.id),result=await this.acknowledge(command.id,current.intent);await this.finish(command.id,current.intent,current.file);return result;});
  const intent=saved.intent;
  return this.create({...command,path:intent.root,project:{...intent.book.projects[0],parentId:intent.parentId}},{...options,resume:true});
 }
 async create(command,{check=async()=>{},resume=false}={}){
  if(!command||!['id,password,path,project,username','id,password,project,username'].includes(Object.keys(command).filter(key=>!configurationCreationOptions.includes(key)).sort().join())||!researchId(command.id)||!researchId(command.project?.id)||typeof command.username!=='string'||typeof command.password!=='string')throw new AppError('INVALID');
  const {password,...request}=command;const fingerprint=digest(revisionText(request));
  // Validate editable content before generating keys or writing a request.
  const parentId=command.project.parentId??null;if(parentId!==null&&!researchId(parentId))throw new AppError('INVALID');
  validateStorageName(command.project.title);
  const draft=createNotebook(command.project.title,command.project.description);draft.projects=[{...command.project,parentId:null}];if(hasConfigurationCreation(command))delete draft.projects[0].labBookTemplate;validateNotebook(draft);
  await check();const directory=await privateDirectory(this.workspace.root,'.observanda/project-creation'),file=path.join(directory,command.id+'.obsv');
  return withWriterLease(path.join(directory,command.id+'.lock'),()=>withWriterLease(path.join(directory,'owner-'+command.project.id+'.lock'),async()=>{
   await check();let intent,vault;active.add(file);
   try{
    const saved=await this.read(command.id);
    if(saved){
     intent=saved.intent;if(!resume&&intent.fingerprint!==fingerprint)throw new AppError('CONFLICT');
     if(intent.projectId!==command.project.id)throw new AppError('CONFLICT');
     if(intent.phase==='attached'){const result=await this.acknowledge(command.id,intent);await this.finish(command.id,intent,saved.file);return result;}
     // Registry attachment is already the adoption boundary. If the service
     // stopped before recording its reply, acknowledge the owner's current
     // location and edits; never initialize the old folder again.
     const existing=(await this.registry.read()).value.projects.find(entry=>entry.projectId===intent.projectId);
     if(existing){const result=await this.acknowledge(command.id,intent);await this.finish(command.id,intent,file);return result;}
     vault=await verifyAccess({value:intent.access},command.username,password,{deviceStore:this.deviceStore});
    }else{
     if(resume)throw new AppError('NOT_FOUND');
     const selected=await prepareCreationConfiguration(this.workspace,command,{projectId:command.project.id,notebookId:null,slot:'labBookTemplate'},{withConfigurationSource:this.withConfigurationSource,check});
     if(selected&&Object.hasOwn(selected,'inline')&&selected.inline)draft.projects[0].labBookTemplate=selected.inline;validateNotebook(draft);
     await withProjectMembership(this.registry,[parentId],async()=>{
     const current=await this.registry.read();
     if(await incomingProjectMove(this.registry,command.project.id))throw new AppError('STORAGE_PROJECT_BUSY');
     if([...current.value.projects,...(current.value.deleted??[]),...(current.value.relocated??[])].some(entry=>entry.projectId===command.project.id))throw new AppError('EXISTS');
     const parent=parentId===null?this.workspace.root:current.value.projects.find(entry=>entry.projectId===parentId)?.root;
     if(!parent)throw new AppError('NOT_FOUND');
     const derived=storageCreationPath(parent,command.project.title),root=command.path===undefined?derived:await resolveLocation(command.path);
     assertProjectRoot(this.workspace.root,root,current.value.projects,{parentId});
     requireStorageName(root,command.project.title);
     if(root!==derived)throw new AppError('STORAGE_PATH');
     const access=await createWorkspaceAccess(command.username,password,this.deviceStore);vault=takeCreatedVault(access);
     intent={version:1,moduleLayout:'domains-and-authoring-v1',fingerprint,phase:'prepared',root,projectId:draft.projects[0].id,parentId:parentId,book:draft,access,...(selected?.frozen?{configuration:selected.frozen}:{})};
     const serialized=serialize(intent);if(Buffer.byteLength(serialized)>intentLimit)throw new AppError('LIMIT');await this.workspace.writeFile(file,serialized);
     });
    }
    await check();
    const populate=intent.moduleLayout==='domains-and-authoring-v1'||intent.configuration?{populateId:'project-domains-and-authoring-v1'+(intent.configuration?':configuration:'+digest(serialize(intent.configuration)):''),populate:async storage=>{if(intent.moduleLayout==='domains-and-authoring-v1')await storage.catalogue(store=>withProjectModuleInitialization(store,intent.book.id,async()=>{}));if(intent.configuration)await populateCreationConfiguration(storage,this.workspace,intent.configuration,{commandId:command.id,projectId:intent.projectId,notebookId:null,slot:'labBookTemplate',withConfigurationSource:this.withConfigurationSource,check});}}:{};
    const project=await initializeProjectLocation(intent.root,intent.projectId,intent.book,intent.access,vault,populate);
    await check();const entry=await this.registry.describe(project,intent.parentId);
    return await withProjectMembership(this.registry,[intent.parentId],async()=>{
    // Only registry membership serializes here. Unrelated project creation and
    // authoring already completed against their independent owners.
    for(let attempt=0;;attempt++){
     const current=await this.registry.read(),existing=current.value.projects.find(item=>item.projectId===intent.projectId);
     if(existing){if(revisionText(existing)!==revisionText(entry))throw new AppError('CONFLICT');break;}
     try{await this.registry.attach(project,{parentId:intent.parentId,expected:current.revision});break;}
     catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;await check();}
    }
    await this.finish(command.id,intent,file);return {project:entry};
    });
   }finally{active.delete(file);clearVault(vault);}
  }));
 }
}
