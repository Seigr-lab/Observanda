import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {withRecordDocument} from './record-document.js';
import {SnapshotIndex} from './snapshot-index.js';
import {WebsiteFileStore,websiteSourceId} from './website-file-store.js';
import {sourceRecordAllowed} from './web/source-publication-permissions.js';
import {PUBLICATION_PARTS,publicationPartAllowed} from './web/record-publication-privacy.js';
import {researchId} from './web/research-reference.js';
import {convertPublicationRecord} from './publication-conversion-render.js';

const channels=['website','pdf'];
const consentKey=target=>target==='pdf'?'sharePdf':'share';
const domainFields=new Set(PUBLICATION_PARTS);
const notebookChange=data=>data?.change?.kind==='notebook'?data.change.value:null;
const collectionAllowed=(value,target,collection)=>target==='pdf'?value===true:collection==='sections'?value!==false:value===true;
const identity=(metadata,recordId,notebookId,target)=>{const book=metadata.notebooks.find(item=>item.id===notebookId);return book?{workspaceId:metadata.id,projectId:book.projectId,notebookId,recordId,target}:null;};

// Never enumerate a research owner while opening a website. Only an explicit
// research save can reach this adapter. Ordinary edits to copied writing do
// not change the copy. Deleting its original is not a publication withdrawal.
function commandTargets(route,data){
 if(!data||typeof data!=='object')return null;
 const records=new Map(),books=new Set();
 const add=(id,notebook=null)=>{if(researchId(id))records.set(id,notebook);};
 switch(route){
 case '/api/research/records/values/save': if(!['share','sharePdf','publication'].includes(data.field)&&!(typeof data.field==='string'&&data.field.startsWith('media:')))return null;add(data.recordId);break;
 case '/api/research/records/writing/save':if(!data.sectionId||!data.value||!['share','sharePdf'].some(key=>Object.hasOwn(data.value,key)))return null;add(data.recordId);break;
 case '/api/research/records/sections':if(data.action==='move')return null;add(data.recordId);break;
 case '/api/research/records/media':add(data.recordId);break;
 case '/api/research/records/history/restore':add(data.recordId);break;
 case '/api/research/records/location':add(data.recordId,data.notebookId);break;
 case '/api/workspace/save':case '/api/research/records/save':for(const change of data.changes??[])add(change?.id,change?.record?.notebookId);break;
 case '/api/notebook/save':for(const record of data.book?.entries??[])add(record.id,record.notebookId);for(const book of data.book?.notebooks??[])if(researchId(book.id))books.add(book.id);break;
 case '/api/workspace/structure':case '/api/workspace/notebook':{const book=notebookChange(data);if(book&&researchId(book.id))books.add(book.id);break;}
 default:return null;
 }
 return records.size||books.size?{records,books}:null;
}

async function visibleParts(document,field,target){
 const keys=[];for await(const item of document.items([field])){
  const flag=(await document.tree.selected(item.value,[consentKey(target)])).value;
  if(collectionAllowed(flag,target,field))keys.push((await document.tree.selected(item.value,['id'])).value);
 }return keys.sort();
}
async function status(metadata,row,document,target){
 const record={id:row.id,notebookId:row.notebookId??(await document.field(['notebookId'])).value,[consentKey(target)]:(await document.field([consentKey(target)])).value};
 const provenance=identity(metadata,row.id,record.notebookId,target);if(!provenance)throw new AppError('CATALOGUE_DAMAGED');
 const visible=sourceRecordAllowed(record,metadata,target);let permissions=null;
 if(visible){const publication=(await document.field(['publication'])).value;permissions={parts:PUBLICATION_PARTS.filter(key=>publicationPartAllowed({publication},key,target)),sections:await visibleParts(document,'sections',target),attachments:await visibleParts(document,'attachments',target)};}
 return {provenance,sourceId:websiteSourceId(provenance),visible,signature:digest(serialize(permissions)),revision:row.revision};
}

