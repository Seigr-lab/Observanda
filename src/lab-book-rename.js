import {validConfigurationReference} from './web/configuration-reference.js';
import {discardConfigurationCheckpoint} from './configuration-commands.js';
import {assertBookPlacementAvailable} from './lab-book-placement-state.js';
import {assertBookTransfersComplete} from './lab-book-transfer-state.js';
// Rename the existing book directory and its current metadata as one recoverable
// operation. The project retains a journal; records and evidence are not copied.
import path from 'node:path';
import {readFile,realpath,rename,unlink} from 'node:fs/promises';
import {LabBookStorage} from './lab-book-storage.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {assertRegular,atomicWrite,privateDirectory,digest,serialize,workspaceFile} from './storage.js';
import {withWriterLease} from './writer-lease.js';
import {storageCreationPath,validateStorageName} from './storage-names.js';
import {RENAME_MARKER,workspaceRename,renameScope} from './workspace-rename-state.js';
import {assertRenameDatabaseOwners} from './workspace-rename-inventory.js';
import {assertLabBookDatabaseStopped,LAB_BOOK_DATABASE_DIRECTORY} from './lab-book-postgres.js';
import {databaseProvider} from './workspace-database-context.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {researchId} from './web/research-reference.js';
import {validConfiguration} from './web/notebook-schema.js';
import {MAX_BYTES} from './model.js';
import {AppError} from './errors.js';
const validSettings=value=>value===null||value&&['configuration,etag','configuration,etag,input','etag,input','checkpoint,configuration,etag,input'].includes(Object.keys(value).sort().join())&&hash(value.etag)&&(!Object.hasOwn(value,'configuration')||validConfiguration(value.configuration)||validConfigurationReference(value.configuration))&&(!Object.hasOwn(value,'input')||hash(value.input))&&(!Object.hasOwn(value,'checkpoint')||value.checkpoint&&Object.keys(value.checkpoint).sort().join()==='id,revision'&&researchId(value.checkpoint.id)&&hash(value.checkpoint.revision));
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const nameKey=name=>['win32','darwin'].includes(process.platform)?name.normalize('NFC').toLowerCase():name;
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
export class LabBookRenames{
 constructor(project){this.project=project;this.registry=new LabBookRegistry(project);}
 file(id){if(!researchId(id))throw new AppError('INVALID');return path.join(this.project.root,'.observanda/lab-book-renames',id+'.obsv');}
 pointer(id){if(!researchId(id))throw new AppError('INVALID');return path.join(this.project.root,'.observanda/lab-book-renames','book-'+id+'.pointer');}
 async read(id){
  const file=this.file(id),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>MAX_BYTES+16384)throw new AppError('STORAGE_RENAME_STATE');
  let value;try{value=JSON.parse(await this.project.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_RENAME_STATE');}
  if(!value||Object.keys(value).sort().join()!=='accessHash,descriptorHash,destination,id,identity,labBookId,namespaceId,phase,projectId,settings,source,vaultId,version'||!validSettings(value.settings)||value.version!==1||value.id!==id||value.projectId!==this.project.projectId||![value.id,value.labBookId,value.namespaceId,value.vaultId].every(researchId)||!['prepared','frozen','moved','complete'].includes(value.phase)||!hash(value.accessHash)||!hash(value.descriptorHash)||!value.identity||Object.keys(value.identity).sort().join()!=='dev,ino'||Object.values(value.identity).some(part=>typeof part!=='string'))throw new AppError('STORAGE_RENAME_STATE');
  for(const name of [value.source,value.destination]){validateStorageName(name,{nameError:'STORAGE_RENAME_STATE'});if(name.toLowerCase()==='.observanda')throw new AppError('STORAGE_RENAME_STATE');}
  if(value.source===value.destination)throw new AppError('STORAGE_RENAME_STATE');return value;
 }
 async save(value){await privateDirectory(this.project.root,'.observanda/lab-book-renames');await this.project.writeFile(this.file(value.id),serialize(value));}
 async pending(labBookId){const file=this.pointer(labBookId),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>256)throw new AppError('STORAGE_RENAME_STATE');const id=await this.project.readFile(file,'utf8');if(!researchId(id))throw new AppError('STORAGE_RENAME_STATE');const value=await this.read(id);if(!value||value.labBookId!==labBookId)throw new AppError('STORAGE_RENAME_STATE');return value;}
 async clearPointer(value){const file=this.pointer(value.labBookId);if(await assertRegular(file,{missing:true})&&await this.project.readFile(file,'utf8')===value.id)await unlink(file);}
 root(name){return storageCreationPath(this.project.root,name);}
 async locate(value){
  for(const name of [value.destination,value.source]){
   const root=this.root(name),stat=await assertRegular(root,{directory:true,missing:true});if(!stat||!same(identity(stat),value.identity)||await realpath(root)!==root)continue;
   if(digest(await readFile(path.join(root,'.observanda/access.json')))!==value.accessHash)throw new AppError('STORAGE_RENAME_STATE');
   return root;
  }
  throw new AppError('STORAGE_RENAME_STATE');
 }
 async locked(labBookId,name,operation){
  const directory=await privateDirectory(this.project.root,'.observanda/lab-book-creation');
  return withWriterLease(path.join(directory,'book-'+labBookId+'.lock'),()=>withWriterLease(path.join(directory,'name-'+digest(nameKey(name))+'.lock'),operation));
 }
 async run(storage,{id,name,expectedName,settings=null,check=async()=>{},checkpoint=async()=>{}}){
  if(!researchId(id)||!researchId(storage?.labBookId)||!validSettings(settings))throw new AppError('INVALID');validateStorageName(name);validateStorageName(expectedName);if(name.toLowerCase()==='.observanda')throw new AppError('FOLDER_NAME');
  return this.locked(storage.labBookId,name,async()=>{
   await check();await assertBookPlacementAvailable(this.project,storage.labBookId,name);await assertBookTransfersComplete(this.project,storage.labBookId);let value=await this.read(id);
   if(value){if(value.labBookId!==storage.labBookId||value.source!==expectedName||value.destination!==name||value.vaultId!==storage.vault?.id||serialize(value.settings)!==serialize(settings))throw new AppError('CONFLICT');return this.finish(value,storage.vault,{check,checkpoint});}
   const entry=await this.registry.locate(storage.labBookId),pending=await this.pending(storage.labBookId);
   if(pending&&pending.phase!=='complete')throw new AppError('STORAGE_RENAMING');
   if(entry.root!==storage.root||entry.directory!==expectedName||entry.vaultId!==storage.vault?.id)throw new AppError('CONFLICT');
   if(name===expectedName)return {book:entry,complete:true};
   const target=this.root(name),stat=await assertRegular(target,{directory:true,missing:true});if(stat&&await realpath(target)!==storage.root)throw new AppError('EXISTS');
   await assertRenameDatabaseOwners(storage.root,[]);
   await storage.withStorageHandoff(async()=>{
    await check();const {metadata,etag}=await storage.outline();if(settings&&settings.etag!==etag)throw new AppError('CONFLICT');if(metadata.id!==entry.namespaceId||metadata.notebooks[0].title!==expectedName)throw new AppError('CONFLICT');
    const access=await readAccess(storage.root);authenticateKeyring(access.value,storage.vault);
    value={version:1,id,projectId:this.project.projectId,labBookId:storage.labBookId,namespaceId:entry.namespaceId,vaultId:entry.vaultId,source:expectedName,destination:name,settings,identity:identity(await assertRegular(storage.root,{directory:true})),accessHash:digest(await readFile(path.join(storage.root,'.observanda/access.json'))),descriptorHash:digest(await readFile(await workspaceFile(storage.root))),phase:'prepared'};
    await withWriterLease(path.join(this.project.root,'.observanda/lab-books.lock'),async()=>{await this.save(value);await this.project.writeFile(this.pointer(value.labBookId),value.id);});await checkpoint('prepared',value);
    await atomicWrite(path.join(storage.root,RENAME_MARKER),serialize({version:1,id,source:storage.root,destination:target}));
   },{existing:true});
   value.phase='frozen';await this.save(value);await checkpoint('frozen',value);return this.finish(value,storage.vault,{check,checkpoint});
  });
 }
 async resume(labBookId,vault,options={}){
  const value=await this.pending(labBookId);if(!value)return null;
  return this.locked(labBookId,value.destination,async()=>{const latest=await this.read(value.id);return this.finish(latest,vault,options);});
 }
 async finish(value,vault,{check=async()=>{},checkpoint=async()=>{}}={}){
  if(value.vaultId!==vault?.id)throw new AppError('ACCESS_DENIED');
  const source=this.root(value.source),destination=this.root(value.destination);
  return renameScope(value.id,async()=>{
   await check();
   if(value.phase==='complete'){
    // A subsequent rename may have replaced this receipt; never undo it.
    const entry=await this.registry.locate(value.labBookId);if(entry.namespaceId!==value.namespaceId||entry.vaultId!==value.vaultId)throw new AppError('CONFLICT');
    authenticateKeyring((await readAccess(entry.root)).value,vault);const marker=await workspaceRename(entry.root);if(marker?.id===value.id){if(await this.locate(value)!==entry.root)throw new AppError('STORAGE_RENAME_STATE');await unlink(path.join(entry.root,RENAME_MARKER));}await this.clearPointer(value);return {id:value.id,book:entry,complete:true};
   }
   let root=await this.locate(value);authenticateKeyring((await readAccess(root)).value,vault);const marker=await workspaceRename(root);
   if(marker&&(marker.id!==value.id||marker.source!==source||marker.destination!==destination))throw new AppError('STORAGE_RENAMING');
   if(!marker){
    if(value.phase!=='prepared'||root!==source)throw new AppError('STORAGE_RENAME_STATE');
    const storage=new LabBookStorage(root,value.labBookId,vault);await storage.withStorageHandoff(async()=>{
     await check();if(digest(await readFile(await workspaceFile(root)))!==value.descriptorHash)throw new AppError('STORAGE_RENAME_STATE');
     await atomicWrite(path.join(root,RENAME_MARKER),serialize({version:1,id:value.id,source,destination}));
    },{existing:true});
   }
   if(root===source){
    const provider=databaseProvider();if(!provider?.stopLabBookForRename)throw new AppError('DATABASE_LOCATION');
    await provider.stopLabBookForRename(root,value.labBookId,vault,value.id);
    const lease=await workspaceDatabaseLease(path.join(root,LAB_BOOK_DATABASE_DIRECTORY),{});
    try{await assertLabBookDatabaseStopped(root,value.labBookId,vault);if(await this.locate(value)!==root||await realpath(this.project.root)!==this.project.root||digest(await readFile(await workspaceFile(root)))!==value.descriptorHash)throw new AppError('STORAGE_RENAME_STATE');const existing=await assertRegular(destination,{directory:true,missing:true});if(existing&&await realpath(destination)!==root)throw new AppError('EXISTS');await check();await checkpoint('stopped',value);}finally{await lease.close();}
    await rename(root,destination);root=destination;await checkpoint('renamed',value);value.phase='moved';await this.save(value);
   }
   const storage=new LabBookStorage(root,value.labBookId,vault);
   await storage.withLock(()=>storage.catalogue(async store=>{
    const head=await store.head(),snapshot=await store.snapshot(head);if(snapshot.metadata.id!==value.namespaceId)throw new AppError('STORAGE_RENAME_STATE');
    if(snapshot.metadata.notebooks[0].title===value.destination&&snapshot.metadata.title===value.destination&&(!value.settings||serialize(snapshot.metadata.notebooks[0].configuration)===serialize(value.settings.configuration)))return;
    const current=await store.indexed(snapshot),metadata={...current.metadata,title:value.destination,notebooks:current.metadata.notebooks.map(book=>{const next={...book,title:value.destination};if(value.settings){if(Object.hasOwn(value.settings,'configuration'))next.configuration=value.settings.configuration;else delete next.configuration;}return next;})};
    await store.validateMetadata(current,metadata);await store.commitChanges(head,current,metadata,[],{now:new Date().toISOString()});
    if(value.settings?.checkpoint)await discardConfigurationCheckpoint(store,{workspaceId:metadata.id,projectId:value.projectId,notebookId:value.labBookId,slot:'configuration'},value.settings.checkpoint);
   }));await checkpoint('metadata',value);
   for(let attempt=0;;attempt++){
    const current=await this.registry.read(),entry=current.value.books.find(book=>book.labBookId===value.labBookId);
    if(!entry||entry.namespaceId!==value.namespaceId||entry.vaultId!==value.vaultId||![value.source,value.destination].includes(entry.directory))throw new AppError('CONFLICT');
    if(entry.directory===value.destination)break;
    try{await this.registry.change(current.revision,data=>({...data,books:data.books.map(book=>book.labBookId===value.labBookId?{...book,directory:value.destination}:book)}));break;}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
   }
   await checkpoint('registered',value);value.phase='complete';await this.save(value);await checkpoint('complete',value);
   if((await workspaceRename(root))?.id!==value.id)throw new AppError('STORAGE_RENAME_STATE');await unlink(path.join(root,RENAME_MARKER));await this.clearPointer(value);
   return {id:value.id,book:await this.registry.locate(value.labBookId),complete:true};
  });
 }
}
