import {configurationCreationOptions,hasConfigurationCreation,validCreationConfiguration,prepareCreationConfiguration,populateCreationConfiguration,discardCreationConfiguration,localConfigurationSource} from './configuration-creation.js';
import {projectSummaryForBook} from './configuration-metadata.js';
import {assertBookPlacementAvailable} from './lab-book-placement-state.js';
import path from 'node:path';
import {readdir,opendir,unlink} from 'node:fs/promises';
import {projectTransferRunning,trackProjectTransfer} from './project-transfer-tasks.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {initializeLabBookLocation} from './lab-book-initialization.js';
import {createNotebook,validateNotebook,MAX_BYTES} from './model.js';
import {ACCESS_LIMIT} from './security/keyring.js';
import {createWorkspaceAccess,takeCreatedVault,verifyAccess} from './access.js';
import {clearVault} from './encryption.js';
import {privateDirectory,assertRegular,digest,serialize} from './storage.js';
import {storageCreationPath,validateStorageName} from './storage-names.js';
import {withWriterLease} from './writer-lease.js';
import {revisionText} from './web/revision-model.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const intentLimit=2*MAX_BYTES+ACCESS_LIMIT+16384;
const nameKey=name=>process.platform==='win32'||process.platform==='darwin'?name.normalize('NFC').toLowerCase():name;
export class LabBookCreation{
 constructor(project,deviceStore,{publish=async()=>{},withConfigurationSource=localConfigurationSource(project)}={}){this.publish=publish;this.project=project;this.registry=new LabBookRegistry(project);this.deviceStore=deviceStore;this.withConfigurationSource=withConfigurationSource;}
 file(id,completed=false){if(!researchId(id))throw new AppError('INVALID');return path.join(this.project.root,'.observanda',completed?'lab-book-created':'lab-book-creation',id+'.obsv');}
 async read(id){
  const completed=this.file(id,true),file=await assertRegular(completed,{missing:true})?completed:this.file(id),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>intentLimit+128)throw new AppError('LIMIT');let value;
  try{value=JSON.parse(await this.project.readFile(file,'utf8'));}catch(error){if(error instanceof SyntaxError)throw new AppError('FORMAT');throw error;}
  if(!value||value.version!==1||!['prepared','attached'].includes(value.phase)||!researchId(value.labBookId)||!/^[a-f0-9]{64}$/.test(value.fingerprint??'')||!researchId(value.namespaceId)||!researchId(value.vaultId))throw new AppError('FORMAT');
  const fields=value.phase==='prepared'?'access,book,directory,fingerprint,labBookId,namespaceId,phase,vaultId,version':'fingerprint,labBookId,namespaceId,phase,vaultId,version';
  if(Object.keys(value).filter(key=>key!=='configuration').sort().join()!==fields||value.configuration!==undefined&&(value.phase!=='prepared'||!validCreationConfiguration(value.configuration)))throw new AppError('FORMAT');
  if(value.phase==='prepared'){
   validateStorageName(value.directory,{nameError:'FORMAT'});validateNotebook(value.book);
   if(value.directory.toLowerCase()==='.observanda'||value.book.id!==value.namespaceId||value.book.notebooks.length!==1||value.book.notebooks[0].id!==value.labBookId||value.book.notebooks[0].title!==value.directory||value.book.projects.length!==1||value.book.projects[0].id!==this.project.projectId||value.access?.vaultId!==value.vaultId)throw new AppError('FORMAT');
  }
  return value;
 }
 async acknowledge(id,intent){
  const entry=await this.registry.locate(intent.labBookId);if(entry.namespaceId!==intent.namespaceId||entry.vaultId!==intent.vaultId)throw new AppError('CONFLICT');
  await this.publish(entry);await discardCreationConfiguration(this.project,intent.configuration);
  if(!await assertRegular(this.file(id,true),{missing:true})){await privateDirectory(this.project.root,'.observanda/lab-book-created');await this.project.writeFile(this.file(id,true),serialize({version:1,phase:'attached',labBookId:intent.labBookId,namespaceId:intent.namespaceId,vaultId:intent.vaultId,fingerprint:intent.fingerprint}));}
  await unlink(this.file(id)).catch(error=>{if(error.code!=='ENOENT')throw error;});
  return {book:entry};
 }
 async pending({after=null,limit=20}={}){
  if(after!==null&&!researchId(after)||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new AppError('INVALID');
  const directory=path.join(this.project.root,'.observanda/lab-book-creation');
  if(!await assertRegular(directory,{directory:true,missing:true}))return {items:[],next:null};
  const ids=[];
  for await(const entry of await opendir(directory)){
   if(!entry.name.endsWith('.obsv')||!researchId(entry.name.slice(0,-5)))continue;
   const id=entry.name.slice(0,-5);if(after!==null&&id<=after)continue;
   ids.push(id);ids.sort();if(ids.length>limit+1)ids.pop();
  }
  const more=ids.length>limit;if(more)ids.pop();const items=[];
  for(const id of ids){const value=await this.read(id);if(value?.phase==='prepared')items.push({id,labBookId:value.labBookId,name:value.directory,username:value.access.username,password:!!value.access.password,running:projectTransferRunning(this.file(id))});}
  return {items,next:more?ids.at(-1):null};
 }
 async resume(command,{check=async()=>{}}={}){
  if(!command||Object.keys(command).sort().join()!=='id,password,username'||!researchId(command.id)||typeof command.username!=='string'||typeof command.password!=='string')throw new AppError('INVALID');
  await check();const intent=await this.read(command.id);if(!intent)throw new AppError('NOT_FOUND');
  if(intent.phase==='attached')return withWriterLease(path.join(path.dirname(this.file(command.id)),command.id+'.lock'),async()=>{await check();return this.acknowledge(command.id,await this.read(command.id));});
  // The encrypted intent owns the original request. Credentials may be
  // normalized differently; resuming must not invent a new request identity.
  return this.create({...command,book:intent.book.notebooks[0]},{check,resume:true});
 }
 async create(command,{check=async()=>{},resume=false}={}){
  if(!command||Object.keys(command).filter(key=>!configurationCreationOptions.includes(key)).sort().join()!=='book,id,password,username'||!researchId(command.id)||!researchId(command.book?.id)||command.book.projectId!==this.project.projectId||typeof command.username!=='string'||typeof command.password!=='string')throw new AppError('INVALID');
  validateStorageName(command.book.title);if(command.book.title.toLowerCase()==='.observanda')throw new AppError('FOLDER_NAME');
  const {password,...request}=command,fingerprint=digest(revisionText(request));
  await check();const directory=await privateDirectory(this.project.root,'.observanda/lab-book-creation');
  return trackProjectTransfer(this.file(command.id),()=>withWriterLease(path.join(directory,command.id+'.lock'),()=>withWriterLease(path.join(directory,'book-'+command.book.id+'.lock'),()=>withWriterLease(path.join(directory,'name-'+digest(nameKey(command.book.title))+'.lock'),async()=>{
   await check();await assertBookPlacementAvailable(this.project,command.book.id,command.book.title);let intent=await this.read(command.id),vault;
   try{
    if(intent){
     if(intent.labBookId!==command.book.id||!resume&&intent.fingerprint!==fingerprint)throw new AppError('CONFLICT');
     const registered=(await this.registry.state(intent.labBookId)).state==='active';
     if(registered||intent.phase==='attached')return this.acknowledge(command.id,intent);
     vault=await verifyAccess({value:intent.access},command.username,password,{deviceStore:this.deviceStore});
    }else{
     if(resume)throw new AppError('NOT_FOUND');
     await this.registry.inspect(async view=>{if(await view.get(command.book.id)||await view.get(view.nameKey(command.book.title),{index:'location'}))throw new AppError('EXISTS');});
     const root=storageCreationPath(this.project.root,command.book.title);if(await assertRegular(root,{directory:true,missing:true})&&(await readdir(root)).length)throw new AppError('EXISTS');
     const {metadata}=await this.project.outline(),parent=metadata.projects.find(entry=>entry.id===this.project.projectId);if(!parent)throw new AppError('DATABASE_LOCATION');
     const book=createNotebook(command.book.title);book.projects=[projectSummaryForBook(parent)];book.notebooks=[structuredClone(command.book)];if(hasConfigurationCreation(command))delete book.notebooks[0].configuration;validateNotebook(book);
     const selected=await prepareCreationConfiguration(this.project,command,{projectId:this.project.projectId,notebookId:command.book.id,slot:'configuration'},{withConfigurationSource:this.withConfigurationSource,check});
     if(selected&&Object.hasOwn(selected,'inline'))book.notebooks[0].configuration=selected.inline?.configuration??{profiles:[],sections:[]};validateNotebook(book);
     const access=await createWorkspaceAccess(command.username,password,this.deviceStore);vault=takeCreatedVault(access);
     intent={version:1,phase:'prepared',labBookId:command.book.id,namespaceId:book.id,vaultId:vault.id,directory:command.book.title,book,access,fingerprint,...(selected?.frozen?{configuration:selected.frozen}:{})};
     const raw=serialize(intent);if(Buffer.byteLength(raw)>intentLimit)throw new AppError('LIMIT');await withWriterLease(path.join(this.project.root,'.observanda/lab-books.lock'),()=>this.project.writeFile(this.file(command.id),raw));
    }
    await check();await this.project.requireStorageKey();const root=storageCreationPath(this.project.root,intent.directory),storage=await initializeLabBookLocation(root,intent.labBookId,intent.book,intent.access,vault,intent.configuration?{populateId:'configuration-v1:'+digest(serialize(intent.configuration)),populate:storage=>populateCreationConfiguration(storage,this.project,intent.configuration,{commandId:command.id,projectId:this.project.projectId,notebookId:intent.labBookId,slot:'configuration',withConfigurationSource:this.withConfigurationSource,check})}:{});
    await check();
    for(let attempt=0;;attempt++){
     const current=await this.registry.state(intent.labBookId);
     if(current.state==='active')return this.acknowledge(command.id,intent);
     try{await this.registry.attach(storage,{expected:current.revision});break;}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
    }
    return this.acknowledge(command.id,intent);
   }finally{clearVault(vault);}
  }))));
 }
}
