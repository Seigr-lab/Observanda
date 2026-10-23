import {assertWorkspaceAvailable} from './workspace-lifecycle-admission.js';
import {projectDomainHandoff} from './project-domain-lock.js';
import {websiteMetadataShell} from './website-owned-metadata.js';
import {withProjectSourceMetadataAuthority} from './project-source-metadata-authority.js';
import {inspectRecordedCatalogue,assertCatalogueWritable} from './catalogue-inspection.js';
import {workspaceFolderName} from './workspace-names.js';
import {assertNotRenaming} from './workspace-rename-state.js';
import {digest,serialize} from './storage-format.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {requireDatabase} from './postgres.js';
import {hasCatalogue,catalogueContext,openCatalogue,ResearchCatalogue,isCatalogue,catalogueDescriptor} from './research-catalogue.js';
import {CatalogueReadCache} from './catalogue-read-cache.js';
import {withCatalogueConnections,catalogueConnection} from './catalogue-connections.js';
import {atomicReplace} from './atomic-replace.js';
import {temporaryWriteName} from './storage-temporary.js';
import {seal,unseal,encrypted,ENCRYPTION_OVERHEAD} from './encryption.js';
import { mkdir, lstat, readFile, open, rename, unlink, rmdir, realpath, readdir, opendir } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors.js';
import {assertNotMoving} from './workspace-move-state.js';
import {assertNotDeleting} from './workspace-delete-state.js';
import {legacyWriterLock,withWriterLease} from './writer-lease.js';
import {waitForWriter,queuedWriter} from './writer-wait.js';
import { validateNotebook, upgradeNotebook, MAX_BYTES } from './model.js';

const catalogueReads=new AsyncLocalStorage();
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
 if(held?.root===workspace.root&&held.db!==store.db)return inspectRecordedCatalogue(workspace,store,inspect);
 return inspect();
}

export const WORKSPACE_FILE='workspace.observanda';
export async function workspaceFile(root,{secure=false}={}){
 const native=path.join(root,WORKSPACE_FILE),legacy=path.join(root,'observanda.json');
 const a=await assertRegular(native,{missing:true}),b=await assertRegular(legacy,{missing:true});
 if(a&&b)throw new AppError('ACCESS_FORMAT');
 return a?native:b?legacy:secure?native:legacy;
}
export {digest,serialize} from './storage-format.js';

export async function assertRegular(file, { missing = false, directory = false } = {}) {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || (!directory && stat.nlink > 1)) throw new AppError('UNSAFE');
    return stat;
  } catch (error) { if (missing && error.code === 'ENOENT') return null; throw error; }
}

export async function privateDirectory(root, relative) {
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    // Existing evidence directories are the common case. Validate every parent
    // without issuing a failing mkdir for each chunk or retained original.
    if (await assertRegular(current, { missing: true, directory: true })) continue;
    await mkdir(current, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await assertRegular(current, { directory: true });
  }
  return current;
}

