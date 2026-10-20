import {sourceSelectionRevision} from './website-source-selections.js';
import {publicationReferenceWindow} from './publication-reference-window.js';
import {AppError} from './errors.js';
import {PublicationPreviewOwner} from './publication-preview-owner.js';
import {PublicationOwnerIdentities} from './publication-owner-identities.js';
import {appendPublicationCollections} from './publication-owner-projection.js';
import {readingKey} from './record-reading-index.js';
import {recordRevision} from './research.js';
import {bookSelectors} from './web/book-selectors.js';
import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {publicationRecordDestination,publicationLinkResolver} from './publication-prose.js';
import {researchReference} from './web/research-reference.js';
import {websiteReferenceCandidates} from './website-preview-references.js';
import {publicationDescriptor} from './publication-record-descriptor.js';
import {digest,serialize} from './storage-format.js';

// Page-local federation. Owners supply bounded derivatives; only the selected
// record bodies and page assets survive into the authenticated canvas.
export class WebsitePreviewSources{
 constructor(local,reader){
  Object.assign(this,{local,reader,store:local.store,snapshot:local.snapshot,command:local.command,signal:local.signal,websiteId:local.websiteId,websitePin:local.websitePin});
  this.metadata=structuredClone(local.metadata);this.identities=new PublicationOwnerIdentities(this.metadata.id);
  this.owners=[];this.rows=new Map();this.descriptors=new Map();this.mediaOrigins=new Map();
 }
 async initialize(sources,{entryId=null}={}){
  if(entryId&&await this.local.row(entryId))entryId=null;
  for(const kind of ['projects','notebooks'])for(const item of this.metadata[kind]){
   this.identities.identity(this.metadata.id,kind==='projects'?'project':'notebook',item.id);
   const namespace=this.metadata.id;
   item.sourceId=item.id;item.sourceWorkspaceId=namespace;item.referenceNamespaces=[...new Set([this.metadata.id,namespace])];
  }
  for await(const source of Array.isArray(sources)?sources:sources.items()){
   const owner=await new PublicationPreviewOwner(source,this.reader,this.identities,{signal:this.signal}).initialize({counts:true,entryId});
   appendPublicationCollections(this.metadata,owner.projected);this.owners.push(owner);
   if(owner.entryId){for(const [id,descriptor] of owner.descriptors)this.remember(owner.rows.get(id),{publicationCard:descriptor});entryId=null;}
  }
  this.binding=digest(serialize(this.owners.map(owner=>({source:sourceSelectionRevision(owner.source),snapshotId:owner.snapshotId}))));
  return this;
 }
 owner(row){return this.owners.find(owner=>owner.source.workspaceId===row.workspaceId);}
 remember(row,value){
  if(!row.workspaceId){const descriptor=this.local.remember(row,value);this.descriptors.set(row.id,descriptor);this.rows.set(row.id,row);return descriptor;}
  const owner=this.owner(row),descriptor=value.publicationCard;
  if(!owner||descriptor.id!==row.id||descriptor.sourceWorkspaceId!==owner.source.workspaceId)throw new AppError('PUBLICATION_IDENTITY');
  if(!row.historical)this.identities.identity(owner.source.workspaceId,'record',row.recordId);
  this.descriptors.set(row.id,descriptor);this.rows.set(row.id,row);
  for(const [attachmentId,id] of Object.entries(descriptor.mediaIdentities??{}))this.mediaOrigins.set(id,{workspaceId:owner.source.workspaceId,snapshotId:owner.snapshotId,attachmentId});
  return descriptor;
 }
 async row(id,{describe=false}={}){
  if(this.rows.has(id))return this.rows.get(id);
  const local=await this.local.row(id);if(local){this.identities.identity(this.metadata.id,'record',id);this.rows.set(id,local);return local;}
  for(const owner of this.owners){
   const origin=this.identities.origins.get(id),recordId=origin?.startsWith(owner.source.workspaceId+'/record/')?origin.split('/')[2]:undefined;
   if(describe){const value=await owner.resolve(id,{recordId});if(value){this.remember(value.row,{publicationCard:value.descriptor});return value.row;}}
   else{const row=await owner.find(id,{recordId});if(row){this.rows.set(id,row);return row;}}
  }
  return null;
 }
 async get(id){
  if(this.descriptors.has(id))return this.descriptors.get(id);
  const row=await this.row(id,{describe:true});if(!row)return null;
  if(!row.workspaceId){const value=await this.local.get(id);this.descriptors.set(id,value);return value;}
  return this.descriptors.get(id)??this.remember(row,await this.document(row));
 }
 async document(row,options){
  if(!row.workspaceId)return this.local.document(row,options);
  const descriptor=await this.owner(row).describe(row);return {...descriptor,publicationCard:descriptor};
 }
 async original(id){const row=await this.row(id);return row?.workspaceId?this.owner(row).original(row):this.local.original(id);}
 revision(record){return this.descriptors.get(record.id)?.revision??recordRevision(record);}
 selectors(record){return this.descriptors.get(record.id)?.selectors??bookSelectors(record);}
 async *dateRows(notebooks,options={}){
  const localIds=new Set(this.local.metadata.notebooks.map(book=>book.id).filter(id=>notebooks.has(id)));
  const lanes=[this.local.dateRows(localIds,options)];
  for(const owner of this.owners){
   const selected=new Set(owner.projected.notebooks.map(book=>book.id).filter(id=>notebooks.has(id)));if(!selected.size)continue;
   lanes.push((async function*(){
    let after=options.after??null;
    if(options.includeAfter&&after){const row=await owner.find(after.id);if(row&&selected.has(row.notebookId)&&readingKey(row,'date')===readingKey(after,'date'))yield row;}
    for(;;){const rows=await owner.window(selected,{after,backward:options.backward});for(const row of rows)yield row;if(rows.length<128)return;after=rows.at(-1);}
   })());
  }
  const frontiers=[];
  try{
   for(const iterator of lanes){const next=await iterator.next();if(!next.done)frontiers.push({iterator,row:next.value});}
   while(frontiers.length){
    this.signal?.throwIfAborted();let at=0;
    for(let i=1;i<frontiers.length;i++){const a=readingKey(frontiers[i].row,'date'),b=readingKey(frontiers[at].row,'date');if(options.backward?a>b:a<b)at=i;}
    const lane=frontiers[at];yield lane.row;const next=await lane.iterator.next();if(next.done)frontiers.splice(at,1);else lane.row=next.value;
   }
  }finally{for(const iterator of lanes)await iterator.return();}
 }
 async neighbours(id){
  const row=await this.row(id);if(!row)return;
  if(!row.workspaceId){await this.local.neighbours(id);for(const [key,value] of this.local.descriptors)this.descriptors.set(key,value);return;}
  if(this.owner(row).entryId===id)return;
  if(row.historical){await this.get(this.owner(row).id('record',row.recordId));return;}
  for(const value of await this.owner(row).neighbourDescriptors(row))this.remember(value.row,{publicationCard:value.descriptor});
 }
 async counts(){
  const result=await this.local.counts();
  for(const owner of this.owners)Object.assign(result.notebooks,await owner.counts());
  result.total=Object.values(result.notebooks).reduce((sum,count)=>sum+count,0);return result;
 }
 async resolveReference(target){
  const candidates=[];
  if(await referenceNamespaceMatches(this.local.store,target)){const local=await this.local.get(target.id);if(local){this.descriptors.set(local.id,local);candidates.push(local);}}
  for(const owner of this.owners){
   if(target.revision){const historical=await owner.historicalTarget(target);if(historical){this.rows.set(historical.id,historical);candidates.push(await this.get(historical.id));}}
   const id=owner.id('record',target.id),row=await owner.find(id,{recordId:target.id});if(!row)continue;
   this.rows.set(id,row);const descriptor=await this.get(id);if(descriptor.referenceNamespaces.includes(target.workspaceId))candidates.push(descriptor);
  }
  return publicationRecordDestination(candidates,target,this.metadata.id);
 }
 async referencePage(id,cursor=null){
  if(cursor!==null&&(typeof cursor!=='string'||!cursor||cursor.length>4096))throw new AppError('INVALID');
  const selected=await this.get(id),original=await this.original(id);if(!selected||!original)throw new AppError('NOT_FOUND');
  selected.revision=this.revision(original);selected.selectors=this.selectors(original);
  const binding=digest(serialize({source:this.binding,snapshot:this.command.baseEtag,changes:this.command.changes,removed:this.command.removed,id}));
  let anchor={owner:0,position:null,backward:false};
  if(cursor){
   try{anchor=this.store.decode('website-source-references',this.metadata.id,Buffer.from(cursor,'base64url'));}catch{throw new AppError('INVALID');}
   if(!anchor||Object.keys(anchor).sort().join()!=='backward,binding,owner,position'||anchor.binding!==binding||!Number.isInteger(anchor.owner)||anchor.owner<0||anchor.owner>this.owners.length||!Number.isSafeInteger(anchor.position)||anchor.position<0||typeof anchor.backward!=='boolean')throw new AppError('INVALID');
  }
  const resolve=publicationLinkResolver(this.metadata.id,{entries:[selected]},{workspaceContent:true}),items=[];let scanned=0,first=null,last=null,more=false;
  const namespaces=selected.referenceNamespaces??[this.metadata.id],rawId=selected.recordId??id;
  outer:for(let index=anchor.owner;index>=0&&index<=this.owners.length;index+=anchor.backward?-1:1){
   const position=index===anchor.owner?anchor.position:null;
   const rows=index===0?await publicationReferenceWindow(namespaces.map(namespace=>()=>websiteReferenceCandidates(this.local,rawId,{after:position,backward:anchor.backward},namespace)),{backward:anchor.backward,signal:this.signal}):await this.owners[index-1].referenceWindow({workspaceIds:namespaces,id:rawId},{after:position,backward:anchor.backward});
   for(const row of rows){
    if(items.length===24||scanned===256){more=true;break outer;}
    const point={owner:index,position:row.position};first??=point;last=point;scanned++;
    let descriptor;
    if(index===0){
     const details=this.local.changed.has(row.id)?publicationDescriptor(this.local.changed.get(row.id)):(await Array.fromAsync(this.store.queryDocuments([row],this.local.metadata,{signal:this.signal,search:false,publicationDetails:true})))[0].publicationDescriptor;
     descriptor={...await this.local.get(row.id),relations:details.relations,status:details.status,outcome:details.outcome};this.descriptors.set(row.id,descriptor);
    }else{
     const admitted=await this.owners[index-1].find(row.id,{recordId:row.recordId});if(!admitted)continue;this.rows.set(row.id,admitted);descriptor=await this.get(row.id);
    }
    if(descriptor.relations.some(link=>link.target.kind==='record'&&link.target.id===rawId&&resolve(researchReference(link.target))))items.push(row.id);
   }
  }
  const encode=(point,backward)=>this.store.encode('website-source-references',this.metadata.id,{binding,...point,backward}).toString('base64url');
  const prior=anchor.position!==null?encode(first??anchor,!anchor.backward):null,next=more?encode(last??anchor,anchor.backward):null;
  if(anchor.backward)items.reverse();
  return {recordIds:items,scanned,previousCursor:anchor.backward?next:prior,nextCursor:anchor.backward?prior:next};
 }
}
