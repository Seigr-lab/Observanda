import {assertProjectBookPlacementsComplete} from './lab-book-placement-state.js';
import {assertProjectBookTransfersComplete} from './lab-book-transfer-state.js';
// A project discovers and authenticates its immediate book owners. Lifecycle
// commands reuse this inventory without reading record bodies or evidence.
import path from 'node:path';
import {opendir,readFile,realpath} from 'node:fs/promises';
import {LabBookRegistry} from './lab-book-registry.js';
import {LabBookCreation} from './lab-book-creation.js';
import {LabBookRenames} from './lab-book-rename.js';
import {pendingLabBookDeletions} from './lab-book-deletion.js';
import {LabBookStorage} from './lab-book-storage.js';
import {catalogueBinding} from './postgres-activation.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {cloneVault,clearVault} from './encryption.js';
import {assertRegular,digest,serialize,privateDirectory} from './storage.js';
import {withWriterLease,writerLeaseHeld} from './writer-lease.js';
import {validateRenameBooks} from './rename-owner-receipts.js';
import {AppError} from './errors.js';
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const hash=async file=>digest(await readFile(file));
export class ProjectBookOwners{
 constructor(project,{busyCode='STORAGE_RENAME_BUSY',missingAccessCode='STORAGE_RENAME_PROJECTS'}={}){this.project=project;this.busyCode=busyCode;this.missingAccessCode=missingAccessCode;this.registry=new LabBookRegistry(project);this.keys=new Map();}
 async ready({renames=true}={}){
  await assertProjectBookPlacementsComplete(this.project);await assertProjectBookTransfersComplete(this.project);
  // Pending creation/deletion is explicitly recoverable in the book list.
  for(const owner of [new LabBookCreation(this.project),{pending:args=>pendingLabBookDeletions(this.project,args)}]){
   let after=null;do{const page=await owner.pending({after,limit:50});if(page.items.length)throw new AppError(this.busyCode);after=page.next;}while(after);
  }
  if(!renames)return;const directory=path.join(this.project.root,'.observanda/lab-book-renames');
  if(await assertRegular(directory,{directory:true,missing:true}))for await(const file of await opendir(directory)){
   const match=/^book-([a-f0-9-]{36})\.pointer$/.exec(file.name);if(!match)continue;
   const pending=await new LabBookRenames(this.project).pending(match[1]);if(pending)throw new AppError(this.busyCode);
  }
 }
 async prepare(withBook){
  await this.ready({renames:false});const books=[];let revision;
  await this.registry.inspect(async current=>{
   revision=current.revision;if(current.count&&typeof withBook!=='function')throw new AppError(this.missingAccessCode);
   for await(const {entry:initial} of current.entries()){
    await withBook(initial.labBookId,async storage=>{
     const {root,...entry}=await this.registry.locate(initial.labBookId);
     if(entry.vaultId!==initial.vaultId||entry.namespaceId!==initial.namespaceId)throw new AppError('CONFLICT');
     if(storage.root!==root||storage.labBookId!==entry.labBookId||storage.vault?.id!==entry.vaultId||await realpath(root)!==root)throw new AppError('DATABASE_LOCATION');
     authenticateKeyring((await readAccess(root)).value,storage.vault);const binding=await catalogueBinding(root),metadata=(await storage.outline()).metadata;
     if(binding?.placement!=='lab-book'||binding.labBookId!==entry.labBookId||metadata.id!==entry.namespaceId||metadata.notebooks[0].projectId!==this.project.projectId)throw new AppError('DATABASE_LOCATION');
     books.push({...entry,identity:identity(await assertRegular(root,{directory:true})),accessHash:await hash(path.join(root,'.observanda/access.json'))});this.keys.set(entry.labBookId,cloneVault(storage.vault));
    });
   }
  });
  await this.ready();await this.registry.inspect(async current=>{
   if(current.count!==books.length)throw new AppError('CONFLICT');let index=0;
   for await(const {entry} of current.entries()){const selected=books[index++];if(!selected||['labBookId','directory','namespaceId','vaultId'].some(key=>selected[key]!==entry[key]))throw new AppError('CONFLICT');}
   revision=current.revision;
  });this.revision=revision;this.books=validateRenameBooks(books);return this.books;
 }
 async withStorageHandoff(operation,{checkOwner}={}){
  const entries=[...this.books].sort((a,b)=>a.labBookId.localeCompare(b.labBookId));
  const next=async index=>{
   if(index===entries.length)return operation();const item=entries[index],storage=await this.checked(item);
   return storage.withStorageHandoff(async()=>{await this.checked(item);await checkOwner?.(storage);return next(index+1);},{existing:true});
  };
  const directory=await privateDirectory(this.project.root,'.observanda/lab-book-creation');
  const take=index=>{if(index===entries.length)return next(0);const file=path.join(directory,'book-'+entries[index].labBookId+'.lock');return writerLeaseHeld(file)?take(index+1):withWriterLease(file,()=>take(index+1));};
  return take(0);
 }
 async checked(item){
  const root=this.registry.location(item).root,stat=await assertRegular(root,{directory:true});
  if(await realpath(root)!==root||serialize(identity(stat))!==serialize(item.identity)||await hash(path.join(root,'.observanda/access.json'))!==item.accessHash)throw new AppError('STORAGE_RENAME_STATE');
  const vault=this.keys.get(item.labBookId);if(!vault)throw new AppError('ACCESS_LOCKED');authenticateKeyring((await readAccess(root)).value,vault);
  const binding=await catalogueBinding(root);if(binding?.placement!=='lab-book'||binding.labBookId!==item.labBookId)throw new AppError('DATABASE_LOCATION');return new LabBookStorage(root,item.labBookId,vault);
 }
 close(){for(const key of this.keys.values())clearVault(key);this.keys.clear();}
}
