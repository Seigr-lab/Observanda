import {AppError} from './errors.js';
import {PublicationPreviewOwner} from './publication-preview-owner.js';
import {PublicationOwnerIdentities} from './publication-owner-identities.js';
import {appendPublicationCollections} from './publication-owner-projection.js';
import {readingKey} from './record-reading-index.js';
import {recordReferenceCandidates} from './record-reference-candidates.js';
import {publicationReferenceWindow} from './publication-reference-window.js';
import {referenceNamespaceMatches} from './research-reference-namespace.js';
import {publicationRecordDestination} from './publication-prose.js';
import {digest,serialize} from './storage-format.js';

// Appearance uses the website's saved consent. Owners remain independent and
// each request reauthorizes their pinned snapshots; no source key is cached.
export class AppearancePreviewSources{
 constructor(local,reader,{snapshots=new Map(),mediaOrigins=new Map()}={}){
  Object.assign(this,{local,reader,snapshots,mediaOrigins,store:local.store,signal:local.signal,websiteId:local.websiteId,websitePin:local.websitePin,selection:local.selection});
  this.metadata=structuredClone(local.metadata);this.identities=new PublicationOwnerIdentities(this.metadata.id);
  this.owners=[];this.members=new Map();this.descriptors=new Map();
 }
 async initialize(sources){
  for(const kind of ['projects','notebooks'])for(const item of this.metadata[kind]){
   item.sourceId=item.id;item.sourceWorkspaceId=this.metadata.id;item.referenceNamespaces=[this.metadata.id];
  }
  let offset=this.local.snapshot.nextPosition??this.local.snapshot.records.length;
  for(const source of sources){
   const owner=await new PublicationPreviewOwner(source,this.reader,this.identities,{signal:this.signal}).initialize({counts:true,snapshotId:this.snapshots.get(source.workspaceId)});
   owner.offset=offset;offset+=owner.positionSpan;
   if(!Number.isSafeInteger(offset)||offset<0)throw new AppError('LIMIT');
   this.snapshots.set(source.workspaceId,owner.snapshotId);this.owners.push(owner);appendPublicationCollections(this.metadata,owner.projected);
  }
  this.notebooks=new Set([...this.local.notebooks,...this.owners.flatMap(owner=>owner.projected.notebooks.map(book=>book.id))]);
  const notebooks={...this.local.counts.notebooks};for(const owner of this.owners)Object.assign(notebooks,await owner.counts());
  this.counts={notebooks,total:Object.values(notebooks).reduce((sum,value)=>sum+value,0)};
  this.snapshotId=digest(serialize({local:this.local.snapshotId,sources:[...this.snapshots]}));return this;
 }
 owner(row){return this.owners.find(owner=>owner.source.workspaceId===row.workspaceId);}
 projected(row,owner){return {...row,position:owner.offset+row.position};}
 async member(id){
  if(this.members.has(id))return this.members.get(id);
  const local=await this.local.member(id);if(local&&await this.local.visible(local)){this.members.set(id,local);return local;}
  for(const owner of this.owners){const row=await owner.find(id);if(row){const projected=this.projected(row,owner);this.members.set(id,projected);return projected;}}
  return null;
 }
 async visible(row){return row.workspaceId?!!await this.owner(row)?.find(row.id,{recordId:row.recordId}):this.local.visible(row);}
 async get(id){
  if(this.descriptors.has(id))return this.descriptors.get(id);
  const row=await this.member(id);if(!row)return null;
  const owner=this.owner(row),descriptor=owner?{...await owner.describe(row),position:row.position}:await this.local.get(id);
  for(const [attachmentId,mapped] of Object.entries(descriptor.mediaIdentities??{}))this.mediaOrigins.set(mapped,{workspaceId:owner.source.workspaceId,snapshotId:owner.snapshotId,attachmentId});
  this.descriptors.set(id,descriptor);return descriptor;
 }
 async summary(row,options={}){
  if(!row.workspaceId)return this.local.summary(row,options);
  if(!options.references&&!options.publicationDetails)return this.owner(row).use(async(store,snapshot)=>{
   const member=await store.member(snapshot,row.recordId);if(!member)throw new AppError('CATALOGUE_DAMAGED');
   const [summary]=await Array.fromAsync(store.queryDocuments([member],snapshot.metadata,{search:false,signal:this.signal}));
   return {...summary,id:row.id,notebookId:row.notebookId};
  });
  this.members.set(row.id,row);const descriptor=await this.get(row.id);
  return {...descriptor,referenceTargets:[...descriptor.relations.map(link=>link.target),...descriptor.references],publicationDescriptor:descriptor};
 }
 async original(id){const row=await this.member(id);return row?.workspaceId?this.owner(row).original(row):this.local.original(id);}
 async neighbours(id){
  const row=await this.member(id);if(!row)return;
  if(!row.workspaceId){await this.local.neighbours(id);for(const [key,value] of this.local.descriptors)this.descriptors.set(key,value);return;}
  const owner=this.owner(row);for(const next of await owner.neighbours(row)){this.members.set(next.id,this.projected(next,owner));await this.get(next.id);}
 }
 async *ownerRows(owner,{order,notebooks,after,backward}){
  const selected=new Set(owner.projected.notebooks.map(book=>book.id).filter(id=>notebooks.has(id)));if(!selected.size)return;
  let cursor=order==='position'?after===null?null:after.position-owner.offset:after;
  if(order==='position'&&cursor!==null&&(backward?cursor<=0:cursor>=owner.positionSpan-1))return;
  if(order==='position'&&cursor!==null&&(backward?cursor>=owner.positionSpan:cursor<0))cursor=null;
  for(;;){
   const rows=order==='position'?await owner.positionWindow({after:cursor,backward}):await owner.window(selected,{after:cursor,backward});
   for(const row of rows)if(selected.has(row.notebookId))yield this.projected(row,owner);
   if(rows.length<128)return;cursor=order==='position'?rows.at(-1).position:rows.at(-1);
  }
 }
 async *rows({notebooks=this.notebooks,order='position',after=null,backward=false}={}){
  const localBooks=new Set([...this.local.notebooks].filter(id=>notebooks.has(id))),lanes=[this.local.rows({notebooks:localBooks,order,after,backward}),...this.owners.map(owner=>this.ownerRows(owner,{notebooks,order,after,backward}))];
  const frontiers=[];
  try{
   for(const iterator of lanes){const next=await iterator.next();if(!next.done)frontiers.push({iterator,row:next.value});}
   while(frontiers.length){
    this.signal?.throwIfAborted();let at=0;
    for(let i=1;i<frontiers.length;i++){const a=readingKey(frontiers[i].row,order),b=readingKey(frontiers[at].row,order);if(backward?a>b:a<b)at=i;}
    const lane=frontiers[at];yield lane.row;const next=await lane.iterator.next();if(next.done)frontiers.splice(at,1);else lane.row=next.value;
   }
  }finally{for(const iterator of lanes)await iterator.return();}
 }
 async resolveReference(target){
  const candidates=[];
  if(await referenceNamespaceMatches(this.local.store,target)){const local=await this.get(target.id);if(local)candidates.push(local);}
  for(const owner of this.owners){
   if(target.revision){const historical=await owner.historicalTarget(target);if(historical){this.members.set(historical.id,this.projected(historical,owner));candidates.push(await this.get(historical.id));}}
   const row=await owner.find(owner.id('record',target.id),{recordId:target.id});if(!row)continue;
   this.members.set(row.id,this.projected(row,owner));const descriptor=await this.get(row.id);if(descriptor.referenceNamespaces.includes(target.workspaceId))candidates.push(descriptor);
  }
  return publicationRecordDestination(candidates,target,this.metadata.id);
 }
 async *referenceRows(id,after,backward){
  const selected=await this.get(id),raw=selected.recordId??id,namespaces=selected.referenceNamespaces??[this.metadata.id],owners=[null,...this.owners];if(backward)owners.reverse();
  for(const owner of owners){
   const offset=owner?.offset??0;let cursor=after===null?null:after-offset;
   const span=owner?.positionSpan??(this.local.snapshot.nextPosition??this.local.snapshot.records.length);
   if(cursor!==null&&(backward?cursor<=0:cursor>=span-1))continue;
   if(cursor!==null&&(backward?cursor>=span:cursor<0))cursor=null;
   for(;;){
    const rows=await publicationReferenceWindow(namespaces.map(workspaceId=>()=>owner?owner.referenceRows({workspaceId,id:raw},{after:cursor,backward}):recordReferenceCandidates({store:this.local.store,snapshot:this.local.snapshot,signal:this.signal,notebooks:this.local.notebooks,workspaceId,fallback:anchor=>this.local.rows({after:anchor.after===null?null:{position:anchor.after},backward:anchor.backward})},raw,{after:cursor,backward})),{backward,signal:this.signal});
    for(const row of rows)yield owner?this.projected(row,owner):row;
    if(rows.length<257)break;cursor=rows.at(-1).position;
   }
  }
 }
}