export async function atomicWrite(file, content) {
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
    const data=await workspaceFile(this.root);
    const dataStat=await assertRegular(data,{missing:true});
    if(dataStat){
     const handle=await open(data,'r');try{const header=Buffer.alloc(8);await handle.read(header,0,8,0);if(encrypted(header))throw new AppError('ACCESS_LOCKED');}finally{await handle.close();}
    }
    const file=path.join(this.root,'.observanda','access.json');
    const stat=await assertRegular(file,{missing:true});if(!stat)return;
    if(stat.size>262144)throw new AppError('ACCESS_FORMAT');
    let header;try{header=JSON.parse(await readFile(file,'utf8'));}catch{throw new AppError('ACCESS_FORMAT');}
    if([2,3].includes(header?.formatVersion))throw new AppError('ACCESS_LOCKED');
    if(header?.formatVersion!==1)throw new AppError('ACCESS_FORMAT');
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
  async readFile(file,encoding){await this.requireStorageKey();const stored=await readFile(file);let bytes=stored;if(encrypted(stored)||this.vault?.id){if(!this.vault?.key)throw new AppError('ACCESS_LOCKED');bytes=unseal(stored,this.vault.key,this.fileAAD(file));}return encoding?bytes.toString(encoding):bytes;}
  async writeFile(file,content){await this.requireStorageKey();const bytes=Buffer.from(content);await atomicWrite(file,this.vault?.id?seal(bytes,this.vault.key,this.fileAAD(file)):bytes);}
  metadataPath(relative){
    if(typeof relative!=='string'||!/^\.observanda\/[a-zA-Z0-9./-]+$/.test(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..'))throw new AppError('UNSAFE');
    return path.join(this.root,...relative.split('/'));
  }
  async readMetadata(relative,limit){
    const file=this.metadataPath(relative);await this.requireCatalogueKey();
    if(activeCatalogue(this)||await hasCatalogue(this.root))return this.catalogue(async store=>{
      const value=await store.object('metadata:'+relative);if(value===null)return null;
      if(typeof value.text!=='string')throw new AppError('FORMAT');if(Buffer.byteLength(value.text)>limit)throw new AppError('LIMIT');return value.text;
    });
    await assertRegular(path.dirname(file),{directory:true,missing:true});const stat=await assertRegular(file,{missing:true});
    if(!stat)return null;if(stat.size>limit+ENCRYPTION_OVERHEAD)throw new AppError('LIMIT');return this.readFile(file,'utf8');
  }
  async writeMetadata(relative,text){
    const file=this.metadataPath(relative);
    if(activeCatalogue(this)||await hasCatalogue(this.root)){
      if(catalogueContext.getStore()?.root!==this.root)throw new AppError('LOCKED');
      return this.catalogue(async store=>{
        if(relative.startsWith('.observanda/materials/')||relative.startsWith('.observanda/jobs/')){
          const value=JSON.parse(text);if(value.content?.datasetFormat===3||relative.startsWith('.observanda/materials/sequences/chunks/')&&['cells','cell-text'].includes(value.kind)){const {requirePagedResearchTables}=await import('./catalogue-format.js');await requirePagedResearchTables(store.db);}
          const {referencedCalculationMetadata}=await import('./calculation-graph-format.js');if(referencedCalculationMetadata(relative,value)){const {requireReferencedCalculations}=await import('./catalogue-format.js');await requireReferencedCalculations(store.db);}
          const {nativeNumericalMetadata,nativeClockMetadata}=await import('./numerical-material-format.js');if(nativeNumericalMetadata(relative,value)){const {requireNativeNumericalModels}=await import('./catalogue-format.js');await requireNativeNumericalModels(store.db);}
          if(nativeClockMetadata(relative,value)){const {requireNativeClockModels}=await import('./catalogue-format.js');await requireNativeClockModels(store.db);}
          const {nativeDomainMetadata}=await import('./native-domain-format.js');if(nativeDomainMetadata(relative,value)){const {requireNativeDomainValues}=await import('./catalogue-format.js');await requireNativeDomainValues(store.db);}
          const {clockDerivationMetadata}=await import('./clock-derivation-format.js');if(clockDerivationMetadata(relative,value)){const {requireClockDerivations}=await import('./catalogue-format.js');await requireClockDerivations(store.db);}
          const {intervalUncertaintyMetadata}=await import('./interval-uncertainty-format.js');if(intervalUncertaintyMetadata(relative,value)){const {requireIntervalUncertainty}=await import('./catalogue-format.js');await requireIntervalUncertainty(store.db);}
          const {datasetResourceMetadata}=await import('./dataset-resource-format.js');if(datasetResourceMetadata(relative,value)){const {requireDatasetResourcePolicies}=await import('./catalogue-format.js');await requireDatasetResourcePolicies(store.db);}
        }
        if(/^\.observanda\/module-drafts\/[a-f0-9-]{36}\.json$/.test(relative)){
          const {checkpointHasCalculationPolicy}=await import('./web/tools/calculation-policy.js');if(checkpointHasCalculationPolicy(JSON.parse(text))){const {requireCalculationPolicies}=await import('./catalogue-format.js');await requireCalculationPolicies(store.db);}
        }
        if(relative.startsWith('.observanda/reviews/parts/')||/^\.observanda\/reviews\/[a-f0-9-]{36}\.json$/.test(relative)&&JSON.parse(text)?.request?.value?.version===2){
          const {requireReviewFigurePackages}=await import('./catalogue-format.js');await requireReviewFigurePackages(store.db);
        }
        return store.putObject('metadata:'+relative,{text});
      });
    }
    await privateDirectory(this.root,relative.slice(0,relative.lastIndexOf('/')));return this.writeFile(file,text);
  }
  async *metadataNames(relative,{signal}={}){
    const directory=this.metadataPath(relative);await this.requireCatalogueKey();signal?.throwIfAborted();
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
    if(!await assertRegular(directory,{directory:true,missing:true}))return;
    for await(const entry of await opendir(directory)){signal?.throwIfAborted();yield entry.name;}
  }
  async listMetadata(relative){const names=[];for await(const name of this.metadataNames(relative))names.push(name);return names;}
  async metadataPage(relative,{after=null,limit=20,localOnly=false}={}){
    this.metadataPath(relative);await this.requireCatalogueKey();
    if(!activeCatalogue(this)&&!await hasCatalogue(this.root))throw new AppError('FORMAT');
    return this.catalogue(async store=>{
      const prefix='metadata:'+relative+'/',page=await store.objectPage(prefix,{after:after===null?null:prefix+after,limit,localOnly});
      return {items:page.items.map(item=>({name:item.id.slice(prefix.length),text:item.value.text})),next:page.next?.slice(prefix.length)??null};
    });
  }
  async removeMetadata(relative){
    const file=this.metadataPath(relative);
    if(activeCatalogue(this)||await hasCatalogue(this.root)){
      if(catalogueContext.getStore()?.root!==this.root)throw new AppError('LOCKED');
      return this.catalogue(store=>store.deleteObject('metadata:'+relative));
    }
    await assertRegular(file);return unlink(file);
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
      if(isCatalogue(book)){
        if(book.version!==2||Object.keys(book).sort().join()!=='format,version,workspaceId')throw new AppError('CATALOGUE_DAMAGED');
        return this.catalogue(async store=>{
          if(metadataOnly){
            const etag=await store.head(),snapshot=await store.snapshot(etag);
            if(snapshot.metadata.id!==book.workspaceId)throw new AppError('CATALOGUE_DAMAGED');
            const {entries,...metadata}=snapshot.metadata;void entries;
            return {metadata,etag,recordCount:snapshot.count??snapshot.records.length};
          }
          const result=await store.read();
          if(result.book.id!==book.workspaceId)throw new AppError('CATALOGUE_DAMAGED');
          validateNotebook(result.book);
          return result;
        });
      }
      validateNotebook(book);
      if(metadataOnly){const {entries,...metadata}=book;return {metadata,etag:digest(raw),recordCount:entries.length};}
      return { book, etag: digest(raw) };
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
        const result=await db.scope(()=>catalogueReads.run({root:this.root,projectId:this.projectId,labBookId:this.labBookId,vault:this.vault,db,cache},()=>operation(this.catalogueStore(db,{readCache:cache}))));
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
  // Only this fixed, read-only transaction may reuse its admitted location.
  // The caller remains outside the read context, so its writes stay current.
  async withCatalogueInspection(store,operation,{signal}={}){
    signal?.throwIfAborted();
    if(store.workspace!==this)throw new AppError('INVALID');
    if(!Buffer.isBuffer(this.vault?.key))throw new AppError('ACCESS_LOCKED');
    const owner={root:this.root,projectId:this.projectId??null,labBookId:this.labBookId??null,vault:this.vault,id:this.vault.id,key:Buffer.from(this.vault.key)},db=store.db,pending=new Set();
    let active=true,closing=false;
    const check=()=>{
      if(!active)throw new AppError('INVALID');signal?.throwIfAborted();
      if(owner.root!==this.root||owner.projectId!==(this.projectId??null)||owner.labBookId!==(this.labBookId??null))throw new AppError('DATABASE_LOCATION');
      if(!Buffer.isBuffer(this.vault?.key))throw new AppError('ACCESS_LOCKED');
      if(this.vault!==owner.vault||this.vault.id!==owner.id||!owner.key.equals(this.vault.key))throw new AppError('ACCESS_DENIED');
      if(store.workspace!==this||store.db!==db)throw new AppError('INVALID');
    };
    try{
      check();await this.requireStorageKey();check();
      const transaction=await db.get("SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS read_only");
      if(!['repeatable read','serializable'].includes(transaction?.isolation)||transaction.read_only!=='on')throw new AppError('INVALID');
      await projectDomainHandoff(db,{shared:true});
      // A handoff may have started between the initial check and the lease.
      check();await this.requireStorageKey();check();
      const inspect=operation=>{
        if(closing)return Promise.reject(new AppError('INVALID'));
        const result=(async()=>{check();const value=await inspectOwnedCatalogue(this,store,operation);check();return value;})();
        pending.add(result);const finished=()=>pending.delete(result);result.then(finished,finished);return result;
      };
      let result,failure,failedOperation=false;
      try{result=await operation(inspect);}catch(error){failure=error;failedOperation=true;}
      closing=true;
      const settled=await Promise.allSettled([...pending]);
      if(failedOperation)throw failure;
      const failed=settled.find(value=>value.status==='rejected');if(failed)throw failed.reason;
      check();return result;
    }finally{closing=true;active=false;owner.key.fill(0);}
  }
  async updateRecords(command,apply,options){
    return this.withLock(()=>this.catalogue(store=>store.updateRecords(command,apply,options)));
  }
  async storageKind(){
    // The active transaction has already checked its workspace binding. Do not
    // reopen the descriptor for every metadata operation in that transaction.
    if(activeCatalogue(this))return 'catalogue';
    const file=await workspaceFile(this.root);
    if((await assertRegular(file)).size>MAX_BYTES+ENCRYPTION_OVERHEAD)throw new AppError('LIMIT');
    let value;
    try{value=JSON.parse(await this.readFile(file,'utf8'));}catch(error){if(error instanceof SyntaxError)throw new AppError('FORMAT');throw error;}
    return isCatalogue(value)?'catalogue':'document';
  }
  // Called only while creating a new workspace. Application updates never copy
  // or replace a workspace to select a different storage engine.
  async initializeResearch(book,metadata={},populate=null) {
    if(!this.vault?.key)throw new AppError('ACCESS_LOCKED');
    validateNotebook(book);
    const file=await workspaceFile(this.root,{secure:true});
    if(await assertRegular(file,{missing:true}))throw new AppError('EXISTS');
    const db=await this.openCatalogue({create:true});
    try{
      await db.run('BEGIN');
      const store=this.catalogueStore(db),descriptor=catalogueDescriptor(book),afterCommit=[];
      await db.scope(async()=>{
      await store.put(book);
      for(const [relative,text] of Object.entries(metadata)){this.metadataPath(relative);await store.putObject('metadata:'+relative,{text});}
      if(populate)await catalogueContext.run({root:this.root,projectId:this.projectId,labBookId:this.labBookId,vault:this.vault,db,afterCommit},()=>populate(this));
      if(!this.projectId&&!this.labBookId)await store.initializeWebsiteDocuments();
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
  withStorageHandoff(operation,options){return this.withLock(async internal=>{const held=catalogueContext.getStore();if(held?.root===this.root)await projectDomainHandoff(held.db);return operation(internal);},options);}
  async withLock(operation,{detached=false,moveId,existing=false}={}) {
    assertCatalogueWritable(this);
    await assertWorkspaceAvailable(this.root,{moveId});
    if(existing)await assertRegular(this.root,{directory:true});else await mkdir(this.root, { recursive: true, mode: 0o700 });
    // Canonicalize the selected workspace before using its protected internal paths.
    this.root = await realpath(this.root);
    const internal = await privateDirectory(this.root, '.observanda');
    const lock = path.join(internal, 'write.lock');
    if(await hasCatalogue(this.root)){
      if(await legacyWriterLock(lock))throw new AppError('LEGACY_WRITE_LOCK');
      if(catalogueContext.getStore()?.root===this.root)throw new AppError('LOCKED');
      return queuedWriter(this.root,()=>catalogueConnection(this,'write',{detached,moveId},async db=>{
        await db.run('BEGIN');await waitForWriter(()=>db.lock());
        await assertWorkspaceAvailable(this.root,{moveId});
        const afterCommit=[];
        const result=await db.scope(()=>catalogueContext.run({root:this.root,projectId:this.projectId,labBookId:this.labBookId,vault:this.vault,db,afterCommit},()=>withProjectSourceMetadataAuthority(this,db,()=>operation(internal))));
        await db.run('COMMIT');for(const cleanup of afterCommit)await cleanup();return result;
      }));
    }
    return withWriterLease(lock,async()=>{
      await assertWorkspaceAvailable(this.root,{moveId});
      // Creation or encryption may have completed while this writer waited.
      if(await hasCatalogue(this.root))return this.withLock(operation,{detached,moveId,existing:true});
      return operation(internal);
    });
  }
  async create(book) {
    validateNotebook(book);
    if(this.vault?.id)await requireDatabase();
    return this.withLock(async () => {
      const file = await workspaceFile(this.root);
      if (await assertRegular(file, { missing: true })) throw new AppError('EXISTS');
      if(this.vault?.id){
        const marker=path.join(this.root,'.observanda','copy-in-progress');
        await atomicWrite(marker,'initializing\n');
        await this.initializeResearch(book);
        await unlink(marker);
      }else await this.writeFile(file, serialize(book));
      return this.read();
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
    const comparable = book.formatVersion >= 13 ? upgradeNotebook(current.book) : current.book;
    const originals = new Map(comparable.entries.map(entry => [entry.id, entry]));
    for (const entry of next.entries) {
      const previous = originals.get(entry.id);
      entry.createdAt = previous?.createdAt ?? next.updatedAt;
      entry.updatedAt = previous && JSON.stringify(previous) === JSON.stringify(entry) ? previous.updatedAt : next.updatedAt;
    }
    validateNotebook(next);
    if(await this.storageKind()==='catalogue')return this.catalogue(async store=>{
      if(await store.head()!==current.etag)throw new AppError('CONFLICT');
      return store.put(next);
    });
    const revisions = await privateDirectory(this.root, '.observanda/revisions');
    const originalBytes = await this.readFile(await workspaceFile(this.root), 'utf8');
    if (digest(originalBytes) !== current.etag) throw new AppError('CONFLICT');
    const revision = path.join(revisions, `${digest(originalBytes)}.json`);
    if (!(await assertRegular(revision, { missing: true }))) await this.writeFile(revision, originalBytes);
    if ((await this.read()).etag !== current.etag) throw new AppError('CONFLICT');
    await this.writeFile(await workspaceFile(this.root), serialize(next));
    return this.read();
  }
  async *revisionSnapshots() {
    if(await this.storageKind()==='catalogue'){
      const ids=await this.catalogue(async store=>{const head=await store.head();return (await store.snapshots()).filter(id=>id!==head);});
      for(const id of ids)yield {id,book:(await this.catalogue(store=>store.read(id))).book};
      return;
    }
    let names;
    try {
      await assertRegular(path.join(this.root, '.observanda'), { directory: true });
      const directory = path.join(this.root, '.observanda', 'revisions');
      await assertRegular(directory, { directory: true });
      names = await readdir(directory);
    } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const name of names.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      yield {id:name.slice(0,-5),book:await this.readRevision(name.slice(0,-5))};
    }
  }
  async history() {
    const records=[];
    for await(const {id,book} of this.revisionSnapshots())records.push({id,revision:book.revision,updatedAt:book.updatedAt,entries:book.entries.length});
    return records.sort((a,b)=>b.revision-a.revision);
  }
  async readRevision(revisionId) {
    if(await this.storageKind()==='catalogue')return (await this.catalogue(store=>store.read(revisionId))).book;
    if (!/^[a-f0-9]{64}$/.test(revisionId)) throw new AppError('INVALID');
    await assertRegular(path.join(this.root, '.observanda'), { directory: true });
    await assertRegular(path.join(this.root, '.observanda', 'revisions'), { directory: true });
    const file = path.join(this.root, '.observanda', 'revisions', `${revisionId}.json`);
    const stat = await assertRegular(file);
    if (stat.size > MAX_BYTES + ENCRYPTION_OVERHEAD) throw new AppError('LIMIT');
    const content = await this.readFile(file, 'utf8');
    if (digest(content) !== revisionId) throw new AppError('FORMAT');
    return validateNotebook(JSON.parse(content));
  }
  async restore(revisionId, expectedEtag) {
    const previous = await this.readRevision(revisionId);
    const current = await this.read();
    const separateWebsites=await this.storageKind()==='catalogue'&&await this.catalogue(async store=>(await store.snapshot(current.etag)).websiteDocuments===1);
    // Restoring research never replaces independently saved website originals.
    const research=separateWebsites?websiteMetadataShell(previous):previous;
    return this.save(this.prepareRestoredBook(research,current.book), expectedEtag);
  }
  prepareRestoredBook(previous,current){
    previous.revision=current.revision;
    if(this.projectId===undefined&&this.labBookId===undefined)previous.title=workspaceFolderName(this.root);
    return previous;
  }
}
