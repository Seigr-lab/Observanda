// A saved view retains a user's named query and presentation choices. It is
// encrypted in the record owner's store, outside the scientific revision.
import {AppError} from './errors.js';
import {exact,text} from './modules/validation.js';
import {digest,serialize} from './storage-format.js';
import {validMaterialReference} from './web/material-reference.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validTableQuery} from './web/dataset-table-query.js';
import {ResearchMaterials} from './research-materials.js';

const invalid=()=>{throw new AppError('INVALID');};
const folder=(recordId,id,revision)=>'.observanda/materials/table-views/'+recordId+'/'+id+'/'+revision;
const indices=(values,width,limit)=>Array.isArray(values)&&values.length<=limit&&new Set(values).size===values.length&&values.every(i=>Number.isSafeInteger(i)&&i>=0&&i<width);
function validSettings(s,width){
 if(!exact(s,['query','pinned','hidden','columnOffset'])||!validTableQuery(s.query)||!Number.isSafeInteger(s.columnOffset)||s.columnOffset<0||s.columnOffset>=width||!indices(s.pinned,width,16)||!indices(s.hidden,width,width)||s.hidden.length===width)return false;
 const hidden=new Set(s.hidden);
 return s.pinned.every(n=>!hidden.has(n))&&s.query.filters.every(f=>f.column<width)&&(!s.query.sort||s.query.sort.column<width);
}
export function decodeDatasetTableView(raw,{id,recordId,ref,width}){
 let entry;
 try{entry=JSON.parse(raw);}catch{throw new AppError('CATALOGUE_DAMAGED');}
 if(!exact(entry,['version','recordId','datasetId','datasetRevision','id','name','settings','removed'])||entry.version!==1||entry.recordId!==recordId||entry.datasetId!==ref.id||entry.datasetRevision!==ref.revision||entry.id!==id||!researchId(id)||typeof entry.removed!=='boolean'||!text(entry.name,120,true)||!validSettings(entry.settings,width))throw new AppError('CATALOGUE_DAMAGED');
 return entry;
}
export async function tableViewRequest(materials,operation,data,{signal,check=async()=>{}}={}){
 const {ref}=data;
 if(!validMaterialReference(ref)||ref.kind!=='dataset')invalid();
 const listing=operation==='table-view-list',save=operation==='table-view-save';
 if(!listing&&!save&&operation!=='table-view-remove')invalid();
 if(listing){
  if(!exact(data,['ref','after'])||data.after!==null&&!researchId(data.after))invalid();
 }else if(!exact(data,save?['ref','id','previous','name','settings']:['ref','id','previous'])||!researchId(data.id)||(data.previous===null?!save:!revisionId(data.previous))||save&&(!text(data.name,120,true)||data.name.trim()!==data.name))invalid();
 const work=async()=>{
  signal?.throwIfAborted();await check();const doc=await materials.read(ref),{recordId}=doc;
  await materials.assertOwner(recordId,{write:!listing});
  const dir=folder(recordId,ref.id,ref.revision),width=doc.content.schemaIndex?.count??doc.content.columns.length;
  const decode=(raw,id)=>decodeDatasetTableView(raw,{id,recordId,ref,width});
  if(listing){
   const result=[];
   const after=data.after?data.after+'.json':null,page=await materials.workspace.metadataPage(dir,{after,limit:32});
   for(const {name,text:raw} of page.items){
    const id=name.slice(0,-5);if(name!==id+'.json')throw new AppError('CATALOGUE_DAMAGED');
    const entry=decode(raw,id);if(!entry.removed)result.push({id,name:entry.name,settings:entry.settings,revision:digest(raw)});
   }
   signal?.throwIfAborted();await check();
   return {items:result,next:page.next?page.next.slice(0,-5):null};
  }
  const file=dir+'/'+data.id+'.json',raw=await materials.workspace.readMetadata(file,1024*1024);
  const prior=raw&&decode(raw,data.id);
  if((raw===null?null:digest(raw))!==data.previous||prior?.removed)throw new AppError('CONFLICT');
  if(save&&!validSettings(data.settings,width))invalid();
  const entry=save?{version:1,recordId,datasetId:ref.id,datasetRevision:ref.revision,id:data.id,name:data.name,settings:data.settings,removed:false}:{...prior,removed:true};
  const next=serialize(entry);
  await materials.workspace.writeMetadata(file,next);return {id:data.id,revision:digest(next),removed:entry.removed};
 };
 return listing?materials.workspace.catalogue(work):materials.workspace.withLock(work);
}

// Copy only the selected record's saved views. An existing destination file
// may be replaced on return only when it equals the bytes which that owner
// originally transferred. Tombstones carry deliberate deletions back too.
export async function transferTableViews(source,target,receipt,{write,check,signal}){
 const {journalRecordOwnerMutations,retainRecordOwnerResource}=await import('./record-owner-resources.js');
 const recordId=receipt.command.recordId,start='metadata:.observanda/materials/table-views/'+recordId+'/';
 const slot=(id,relative)=>'record-owner-table-view:'+id+':'+digest(relative);
 const materials=new ResearchMaterials(source);
 let after=null,retained;
 do{
  const page=await source.catalogue(store=>store.objectIdPage(start,{after,limit:32,signal}));
  for(const key of page.items){
   signal?.throwIfAborted();await check();
   const tail=key.slice(start.length).split('/');
   if(tail.length!==3||!researchId(tail[0])||!revisionId(tail[1])||!tail[2].endsWith('.json')||!researchId(tail[2].slice(0,-5)))throw new AppError('CATALOGUE_DAMAGED');
   const relative=key.slice(9),raw=await source.readMetadata(relative,1024*1024);
   if(retained?.ref.id!==tail[0]||retained.ref.revision!==tail[1]){
    const ref={kind:'dataset',id:tail[0],revision:tail[1]},doc=await materials.read(ref);
    if(doc.recordId!==recordId)throw new AppError('CATALOGUE_DAMAGED');
    retained={ref,width:doc.content.schemaIndex?.count??doc.content.columns.length};
   }
   decodeDatasetTableView(raw,{...retained,id:tail[2].slice(0,-5),recordId});
   const origin=slot(receipt.id,relative),proof={transferId:receipt.id,recordId,relative,revision:digest(raw)};
   const previous=receipt.progress.previousOwnerTransfer&&await source.catalogue(store=>store.object(slot(receipt.progress.previousOwnerTransfer,relative)));
   await write(async store=>{
    const before=await store.object(key),earlier=await store.object(origin);
    if(earlier){if(serialize(earlier)!==serialize(proof)||before?.text!==raw)throw new AppError('CATALOGUE_DAMAGED');return;}
    if(before&&before.text!==raw&&(previous?.relative!==relative||previous.recordId!==recordId||previous.revision!==digest(before.text)))throw new AppError('RECORD_TRANSFER_EXISTS');
    const resource={kind:'object',key:origin,revision:digest(serialize(proof))};
    await retainRecordOwnerResource(store,resource,{present:false,receipt});await store.putObject(origin,proof);
    await journalRecordOwnerMutations(store,receipt,[{address:{kind:'object',key},before,after:{text:raw}}],{dependencies:[resource]});
    if(before?.text!==raw)await target.writeMetadata(relative,raw);
   });
  }
  after=page.next;
 }while(after);
}
