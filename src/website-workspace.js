import {AppError} from './errors.js';
import {websiteBook} from './web/website-sites-model.js';
import {validateCatalogueMetadata} from './model.js';
import {researchId} from './web/research-reference.js';
export {websiteRequest} from './web/website-context.js';

// Publication-owned objects are isolated by website. Evidence, encryption,
// transactions and the durable job queue remain owned by the real workspace.
const owned=/^\.observanda\/(?:publishing(?:[./-])|release(?:[/-])|releases\/|deployment(?:[/-])|deployments\/|repository(?:[./-])|publication(?:[./-])|analysis-edition-reviews\/|live-check-jobs\/|local-exports\/)/;
export function websiteWorkspace(base,id){
 if(!id)return base;
 if(!researchId(id))throw new AppError('INVALID');
 if(base.websiteId){if(base.websiteId===id)return base;throw new AppError('INVALID');}
 const relative=path=>owned.test(path)?'.observanda/websites/'+id+'/'+path.slice(12):path;
 const choose=metadata=>{const site=metadata.websites?.find(s=>s.id===id);if(!site)throw new AppError('NOT_FOUND');return site;};
 const project=metadata=>websiteBook(metadata,choose(metadata));
 const own={
  websiteId:id,baseWorkspace:base,
  async website(){return choose((await base.outline()).metadata);},
  async outline(){const s=await base.outline();return {...s,metadata:project(s.metadata)};},
  async read(){const s=await base.read();return {...s,book:project(s.book)};},
  async catalogue(operation){return base.catalogue(async store=>{
   const adapter={
    async snapshot(revision){const s=await store.snapshot(revision);return {...s,websiteSelection:choose(s.metadata).selection,metadata:project(s.metadata)};},
    async member(snapshot,key){const row=await store.member(snapshot,key);return row&&snapshot.metadata.notebooks.some(n=>n.id===row.notebookId)?row:null;},
    async *members(snapshot,options){const ids=new Set(snapshot.metadata.notebooks.map(n=>n.id));for await(const row of store.members(snapshot,options))if(ids.has(row.notebookId))yield row;},
    async validateMetadata(snapshot,metadata,options){
     // Reuse indexed collision/target checks, with member lookups constrained
     // to this website. Calling the unscoped owner would admit foreign targets.
     if(snapshot.indexVersion)return store.validateMetadata.call(scoped,snapshot,metadata,options);
     const rows=[];for await(const row of adapter.members(snapshot))rows.push(row);validateCatalogueMetadata(metadata,{reservedIds:rows.flatMap(r=>[r.id,...r.sections]),entryTargets:rows.map(r=>'entry:'+r.id)});
    },
    async *queryDocuments(rows,metadata,options){const ids=new Set(metadata.notebooks.map(n=>n.id));async function* scoped(){for await(const row of rows)if(!row.notebookId||ids.has(row.notebookId))yield row;}yield* store.queryDocuments(scoped(),metadata,options);}
   };
   const scoped=new Proxy(store,{get(target,key){if(key in adapter)return adapter[key];const value=target[key];return typeof value==='function'?value.bind(target):value;}});
   return operation(scoped);
  });},
 };
 for(const method of ['metadataPath','readMetadata','writeMetadata','removeMetadata','metadataNames','listMetadata','metadataPage'])own[method]=(file,...args)=>base[method](relative(file),...args);
 return new Proxy(base,{get(target,key){if(key in own)return own[key];const value=target[key];return typeof value==='function'?value.bind(target):value;}});
}

// Capture the site on the immutable job input, never in a process-global active
// editor setting. The shared worker can resume jobs from several websites.
export function websiteJobQueue(queue,id){
 return new Proxy(queue,{get(target,key){
  if(key==='enqueueLocked'&&id)return command=>target.enqueueLocked({...command,input:{...command.input,websiteId:id}});
  if(key==='read')return async jobId=>{const job=await target.read(jobId);return (job?.input.websiteId??null)===(id??null)?job:null;};
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
}
