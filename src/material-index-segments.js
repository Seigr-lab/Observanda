// Published evidence sets add one pointer to each discovery feed. Immutable
// reference sequences expand only while their requested page is being read.
import {AppError} from './errors.js';
import {MetadataFeed} from './metadata-feed.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {materialBatch,materialOwnerTransfer,materialReturnedRetired,materialInheritedSegment} from './material-visibility.js';
const root='.observanda/materials/index',kinds=['artifact','dataset','analysis','collection'];
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const materialSegmentOwner=head=>head.ownerTransfer??head.stagedBatch??null;
export class MaterialIndexSegments{
 constructor(materials){this.materials=materials;this.workspace=materials.workspace;}
 feed(recordId=null,kind=null){return new MetadataFeed(this.workspace,root+'/segments/'+(recordId??'all')+'/'+(kind??'all'));}
 async json(file){const raw=await this.workspace.readMetadata(file,8192);if(raw===null)return null;try{return JSON.parse(raw);}catch{damaged();}}
 file(id){if(!researchId(id))damaged();return root+'/batches/'+id+'.json';}
 buckets(segment){return segment.version===2?[null,...kinds]:[null,'artifact'];}
 sequence(segment,kind=null){if(kind===null)return segment.inputsIndex;if(segment.version===2)return segment.sequences[kind];return kind==='artifact'?segment.inputsIndex:null;}
 validate(value,id){
  if(!value||![1,2].includes(value.version)||value.batchId!==id||!researchId(value.id)||value.id===id||!researchId(value.recordId)||!Number.isFinite(Date.parse(value.createdAt)))damaged();
  this.materials.sequences.validate(value.inputsIndex);if(value.inputsIndex.kind!=='references')damaged();
  if(value.version===2){
   if(value.ownerTransfer!==id||!value.sequences||Object.keys(value.sequences).sort().join()!==['all',...kinds].sort().join()||!same(value.sequences.all,value.inputsIndex))damaged();
   let count=0;for(const kind of kinds){const sequence=this.materials.sequences.validate(value.sequences[kind]);if(sequence.kind!=='references')damaged();count+=sequence.count;}if(count!==value.inputsIndex.count)damaged();
  }else if(value.ownerTransfer!==undefined||value.sequences!==undefined)damaged();
  return value;
 }
 transferMatches(value,receipt){const evidence=receipt.progress.evidence;return evidence?.version===1&&evidence.segmentId===value.id&&evidence.recordId===value.recordId&&evidence.createdAt===value.createdAt&&same(evidence.sequences,value.sequences);}
 async read(id){
  const value=this.validate(await this.json(this.file(id)),id);
  if(value.version===2){const receipt=await materialOwnerTransfer(this.workspace,id,value.recordId);if(receipt.phase!=='complete'||!this.transferMatches(value,receipt))damaged();}
  else{const batch=await materialBatch(this.workspace,id);if(batch.state!=='completed'||batch.command.recordId!==value.recordId||batch.finalization.segmentId!==value.id||!same(batch.finalization.inputsIndex,value.inputsIndex))damaged();}
  return value;
 }
 async write(value){
  this.validate(value,value.batchId);const file=this.file(value.batchId),prior=await this.json(file);
  if(prior!==null){if(!same(prior,value))damaged();return false;}
  if(await this.workspace.readMetadata('.observanda/materials/objects/'+value.id+'/head.json',8192)!==null)damaged();
  await this.workspace.writeMetadata(file,JSON.stringify(value));
  const pointer={id:value.id,createdAt:value.createdAt,batchId:value.batchId};
  for(const owner of [null,value.recordId])for(const kind of this.buckets(value)){
   const feed=this.feed(owner,kind),key=feed.order+'/'+feed.key(pointer);
   if(await this.workspace.readMetadata(key,8192)!==null)damaged();
   await this.workspace.writeMetadata(key,JSON.stringify(pointer));await this.workspace.writeMetadata(feed.marker,JSON.stringify({version:1}));
  }
  return true;
 }
 async publish({id,segmentId,recordId,createdAt,inputsIndex}){return this.write({version:1,id:segmentId,batchId:id,recordId,createdAt,inputsIndex});}
 async publishTransfer({id,segmentId,recordId,createdAt,sequences}){
  const receipt=await materialOwnerTransfer(this.workspace,id,recordId);if(!['copying','verified','activating','complete'].includes(receipt.phase))damaged();
  const value={version:2,id:segmentId,batchId:id,recordId,createdAt,ownerTransfer:id,inputsIndex:sequences?.all,sequences};if(!this.transferMatches(value,receipt))damaged();return this.write(value);
 }
 async retired(id){
  if(!researchId(id))damaged();const value=await this.json(root+'/retired/'+id+'.json');if(value===null)return materialReturnedRetired(this.workspace,id,null);
  const item=value.item;if(value.version!==1||!item||item.id!==id||!kinds.includes(item.kind)||!researchId(item.recordId)||!researchId(materialSegmentOwner(item))||item.ownerTransfer!==undefined&&item.stagedBatch!==undefined||item.stagedBatch!==undefined&&item.kind!=='artifact'||!Number.isFinite(Date.parse(item.createdAt)))damaged();return materialReturnedRetired(this.workspace,id,item);
 }
 async retire(item){
  if(!kinds.includes(item.kind)||!researchId(materialSegmentOwner(item)))damaged();
  const file=root+'/retired/'+item.id+'.json',prior=await this.retired(item.id);if(prior!==null&&!same(prior,item))damaged();await this.workspace.writeMetadata(file,JSON.stringify({version:1,item}));
 }
 async restore(item){const prior=await this.retired(item.id);if(prior===null)return;if(!same(prior,item))damaged();await this.workspace.removeMetadata(root+'/retired/'+item.id+'.json');}
 inherited(segment,ref){return materialInheritedSegment(this.workspace,segment,ref);}
 async item(segment,ref){
  if(!ref||!kinds.includes(ref.kind)||!researchId(ref.id)||!revisionId(ref.revision)||segment.version===1&&ref.kind!=='artifact')damaged();
  if(await this.inherited(segment,ref))return null;
  const matches=head=>head.kind===ref.kind&&head.recordId===segment.recordId&&(segment.version===2?head.ownerTransfer===segment.batchId&&head.stagedBatch===undefined:head.stagedBatch===segment.batchId&&head.ownerTransfer===undefined);
  const head=await this.materials.current(ref.id);if(head){if(!matches(head))damaged();return head;}
  const retired=await this.retired(ref.id);if(!retired||!matches(retired))damaged();return null;
 }
 async *entries(){for await(const name of this.workspace.metadataNames(root+'/batches')){if(!/^[a-f0-9-]{36}\.json$/.test(name))damaged();yield await this.read(name.slice(0,-5));}}
}
