import {NativeProjectBookCopy} from './native-project-book-copy.js';
import {inspectArchivedOwnerDirectory} from './owner-directory-archive.js';
import {readProjectArchiveIdentity} from './project-archive.js';
import {LabBookStorage} from './lab-book-storage.js';
// A project bundle contains independently transferred book owners. Membership
// is fixed for the command; ordinary writers in unrelated owners remain free.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProjectBookOwners} from './project-book-owners.js';
import {LabBookRegistry} from './lab-book-registry.js';
import {copyLabBookLocation,labBookTransferReceipt} from './lab-book-transfer.js';
import {withWriterLease} from './writer-lease.js';
import {assertRegular,privateDirectory} from './storage.js';
import {readAccess} from './access.js';
import {databaseProvider} from './workspace-database-context.js';
import {operationStage,operationAdvance,operationItem} from './operation-progress.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export class ProjectBookCopy extends ProjectBookOwners{
 constructor(project){super(project,{busyCode:'STORAGE_PROJECT_BUSY',missingAccessCode:'ACCESS_LOCKED'});}
 async prepare(withBook,{portable=false,relocation=false}={}){
  this.withBook=withBook;this.native=null;
  if(!relocation){this.native=new NativeProjectBookCopy(this);return this.native.prepare(withBook,{portable});}
  await super.prepare(withBook);
  if(portable)for(const book of this.books){const storage=await this.checked(book),access=await readAccess(storage.root);if(!access.value.password&&!access.value.recovery)throw new AppError('STORAGE_PORTABLE_BOOK_ACCESS');}
 }
 async using(operation,{holdBooks=false}={}){
  if(this.native)return this.native.using(operation,{holdBooks});
  const directory=await privateDirectory(this.project.root,'.observanda/lab-book-creation'),books=[...this.books].sort((a,b)=>a.labBookId.localeCompare(b.labBookId));
  const take=index=>index===books.length?withWriterLease(path.join(this.project.root,'.observanda/lab-books.lock'),async()=>{await this.ready();if(await this.registry.version()!==this.revision)throw new AppError('CONFLICT');if(!holdBooks)return operation();return this.withStorageHandoff(async()=>{this.holdingBooks=true;try{return await operation();}finally{this.holdingBooks=false;}});}):withWriterLease(path.join(directory,'book-'+books[index].labBookId+'.lock'),()=>take(index+1));
  return take(0);
 }
 async copied(target,receipt,{portable=false,onCopiedBook}={}){
  if(this.native)return this.native.copied(target,receipt,{portable,onCopiedBook});
  if(portable||typeof onCopiedBook!=='function')return;
  const registry=new LabBookRegistry(target);await registry.inspect(async current=>{
  for await(const {entry} of current.entries()){
   const source=this.books.find(book=>book.labBookId===entry.labBookId),transfer=receipt.bookTransfers?.find(item=>item.labBookId===entry.labBookId);
   if(!source||!transfer)throw new AppError('STORAGE_COPY');
   const owner=new LabBookStorage(registry.location(entry).root,entry.labBookId,this.keys.get(entry.labBookId)),saved=await labBookTransferReceipt(owner);
   if(saved?.phase!=='verified'||saved.id!==transfer.id||saved.source!==this.registry.location(source).root||saved.namespaceId!==entry.namespaceId||saved.vaultId!==entry.vaultId)throw new AppError('STORAGE_COPY');
   await onCopiedBook(owner);
  }
  });
 }

 async targetRevision(target,portable){
  const registry=new LabBookRegistry(target);if(!portable)return registry.version();
  const identity=await readProjectArchiveIdentity(target.root,target.vault,{verify:false});
  return inspectArchivedOwnerDirectory(registry,identity.archiveDigest,view=>view.revision);
 }
 async copy(target,receipt,save,{portable=false,relocation=false,checkpoint=async()=>{}}={}){
  if(this.native)return this.native.copy(target,receipt,save,{portable,relocation,checkpoint});
  if(!this.books.length)return;
  if(receipt.bookRegistryRevision!==undefined&&receipt.bookRegistryRevision!==this.revision)throw new AppError('CONFLICT');
  if(receipt.bookTransfers===undefined){receipt.bookRegistryRevision=this.revision;receipt.bookTransfers=this.books.map(book=>({labBookId:book.labBookId,id:randomUUID()}));await save();}
  const transfers=receipt.bookTransfers;
  if(!Array.isArray(transfers)||transfers.length!==this.books.length||new Set(transfers.map(item=>item.id)).size!==transfers.length||transfers.some((item,index)=>item.labBookId!==this.books[index].labBookId||!researchId(item.id)))throw new AppError('STORAGE_COPY');
  if(await this.targetRevision(target,portable)!==this.revision)throw new AppError('CONFLICT');
  await operationStage('copy-project-books',{unit:'books',total:this.books.length},async()=>{
   for(const [index,book] of this.books.entries()){
    operationItem(book.directory);await this.checked(book);const destination=path.join(target.root,book.directory);
    await this.withBook(book.labBookId,async storage=>{
     const current=await this.checked(book);if(storage.root!==current.root||storage.vault?.id!==book.vaultId)throw new AppError('CONFLICT');
     const copied=await copyLabBookLocation(storage,destination,{id:transfers[index].id,portable,relocation,...(this.holdingBooks?{sourceHandoff:operation=>operation(),afterVerified:async()=>{}}:{}),checkpoint:(stage,file)=>checkpoint('book-'+stage,{labBookId:book.labBookId,file})});
     try{if((await labBookTransferReceipt(copied)).namespaceId!==book.namespaceId)throw new AppError('DATABASE_LOCATION');}finally{await databaseProvider()?.closeLabBook(destination);}
    });
    await assertRegular(destination,{directory:true});operationAdvance();await checkpoint('book',book.labBookId);
   }
  });
  if(await this.registry.version()!==this.revision||await this.targetRevision(target,portable)!==this.revision)throw new AppError('CONFLICT');
 }
}
