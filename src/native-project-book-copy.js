// Project copies pin the native book directory and authenticate one independent
// owner at a time. Temporary owner proofs contain no vault keys; copy receipts
// derive per-book command identities instead of retaining an aggregate array.
import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NativeOwnerDirectory} from './owner-directory.js';
import {validOwnerDirectoryHead} from './owner-directory-model.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookStorage} from './lab-book-storage.js';
import {copyLabBookLocation,labBookTransferReceipt} from './lab-book-transfer.js';
import {catalogueBinding} from './postgres-activation.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {cloneVault,clearVault} from './encryption.js';
import {assertInventoryObligationsSettled} from './inventory-obligation-lifecycle.js';
import {assertRegular,privateDirectory,digest,serialize} from './storage.js';
import {withScratch} from './scratch-work.js';
import {withWriterLease} from './writer-lease.js';
import {workspaceCopyTransferId} from './workspace-copy-directory.js';
import {databaseProvider} from './workspace-database-context.js';
import {operationStage,operationAdvance,operationItem} from './operation-progress.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const validPin=pin=>pin&&Object.keys(pin).sort().join()==='head,revision,version'&&pin.version===1&&validOwnerDirectoryHead(pin.head)&&pin.head.kind==='books'&&pin.revision===digest(serialize(pin.head));
export async function captureProjectBookCopyDirectory(registry){
 let pin=await registry.directoryOwner.access.read(value=>value.legacy?{legacy:true,revision:value.legacy.revision}:{version:1,head:value.value,revision:value.revision});
 if(pin.legacy){await registry.apply(pin.revision,[]);pin=await registry.directoryOwner.access.read(value=>({version:1,head:value.value,revision:value.revision}));}
 if(!validPin(pin)||pin.head.ownerId!==registry.project.projectId)throw new AppError('STORAGE_COPY');return pin;
}
export function withProjectBookCopyDirectory(registry,pin,operation){
 if(!validPin(pin)||pin.head.ownerId!==registry.project.projectId)throw new AppError('STORAGE_COPY');
 return registry.project.catalogue(async store=>{
  const envelope=await registry.directoryOwner.access.envelope();if(!envelope.marker||envelope.marker.ownerDirectory.receipt!==digest(serialize(pin.head.receipt)))throw new AppError('STORAGE_COPY');
  const directory=new NativeOwnerDirectory(store,{kind:'books',ownerId:pin.head.ownerId});await directory.head({required:true});
  return operation({count:pin.head.roots.active?.count??0,get:id=>directory.find(pin.head,id),entries:()=>directory.rows(pin.head,{index:'active'}),page:options=>directory.page(pin.head,options)});
 });
}
// A pending older copy may pin the envelope digest which native adoption
// retained. Admit that receipt only after authenticating the original envelope
// and proving every active owner still has its exact identity and placement.
export async function projectBookCopyMatchesLegacy(registry,pin,revision){
 if(!validPin(pin)||pin.head.receipt.legacyDigest!==revision)return false;
 return withProjectBookCopyDirectory(registry,pin,view=>registry.project.catalogue(async store=>{
  const directory=new NativeOwnerDirectory(store,{kind:'books',ownerId:pin.head.ownerId}),chunks=[];let bytes=0,count=0;
  for await(const row of directory.index.entries({root:pin.head.receipt.original})){
   if(row.id!==String(count++).padStart(16,'0'))throw new AppError('CATALOGUE_DAMAGED');
   const value=await directory.blocks.read('original',row.revision);if(!value||Object.keys(value).join()!=='base64'||typeof value.base64!=='string')throw new AppError('CATALOGUE_DAMAGED');
   const chunk=Buffer.from(value.base64,'base64');bytes+=chunk.length;
   if(!chunk.length||chunk.length>32768||chunk.toString('base64')!==value.base64||bytes>16*1024*1024)throw new AppError('CATALOGUE_DAMAGED');chunks.push(chunk);
  }
  const raw=Buffer.concat(chunks,bytes);if(digest(raw)!==revision)throw new AppError('CATALOGUE_DAMAGED');let original;
  try{original=registry.validate(JSON.parse(raw.toString('utf8')));}catch{throw new AppError('CATALOGUE_DAMAGED');}
  if(original.books.length!==view.count)return false;
  for(const entry of original.books){const current=await view.get(entry.labBookId);if(current?.state!=='active'||['labBookId','directory','namespaceId','vaultId'].some(key=>current.entry[key]!==entry[key]))return false;}
  return true;
 }));
}
export function projectBookCopyTransferId(receipt,labBookId){
 if(!researchId(receipt.id)||!researchId(labBookId))throw new AppError('STORAGE_COPY');
 const id=receipt.bookTransfersVersion===2?workspaceCopyTransferId(receipt.id,labBookId):receipt.bookTransfers?.find(item=>item.labBookId===labBookId)?.id;
 if(!researchId(id))throw new AppError('STORAGE_COPY');return id;
}
export async function validateProjectBookCopyTransfers(receipt,view,revision){
 if(receipt.bookRegistryRevision!==revision||!researchId(receipt.id))throw new AppError('CONFLICT');
 if(receipt.bookTransfersVersion===2){if(receipt.bookTransfers!==undefined||receipt.bookCount!==view.count)throw new AppError('STORAGE_COPY');return;}
 if(receipt.bookTransfersVersion!==undefined||!Array.isArray(receipt.bookTransfers)||receipt.bookTransfers.length!==view.count)throw new AppError('STORAGE_COPY');
 await withScratch(async ids=>{let index=0;for await(const {entry} of view.entries()){
  const item=receipt.bookTransfers[index++];if(!item||Object.keys(item).sort().join()!=='id,labBookId'||item.labBookId!==entry.labBookId||!researchId(item.id)||!await ids.add(item.id))throw new AppError('STORAGE_COPY');
 }if(index!==view.count)throw new AppError('STORAGE_COPY');});
}
export class NativeProjectBookCopy{
 constructor(owner){this.owner=owner;this.project=owner.project;this.registry=owner.registry;this.proofs=null;}
 view(operation){return withProjectBookCopyDirectory(this.registry,this.pin,operation);}
 async current(){await this.owner.ready();if(await this.registry.version()!==this.pin.revision)throw new AppError('CONFLICT');}
 async validate(book,storage){
  const root=this.registry.location(book).root;
  if(storage.root!==root||storage.labBookId!==book.labBookId||storage.vault?.id!==book.vaultId||await realpath(root)!==root)throw new AppError('DATABASE_LOCATION');
  const access=await readAccess(root);authenticateKeyring(access.value,storage.vault);
  const binding=await catalogueBinding(root),metadata=(await storage.outline()).metadata;
  if(binding?.placement!=='lab-book'||binding.labBookId!==book.labBookId||metadata.id!==book.namespaceId||metadata.notebooks[0].projectId!==this.project.projectId)throw new AppError('DATABASE_LOCATION');
  return {...book,identity:identity(await assertRegular(root,{directory:true})),accessHash:digest(await readFile(path.join(root,'.observanda/access.json')))};
 }
 async proof({store=null,portable=false,obligations=false,lifecycle=false}={}){
  const hash=createHash('sha256');let count=0;
  await this.view(async view=>{for await(const {entry} of view.entries()){const use=()=>this.withBook(entry.labBookId,async storage=>{
   const book=await this.validate(entry,storage);if(obligations)await assertInventoryObligationsSettled(storage);
   if(portable){const access=await readAccess(storage.root);if(!access.value.password&&!access.value.recovery)throw new AppError('STORAGE_PORTABLE_BOOK_ACCESS');}
   hash.update(serialize(book)+'\n');if(store)await store.put(book.labBookId,book);count++;
  });if(lifecycle)await this.lease(entry,use);else await use();}});
  if(count!==this.count)throw new AppError('CONFLICT');return hash.digest('hex');
 }
 async prepare(withBook,{portable=false}={}){
  this.withBook=withBook;await this.owner.ready({renames:false});this.pin=await captureProjectBookCopyDirectory(this.registry);this.count=this.pin.head.roots.active?.count??0;this.owner.revision=this.pin.revision;
  if(this.count&&typeof withBook!=='function')throw new AppError('ACCESS_LOCKED');await assertInventoryObligationsSettled(this.project);
  this.ownerProof=await this.proof({portable,obligations:true});await this.current();
 }
 async using(operation,{holdBooks=false}={}){
  // Relocation needs all owner writers held until source retirement and uses
  // ProjectBookOwners. Ordinary copies never retain all owner keys or leases.
  if(holdBooks)throw new AppError('INVALID');
  await privateDirectory(this.project.root,'.observanda/lab-book-creation');
  return withWriterLease(path.join(this.project.root,'.observanda/lab-books.lock'),()=>withScratch(async proofs=>{
   await this.current();if(await this.proof({store:proofs,lifecycle:true})!==this.ownerProof)throw new AppError('STORAGE_RENAME_STATE');
   this.proofs=proofs;try{return await operation();}finally{this.proofs=null;}
  }));
 }
 lease(book,operation){return withWriterLease(path.join(this.project.root,'.observanda/lab-book-creation','book-'+book.labBookId+'.lock'),operation,{wait:false});}
 async selected(book,operation){
  if(!this.proofs)throw new AppError('INVALID');
  // A rename takes book -> registry leases. Never wait for its book lease
  // while holding the registry barrier: refuse and retain the copy for retry.
  return this.lease(book,()=>this.withBook(book.labBookId,async storage=>{
   const before=await this.proofs.get(book.labBookId),current=await this.validate(book,storage);
   if(!before||serialize(before)!==serialize(current))throw new AppError('STORAGE_RENAME_STATE');return operation(storage);
  }));
 }
 async copy(target,receipt,save,{portable=false,relocation=false,checkpoint=async()=>{}}={}){
  if(relocation)throw new AppError('INVALID');if(!this.count)return;
  if(receipt.bookRegistryRevision!==undefined&&receipt.bookRegistryRevision!==this.pin.revision){
   if(receipt.bookTransfersVersion!==undefined||!Array.isArray(receipt.bookTransfers)||!await projectBookCopyMatchesLegacy(this.registry,this.pin,receipt.bookRegistryRevision))throw new AppError('CONFLICT');
   await this.view(view=>validateProjectBookCopyTransfers({...receipt,bookRegistryRevision:this.pin.revision},view,this.pin.revision));
   receipt.bookRegistryRevision=this.pin.revision;await save();
  }
  if(receipt.bookTransfers===undefined&&receipt.bookTransfersVersion===undefined){receipt.bookRegistryRevision=this.pin.revision;receipt.bookTransfersVersion=2;receipt.bookCount=this.count;await save();}
  await this.view(view=>validateProjectBookCopyTransfers(receipt,view,this.pin.revision));await this.current();
  if(await this.owner.targetRevision(target,portable)!==this.pin.revision)throw new AppError('CONFLICT');
  await operationStage('copy-project-books',{unit:'books',total:this.count},()=>this.view(async view=>{
   for await(const {entry:book} of view.entries()){
    operationItem(book.directory);const destination=path.join(target.root,book.directory);
    await this.selected(book,async storage=>{
     const copied=await copyLabBookLocation(storage,destination,{id:projectBookCopyTransferId(receipt,book.labBookId),portable,checkpoint:(stage,file)=>checkpoint('book-'+stage,{labBookId:book.labBookId,file})});
     try{if((await labBookTransferReceipt(copied)).namespaceId!==book.namespaceId)throw new AppError('DATABASE_LOCATION');}finally{await databaseProvider()?.closeLabBook(destination);}
    });
    await assertRegular(destination,{directory:true});operationAdvance();await checkpoint('book',book.labBookId);
   }
  }));
  await this.current();if(await this.proof({lifecycle:true})!==this.ownerProof)throw new AppError('STORAGE_RENAME_STATE');if(await this.owner.targetRevision(target,portable)!==this.pin.revision)throw new AppError('CONFLICT');
 }
 async copied(target,receipt,{portable=false,onCopiedBook}={}){
  if(portable||typeof onCopiedBook!=='function')return;
  await new LabBookRegistry(target).inspect(async view=>{
   if(!view.count)return;
   // A completed destination retains its own membership. Adding another book
   // to the source later must not alter that verified copy or its retry IDs.
   await validateProjectBookCopyTransfers(receipt,view,view.revision);
   for await(const {entry} of view.entries()){
   const source=await this.view(current=>current.get(entry.labBookId));if(source?.state!=='active'||['directory','namespaceId','vaultId'].some(key=>source.entry[key]!==entry[key]))throw new AppError('STORAGE_COPY');
   await this.selected(source.entry,async storage=>{
    const key=cloneVault(storage.vault),owner=new LabBookStorage(path.join(target.root,entry.directory),entry.labBookId,key);
    try{
     const saved=await labBookTransferReceipt(owner);
     if(saved?.phase!=='verified'||saved.id!==projectBookCopyTransferId(receipt,entry.labBookId)||saved.source!==storage.root||saved.namespaceId!==entry.namespaceId||saved.vaultId!==entry.vaultId)throw new AppError('STORAGE_COPY');
     await onCopiedBook(owner);
    }finally{clearVault(key);}
   });
  }});
 }
}