async function states(storage,targets,workspaceId,selectedChannels=channels){
 return storage.catalogue(async store=>{
  const snapshotId=await store.head(),snapshot=await store.snapshot(snapshotId),metadata=snapshot.metadata;if(workspaceId&&metadata.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  const rows=new Map(),result=new Map();
  for(const [id] of targets.records){const row=await store.member(snapshot,id);if(row)rows.set(id,row);}
  for(const notebookId of targets.books){
   if(!snapshot.indexVersion)throw new AppError('STORAGE_UPGRADE_REQUIRED');
   const index=new SnapshotIndex(store);if(await index.scopedCount(snapshot.membership)!==snapshot.count)throw new AppError('STORAGE_UPGRADE_REQUIRED');
   for await(const row of index.members(snapshot.membership,{notebookId}))rows.set(row.id,row);
  }
  for(const row of rows.values())await withRecordDocument(store,row.id,row.revision,async doc=>{for(const target of selectedChannels){const value=await status(metadata,row,doc,target);result.set(value.sourceId,{...value,snapshotId});}});
  // A new entry or a move may introduce a second identity that also needs a
  // write fence before the research transaction can commit.
  for(const [id,notebookId] of targets.records)if(notebookId)for(const target of selectedChannels){const provenance=identity(metadata,id,notebookId,target);if(!provenance)continue;const sourceId=websiteSourceId(provenance);if(!result.has(sourceId))result.set(sourceId,{sourceId,provenance,visible:false,signature:null,revision:null});}
  return result;
 });
}

async function permittedOriginal(doc,target){
 const record={},publication=(await doc.field(['publication'])).value;
 for(const key of await doc.tree.propertyNames(doc.root)){
  if(key==='publication'){record.publication=publication;continue;}
  if(key==='sections'||key==='attachments'){
   const values=[];for await(const item of doc.items([key])){const flag=(await doc.tree.selected(item.value,[consentKey(target)])).value;if(collectionAllowed(flag,target,key))values.push(await doc.tree.read(item.value));}record[key]=values;
  }else if(domainFields.has(key)&&!publicationPartAllowed({publication},key,target)){
   if(['contributors','tags','figures','relations'].includes(key))record[key]=[];else if(['body','outcome'].includes(key))record[key]='';
  }else record[key]=(await doc.field([key])).value;
 }
 return record;
}

export class PublicationConversion{
 constructor(workspace,{store=new WebsiteFileStore(workspace)}={}){this.files=store;}
 async capture(storage,state,token){
  const {sourceId,provenance}=state,target=provenance.target;
  if(!state.visible)return this.files.putSource({sourceId,target,provenance:{...provenance,revision:state.revision,recordRevision:state.revision,snapshotId:state.snapshotId??null},title:'Private entry',visible:false},{token});
  const {metadata,record}=await storage.catalogue(async store=>{
   const snapshot=await store.snapshot(),row=await store.member(snapshot,provenance.recordId);if(!row||row.revision!==state.revision)throw new AppError('RECORD_CHANGED');
   return withRecordDocument(store,row.id,row.revision,async doc=>({metadata:snapshot.metadata,record:await permittedOriginal(doc,target)}));
  });
  const output=await convertPublicationRecord(storage,metadata,record,{target});if(!output.visible)throw new AppError('RECORD_CHANGED');
  return this.files.putSource({sourceId,target,provenance:{...provenance,revision:state.revision,recordRevision:state.revision,snapshotId:state.snapshotId??null},title:record.title,...output},{token});
 }
 async seedWebsite(storage,provenance,{signal}={}){
  const sourceId=websiteSourceId(provenance),prior=await this.files.sourceStatus(sourceId);if(prior.pending)throw new AppError('CONFLICT');
  if(!prior.source){
   const token=await this.files.beginSourceUpdate({sourceId,target:provenance.target,ifAbsent:true,signal});
   try{
    const targets={records:new Map([[provenance.recordId,null]]),books:new Set()},state=(await states(storage,targets,provenance.workspaceId,['website'])).get(sourceId);
    if(!state?.visible)throw new AppError('PUBLICATION_PERMISSIONS_CHANGED');
    await this.capture(storage,state,token);
   }catch(error){
    // A concurrent withdrawal takes a different token and cannot be cancelled.
    await this.files.cancelSourceUpdate({sourceId,token}).catch(()=>{});throw error;
   }
  }
  return this.files.getSource(sourceId,{signal});
 }
 async mutate(storage,{route,data},operation){const targets=commandTargets(route,data);return targets?this.change(storage,targets,data.workspaceId,operation):operation();}
 async mutateNotebook(storage,notebookId,operation){if(!researchId(notebookId))throw new AppError('INVALID');return this.change(storage,{records:new Map(),books:new Set([notebookId])},null,operation);}
 async change(storage,targets,workspaceId,operation){
  const before=await states(storage,targets,workspaceId),pending=new Map();
  // After this point every affected site fails closed until its new website
  // files are committed. A lost response can be retried on the same source.
  try{for(const [id,state] of before){const prior=await this.files.sourceStatus(id);pending.set(id,{prior,token:await this.files.beginSourceUpdate({sourceId:id,target:state.provenance.target}),state});}}
  catch(error){await Promise.allSettled([...pending].filter(([,item])=>!item.prior.pending).map(([sourceId,{token}])=>this.files.cancelSourceUpdate({sourceId,token})));throw error;}
  let result,error;try{result=await operation();}catch(failure){error=failure;}
  const after=await states(storage,targets,workspaceId);
  for(const [id,value] of after)if(!pending.has(id)){if(value.visible)throw new AppError('CONFLICT');}
  for(const [id,{prior,token,state}] of pending){
   const next=after.get(id)??{...state,visible:false,signature:null,revision:null};
   if(!prior.pending&&next.visible===state.visible&&next.signature===state.signature&&(error||prior.source||!next.visible))await this.files.cancelSourceUpdate({sourceId:id,token});
   else if(!next.visible&&!prior.source&&!prior.pending)await this.files.cancelSourceUpdate({sourceId:id,token});
   else await this.capture(storage,next,token);
  }
  if(error)throw error;return result;
 }
}
