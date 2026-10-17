// Published file sets add one pointer to each discovery feed. The immutable
// reference sequence is expanded only while its page is being read.
import {AppError} from './errors.js';
import {MetadataFeed} from './metadata-feed.js';
import {researchId} from './web/research-reference.js';
import {materialBatch} from './material-visibility.js';
const root='.observanda/materials/index';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export class MaterialIndexSegments{
 constructor(materials){this.materials=materials;this.workspace=materials.workspace;}
 feed(recordId=null,kind=null){return new MetadataFeed(this.workspace,root+'/segments/'+(recordId??'all')+'/'+(kind??'all'));}
 async json(file){const raw=await this.workspace.readMetadata(file,8192);if(raw===null)return null;try{return JSON.parse(raw);}catch{damaged();}}
 file(id){if(!researchId(id))damaged();return root+'/batches/'+id+'.json';}
 async read(id){
  const value=await this.json(this.file(id));if(!value||value.version!==1||value.batchId!==id||!researchId(value.id)||!researchId(value.recordId)||!Number.isFinite(Date.parse(value.createdAt)))damaged();
  this.materials.sequences.validate(value.inputsIndex);if(value.inputsIndex.kind!=='references')damaged();
  const batch=await materialBatch(this.workspace,id);
  if(batch.state!=='completed'||batch.command.recordId!==value.recordId||batch.finalization.segmentId!==value.id||JSON.stringify(batch.finalization.inputsIndex)!==JSON.stringify(value.inputsIndex))damaged();
  return value;
 }
 async publish({id,segmentId,recordId,createdAt,inputsIndex}){
  if(!researchId(id)||!researchId(segmentId)||id===segmentId||!researchId(recordId)||!Number.isFinite(Date.parse(createdAt)))damaged();
  this.materials.sequences.validate(inputsIndex);if(inputsIndex.kind!=='references')damaged();
  const value={version:1,id:segmentId,batchId:id,recordId,createdAt,inputsIndex},file=this.file(id),prior=await this.json(file);
  if(prior!==null){if(JSON.stringify(prior)!==JSON.stringify(value))damaged();return false;}
  if(await this.workspace.readMetadata('.observanda/materials/objects/'+segmentId+'/head.json',8192)!==null)damaged();
  await this.workspace.writeMetadata(file,JSON.stringify(value));
  const pointer={id:segmentId,createdAt,batchId:id};
  for(const owner of [null,recordId])for(const kind of [null,'artifact']){
   const feed=this.feed(owner,kind),key=feed.order+'/'+feed.key(pointer);
   if(await this.workspace.readMetadata(key,8192)!==null)damaged();
   await this.workspace.writeMetadata(key,JSON.stringify(pointer));await this.workspace.writeMetadata(feed.marker,JSON.stringify({version:1}));
  }
  return true;
 }
 async retired(id){
  if(!researchId(id))damaged();const value=await this.json(root+'/retired/'+id+'.json');if(value===null)return null;
  const item=value.item;if(value.version!==1||!item||item.id!==id||item.kind!=='artifact'||!researchId(item.recordId)||!researchId(item.stagedBatch)||!Number.isFinite(Date.parse(item.createdAt)))damaged();return item;
 }
 async retire(item){
  if(item.kind!=='artifact'||!researchId(item.stagedBatch))damaged();
  const file=root+'/retired/'+item.id+'.json',prior=await this.retired(item.id);
  if(prior!==null&&JSON.stringify(prior)!==JSON.stringify(item))damaged();
  await this.workspace.writeMetadata(file,JSON.stringify({version:1,item}));
 }
 async restore(item){
  const prior=await this.retired(item.id);if(prior===null)return;
  if(JSON.stringify(prior)!==JSON.stringify(item))damaged();await this.workspace.removeMetadata(root+'/retired/'+item.id+'.json');
 }
 async item(segment,ref){
  if(!ref||ref.kind!=='artifact'||!researchId(ref.id)||typeof ref.revision!=='string'||!/^[a-f0-9]{64}$/.test(ref.revision))damaged();
  const head=await this.materials.current(ref.id);
  if(head){if(head.kind!=='artifact'||head.recordId!==segment.recordId||head.stagedBatch!==segment.batchId)damaged();return head;}
  const retired=await this.retired(ref.id);if(!retired||retired.recordId!==segment.recordId||retired.stagedBatch!==segment.batchId)damaged();return null;
 }
 async *entries(){for await(const name of this.workspace.metadataNames(root+'/batches')){if(!/^[a-f0-9-]{36}\.json$/.test(name))damaged();yield await this.read(name.slice(0,-5));}}
}
