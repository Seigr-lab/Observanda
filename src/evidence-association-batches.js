// Resumable attachment of an immutable selection. Each bounded transaction
// publishes record associations and its receipt together; no original is copied.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {researchId} from './web/research-reference.js';
import {MetadataFeed} from './metadata-feed.js';
import {revisionText} from './web/revision-model.js';
import {validIndexRef} from './object-index.js';
import {associateOriginalLocked} from './evidence-associations.js';
const root='.observanda/materials/associations';
const fail=(code='MATERIAL_INVALID')=>{throw new AppError(code);};
const empty=()=>({format:1,kind:'references',root:null,count:0,chunkSize:64});
export class EvidenceAssociationBatches{
 constructor(materials){this.materials=materials;this.workspace=materials.workspace;}
 file(id){if(!researchId(id))fail();return root+'/'+id+'.json';}
 feed(recordId){if(!researchId(recordId))fail();return new MetadataFeed(this.workspace,root+'/by-record/'+recordId);}
 summary(batch){return {id:batch.id,recordId:batch.recordId,count:batch.count,attached:batch.results.count,state:batch.state,createdAt:batch.createdAt};}
 async read(id){
  const raw=await this.workspace.readMetadata(this.file(id),16384);if(raw===null)fail('NOT_FOUND');
  let batch;try{batch=JSON.parse(raw);}catch{fail('CATALOGUE_DAMAGED');}
  if(!batch||batch.format!==1||batch.id!==id||!researchId(batch.recordId)||!batch.selection||typeof batch.selection.scope!=='string'||!validIndexRef(batch.selection.root)||
   !Number.isSafeInteger(batch.count)||batch.count<1||!['open','completed','cancelled'].includes(batch.state))fail('CATALOGUE_DAMAGED');
  this.materials.sequences.validate(batch.results);
  if(batch.results.kind!=='references'||batch.results.count>batch.count||(batch.results.count===batch.count)!==(batch.state==='completed'))fail('CATALOGUE_DAMAGED');
  this.feed(batch.recordId).key(batch);return batch;
 }
 async authorized(id){const batch=await this.read(id);await this.materials.assertOwner(batch.recordId);return batch;}
 async selection(batch,offset=0){
  const scope=JSON.parse(batch.selection.scope);if(scope.recordId!==batch.recordId||scope.kind!=='artifact')fail('CATALOGUE_DAMAGED');
  const page=await this.materials.choices.pagePinned(batch.selection,{offset,limit:32});
  if(page.count!==batch.count)fail('MATERIAL_CHANGED');return page;
 }
 async start({id=randomUUID(),recordId,selection,count}){
  if(!researchId(recordId)||typeof selection!=='string'||!Number.isSafeInteger(count)||count<1)fail();
  const file=this.file(id);
  return this.workspace.withLock(async()=>{
   await this.materials.assertOwner(recordId);
   const input={recordId,selection:await this.materials.choices.pin({recordId,kind:'artifact',selection}),count};await this.selection(input);
   if(await this.workspace.readMetadata(file,16384)!==null){
    const previous=await this.read(id);
    if(['recordId','selection','count'].some(key=>revisionText(previous[key])!==revisionText(input[key])))fail('MATERIAL_CHANGED');return this.summary(previous);
   }
   const batch={format:1,id,...input,results:empty(),state:'open',createdAt:new Date().toISOString()};
   await this.workspace.writeMetadata(file,JSON.stringify(batch));
   const feed=this.feed(recordId);await feed.putLocked(batch);await this.workspace.writeMetadata(feed.marker,JSON.stringify({version:1}));
   return this.summary(batch);
  });
 }
 async step(id){
  return this.workspace.withLock(async()=>{
   const batch=await this.authorized(id);if(batch.state!=='open')return this.summary(batch);
   const page=await this.selection(batch,batch.results.count),results=[];
   for(const ref of page.items)results.push(await associateOriginalLocked(this.materials,{recordId:batch.recordId,ref}));
   batch.results=await this.materials.sequences.append(batch.results,results);
   if(batch.results.count===batch.count)batch.state='completed';
   await this.workspace.writeMetadata(this.file(id),JSON.stringify(batch));
   if(batch.state==='completed')await this.unlist(batch);return this.summary(batch);
  });
 }
 async unlist(batch){const feed=this.feed(batch.recordId);await this.workspace.removeMetadata(feed.order+'/'+feed.key(batch));}
 async cancel(id){return this.workspace.withLock(async()=>{
  const batch=await this.authorized(id);if(batch.state==='open'){batch.state='cancelled';await this.workspace.writeMetadata(this.file(id),JSON.stringify(batch));await this.unlist(batch);}return this.summary(batch);
 });}
 async list({recordId,...options}){return this.materials.readSnapshot(async()=>{
  await this.materials.assertOwner(recordId);const feed=this.feed(recordId);if(!await feed.initialized())return {items:[],next:null};
  const page=await feed.page(options),items=[];
  for(const pointer of page.items){const batch=await this.read(pointer.id);if(batch.state!=='open'||batch.recordId!==recordId)fail('CATALOGUE_DAMAGED');items.push(this.summary(batch));}
  return {...page,items};
 });}
 async verify(check){
  for await(const name of this.workspace.metadataNames(root)){
   if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;
   const batch=await this.read(name.slice(0,-5));
   for(let offset=0;offset<batch.count;offset+=32){
    const page=await this.selection(batch,offset);
    for(const ref of page.items)await check(ref);
    if(offset>=batch.results.count)continue;
    const results=await this.materials.sequences.page(batch.results,{offset,limit:Math.min(32,batch.results.count-offset)});
    for(const [i,ref] of results.items.entries()){
     await check(ref);const doc=await this.materials.read(ref),source=page.items[i];
     if(doc.recordId!==batch.recordId||ref.kind!=='artifact'||
      !(ref.id===source.id&&ref.revision===source.revision)&&
      !(doc.content.inputs?.length===1&&doc.content.inputs[0].id===source.id&&doc.content.inputs[0].revision===source.revision))fail('CATALOGUE_DAMAGED');
    }
   }
   const feed=this.feed(batch.recordId),pointer=await this.workspace.readMetadata(feed.order+'/'+feed.key(batch),1024);
   if((pointer!==null)!==(batch.state==='open'))fail('CATALOGUE_DAMAGED');
   if(pointer!==null){const item=JSON.parse(pointer);if(item.id!==batch.id||item.createdAt!==batch.createdAt||!await feed.initialized())fail('CATALOGUE_DAMAGED');}
  }
 }
}
