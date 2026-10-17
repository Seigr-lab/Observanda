import {AppError} from './errors.js';
import {websiteBook,websiteDocument} from './web/website-sites-model.js';
import {validateCatalogueMetadata} from './model.js';
import {researchId} from './web/research-reference.js';
import {validWebsitePin} from './web/website-pin.js';
import {WebsiteDocumentStore} from './website-document-store.js';
import {websiteDocumentLocks,readWebsiteDocumentRegistry} from './website-document-registry.js';
import {catalogueContext} from './research-catalogue.js';
export {websiteRequest} from './web/website-context.js';

// Publication files belong to a site. The default alias retains its established
// root paths; named websites have independent destinations and edition files.
const owned=/^\.observanda\/(?:publishing(?:[./-])|release(?:[/-])|releases\/|deployment(?:[/-])|deployments\/|repository(?:[./-])|publication(?:[./-])|analysis-edition-reviews\/|live-check-jobs\/|local-exports\/)/;
const pinOf=({researchSnapshotId,websiteId,websiteRevision})=>({researchSnapshotId,websiteId,websiteRevision});
export function websiteWorkspace(base,id=null,{websitePin=null}={}){
 if(id!==null&&!researchId(id)||websitePin!==null&&(!validWebsitePin(websitePin)||websitePin.websiteId!==id))throw new AppError('INVALID');
 if(base.websiteContext){if(base.websiteId!==id)throw new AppError('INVALID');if(websitePin===null)return base;base=base.baseWorkspace;}
 const relative=file=>id!==null&&owned.test(file)?'.observanda/websites/'+id+'/'+file.slice(12):file;
 const legacy=metadata=>{
  if(id!==null){const site=metadata.websites?.find(site=>site.id===id);if(!site)throw new AppError('NOT_FOUND');return site;}
  return {id:null,name:metadata.website.title||metadata.title,projectId:null,document:websiteDocument(metadata),projects:metadata.projects,selection:undefined};
 };
 async function outline(pin){
  if(await base.storageKind()!=='catalogue'){
   const value=await base.outline();if(pin&&(pin.researchSnapshotId!==value.etag||pin.websiteRevision!==null))throw new AppError('CONFLICT');
   const site=legacy(value.metadata);return {...value,metadata:websiteBook(value.metadata,site),websitePin:{researchSnapshotId:value.etag,websiteId:id,websiteRevision:null}};
  }
  return base.catalogue(async store=>{
   const selected=await new WebsiteDocumentStore(store).read(id,pin??undefined),snapshot=await store.snapshot(selected.researchSnapshotId),metadata=websiteBook(snapshot.metadata,selected.site);
   return {metadata,etag:selected.researchSnapshotId,websitePin:pinOf(selected),recordCount:snapshot.count??snapshot.records.length};
  });
 }
 let metadataOwnerKnown=false;
 async function metadataOwner(){
  // Retained editions remain readable after site removal. Only reject the
  // internal default UUID as an alternate address for the root namespace.
  if(id===null||metadataOwnerKnown||await base.storageKind()!=='catalogue')return;
  await base.catalogue(async store=>{const registry=await readWebsiteDocumentRegistry(store);if(registry?.defaultSiteId===id)throw new AppError('INVALID');if(registry)metadataOwnerKnown=true;});
 }
 const own={
  websiteId:id,websiteContext:true,baseWorkspace:base,
  async website(){
   if(await base.storageKind()!=='catalogue')return legacy((await base.outline()).metadata);
   return base.catalogue(async store=>({...((await new WebsiteDocumentStore(store).read(id,websitePin??undefined)).site),id}));
  },
  outline:()=>outline(websitePin),currentOutline:()=>outline(null),
  async read(){
   if(await base.storageKind()!=='catalogue'){const value=await base.read(),site=legacy(value.book);return {...value,book:websiteBook(value.book,site),websitePin:{researchSnapshotId:value.etag,websiteId:id,websiteRevision:null}};}
   return own.catalogue(async store=>{const snapshot=await store.snapshot(),entries=[];for await(const row of store.members(snapshot))entries.push(await store.record(row.id,row.revision));return {book:{...snapshot.metadata,entries},etag:snapshot.websitePin.researchSnapshotId,websitePin:snapshot.websitePin};});
  },
  // Mutation admission must keep this lock until the surrounding transaction
  // commits. A transient read transaction cannot protect a later deployment.
  async lockWebsite(){
   if(await base.storageKind()!=='catalogue')return;
   const held=catalogueContext.getStore();
   if(held?.root!==base.root||(held.projectId??null)!==(base.projectId??null)||(held.labBookId??null)!==(base.labBookId??null))throw new AppError('LOCKED');
   return base.catalogue(store=>websiteDocumentLocks(store,{websiteIds:[id]}));
  },
  async catalogue(operation){return base.catalogue(async store=>{
   const adapter={
    async snapshot(revision,options){
     const explicit=revision!==undefined,requested=websitePin&&(!explicit||revision===websitePin.researchSnapshotId)?websitePin:null;
     if(!explicit&&requested)revision=requested.researchSnapshotId;
     const input={...(revision===undefined?{}:{researchSnapshotId:revision}),...(options&&Object.hasOwn(options,'websiteRevision')?{websiteRevision:options.websiteRevision}:requested?{websiteRevision:requested.websiteRevision}:{})};
     if(explicit&&!Object.hasOwn(input,'websiteRevision')&&(await store.snapshot(revision)).websiteDocuments===1)throw new AppError('INVALID');
     const value=await new WebsiteDocumentStore(store).read(id,input),snapshot=await store.snapshot(value.researchSnapshotId);
     return {...snapshot,websitePin:pinOf(value),websiteSelection:value.site.selection,metadata:websiteBook(snapshot.metadata,value.site)};
    },
    async member(snapshot,key){const row=await store.member(snapshot,key);return row&&snapshot.metadata.notebooks.some(n=>n.id===row.notebookId)?row:null;},
    async *members(snapshot,options){const ids=new Set(snapshot.metadata.notebooks.map(n=>n.id));for await(const row of store.members(snapshot,options))if(ids.has(row.notebookId))yield row;},
    async validateMetadata(snapshot,metadata,options){
     if(snapshot.indexVersion)return store.validateMetadata.call(scoped,snapshot,metadata,options);
     const rows=[];for await(const row of adapter.members(snapshot))rows.push(row);validateCatalogueMetadata(metadata,{reservedIds:rows.flatMap(r=>[r.id,...r.sections]),entryTargets:rows.map(r=>'entry:'+r.id)});
    },
    async *queryDocuments(rows,metadata,options){const ids=new Set(metadata.notebooks.map(n=>n.id));async function* selected(){for await(const row of rows)if(!row.notebookId||ids.has(row.notebookId))yield row;}yield* store.queryDocuments(selected(),metadata,options);}
   };
   const scoped=new Proxy(store,{get(target,key){if(key in adapter)return adapter[key];const value=target[key];return typeof value==='function'?value.bind(target):value;}});
   return operation(scoped);
  });}
 };
 own.metadataPath=file=>base.metadataPath(relative(file));
 for(const method of ['readMetadata','writeMetadata','removeMetadata','listMetadata','metadataPage'])own[method]=async(file,...args)=>{await metadataOwner();return base[method](relative(file),...args);};
 own.metadataNames=async function*(file,...args){await metadataOwner();yield* base.metadataNames(relative(file),...args);};
 return new Proxy(base,{get(target,key){if(key in own)return own[key];const value=target[key];return typeof value==='function'?value.bind(target):value;}});
}

// The worker captures the website owner on immutable input, independently of
// which editor happens to be open when it resumes the job.
export function websiteJobQueue(queue,id){
 return new Proxy(queue,{get(target,key){
  if(key==='enqueueLocked')return command=>target.enqueueLocked({...command,input:{...command.input,websiteId:id??null}});
  if(key==='read')return async jobId=>{const job=await target.read(jobId);return (job?.input.websiteId??null)===(id??null)?job:null;};
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
}
