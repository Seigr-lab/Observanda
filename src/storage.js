import {assertWorkspaceAvailable} from './workspace-lifecycle-admission.js';
import {withQueryCacheHandoff} from './query-cache-lifecycle.js';
import {assertStagingHandoff,withStagingHandoff} from './staging-reservations.js';
import {persistDirectoryCreation,createPersistentDirectory} from './filesystem-persistence.js';
import {projectDomainHandoff} from './project-domain-lock.js';
import {assertNotRenaming} from './workspace-rename-state.js';
import {serialize} from './storage-format.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {constants as bufferConstants} from 'node:buffer';
import {hasCatalogue,catalogueContext,openCatalogue,ResearchCatalogue,isCatalogue,catalogueDescriptor} from './research-catalogue.js';
import {CatalogueReadCache} from './catalogue-read-cache.js';
import {withCatalogueFormatRead} from './catalogue-format-read.js';
import {withCatalogueConnections,catalogueConnection} from './catalogue-connections.js';
import {atomicReplace} from './atomic-replace.js';
import {temporaryWriteName} from './storage-temporary.js';
import {seal,unseal,ENCRYPTION_OVERHEAD} from './encryption.js';
import { mkdir, lstat, readFile, open, rename, unlink, rmdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';
import {assertNotMoving} from './workspace-move-state.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {withWriterLease} from './writer-lease.js';
import {waitForWriter,queuedWriter} from './writer-wait.js';
import { validateNotebook, upgradeNotebook, MAX_BYTES } from './model.js';
import {nativeDestination} from './native-destination.js';

const catalogueReads=new AsyncLocalStorage();
export const withoutCatalogueReadContext=operation=>catalogueReads.exit(operation);
let requireMetadataFormat,metadataFormatLoading;
function ownedCatalogue(context,workspace){
 if(context?.root!==workspace.root)return null;
 if((context.projectId??null)!==(workspace.projectId??null)||(context.labBookId??null)!==(workspace.labBookId??null))throw new AppError('DATABASE_LOCATION');
 if(context.vault!==undefined&&(context.vault?.id!==workspace.vault?.id||!Buffer.isBuffer(context.vault?.key)||!Buffer.isBuffer(workspace.vault?.key)||!context.vault.key.equals(workspace.vault.key)))throw new AppError('ACCESS_DENIED');
 return context;
}
const activeCatalogue=workspace=>Boolean(ownedCatalogue(catalogueContext.getStore(),workspace)||ownedCatalogue(catalogueReads.getStore(),workspace));
function inspectOwnedCatalogue(workspace,store,operation){
 if(store.workspace!==workspace)throw new AppError('INVALID');
 const held=ownedCatalogue(catalogueContext.getStore(),workspace);
 const inspect=async()=>{
  const cache=store.readCache??new CatalogueReadCache();
  try{return await store.db.scope(()=>catalogueReads.run({root:workspace.root,projectId:workspace.projectId,labBookId:workspace.labBookId,vault:workspace.vault,db:store.db,cache},operation));}
  finally{if(!store.readCache)cache.clear();}
 };
 // A second connection may not read this workspace while its writer holds a transaction.
 if(held?.root===workspace.root&&held.db!==store.db)throw new AppError('LOCKED');
 return inspect();
}

export const WORKSPACE_FILE='workspace.observanda';
export async function workspaceFile(root){
 const file=path.join(root,WORKSPACE_FILE);
 await assertRegular(file,{missing:true});
 return file;
}
export {digest,serialize} from './storage-format.js';

export async function assertRegular(file, { missing = false, directory = false } = {}) {
  const admitted=nativeDestination(file);if(admitted?.directory)return admitted.stat(file,{missing,directory});
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (!directory && stat.nlink > 1)) throw new AppError('UNSAFE');
    return stat;
  } catch (error) { if (missing && error.code === 'ENOENT') return null; throw error; }
}

