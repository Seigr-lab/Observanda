import {ProjectBookOwners} from './project-book-owners.js';
import {validateRenameBooks} from './rename-owner-receipts.js';
export {validateRenameBooks} from './rename-owner-receipts.js';
// A parent rename authorizes each book, fences its database and carries its
// existing directory. The project keeps only short-lived recovery capabilities.
import path from 'node:path';
import {readFile,realpath,unlink} from 'node:fs/promises';
import {assertRegular,atomicWrite,digest,serialize} from './storage.js';
import {databaseProvider} from './workspace-database-context.js';
import {assertLabBookDatabaseStopped} from './lab-book-postgres.js';
import {workspaceDatabaseLease} from './workspace-database-lease.js';
import {RENAME_MARKER,workspaceRename} from './workspace-rename-state.js';
import {saveRenameKeys,loadRenameKeys,RENAME_KEYS_FILE} from './workspace-rename-keys.js';
import {nestedRenameRoot} from './workspace-rename-paths.js';
import {operationStage,operationAdvance,operationItem} from './operation-progress.js';
import {AppError} from './errors.js';
const identity=stat=>({dev:String(stat.dev),ino:String(stat.ino)});
const hash=async file=>digest(await readFile(file));
export class ProjectBookRename extends ProjectBookOwners{
 constructor(project,{keyFile=RENAME_KEYS_FILE}={}){super(project);this.keyFile=keyFile;}
 async persist(id,item){
  await this.ready();if(await this.registry.version()!==this.revision)throw new AppError('CONFLICT');
  if(!this.books.length)return;item.books=this.books;item.bookRegistryRevision=this.revision;item.bookKeysHash=await saveRenameKeys(this.project,id,this.keys,this.keyFile);
 }
 async load(id,item){
  this.books=item.books??[];if(!this.books.length)return;
  validateRenameBooks(this.books);if(await this.registry.version()!==item.bookRegistryRevision)throw new AppError('STORAGE_RENAME_STATE');
  this.keys=await loadRenameKeys(this.project,id,item.bookKeysHash,this.keyFile);
  if(this.keys.size!==this.books.length||this.books.some(book=>this.keys.get(book.labBookId)?.id!==book.vaultId))throw new AppError('STORAGE_RENAME_STATE');
 }
 async freezeAndStop(value,{checkpoint=async()=>{}}={}){
  if(!this.books.length)return;
  return operationStage('rename-book-databases',{unit:'books',total:this.books.length},async()=>{
   for(const item of this.books){
    operationItem(item.directory);const storage=await this.checked(item),relative=path.relative(value.source,storage.root).split(path.sep).join('/'),prior=await workspaceRename(storage.root);
    const marker={version:3,...(value.placement?{placement:true}:{}),id:value.id,source:nestedRenameRoot(value.source,relative),destination:nestedRenameRoot(value.destination,relative),parentSource:value.source,parentDestination:value.destination,relative,projectId:this.project.projectId,labBookId:item.labBookId};
    if(prior&&serialize(prior)!==serialize(marker))throw new AppError('STORAGE_RENAME_STATE');
    if(!prior)await storage.withStorageHandoff(()=>atomicWrite(path.join(storage.root,RENAME_MARKER),serialize(marker)),{existing:true});
    await checkpoint('book-frozen',value,item.labBookId);
    const provider=databaseProvider();if(!provider?.stopLabBookForRename)throw new AppError('DATABASE_LOCATION');await provider.stopLabBookForRename(storage.root,item.labBookId,storage.vault,value.id);
    const lease=await workspaceDatabaseLease(path.join(storage.root,'.observanda/postgresql'));try{await assertLabBookDatabaseStopped(storage.root,item.labBookId,storage.vault);}finally{await lease.close();}
    await checkpoint('book-stopped',value,item.labBookId);operationAdvance();
   }
  });
 }
 async verify(){
  if(!this.books.length)return;
  return operationStage('rename-reopen-books',{unit:'books',total:this.books.length},async()=>{for(const item of this.books){operationItem(item.directory);const storage=await this.checked(item);if((await storage.outline()).metadata.id!==item.namespaceId)throw new AppError('STORAGE_RENAME_STATE');operationAdvance();}});
 }

}
export async function clearRenamedBooks(projectRoot,item,value,keyFile=RENAME_KEYS_FILE){
 for(const book of item.books??[]){
  const root=nestedRenameRoot(projectRoot,book.directory),stat=await assertRegular(root,{directory:true});
  if(await realpath(root)!==root||serialize(identity(stat))!==serialize(book.identity)||await hash(path.join(root,'.observanda/access.json'))!==book.accessHash)throw new AppError('STORAGE_RENAME_STATE');
  const marker=await workspaceRename(root);if(!marker)continue;
  if(marker.version!==3||marker.id!==value.id||marker.labBookId!==book.labBookId||marker.projectId!==item.projectId||marker.parentDestination!==value.destination)throw new AppError('STORAGE_RENAME_STATE');await unlink(path.join(root,RENAME_MARKER));
 }
 if(item.books?.length){const file=path.join(projectRoot,keyFile);if(await assertRegular(file,{missing:true})){if(await hash(file)!==item.bookKeysHash)throw new AppError('STORAGE_RENAME_STATE');await unlink(file);}}
}
