// Import one authenticated book into its containing project's literal folder.
// An already nested owner is adopted in place; an archive is restored only at
// its destination. The parent keeps a bounded command, never a second catalogue.
import {assertIncomingProjectAddresses} from './project-incoming-moves.js';
import {ImportDiscard} from './import-discard.js';
import {prepareImportDestination} from './import-destination.js';
import path from 'node:path';
import {mkdir,opendir,readdir,realpath,unlink} from 'node:fs/promises';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookDirectory} from './lab-book-directory.js';
import {LabBookStorage} from './lab-book-storage.js';
import {readLabBookArchiveIdentity} from './lab-book-archive.js';
import {copyLabBookLocation} from './lab-book-transfer.js';
import {reconcileProjectFiles} from './project-transfer-files.js';
import {assertBookPlacementAvailable,reserveBookPlacement,releaseBookPlacement,bookPlacementPending} from './lab-book-placement-state.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {assertNotMoving} from './workspace-move-state.js';
import {Workspace,assertRegular,atomicWrite,privateDirectory,serialize,digest,workspaceFile} from './storage.js';
import {catalogueBinding,CATALOGUE_FILE,CATALOGUE_ACTIVATION,CATALOGUE_ARCHIVE} from './postgres-activation.js';
import {validLabBookCatalogueBinding} from './lab-book-catalogue-owner.js';
import {hashWorkspaceFile} from './workspace-inventory.js';
import {databaseProvider} from './workspace-database-context.js';
import {readAccess,verifyAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {clearVault} from './encryption.js';
import {withWriterLease} from './writer-lease.js';
import {resolveLocation} from './locations.js';
import {storageCreationPath,storageFolderName,validateStorageName} from './storage-names.js';
import {projectTransferRunning,trackProjectTransfer} from './project-transfer-tasks.js';
import {researchId} from './web/research-reference.js';
import {withOperationProgress,operationStage,operationSequence,operationTransfer} from './operation-progress.js';
import {AppError} from './errors.js';
const terminal=value=>value?.phase==='complete';
const nameKey=name=>['win32','darwin'].includes(process.platform)?name.normalize('NFC').toLowerCase():name;
const inside=(root,child)=>{const relative=path.relative(root,child);return !relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const same=(a,b)=>['labBookId','namespaceId','vaultId'].every(key=>a?.[key]===b?.[key]);
export class LabBookImports{
 constructor(project,registry,deviceStore){this.project=project;this.registry=new LabBookRegistry(project);this.workspaceRegistry=registry;this.addresses=new LabBookDirectory(registry);this.deviceStore=deviceStore;}
 file(id){if(!researchId(id))throw new AppError('INVALID');return path.join(this.project.root,'.observanda/lab-book-imports',id+'.obsv');}
 destination(value){return storageCreationPath(this.project.root,value.directory);}
 async read(id){
  const file=this.file(id),stat=await assertRegular(file,{missing:true});if(!stat)return null;if(stat.size>2*1024*1024)throw new AppError('LIMIT');let value;
  try{value=JSON.parse(await this.project.readFile(file,'utf8'));}catch{throw new AppError('STORAGE_COPY');}
  if(!value||Object.keys(value).sort().join()!=='accessEtag,archiveDigest,destinationIdentity,directory,id,kind,labBookId,namespaceId,phase,projectId,source,sourceIdentity,vaultId,version'||value.version!==1||value.id!==id||value.kind!=='import'||value.projectId!==this.project.projectId||!['id','labBookId','namespaceId','vaultId','projectId'].every(key=>researchId(value[key]))||!['prepared','copied','parent','attached','complete','cancelling','cancelled'].includes(value.phase)||!path.isAbsolute(value.source??'')||path.resolve(value.source)!==value.source||!value.sourceIdentity||Object.keys(value.sourceIdentity).sort().join()!=='dev,ino'||Object.values(value.sourceIdentity).some(part=>typeof part!=='string')||value.destinationIdentity!==null&&(!value.destinationIdentity||Object.keys(value.destinationIdentity).sort().join()!=='dev,ino'||Object.values(value.destinationIdentity).some(part=>typeof part!=='string'))||typeof value.accessEtag!=='string'||value.archiveDigest!==null&&!/^[a-f0-9]{64}$/.test(value.archiveDigest))throw new AppError('STORAGE_COPY');
  validateStorageName(value.directory,{nameError:'STORAGE_COPY'});if(value.directory.toLowerCase()==='.observanda')throw new AppError('STORAGE_COPY');return value;
 }
 async save(value){await privateDirectory(this.project.root,'.observanda/lab-book-imports');await this.project.writeFile(this.file(value.id),serialize(value));}
 async pending({after=null,limit=20}={}){
  if(after!==null&&!researchId(after)||!Number.isSafeInteger(limit)||limit<1||limit>50)throw new AppError('INVALID');
  const directory=path.join(this.project.root,'.observanda/lab-book-placements');if(!await assertRegular(directory,{directory:true,missing:true}))return {items:[],next:null};const ids=[];
  for await(const entry of await opendir(directory)){
   const bookId=entry.name.slice(0,-8);if(!entry.name.endsWith('.pointer')||!researchId(bookId))continue;
   const pending=await bookPlacementPending(this.project,bookId);if(pending?.kind!=='import'||after!==null&&pending.id<=after)continue;ids.push(pending.id);ids.sort();if(ids.length>limit+1)ids.pop();
  }
  const more=ids.length>limit;if(more)ids.pop();const registered=new Set((await this.registry.read()).value.books.map(book=>book.labBookId)),items=[];for(const id of ids){const value=await this.read(id);if(!value)throw new AppError('STORAGE_COPY');items.push({id,labBookId:value.labBookId,name:value.directory,phase:value.phase,inPlace:value.source===this.destination(value),cancellable:!['attached','complete'].includes(value.phase)&&!registered.has(value.labBookId),running:projectTransferRunning(this.file(id))});}return {items,next:more?ids.at(-1):null};
 }
 async current(){const entry=await this.workspaceRegistry.locate(this.project.projectId);if(entry.root!==this.project.root||entry.vaultId!==this.project.vault?.id||await realpath(entry.root)!==entry.root)throw new AppError('DATABASE_LOCATION');await this.project.requireStorageKey();authenticateKeyring((await readAccess(entry.root)).value,this.project.vault);}
 async source(root,vault){
  await assertNotDeleting(root);await assertNotMoving(root);if(await assertRegular(path.join(root,'.observanda/copy-in-progress'),{missing:true}))throw new AppError('STORAGE_INCOMPLETE');
  const binding=await catalogueBinding(root);if(binding&&!validLabBookCatalogueBinding(binding))throw new AppError('LAB_BOOK_FOLDER');
  if(!binding)return {...await readLabBookArchiveIdentity(root,vault,{verify:false}),archive:true};
  const storage=new Workspace(root,vault),file=await workspaceFile(root);if((await assertRegular(file)).size>4096)throw new AppError('LAB_BOOK_FOLDER');let descriptor;
  try{descriptor=JSON.parse(await storage.readFile(file,'utf8'));}catch{throw new AppError('LAB_BOOK_FOLDER');}
  if(descriptor?.format!=='observanda-research-catalogue'||descriptor.version!==2||!researchId(descriptor.workspaceId))throw new AppError('LAB_BOOK_FOLDER');return {labBookId:binding.labBookId,namespaceId:descriptor.workspaceId,vaultId:vault.id,archiveDigest:null};
 }
 async run(command,{resume=false,check=async()=>{},checkpoint=async()=>{},opened=async()=>{},onProgress}={}){
  if(!command||Object.keys(command).sort().join()!==(resume?'id,password,recovery,username':'id,password,path,recovery,username')||!researchId(command.id)||['username','password','recovery'].some(key=>typeof command[key]!=='string'||command[key].length>1024))throw new AppError('INVALID');
  await check();await this.current();const directory=await privateDirectory(this.project.root,'.observanda/lab-book-imports');
  return trackProjectTransfer(this.file(command.id),()=>withWriterLease(path.join(directory,command.id+'.lock'),async()=>{
   let value=await this.read(command.id),vault;if(value?.phase==='cancelled')return this.cancelled(value);if(value?.phase==='cancelling')throw new AppError('STORAGE_INCOMPLETE');if(resume&&!value)throw new AppError('NOT_FOUND');
   if(value&&!resume&&await resolveLocation(command.path)!==value.source)throw new AppError('CONFLICT');
   const source=value?.source??await resolveLocation(command.path),root=value&&value.phase!=='prepared'?this.destination(value):source,access=await readAccess(root);
   try{
    try{vault=await verifyAccess(access,command.username,command.password,{deviceStore:this.deviceStore,recovery:command.recovery});}catch(error){const failure=['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN','AUTH'].includes(error.code)?new AppError('LAB_BOOK_IMPORT_ACCESS'):error;failure.operationNotStarted=true;throw failure;}await check();await this.current();
    if(!value){
     const owner=await this.source(source,vault),directory=storageFolderName(source),destination=storageCreationPath(this.project.root,directory);
     if(source!==destination&&(inside(this.workspaceRegistry.workspace.root,source)||inside(source,destination)||inside(destination,source)))throw new AppError('STORAGE_PATH');
     value={version:1,kind:'import',id:command.id,projectId:this.project.projectId,source,sourceIdentity:identity(await assertRegular(source,{directory:true})),destinationIdentity:null,directory,labBookId:owner.labBookId,namespaceId:owner.namespaceId,vaultId:vault.id,archiveDigest:owner.archiveDigest,accessEtag:access.etag,phase:'prepared'};
    }
    if(value.vaultId!==vault.id)throw new AppError('ACCESS_DENIED');
    const names=await privateDirectory(this.project.root,'.observanda/lab-book-creation'),addresses=await privateDirectory(this.workspaceRegistry.workspace.root,'.observanda/lab-book-directory'),locks=[path.join(addresses,value.namespaceId+'.lock'),path.join(names,'book-'+value.labBookId+'.lock'),path.join(names,'name-'+digest(nameKey(value.directory))+'.lock')];
    const take=index=>index===locks.length?this.perform(value,vault,{check,checkpoint,opened,onProgress}):withWriterLease(locks[index],()=>take(index+1),{wait:false});return await take(0);
   }finally{clearVault(vault);}
  }));
 }
 async perform(value,vault,{check,checkpoint,opened,onProgress}){
  await check();await this.current();const destination=this.destination(value),existing=await this.read(value.id),registered=(await this.registry.read()).value;
  if(terminal(value))return this.complete(value,vault,opened);
  await assertIncomingProjectAddresses(this.workspaceRegistry,[value]);
  await assertBookPlacementAvailable(this.project,value.labBookId,value.directory,{except:value.id});
  const address=await this.addresses.read(value.namespaceId);if(address&&(address.projectId!==this.project.projectId||!same(address,value)))throw new AppError('DATABASE_LOCATION');
  const prior=registered.books.find(book=>book.labBookId===value.labBookId);
  if(registered.deleted.some(book=>book.labBookId===value.labBookId)||registered.relocated?.some(book=>book.labBookId===value.labBookId)||registered.books.some(book=>book.labBookId!==value.labBookId&&nameKey(book.directory)===nameKey(value.directory))||prior&&(!same(prior,value)||prior.directory!==value.directory))throw new AppError('EXISTS');
  if(!existing&&prior)throw new AppError('EXISTS');
  if(!existing&&destination!==value.source&&await assertRegular(destination,{directory:true,missing:true}))throw new AppError('EXISTS');
  await withWriterLease(path.join(this.project.root,'.observanda/lab-books.lock'),async()=>{await check();await this.current();if(!existing)await this.save(value);await reserveBookPlacement(this.project,value);});
  const pinned={...value,destination};await prepareImportDestination(pinned,async()=>{value.destinationIdentity=pinned.destinationIdentity;await this.save(value);});
  const target=new LabBookStorage(destination,value.labBookId,vault);
  return withOperationProgress(onProgress,()=>operationSequence('import-book',['copy-files','lab-book-database-import','import-book-register'],async()=>{
   await checkpoint('prepared',value);
   if(value.phase==='prepared'){
    const stat=await assertRegular(value.source,{directory:true});if(serialize(identity(stat))!==serialize(value.sourceIdentity)||(await readAccess(value.source)).etag!==value.accessEtag)throw new AppError('CONFLICT');
    if(destination!==value.source){
     const source=new LabBookStorage(value.source,value.labBookId,vault);
     if(value.archiveDigest)await this.copyArchive(source,target,value,checkpoint);
     else await copyLabBookLocation(source,destination,{id:value.id,retainIncomplete:true,checkpoint});
    }
    value.phase='copied';await this.save(value);await checkpoint('copied',value);
   }
   if(value.phase==='copied'){
     authenticateKeyring((await readAccess(destination)).value,vault);
     if(value.archiveDigest&&!await catalogueBinding(destination)&&await hashWorkspaceFile(path.join(destination,CATALOGUE_ARCHIVE))!==value.archiveDigest){value.phase='prepared';await this.save(value);throw new AppError('STORAGE_COPY');}
     const db=await operationStage('lab-book-database-import',{},()=>target.openCatalogue());await db.close();await checkpoint('restored',value);
     await target.withLock(()=>target.catalogue(async store=>{
      const head=await store.head(),snapshot=await store.snapshot(head);if(snapshot.metadata.id!==value.namespaceId||snapshot.metadata.notebooks[0].id!==value.labBookId||snapshot.metadata.title!==value.directory||snapshot.metadata.notebooks[0].title!==value.directory)throw new AppError('DATABASE_LOCATION');
      if(snapshot.metadata.notebooks[0].projectId===this.project.projectId)return;
      const parent=(await this.project.outline()).metadata.projects.find(item=>item.id===this.project.projectId);if(!parent)throw new AppError('DATABASE_LOCATION');
      const current=await store.indexed(snapshot),metadata={...current.metadata,projects:[{...parent,parentId:null}],notebooks:current.metadata.notebooks.map(book=>({...book,projectId:this.project.projectId}))};await store.commitChanges(head,current,metadata,[],{now:new Date().toISOString()});
     }));value.phase='parent';await this.save(value);await checkpoint('parent',value);
    }
    await operationStage('import-book-register',{},async()=>{
     await check();await this.current();
     const entry=await this.registry.describe(target,{staged:true});if(!same(entry,value)||entry.directory!==value.directory)throw new AppError('DATABASE_LOCATION');
     for(let attempt=0;;attempt++){
      const current=await this.registry.read(),prior=current.value.books.find(book=>book.labBookId===value.labBookId);if(prior){if(!same(prior,entry)||prior.directory!==entry.directory)throw new AppError('CONFLICT');break;}
      try{await this.registry.change(current.revision,data=>({...data,books:[...data.books,entry]}));break;}catch(error){if(error.code!=='CONFLICT'||attempt>=7)throw error;}
     }
     await checkpoint('attached',value);await this.addresses.register(this.project.projectId,entry);value.phase='attached';await this.save(value);await checkpoint('addressed',value);await unlink(path.join(destination,'.observanda/copy-in-progress')).catch(error=>{if(error.code!=='ENOENT')throw error;});
     value.phase='complete';await this.save(value);await checkpoint('complete',value);
    });return this.complete(value,vault,opened);
  })).finally(()=>databaseProvider()?.closeLabBook(destination));
 }
 async cancelled(value){await releaseBookPlacement(this.project,value);return {id:value.id,projectId:this.project.projectId,cancelled:true};}
 async cancel(command,{check=async()=>{},checkpoint=async()=>{},onProgress}={}){
  if(!command||Object.keys(command).sort().join()!=='id,password,recovery,username'||!researchId(command.id)||['username','password','recovery'].some(key=>typeof command[key]!=='string'||command[key].length>1024))throw new AppError('INVALID');
  const directory=await privateDirectory(this.project.root,'.observanda/lab-book-imports');
  return trackProjectTransfer(this.file(command.id),()=>withWriterLease(path.join(directory,command.id+'.lock'),async()=>{
   await check();await this.current();const value=await this.read(command.id);if(!value)throw new AppError('NOT_FOUND');if(value.phase==='cancelled')return this.cancelled(value);
   if(['attached','complete'].includes(value.phase)||(await this.registry.read()).value.books.some(book=>book.labBookId===value.labBookId))throw new AppError('CONFLICT');
   const destination=this.destination(value),discard=new ImportDiscard(this.project,value.id);let vault;
   try{
    if(value.source!==destination&&value.destinationIdentity){
     if(await discard.needsKeys()){
      if(serialize(identity(await assertRegular(value.source,{directory:true})))!==serialize(value.sourceIdentity))throw new AppError('CONFLICT');
      try{vault=await verifyAccess(await readAccess(value.source),command.username,command.password,{deviceStore:this.deviceStore,recovery:command.recovery});}
      catch(error){if(['ACCESS_LOCKED','ACCESS_DENIED','DEVICE_UNKNOWN','AUTH'].includes(error.code)){const failure=new AppError('LAB_BOOK_IMPORT_ACCESS');failure.operationNotStarted=true;throw failure;}throw error;}
      if(vault.id!==value.vaultId)throw new AppError('ACCESS_DENIED');
     }
     await check();await this.current();value.phase='cancelling';await this.save(value);
     await discard.run({...value,destination,owners:[{kind:'lab-book',relative:'',projectId:value.projectId,labBookId:value.labBookId,vaultId:value.vaultId}]},new Map([['',vault]]),{check,checkpoint,onProgress});
    }
    value.phase='cancelled';await this.save(value);await checkpoint('cancelled',value);return this.cancelled(value);
   }finally{clearVault(vault);}
  },{wait:false}));
 }
 async copyArchive(source,target,value,checkpoint){
  if(!await assertRegular(target.root,{directory:true,missing:true}))await mkdir(target.root,{mode:0o700});
  if(!await assertRegular(path.join(target.root,'.observanda'),{directory:true,missing:true})){if((await readdir(target.root)).length)throw new AppError('EXISTS');await mkdir(path.join(target.root,'.observanda'),{mode:0o700});}
  const controls=new Set([CATALOGUE_FILE,CATALOGUE_ACTIVATION,'.observanda/lab-book-transfer.observanda','.observanda/lab-book-transfer.lock']);
  await atomicWrite(path.join(target.root,'.observanda/copy-in-progress'),'importing lab book\n');operationTransfer({phase:'copying',files:0,bytes:0});
  await operationStage('copy-files',{unit:'files'},()=>reconcileProjectFiles(source,target,{id:value.id,filesVersion:1},{controls,receiptDirectory:'.observanda/lab-book-transfer-files',checkpoint}));
  const owner=await readLabBookArchiveIdentity(target.root,target.vault,{verify:false});if(!same(owner,value)||owner.archiveDigest!==value.archiveDigest)throw new AppError('STORAGE_COPY');
 }
 async complete(value,vault,opened){
  const entry=await this.registry.locate(value.labBookId),address=await this.addresses.read(value.namespaceId);if(!same(entry,value)||entry.directory!==value.directory||address?.projectId!==this.project.projectId||!same(address,value))throw new AppError('CONFLICT');
  authenticateKeyring((await readAccess(entry.root)).value,vault);await releaseBookPlacement(this.project,value);await opened(entry,vault);return {id:value.id,projectId:this.project.projectId,book:entry,complete:true};
 }
}