export async function readStorageFile(file,encoding,limit=bufferConstants.MAX_LENGTH){
 const admitted=nativeDestination(file);return admitted?.directory?admitted.read(file,{encoding,limit}):readFile(file,encoding);
}

export async function privateDirectory(root, relative) {
  const admitted=nativeDestination(path.resolve(root,relative));if(admitted)return admitted.ensure(path.relative(admitted.root,path.resolve(root,relative)));
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    // Existing evidence directories are the common case. Validate every parent
    // without issuing a failing mkdir for each chunk or retained original.
    if (await assertRegular(current, { missing: true, directory: true })) continue;
    await mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await assertRegular(current, { directory: true });
    await persistDirectoryCreation(current);
  }
  return current;
}

export async function atomicWrite(file, content) {
  const admitted=nativeDestination(file);if(admitted)return admitted.write(file,content);
  const temporary = path.join(path.dirname(file), temporaryWriteName());
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close(); handle = null;
    await atomicReplace(temporary, file);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export class Workspace {
  constructor(root, vault = null) { this.root = path.resolve(root); this.vault=vault; }
  fileAAD(file){const relative=path.relative(this.root,file).split(path.sep).join('/');if(relative.startsWith('../')||path.isAbsolute(relative))throw new AppError('UNSAFE');return 'Observanda/file/v1/'+this.vault.id+'/'+relative;}
  async requireStorageKey(){
    await assertNotRenaming(this.root);
    if(this.vault?.id){if(!this.vault.key)throw new AppError('ACCESS_LOCKED');return;}
    // Every workspace is encrypted. Without its key, only a folder that holds
    // no workspace yet (one being created) may be prepared.
    if(await assertRegular(path.join(this.root,'.observanda','access.json'),{missing:true})||await assertRegular(await workspaceFile(this.root),{missing:true}))throw new AppError('ACCESS_LOCKED');
  }
  async requireCatalogueKey(){
    // Admission checked the location fences before opening this transaction.
    // Metadata reuses that owned snapshot; direct file access and new
    // transactions still check the filesystem. Vault identity remains live.
    if(this.vault?.id){
      if(!this.vault.key)throw new AppError('ACCESS_LOCKED');
      if(activeCatalogue(this))return;
    }
    await this.requireStorageKey();
  }
  async readFile(file,encoding,limit=bufferConstants.MAX_LENGTH){await this.requireStorageKey();if(!this.vault?.key)throw new AppError('ACCESS_LOCKED');const bytes=unseal(await readStorageFile(file,undefined,limit),this.vault.key,this.fileAAD(file));return encoding?bytes.toString(encoding):bytes;}
  async writeFile(file,content){await this.requireStorageKey();if(!this.vault?.key)throw new AppError('ACCESS_LOCKED');await atomicWrite(file,seal(Buffer.from(content),this.vault.key,this.fileAAD(file)));}
  metadataPath(relative){
    if(typeof relative!=='string'||!/^\.observanda\/[a-zA-Z0-9./-]+$/.test(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw new AppError('UNSAFE');
    return path.join(this.root,...relative.split('/'));
  }
  async readMetadata(relative,limit){
    this.metadataPath(relative);await this.requireCatalogueKey();
    if(activeCatalogue(this)||await hasCatalogue(this.root))return this.catalogue(async store=>{
      const value=await store.object('metadata:'+relative);if(value===null)return null;
      if(typeof value.text!=='string')throw new AppError('FORMAT');if(Buffer.byteLength(value.text)>limit)throw new AppError('LIMIT');return value.text;
    });
    throw new AppError('FORMAT');
  }
  // Batched reads of up to 32 small metadata files, as readMetadata reads each.
  async readMetadataMany(relatives,limit){
    if(!Array.isArray(relatives)||relatives.length>32||new Set(relatives).size!==relatives.length)throw new AppError('INVALID');
    for(const relative of relatives)this.metadataPath(relative);await this.requireCatalogueKey();
    if(!activeCatalogue(this)&&!await hasCatalogue(this.root))throw new AppError('FORMAT');
    return this.catalogue(async store=>{
      const values=await store.objects(relatives.map(relative=>'metadata:'+relative));
      return relatives.map(relative=>{const value=values.get('metadata:'+relative);if(value===null)return null;if(typeof value.text!=='string')throw new AppError('FORMAT');if(Buffer.byteLength(value.text)>limit)throw new AppError('LIMIT');return value.text;});
    });
  }
  async writeMetadata(relative,text){
    this.metadataPath(relative);
    if(activeCatalogue(this)||await hasCatalogue(this.root)){
      if(catalogueContext.getStore()?.root!==this.root)throw new AppError('LOCKED');
      return this.catalogue(async store=>{
        requireMetadataFormat??=await (metadataFormatLoading??=import('./metadata-catalogue-format.js').then(module=>module.requireMetadataCatalogueFormat));
        await requireMetadataFormat(store.db,relative,text);
        return store.putObject('metadata:'+relative,{text});
      });
    }
    throw new AppError('FORMAT');
  }
  async *metadataNames(relative,{signal}={}){
    this.metadataPath(relative);await this.requireCatalogueKey();signal?.throwIfAborted();
    if(activeCatalogue(this)||await hasCatalogue(this.root)){
      const prefix='metadata:'+relative+'/';let after=null,previous=null;
      do{
        const page=await this.catalogue(store=>store.objectIdPage(prefix,{after,signal}));
        for(const id of page.items){
          signal?.throwIfAborted();const tail=id.slice(prefix.length),name=tail.split('/')[0];
          if(name===previous)continue;previous=name;
          // Object stores can contain both a file and descendants under the
          // same name. The exact file sorts first, even across other siblings.
          if(tail!==name&&await this.catalogue(store=>store.objectIdentity(prefix+name)))continue;
          yield name;
        }
        after=page.next;
      }while(after!==null);
      return;
    }
    throw new AppError('FORMAT');
  }
  async listMetadata(relative){const names=[];for await(const name of this.metadataNames(relative))names.push(name);return names;}
  async metadataPage(relative,{after=null,limit=20}={}){
    this.metadataPath(relative);await this.requireCatalogueKey();
    if(!activeCatalogue(this)&&!await hasCatalogue(this.root))throw new AppError('FORMAT');
    return this.catalogue(async store=>{
      const prefix='metadata:'+relative+'/',page=await store.objectPage(prefix,{after:after===null?null:prefix+after,limit});
      return {items:page.items.map(item=>({name:item.id.slice(prefix.length),text:item.value.text})),next:page.next?.slice(prefix.length)??null};
    });
  }
  async removeMetadata(relative){
    this.metadataPath(relative);
    if(activeCatalogue(this)||await hasCatalogue(this.root)){
      if(catalogueContext.getStore()?.root!==this.root)throw new AppError('LOCKED');
      return this.catalogue(store=>store.deleteObject('metadata:'+relative));
    }
    throw new AppError('FORMAT');
  }
  async read() {return this.readWorkspace(false);}
  // An outline cannot be mistaken for a complete editable book.
  async outline() {return this.readWorkspace(true);}
  async readWorkspace(metadataOnly) {
    try {
      await assertNotDeleting(this.root);
      await assertNotMoving(this.root);
      await assertRegular(path.join(this.root,'.observanda'),{directory:true,missing:true});
      if(await assertRegular(path.join(this.root,'.observanda','copy-in-progress'),{missing:true}))throw new AppError('STORAGE_INCOMPLETE');
      const file = await workspaceFile(this.root);
      const stat = await assertRegular(file);
      if (stat.size > MAX_BYTES + ENCRYPTION_OVERHEAD) throw new AppError('LIMIT');
      const raw = await this.readFile(file, 'utf8');
      let book;
      try { book = JSON.parse(raw); } catch { throw new AppError('FORMAT'); }
      if(!isCatalogue(book))throw new AppError('FORMAT');
      if(book.version!==2||Object.keys(book).sort().join()!=='format,version,workspaceId')throw new AppError('CATALOGUE_DAMAGED');
      return await this.catalogue(async store=>{
        if(metadataOnly){
          const etag=await store.head(),snapshot=await store.snapshot(etag);
          if(snapshot.metadata.id!==book.workspaceId)throw new AppError('CATALOGUE_DAMAGED');
          const {entries,...metadata}=snapshot.metadata;void entries;
          return {metadata,etag,recordCount:snapshot.count};
        }
        const result=await store.read();
        if(result.book.id!==book.workspaceId)throw new AppError('CATALOGUE_DAMAGED');
        validateNotebook(result.book);
        return result;
      });
    } catch (error) { if (error.code === 'ENOENT') throw new AppError('MISSING'); throw error; }
  }
  catalogueStore(db,options){return new ResearchCatalogue(this,db,options);}
  async openCatalogue(options={}) {
    await assertWorkspaceAvailable(this.root,options);
    return openCatalogue(this.root,{...options,vault:this.vault,validate:this.vault?.key?async db=>{
      const descriptor=JSON.parse(await this.readFile(await workspaceFile(this.root),'utf8'));
      await this.catalogueStore(db).verify(descriptor);
      options.onVerified?.(descriptor);
    }:undefined});
  }
  withCatalogueConnections(operation){return withCatalogueConnections(this,operation);}
  async catalogue(operation) {
    await this.requireCatalogueKey();
    const held=ownedCatalogue(catalogueContext.getStore(),this);
    if(held?.root===this.root)return operation(this.catalogueStore(held.db));
    const reader=ownedCatalogue(catalogueReads.getStore(),this);if(reader?.root===this.root)return operation(this.catalogueStore(reader.db,{readCache:reader.cache}));
    return catalogueConnection(this,'read',{},async db=>{
      const cache=new CatalogueReadCache();
      try{
        await db.run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result=await withCatalogueFormatRead(db,()=>db.scope(()=>catalogueReads.run({root:this.root,projectId:this.projectId,labBookId:this.labBookId,vault:this.vault,db,cache},()=>operation(this.catalogueStore(db,{readCache:cache})))));
        await db.run('COMMIT');return result;
      }finally{cache.clear();}
    });
  }
  // Verification already owns a fixed catalogue transaction, including before
  // a restored database has a published binding. Domain readers must inspect
  // that exact snapshot instead of opening/activating another database.
  async inspectCatalogue(store,operation){
    await this.requireStorageKey();
    return inspectOwnedCatalogue(this,store,operation);
  }
  async updateRecords(command,apply,options){
    return this.withLock(()=>this.catalogue(store=>store.updateRecords(command,apply,options)));
  }
  // Called only while creating a new workspace. Application updates never copy
  // or replace a workspace to select a different storage engine.
  async initializeResearch(book,metadata={},populate=null) {
    if(!this.vault?.key)throw new AppError('ACCESS_LOCKED');
    validateNotebook(book);
    const file=await workspaceFile(this.root);
    if(await assertRegular(file,{missing:true}))throw new AppError('EXISTS');
    const db=await this.openCatalogue({create:true});
    try{
      await db.run('BEGIN');
      const store=this.catalogueStore(db),descriptor=catalogueDescriptor(book),afterCommit=[];
      await db.scope(async()=>{
      await store.put(book);
      for(const [relative,text] of Object.entries(metadata)){this.metadataPath(relative);await store.putObject('metadata:'+relative,{text});}
      if(populate)await catalogueContext.run({root:this.root,projectId:this.projectId,labBookId:this.labBookId,vault:this.vault,db,afterCommit},()=>populate(this));
      await store.verify(descriptor);
      await db.run('COMMIT');
      await this.writeFile(file,serialize(descriptor));
      for(const operation of afterCommit)await operation();
      });
    }finally{await db.close();}
  }
  async afterCommit(operation){
    const held=ownedCatalogue(catalogueContext.getStore(),this);
    if(held?.root===this.root){held.afterCommit.push(operation);return;}
    await operation();
  }
  withStorageHandoff(operation,options){return withStagingHandoff(this,()=>withQueryCacheHandoff(this.root,()=>this.withLock(async internal=>{await assertStagingHandoff(this);const held=catalogueContext.getStore();if(held?.root===this.root)await projectDomainHandoff(held.db);return operation(internal);},options)));}
  async withLock(operation,{detached=false,moveId,existing=false}={}) {
    await assertWorkspaceAvailable(this.root,{moveId});
    if(existing)await assertRegular(this.root,{directory:true});else await createPersistentDirectory(this.root, { recursive: true, mode: 0o700 });
    // Canonicalize the selected workspace before using its protected internal paths.
    this.root = await realpath(this.root);
    const internal = await privateDirectory(this.root, '.observanda');
    const lock = path.join(internal, 'write.lock');
    if(await hasCatalogue(this.root)){
      if(catalogueContext.getStore()?.root===this.root)throw new AppError('LOCKED');
      return queuedWriter(this.root,()=>catalogueConnection(this,'write',{detached,moveId},async db=>{
        await db.run('BEGIN');await waitForWriter(()=>db.lock());
        await assertWorkspaceAvailable(this.root,{moveId});
        const afterCommit=[];
        const result=await db.scope(()=>catalogueContext.run({root:this.root,projectId:this.projectId,labBookId:this.labBookId,vault:this.vault,db,afterCommit},()=>operation(internal)));
        await db.run('COMMIT');for(const cleanup of afterCommit)await cleanup();return result;
      }));
    }
    // A folder without a database is still being created. Creation holds the
    // file lease until its database exists; later writers use the database.
    return withWriterLease(lock,async()=>{
      await assertWorkspaceAvailable(this.root,{moveId});
      // Creation may have completed while this writer waited.
      if(await hasCatalogue(this.root))return this.withLock(operation,{detached,moveId,existing:true});
      return operation(internal);
    });
  }
  async save(book, expectedEtag) {
    validateNotebook(book);
    return this.withLock(async () => {
      const current = await this.read();
      if (current.etag !== expectedEtag) throw new AppError('CONFLICT');
      return this.#commit(current, book);
    });
  }
  // Application commands inspect and change the latest snapshot under one lock.
  // The callback never writes files; revisions and encryption stay in this adapter.
  async update(operation) {
    return this.withLock(async () => {
      const current = await this.read();
      const next = await operation(structuredClone(current.book));
      if (next === null) return current;
      return this.#commit(current, next);
    });
  }
  async #commit(current, book) {
    validateNotebook(book);
    if (book.id !== current.book.id || book.revision !== current.book.revision || book.createdAt !== current.book.createdAt) throw new AppError('CONFLICT');
    const next = structuredClone(book);
    next.revision = current.book.revision + 1;
    next.updatedAt = new Date().toISOString();
    const comparable = upgradeNotebook(current.book);
    const originals = new Map(comparable.entries.map(entry => [entry.id, entry]));
    for (const entry of next.entries) {
      const previous = originals.get(entry.id);
      entry.createdAt = previous?.createdAt ?? next.updatedAt;
      entry.updatedAt = previous && JSON.stringify(previous) === JSON.stringify(entry) ? previous.updatedAt : next.updatedAt;
    }
    validateNotebook(next);
    return this.catalogue(async store=>{
      if(await store.head()!==current.etag)throw new AppError('CONFLICT');
      return store.put(next);
    });
  }
  async *revisionSnapshots() {
    const ids=await this.catalogue(async store=>{const head=await store.head();return (await store.snapshots()).filter(id=>id!==head);});
    for(const id of ids)yield {id,book:(await this.catalogue(store=>store.read(id))).book};
  }
  async readRevision(revisionId) {
    if(typeof revisionId!=='string')throw new AppError('INVALID');
    return (await this.catalogue(store=>store.read(revisionId))).book;
  }
}
