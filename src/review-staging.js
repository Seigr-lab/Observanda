// An OS lease distinguishes active uploads from crash leftovers. No age or PID
// heuristic is authority to remove an encrypted review stage.
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {privateDirectory} from './storage.js';
import {withWriterLease,writerLeaseHeld} from './writer-lease.js';
import {ExchangeParts} from './collaboration/exchange-parts.js';
import {requireReviewFigurePackages} from './catalogue-format.js';
import {exact,uuid} from './modules/validation.js';
import {AppError} from './errors.js';
const root='.observanda/reviews/parts';
const damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');};
export const reviewStageFile=id=>root+'/'+id+'/stage.json';
export const reviewStageLease=(workspace,id)=>{if(!uuid(id))throw new AppError('INVALID');return path.join(workspace.root,'.observanda/reviews/leases',id+'.lock');};
export async function readReviewStage(workspace,id){
 const raw=await workspace.readMetadata(reviewStageFile(id),1024);if(raw===null)return null;let value;try{value=JSON.parse(raw);}catch{damaged();}
 if(!exact(value,['version','id','requestId'])||value.version!==1||value.id!==id||!uuid(id)||value.requestId!==null&&!uuid(value.requestId))damaged();return value;
}
export class ReviewStaging{
 constructor(workspace){this.workspace=workspace;}
 parts(id){return new ExchangeParts(this.workspace,id,{scope:'reviews',write:operation=>this.write(operation)});}
 write(operation){return this.workspace.withLock(async()=>{await this.workspace.catalogue(store=>requireReviewFigurePackages(store.db));return operation();});}
 async run(operation,{requestId=null,signal,check}={}){
  if(requestId!==null&&!uuid(requestId))throw new AppError('INVALID');signal?.throwIfAborted();await check?.();
  const id=randomUUID(),parts=this.parts(id);await privateDirectory(this.workspace.root,'.observanda/reviews/leases');
  return withWriterLease(reviewStageLease(this.workspace,id),async()=>{
   await this.write(()=>this.workspace.writeMetadata(reviewStageFile(id),JSON.stringify({version:1,id,requestId})));
   try{return await operation(parts);}finally{await this.discard(parts);}
  },{wait:false});
 }
 async bind(parts,requestId){
  if(!uuid(requestId)||!writerLeaseHeld(reviewStageLease(this.workspace,parts.id)))throw new AppError('INVALID');
  await this.write(async()=>{const stage=await readReviewStage(this.workspace,parts.id);if(!stage||stage.requestId!==null&&stage.requestId!==requestId)damaged();await this.workspace.writeMetadata(reviewStageFile(parts.id),JSON.stringify({...stage,requestId}));});
 }
 // Invoked inside the same final writer which publishes head, packet and index.
 async finish(parts,requestId){
  if(!writerLeaseHeld(reviewStageLease(this.workspace,parts.id)))throw new AppError('LOCKED');const stage=await readReviewStage(this.workspace,parts.id);if(!stage||stage.requestId!==requestId)damaged();await this.workspace.removeMetadata(reviewStageFile(parts.id));
 }
 async uncommitted(parts){
  // Even an invalid finalized head is never permission to erase its payload.
  if(await this.workspace.readMetadata(parts.prefix+'/head.json',8192)!==null)return false;
  const stage=await readReviewStage(this.workspace,parts.id);if(!stage)return false;
  if(stage.requestId!==null){const raw=await this.workspace.readMetadata('.observanda/reviews/'+stage.requestId+'.json',1800000);if(raw!==null){let packet;try{packet=JSON.parse(raw);}catch{damaged();}if(packet?.parts===parts.id)damaged();}}
  return true;
 }
 async discard(parts){
  if(!writerLeaseHeld(reviewStageLease(this.workspace,parts.id)))throw new AppError('LOCKED');
  if(!await this.workspace.withLock(()=>this.uncommitted(parts)))return;
  await parts.discardUncommitted();
  for(;;){const removed=await this.workspace.withLock(async()=>{
   if(!await this.uncommitted(parts))return 0;
   const page=await this.workspace.metadataPage(parts.prefix,{limit:32}),rows=page.items.filter(row=>row.name!=='stage.json');
   for(const row of rows)await this.workspace.removeMetadata(parts.prefix+'/'+row.name);
   if(!rows.length)await this.workspace.removeMetadata(reviewStageFile(parts.id));return rows.length;
  });if(!removed)return;}
 }
 async recover({signal,check}={}){
  for await(const id of this.workspace.metadataNames(root,{signal})){
   signal?.throwIfAborted();await check?.();if(!uuid(id))damaged();if(!await readReviewStage(this.workspace,id))continue;
   await privateDirectory(this.workspace.root,'.observanda/reviews/leases');
   try{await withWriterLease(reviewStageLease(this.workspace,id),()=>this.discard(this.parts(id)),{wait:false});}catch(error){if(error.code!=='LOCKED')throw error;}
  }
 }
}
