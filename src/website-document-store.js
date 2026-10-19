// Independent current website heads and immutable retained document revisions.
// Call mutation methods inside the declared website/membership transaction.
import {randomUUID} from 'node:crypto';
import {projectDomainLock} from './project-domain-lock.js';
import {websiteNameKey,validWebsiteName} from './web/website-name.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {ObjectIndex,validIndexRef} from './object-index.js';
import {RecordDocument} from './record-document.js';
import {RecordValueTree} from './record-value-tree.js';
import {WebsiteDocumentBlockStore} from './website-document-block-store.js';
import {readWebsiteDocumentRegistry,initializeWebsiteDocumentRegistry,writeWebsiteDocumentRegistry,websiteDirectoryIndex,WEBSITE_DOCUMENT_PREFIX} from './website-document-registry.js';
import {websiteDocument,websiteBook,validWebsites} from './web/website-sites-model.js';
import {validWebsiteSelection} from './web/website-selection.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {catalogueIndexedCount} from './postgres-indexes.js';
import {catalogueFormat,catalogueRequiresWebsiteEditor,catalogueRequiresWebsitePresentation,requireWebsitePresentation} from './catalogue-format.js';
import {WebsiteCollectionIndex,validWebsiteCollectionIndexes} from './website-collection-index.js';
import {WebsiteEditorNavigation,validWebsiteNavigationProjection} from './website-editor-navigation.js';
import {validateWebsiteDocument,websiteDocumentHeader} from './website-document-validation.js';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const invalid=()=>{throw new AppError('INVALID');};
const hash=value=>digest(serialize(value));
const prefix=WEBSITE_DOCUMENT_PREFIX;
const headSlot=id=>prefix+'head:'+id;
const versionSlot=(id,revision)=>prefix+'revision:'+id+':'+revision;
const ordinal=n=>String(n).padStart(16,'0');
const bounded=(after,limit)=>{if(after!==null&&typeof after!=='string'||!Number.isSafeInteger(limit)||limit<1||limit>100)invalid();};
function defaultSite(metadata,id,selection){
 return {id,name:metadata.website.title?.trim()||metadata.title,projectId:null,document:websiteDocument(metadata),projects:metadata.projects.map(({id,share,logoId})=>({id,share,logoId:logoId??null})),...(selection===undefined?{}:{selection})};
}
function memoryBlocks(){
 const nodes=new Map();return {async put(kind,value){const revision=hash(value);nodes.set(kind+':'+revision,structuredClone(value));return revision;},async read(kind,revision){const value=nodes.get(kind+':'+revision);if(!value)damaged();return structuredClone(value);},tree(){return new RecordValueTree(this);}};
}
export class WebsiteDocumentStore{
 constructor(store){this.store=store;}
 index(id,kind){return new ObjectIndex(this.store,{namespace:prefix+kind+':'+id+':',immutable:true});}
 async registry(){return readWebsiteDocumentRegistry(this.store);}
 async initialize(researchSnapshotId,snapshot,{defaultSelection,defaultSiteId=randomUUID()}={}){
  const current=await this.registry();if(current)return current;
  if(!revisionId(researchSnapshotId)||snapshot.metadata.id!==(await this.store.snapshot(researchSnapshotId)).metadata.id||!validWebsiteSelection(defaultSelection)||defaultSelection.defaultShare!==false||!researchId(defaultSiteId))invalid();
  const sites=snapshot.metadata.websites??[];if(sites.some(site=>site.id===defaultSiteId))invalid();
  await initializeWebsiteDocumentRegistry(this.store,{workspaceId:snapshot.metadata.id,defaultSiteId});
  await this.#register(defaultSite(snapshot.metadata,defaultSiteId,structuredClone(defaultSelection)),researchSnapshotId);
  for(const site of sites)await this.#register(site,researchSnapshotId);
  return this.registry();
 }
 async ownedId(websiteId,registry){if(websiteId!==null&&(!researchId(websiteId)||websiteId===registry.defaultSiteId))invalid();return websiteId??registry.defaultSiteId;}
 async savedHead(id,registry,{removed=false}={}){
  const entry=await websiteDirectoryIndex(this.store).find(registry,id),row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',headSlot(id));
  if(!entry){if(row)damaged();throw new AppError('NOT_FOUND');}if(!row)damaged();
  const value=this.store.decode('state',headSlot(id),row.payload);
  if(!value||Object.keys(value).sort().join()!=='history,name,ordinal,projectId,removed,revision,version,versions,websiteId,workspaceId'||value.version!==1||value.workspaceId!==registry.workspaceId||value.websiteId!==id||!revisionId(value.revision)||typeof value.name!=='string'||!value.name.trim()||value.name.length>160||value.projectId!==null&&!researchId(value.projectId)||typeof value.removed!=='boolean'||!Number.isSafeInteger(value.ordinal)||value.ordinal<0||!validIndexRef(value.history)||!validIndexRef(value.versions)||value.history?.count!==value.ordinal+1||!value.versions||value.versions.count>value.history.count)damaged();
  if(id===registry.defaultSiteId&&value.removed)damaged();
  if(value.removed&&!removed)throw new AppError('NOT_FOUND');return value;
 }
 summary(head,registry){return {websiteId:head.websiteId===registry?.defaultSiteId?null:head.websiteId,websiteRevision:head.revision,name:head.name,projectId:head.projectId};}
 async head(websiteId,{includeRemoved=false}={}){
  if(typeof includeRemoved!=='boolean')invalid();const registry=await this.registry();if(!registry){const value=await this.legacy(websiteId);return {websiteId:value.websiteId,websiteRevision:null,name:value.site.name,projectId:value.site.projectId};}
  return this.summary(await this.savedHead(await this.ownedId(websiteId,registry),registry,{removed:includeRemoved}),registry);
 }
 async *entries({signal,after=null,includeDefault=true,includeRemoved=false}={}){
  const registry=await this.registry();
  if(!registry){const snapshot=await this.store.snapshot();if(includeDefault&&after===null)yield await this.head(null);for(const site of [...(snapshot.metadata.websites??[])].sort((a,b)=>a.id<b.id?-1:1)){signal?.throwIfAborted();if(after!==null&&site.id<=after)continue;yield {websiteId:site.id,websiteRevision:null,name:site.name,projectId:site.projectId};}return;}
  for await(const entry of websiteDirectoryIndex(this.store).entries(registry,'',after)){
   signal?.throwIfAborted();if(!includeDefault&&entry.id===registry.defaultSiteId)continue;
   const head=await this.savedHead(entry.id,registry,{removed:true});if(!head.removed||includeRemoved)yield {...this.summary(head,registry),...(includeRemoved?{removed:head.removed}:{})};
  }
 }
 async list({after=null,limit=20,includeDefault=false}={}){
  bounded(after,limit);const sites=[],registry=await this.registry(),defaultCursor=registry?.defaultSiteId??'default';let next=null;
  if(includeDefault&&after===null)sites.push(await this.head(null));
  for await(const value of this.entries({after:after===defaultCursor?null:after,includeDefault:false})){
   if(sites.length===limit){next=sites.at(-1).websiteId??defaultCursor;break;}sites.push(value);
  }
  return {sites,next};
 }
 async legacy(websiteId,{researchSnapshotId,signal}={}){
  signal?.throwIfAborted();researchSnapshotId??=await this.store.head();if(!revisionId(researchSnapshotId)||websiteId!==null&&!researchId(websiteId))invalid();
  const snapshot=await this.store.snapshot(researchSnapshotId);if(snapshot.websiteDocuments===1)invalid();
  const site=websiteId===null?defaultSite(snapshot.metadata,null,undefined):snapshot.metadata.websites?.find(site=>site.id===websiteId);
  if(!site)throw new AppError('NOT_FOUND');return {researchSnapshotId,websiteId,websiteRevision:null,site:structuredClone(site)};
 }
 async revision(id,revision,registry){
  if(!revisionId(revision))invalid();const head=await this.savedHead(id,registry,{removed:true}),known=await this.index(id,'versions').find({root:head.versions},revision);
  if(!known||known.revision!==revision){if(head.revision===revision)damaged();throw new AppError('NOT_FOUND');}
  const slot=versionSlot(id,revision),row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot),value=this.store.decode('state',slot,row?.payload);
  if(!value||![1,2,3].includes(value.version)||Object.keys(value).sort().join()!==(value.version>=2?'collectionIndexes,navigationProjection,researchSnapshotId,root,version,websiteId,workspaceId':'researchSnapshotId,root,version,websiteId,workspaceId')||value.workspaceId!==registry.workspaceId||value.websiteId!==id||!revisionId(value.root)||!revisionId(value.researchSnapshotId)||hash(value)!==revision)damaged();
  if(value.version>=2&&(!(value.version===3?catalogueRequiresWebsitePresentation:catalogueRequiresWebsiteEditor)(await catalogueFormat(this.store.db))||!validWebsiteCollectionIndexes(value.collectionIndexes,{version:value.version-1})||!validWebsiteNavigationProjection(value.navigationProjection)))damaged();return value;
 }
 async document(websiteId,{researchSnapshotId,websiteRevision,signal,mutable=false}={}){
  signal?.throwIfAborted();const registry=await this.registry(),explicitSnapshot=researchSnapshotId!==undefined;researchSnapshotId??=await this.store.head();if(!revisionId(researchSnapshotId))invalid();
  const snapshot=await this.store.snapshot(researchSnapshotId);
  if(!registry||websiteRevision===null||websiteRevision===undefined&&explicitSnapshot&&snapshot.websiteDocuments!==1){
   if(websiteRevision!==undefined&&websiteRevision!==null)invalid();const value=await this.legacy(websiteId,{researchSnapshotId,signal}),blocks=memoryBlocks(),root=await blocks.tree().retain(value.site);
   return {researchSnapshotId,websiteId,websiteRevision:null,document:new RecordDocument(blocks,root),collectionIndexes:null,navigationProjection:null};
  }
  const id=await this.ownedId(websiteId,registry);
  if(websiteRevision===undefined){if(explicitSnapshot&&researchSnapshotId!==await this.store.head())invalid();websiteRevision=(await this.savedHead(id,registry)).revision;}
  const value=await this.revision(id,websiteRevision,registry),blocks=new WebsiteDocumentBlockStore(this.store,id,{readOnly:!mutable}),document=new RecordDocument(blocks,value.root,{mutable});
  if((await document.field(['id'],{signal})).value!==id)damaged();
  return {researchSnapshotId,websiteId:id===registry.defaultSiteId?null:id,websiteRevision,document,collectionIndexes:value.collectionIndexes??null,navigationProjection:value.navigationProjection??null};
 }
 async read(websiteId,options){const {document,researchSnapshotId,websiteId:id,websiteRevision}=await this.document(websiteId,options);return {researchSnapshotId,websiteId:id,websiteRevision,site:await document.tree.read(document.root)};}
 async #register(site,researchSnapshotId){
  site=structuredClone(site);const registry=await this.registry();if(!registry||!researchId(site?.id)||!revisionId(researchSnapshotId))invalid();
  const directory=websiteDirectoryIndex(this.store);if(await directory.find(registry,site.id)||await this.store.db.get('SELECT 1 FROM state WHERE slot=$1',headSlot(site.id)))throw new AppError('EXISTS');
  const head=await this.#retain(site,researchSnapshotId,registry,null),root=await directory.change(registry.root,site.id,head.revision);await directory.flush(root);
  await writeWebsiteDocumentRegistry(this.store,{...registry,root});return {researchSnapshotId,...this.summary(head,registry)};
 }
 async assertNameAvailable(site,{previous,signal}={}){
  if(!validWebsiteName(site?.name))invalid();if(previous?.name===site.name)return;
  const key=websiteNameKey(site.name);
  await projectDomainLock(this.store.db,'Observanda/website-name/'+this.store.db.id+'/'+hash(key));
  // Read after acquiring the name lock: two sites cannot concurrently claim it.
  const registry=await this.registry();
  for await(const current of this.entries({signal}))if((current.websiteId??registry.defaultSiteId)!==site.id&&websiteNameKey(current.name)===key)throw new AppError('WEBSITE_NAME_EXISTS');
 }
 async create(site,{researchSnapshotId}={}){
  if(this.store.workspace.projectId||this.store.workspace.labBookId||site?.projectId!==null)invalid();await this.assertNameAvailable(site);return this.#register(site,researchSnapshotId);
 }
 async save(websiteId,site,{researchSnapshotId,expectedRevision}={}){
  site=structuredClone(site);const registry=await this.registry();if(!registry)throw new AppError('ACCESS_UPGRADE');const id=await this.ownedId(websiteId,registry),head=await this.savedHead(id,registry);
  if(head.revision!==expectedRevision)throw new AppError('CONFLICT');if(site?.id!==id||site.projectId!==head.projectId||!revisionId(researchSnapshotId))invalid();
  await this.assertNameAvailable(site,{previous:head});
  const next=await this.#retain(site,researchSnapshotId,registry,head);return {researchSnapshotId,...this.summary(next,registry)};
 }
 async saveDocument(websiteId,document,{researchSnapshotId,expectedRevision,collectionIndexes=null,navigationProjection=null,signal}={}){
  const registry=await this.registry();if(!registry)throw new AppError('ACCESS_UPGRADE');const id=await this.ownedId(websiteId,registry),head=await this.savedHead(id,registry);
  if(head.revision!==expectedRevision)throw new AppError('CONFLICT');if(!revisionId(researchSnapshotId)||document.blocks.store!==this.store||document.blocks.websiteId!==id||document.blocks.readOnly)invalid();
  const previous=await this.revision(id,head.revision,registry),priorDocument=new RecordDocument(new WebsiteDocumentBlockStore(this.store,id,{readOnly:true}),previous.root),previousSite=await websiteDocumentHeader(priorDocument,{signal});
  const snapshot=await this.store.snapshot(researchSnapshotId),{site}=await validateWebsiteDocument(this.store,snapshot,document,{signal,previous:previousSite});
  if(site.id!==id||site.projectId!==head.projectId||snapshot.metadata.id!==registry.workspaceId)invalid();
  await this.assertNameAvailable(site,{previous:head,signal});
  if(previous.root===document.root)return {researchSnapshotId,...this.summary(head,registry)};
  collectionIndexes=await WebsiteCollectionIndex.retainAll(document,collectionIndexes??previous.collectionIndexes,{signal});
  navigationProjection=await WebsiteEditorNavigation.retain(this.store,snapshot,document,site,collectionIndexes,navigationProjection??previous.navigationProjection,{signal});
  await requireWebsitePresentation(this.store.db);const value={version:3,workspaceId:registry.workspaceId,websiteId:id,researchSnapshotId,root:document.root,collectionIndexes,navigationProjection};
  const next=await this.#publish(site,value,document.blocks,head);return {researchSnapshotId,...this.summary(next,registry)};
 }
 async #publish(site,value,blocks,previous){
  const revision=hash(value),slot=versionSlot(site.id,revision),row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  if(row){if(hash(this.store.decode('state',slot,row.payload))!==revision)damaged();}else await this.store.db.run('INSERT INTO state VALUES ($1,$2)',slot,this.store.encode('state',slot,value));
  await blocks.flush();const history=this.index(site.id,'history'),versions=this.index(site.id,'versions'),position=previous?previous.ordinal+1:0;
  const historyRoot=await history.change(previous?.history??null,ordinal(position),revision),versionsRoot=await versions.change(previous?.versions??null,revision,revision);
  await history.flush(historyRoot);await versions.flush(versionsRoot);
  const head={version:1,workspaceId:value.workspaceId,websiteId:site.id,revision,name:site.name,projectId:site.projectId,removed:false,ordinal:position,history:historyRoot,versions:versionsRoot};
  await this.store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',headSlot(site.id),this.store.encode('state',headSlot(site.id),head));return head;
 }
 async #retain(site,researchSnapshotId,registry,previous){
  const snapshot=await this.store.snapshot(researchSnapshotId);if(snapshot.metadata.id!==registry.workspaceId||!validWebsites([site],snapshot.metadata))invalid();
  const blocks=new WebsiteDocumentBlockStore(this.store,site.id),root=await blocks.tree().retain(site);
  if(previous&&(await this.revision(site.id,previous.revision,registry)).root===root)return previous;
  let value={version:1,workspaceId:registry.workspaceId,websiteId:site.id,researchSnapshotId,root};
  if(catalogueRequiresWebsiteEditor(await catalogueFormat(this.store.db))){
   const version=catalogueRequiresWebsitePresentation(await catalogueFormat(this.store.db))?3:2,document=new RecordDocument(blocks,root),collectionIndexes=await WebsiteCollectionIndex.retainAll(document,null,{version:version-1}),navigationProjection=await WebsiteEditorNavigation.retain(this.store,snapshot,document,site,collectionIndexes);
   value={...value,version,collectionIndexes,navigationProjection};
  }
  return this.#publish(site,value,blocks,previous);
 }
 async remove(websiteId,{expectedRevision}={}){
  const registry=await this.registry();if(!registry)throw new AppError('ACCESS_UPGRADE');const id=await this.ownedId(websiteId,registry);if(id===registry.defaultSiteId)invalid();
  const head=await this.savedHead(id,registry);if(head.revision!==expectedRevision)throw new AppError('CONFLICT');
  await this.store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',this.store.encode('state',headSlot(id),{...head,removed:true}),headSlot(id));
 }
 async verifySite(site,snapshot){
  if(!validWebsites([site],snapshot.metadata))damaged();
  const metadata=websiteBook(snapshot.metadata,site);
  try{await this.store.validateMetadata(snapshot,metadata);}catch(error){if(['INVALID','FORMAT','LIMIT','WORKSPACE_METADATA_LIMIT'].includes(error.code))damaged();throw error;}
  const notebooks=new Set(metadata.notebooks.map(book=>book.id));
  for(const selected of site.selection.records){const row=await this.store.member(snapshot,selected.id);if(!row||!notebooks.has(row.notebookId))damaged();}
 }
 async verify({signal,onRevision,onDocument}={}){
  const registry=await this.registry();if(!registry)return;const current=await this.store.snapshot();
  const directory=websiteDirectoryIndex(this.store);if(!await directory.find(registry,registry.defaultSiteId)||(await catalogueIndexedCount(this.store.db,'state',prefix+'head:'))!==(registry.root?.count??0))damaged();
  let owners=0;
  for await(const entry of directory.entries(registry)){
   signal?.throwIfAborted();if(!researchId(entry.id))damaged();owners++;const head=await this.savedHead(entry.id,registry,{removed:true}),history=this.index(entry.id,'history'),versions=this.index(entry.id,'versions');let count=0,last=null;
   for await(const item of history.entries({root:head.history})){
    signal?.throwIfAborted();if(item.id!==ordinal(count++)||!revisionId(item.revision)||!await versions.find({root:head.versions},item.revision))damaged();if(count===1&&item.revision!==entry.revision)damaged();last=item.revision;
   }
   if(count!==head.ordinal+1||last!==head.revision||(await catalogueIndexedCount(this.store.db,'state',prefix+'revision:'+entry.id+':'))!==head.versions.count)damaged();
   let revisions=0;
   for await(const item of versions.entries({root:head.versions})){
    signal?.throwIfAborted();revisions++;if(!revisionId(item.id)||item.id!==item.revision)damaged();const value=await this.revision(entry.id,item.revision,registry),snapshot=await this.store.snapshot(value.researchSnapshotId),blocks=new WebsiteDocumentBlockStore(this.store,entry.id,{readOnly:true}),tree=blocks.tree();
    // Exhaust the independent tree verifier before applying semantic admission.
    for await(const chunk of tree.json(value.root,{signal}))void chunk;
    const document=new RecordDocument(blocks,value.root);let site;
    try{({site}=await validateWebsiteDocument(this.store,snapshot,document,{signal}));}catch(error){if(['INVALID','FORMAT','LIMIT','WORKSPACE_METADATA_LIMIT'].includes(error.code))damaged();throw error;}
    if(site.id!==entry.id)damaged();
    if(value.version>=2){for(const collection of Object.keys(value.collectionIndexes)){const index=await WebsiteCollectionIndex.open(document,collection,value.collectionIndexes[collection],{signal});if(!index)damaged();await index.verify({signal});}await new WebsiteEditorNavigation(document,value.navigationProjection).verify(this.store,snapshot,site,value.collectionIndexes,{signal});}

    if(item.revision===head.revision){
     if(site.name!==head.name||site.projectId!==head.projectId)damaged();
     // A live document can accompany later body-only research snapshots. Prove
     // current membership separately, without changing its retained identity.
     if(!head.removed)try{await validateWebsiteDocument(this.store,current,document,{signal});}catch(error){if(['INVALID','FORMAT','LIMIT','WORKSPACE_METADATA_LIMIT'].includes(error.code))damaged();throw error;}
    }
    const pin={researchSnapshotId:value.researchSnapshotId,websiteId:entry.id===registry.defaultSiteId?null:entry.id,websiteRevision:item.revision};
    if(onDocument)await onDocument(document,pin);else if(onRevision)await onRevision(await tree.read(value.root),pin);
   }
   if(revisions!==head.versions.count)damaged();
  }
  if(owners!==registry.root.count)damaged();
  // Historic immutable index nodes can outlive the current root. Authenticate
  // their bytes too, and reject rows belonging to an undeclared website owner.
  for await(const row of this.store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C"',[prefix,'website-document;'],{batchSize:1})){
   signal?.throwIfAborted();const tail=row.slot.slice(prefix.length),value=this.store.decode('state',row.slot,row.payload);let owner=null,revision=null,block=false,match;
   if((match=/^directory:([a-f0-9]{64})$/.exec(tail)))revision=match[1];
   else if((match=/^head:([a-f0-9-]{36})$/.exec(tail)))owner=match[1];
   else if((match=/^(?:history|versions|revision):([a-f0-9-]{36}):([a-f0-9]{64})$/.exec(tail))){owner=match[1];revision=match[2];}
   else if((match=/^block:([a-f0-9-]{36}):(value|index):([a-f0-9]{64})$/.exec(tail))){owner=match[1];revision=match[3];block=true;}
   else damaged();
   if(owner&&(!researchId(owner)||!await directory.find(registry,owner)))damaged();
   if(revision&&hash(value)!==revision||block&&Buffer.byteLength(serialize(value))>65536)damaged();
  }
 }
}
