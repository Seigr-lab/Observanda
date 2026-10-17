import {readRecordOwnerMetadata} from './record-owner-audit-metadata.js';
// Immutable completion receipts with a paged history and exact applicability
// lookup. Total receipt count is independent of request and working-set size.
import {AppError} from './errors.js';
import {MetadataFeed} from './metadata-feed.js';
import {withWorkspaceMetadataBatch} from './metadata-batch.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest,serialize} from './storage-format.js';
import {catalogueFormat,requireRunReceiptStore} from './catalogue-format.js';
const prefix='.observanda/run-readiness/receipts/';
const kinds=['validation','publication','git'];
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export function validateRunReceipt(value){
 if(!value||!researchId(value.id)||!kinds.includes(value.kind)||!revisionId(value.recordRevision)||value.evidenceRevision!==undefined&&!revisionId(value.evidenceRevision)||!Number.isSafeInteger(Date.parse(value.recordedAt))||Date.parse(value.recordedAt)<0)damaged();
 return value;
}
const parse=raw=>{try{return JSON.parse(raw);}catch{damaged();}};
export class RunReceiptStore{
 constructor(workspace,recordId){if(!researchId(recordId))throw new AppError('INTAKE_INVALID');this.workspace=workspace;this.recordId=recordId;this.root=prefix+recordId;this.marker=this.root+'.json';this.feed=new MetadataFeed(workspace,this.root+'/items');}
 async json(file,limit=1024*1024){const raw=await readRecordOwnerMetadata(this.workspace,file,limit);return raw===null?null:parse(raw);}
 async metadata(){const value=await this.json(this.marker,1024);if(value&&(value.version!==1||!Number.isSafeInteger(value.count)||value.count<0))damaged();return value;}
 file(id){if(!researchId(id))throw new AppError('INTAKE_INVALID');return this.root+'/items/'+id+'.json';}
 basis(receipt){return this.root+'/basis/'+receipt.recordRevision+'/'+receipt.evidenceRevision+'/'+receipt.kind+'.json';}
 async stored(id){const value=await this.json(this.file(id));if(value&&(validateRunReceipt(value).id!==id))damaged();return value;}
 async ensure(){if(!await this.metadata())await this.workspace.withLock(()=>this.ensureLocked());}
 async ensureLocked(){
  if(await this.metadata())return;
  return withWorkspaceMetadataBatch(this.workspace,async()=>{
   for await(const _name of this.workspace.metadataNames(this.root)){void _name;damaged();}
   await this.workspace.catalogue(store=>requireRunReceiptStore(store.db));
   const legacy='.observanda/run-readiness/records/'+this.recordId+'.json',values=await this.json(legacy);if(values!==null&&!Array.isArray(values))damaged();
   let count=0;for(const receipt of values??[]){validateRunReceipt(receipt);if(await this.stored(receipt.id))damaged();await this.writeLocked(receipt);count++;}
   await this.workspace.writeMetadata(this.feed.marker,JSON.stringify({version:1}));await this.workspace.writeMetadata(this.marker,JSON.stringify({version:1,count}));
   if(values!==null)await this.workspace.removeMetadata(legacy);
  });
 }
 async writeLocked(receipt,{basis=true}={}){
  await this.workspace.writeMetadata(this.file(receipt.id),JSON.stringify(receipt));
  await this.feed.putLocked({id:receipt.id,createdAt:receipt.recordedAt});
  if(basis&&receipt.evidenceRevision)await this.workspace.writeMetadata(this.basis(receipt),JSON.stringify({id:receipt.id,sha256:digest(serialize(receipt))}));
 }
 async appendLocked(receipt){
  validateRunReceipt(receipt);await this.ensureLocked();const prior=await this.stored(receipt.id);
  if(prior){if(serialize(prior)!==serialize(receipt))throw new AppError('INTAKE_CHANGED');return prior;}
  const metadata=await this.metadata();if(!Number.isSafeInteger(metadata.count+1))throw new AppError('LIMIT');
  await this.writeLocked(receipt);await this.workspace.writeMetadata(this.marker,JSON.stringify({...metadata,count:metadata.count+1}));return receipt;
 }
 async get(id){await this.ensure();return this.stored(id);}
 async getLocked(id){await this.ensureLocked();return this.stored(id);}
 // Record history includes receipts resolved through authenticated project locations.
 async page({cursor=null,limit=20,signal}={}){
  signal?.throwIfAborted();await this.ensure();const metadata=await this.metadata(),page=await this.feed.page({cursor,limit,localOnly:false}),items=[];
  for(const item of page.items){signal?.throwIfAborted();const receipt=await this.stored(item.id);if(!receipt||receipt.recordedAt!==item.createdAt)damaged();items.push(receipt);}
  return {items,next:page.next,total:metadata.count};
 }
 async lookup(kind,revision,evidenceRevision){
  const target={kind,recordRevision:revision,evidenceRevision},link=await this.json(this.basis(target),1024);if(!link)return false;
  if(!researchId(link.id)||!revisionId(link.sha256))damaged();const receipt=await this.stored(link.id);
  if(!receipt||receipt.kind!==kind||receipt.recordRevision!==revision||receipt.evidenceRevision!==evidenceRevision||digest(serialize(receipt))!==link.sha256)damaged();return true;
 }
 async matching(required,revisions,evidenceRevision,{signal}={}){
  signal?.throwIfAborted();await this.ensure();return this.matchingStored(required,revisions,evidenceRevision,{signal});
 }
 async matchingLocked(required,revisions,evidenceRevision,{signal}={}){
  signal?.throwIfAborted();await this.ensureLocked();return this.matchingStored(required,revisions,evidenceRevision,{signal});
 }
 async matchingStored(required,revisions,evidenceRevision,{signal}={}){
  const found=new Set();
  for(const kind of required)for(const revision of revisions){signal?.throwIfAborted();if(await this.lookup(kind,revision,evidenceRevision)){found.add(kind);break;}}
  return found;
 }
 async verify({signal}={}){
  const metadata=await this.metadata();if(!metadata||!await this.feed.initialized())damaged();let count=0;
  for await(const name of this.workspace.metadataNames(this.root+'/items',{signal})){
   if(!name.endsWith('.json')||!researchId(name.slice(0,-5)))damaged();const receipt=await this.stored(name.slice(0,-5));if(!receipt)damaged();
   const item={id:receipt.id,createdAt:receipt.recordedAt},ordered=await this.json(this.feed.order+'/'+this.feed.key(item),1024);if(serialize(item)!==serialize(ordered))damaged();
   if(receipt.evidenceRevision&&!await this.lookup(receipt.kind,receipt.recordRevision,receipt.evidenceRevision))damaged();count++;
  }
  if(count!==metadata.count)damaged();count=0;let cursor=null;
  do{const page=await this.page({cursor,signal});count+=page.items.length;cursor=page.next;}while(cursor);if(count!==metadata.count)damaged();
  for await(const revision of this.workspace.metadataNames(this.root+'/basis',{signal})){
   if(!revisionId(revision))damaged();
   for await(const evidence of this.workspace.metadataNames(this.root+'/basis/'+revision,{signal})){
    if(!revisionId(evidence))damaged();
    for await(const name of this.workspace.metadataNames(this.root+'/basis/'+revision+'/'+evidence,{signal})){const kind=name.slice(0,-5);if(name!==kind+'.json'||!kinds.includes(kind)||!await this.lookup(kind,revision,evidence))damaged();}
   }
  }
 }
}
export async function verifyRunReceiptStores(workspace,{signal}={}){
 for await(const name of workspace.metadataNames(prefix.slice(0,-1),{signal})){
  if(await workspace.catalogue(store=>catalogueFormat(store.db))<9)damaged();
  const id=name.endsWith('.json')?name.slice(0,-5):name;if(!researchId(id))damaged();
  const receipts=new RunReceiptStore(workspace,id);if(!await receipts.metadata())damaged();if(name.endsWith('.json'))await receipts.verify({signal});
 }
}
