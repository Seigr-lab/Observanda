// Bounded, disposable lookup for selected record moves. The authenticated object
// root invalidates every cached result after any metadata mutation; no data or
// completion claim survives a changed root or process restart.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {ResearchMaterials} from './research-materials.js';
import {classifyRecordOwnerAuditMetadata} from './record-owner-audit-metadata.js';
const cache=new WeakMap(),MAX_NAMES=65536,MAX_BYTES=32*1024*1024;
// Workflow folders also contain arbitrarily many chunk and item documents.
// Seek between their fixed-width identities using the authenticated range index;
// only the root receipt can describe whether that workflow is still pending.
export async function* workflowReceiptKeys(store,{signal}={}){
 for(const [folder,receipt] of [['imports','session'],['intakes','batch'],['drafts','draft']]){
  const prefix='metadata:.observanda/materials/'+folder+'/';let after=null;
  while(true){
   signal?.throwIfAborted();const {items}=await store.objectIdPage(prefix,{after,limit:32,signal});if(!items.length)break;
   for(const key of items){
    if(after!==null&&key<=after)continue;
    const match=/^([a-f0-9-]{36})\//.exec(key.slice(prefix.length));
    if(!match){after=key;continue;}
    const root=prefix+match[1],selected=root+'/'+receipt+'.json';
    if(await store.objectIdentity(selected))yield {key:selected,prefix:root+'/',folder};
    // All descendants start with '/', which sorts before '0'.
    after=root+'0';
   }
  }
 }
}
export async function* pendingEvidenceReceiptKeys(store,options){
 for await(const {key} of workflowReceiptKeys(store,options))yield key;
 for(const prefix of ['metadata:.observanda/materials/associations/','metadata:.observanda/intake/proposals/','metadata:.observanda/jobs/'])yield* store.objectIdEntries(prefix,options);
}

export async function recordOwnerWorkflows(source,recordId,{signal,onProgress=()=>{}}={}){
 return source.catalogue(async store=>{
  signal?.throwIfAborted();const proof=digest(serialize(await store.objectIndex().head())),saved=cache.get(source);
  if(saved?.proof===proof)return {proof,...(saved.records.get(recordId)??{pending:false,names:[]})};
  const records=new Map(),materials=new ResearchMaterials(source);let count=0,retained=0,bytes=0,overflow=false;
  const group=id=>{let value=records.get(id);if(!value){bytes+=Buffer.byteLength(id)+128;value={pending:false,names:[]};records.set(id,value);}return value;};
  const read=async(entry,admission=true)=>{
   signal?.throwIfAborted();const name=entry.key.slice(9);count++;if(count%1000===0)await onProgress(count);
   const classified=await classifyRecordOwnerAuditMetadata(source,name);
   if(classified){retained++;bytes+=Buffer.byteLength(entry.key)+Buffer.byteLength(entry.prefix??'')+128;if(retained>MAX_NAMES||bytes>MAX_BYTES){overflow=true;return;}group(classified.recordId).names.push(entry);}
   if(!admission)return;
   const text=await source.readMetadata(name,16*1024*1024);let value;try{value=JSON.parse(text);}catch{throw new AppError('CATALOGUE_DAMAGED');}
   const owner=value?.recordId??value?.command?.recordId??value?.manifest?.recordId??value?.scope;if(typeof owner!=='string')return;
   let pending;if(entry.folder==='imports')pending=!(await materials.importState(value.id)).completed;
   else if(name.startsWith('.observanda/jobs/'))pending=['queued','running'].includes(value.state);
   else pending=!['completed','cancelled'].includes(value.state);
   if(pending)group(owner).pending=true;if(bytes>MAX_BYTES)overflow=true;
  };
  for await(const entry of workflowReceiptKeys(store,{signal})){await read(entry);if(overflow)return null;}
  for(const prefix of ['metadata:.observanda/materials/associations/','metadata:.observanda/materials/corrections/','metadata:.observanda/intake/','metadata:.observanda/jobs/']){
   for await(const key of store.objectIdEntries(prefix,{signal})){
    const admission=/^(?:metadata:\.observanda\/materials\/associations\/[a-f0-9-]{36}|metadata:\.observanda\/intake\/proposals\/[a-f0-9-]{36}|metadata:\.observanda\/jobs\/[a-f0-9-]{36})\.json$/.test(key);
    await read({key},admission);if(overflow)return null;
   }
  }
  cache.set(source,{proof,records});return {proof,...(records.get(recordId)??{pending:false,names:[]})};
 });
}
