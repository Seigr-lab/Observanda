import {materialReference} from './web/material-reference.js';
// Resumable reference intake. Each accepted batch and its receipt commit with
// the draft root; completion attaches one immutable collection or analysis.
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {MetadataFeed} from './metadata-feed.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validAnalysisMethod,analysisMethodReferences} from './web/analysis-model.js';
const root='.observanda/materials/drafts';
const fail=code=>{throw new AppError(code??'MATERIAL_INVALID');};
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const required=(v,max)=>text(v,max)&&v.trim();
const hash=v=>digest(serialize(v));
const empty=()=>({format:1,kind:'references',root:null,count:0,chunkSize:64});
const normalized=refs=>refs.map(materialReference);
export class MaterialDrafts{
 constructor(materials){this.materials=materials;this.workspace=materials.workspace;}
 file(id){if(!researchId(id))fail();return root+'/'+id+'/draft.json';}
 feed(recordId){if(!researchId(recordId))fail();return new MetadataFeed(this.workspace,root+'/by-record/'+recordId);}
 validate(command){
  const {kind,recordId,title,totals,id,expectedRevision=null}=command;
  if(!['collection','analysis'].includes(kind)||!researchId(recordId)||!required(title,300)||!researchId(id)||expectedRevision!==null&&!revisionId(expectedRevision)||
   !totals||!['inputs','outputs'].every(k=>Number.isSafeInteger(totals[k])&&totals[k]>=0)||kind==='collection'&&totals.outputs!==0||kind==='analysis'&&(!totals.inputs||!required(command.tool,200)||!required(command.version,200)||!text(command.parameters,20000)))fail();
  if(command.method!==undefined&&(kind!=='analysis'||!validAnalysisMethod(command.method)))fail('ANALYSIS_INVALID');
  if(Buffer.byteLength(JSON.stringify(command))>100000)fail('ANALYSIS_LIMIT');
 }
 async read(id){
  const raw=await this.workspace.readMetadata(this.file(id),131072);if(raw===null)fail('NOT_FOUND');
  let draft;try{draft=JSON.parse(raw);}catch{fail('CATALOGUE_DAMAGED');}
  if(!draft||draft.format!==1||draft.draftId!==id||!draft.command||!['open','completed','cancelled'].includes(draft.state)||hash(draft.command)!==draft.intent)fail('CATALOGUE_DAMAGED');
  try{this.validate(draft.command);}catch{fail('CATALOGUE_DAMAGED');}
  for(const slot of ['inputs','outputs']){this.materials.sequences.validate(draft[slot]);if(draft[slot].kind!=='references'||draft[slot].count>draft.command.totals[slot])fail('CATALOGUE_DAMAGED');}
  if(draft.state==='completed'){
   if(draft.result?.kind!==draft.command.kind||draft.result?.id!==draft.command.id||!revisionId(draft.result?.revision)||['inputs','outputs'].some(slot=>draft[slot].count!==draft.command.totals[slot]))fail('CATALOGUE_DAMAGED');
  }else if(draft.result!==null)fail('CATALOGUE_DAMAGED');
  return draft;
 }
 summary(draft,{details=false}={}){return {id:draft.draftId,kind:draft.command.kind,recordId:draft.command.recordId,title:draft.command.title,state:draft.state,
  totals:draft.command.totals,received:{inputs:draft.inputs.count,outputs:draft.outputs.count},result:draft.result,createdAt:draft.createdAt,
  ...(details&&draft.command.kind==='analysis'?{method:{tool:draft.command.tool,version:draft.command.version,parameters:draft.command.parameters}}:{})};}
 async authorized(id){const draft=await this.read(id);await this.materials.assertOwner(draft.command.recordId);return draft;}
 async start({draftId=randomUUID(),...input}){
  const command={kind:input.kind,recordId:input.recordId,title:input.title,id:input.id??draftId,expectedRevision:input.expectedRevision??null,totals:{inputs:input.totals?.inputs,outputs:input.totals?.outputs},
   ...(input.kind==='analysis'?{tool:input.tool,version:input.version,parameters:input.parameters,...(input.method?{method:input.method}:{})}: {})};
  this.validate(command);const file=this.file(draftId),intent=hash(command);
  return this.workspace.withLock(async()=>{
   await this.materials.assertOwner(command.recordId);
   if(command.method)for(const ref of analysisMethodReferences(command.method))await this.materials.checkReference(ref);
   if(await this.workspace.readMetadata(file,131072)!==null){const prior=await this.read(draftId);if(prior.intent!==intent)fail('MATERIAL_CHANGED');return this.summary(prior);}
   const current=await this.materials.current(command.id);
   if((current?.revision??null)!==command.expectedRevision||current&&(current.kind!==command.kind||current.recordId!==command.recordId))fail('MATERIAL_CHANGED');
   const draft={format:1,draftId,command,intent,state:'open',inputs:empty(),outputs:empty(),result:null,createdAt:new Date().toISOString()};
   await this.workspace.writeMetadata(file,JSON.stringify(draft));
   const feed=this.feed(command.recordId);await feed.putLocked({id:draftId,createdAt:draft.createdAt});await this.workspace.writeMetadata(feed.marker,JSON.stringify({version:1}));
   return this.summary(draft);
  });
 }
 async receipt(draft,slot,offset,raw){
  raw??=await this.workspace.readMetadata(root+'/'+draft.draftId+'/accepted/'+slot+'/'+offset+'.json',1024);
  let value;try{value=JSON.parse(raw);}catch{fail('CATALOGUE_DAMAGED');}
  if(!value||!revisionId(value.hash)||!Number.isSafeInteger(value.count)||value.count<1||value.count>64||offset+value.count>draft[slot].count)fail('CATALOGUE_DAMAGED');
  const page=await this.materials.sequences.page(draft[slot],{offset,limit:value.count});
  if(hash(page.items)!==value.hash)fail('CATALOGUE_DAMAGED');return value;
 }
 async append({id,slot='inputs',offset,items}){
  if(!['inputs','outputs'].includes(slot)||!Number.isSafeInteger(offset)||offset<0||!Array.isArray(items)||!items.length||items.length>64)fail();
  this.materials.referenceSet({inputs:items});
  if(slot==='outputs'&&items.some(r=>r.kind!=='artifact'))fail();
  const refs=normalized(items),batchHash=hash(refs),receipt=root+'/'+id+'/accepted/'+slot+'/'+offset+'.json';
  return this.workspace.withLock(async()=>{
   const draft=await this.authorized(id);
   const previous=await this.workspace.readMetadata(receipt,1024);
   if(previous!==null){
    const saved=await this.receipt(draft,slot,offset,previous);
    for(const item of items)await this.materials.checkReference(item);
    // Older accepted batches omitted a validated local namespace. Preserve
    // their receipts; only that exact unqualified batch can use this fallback.
    const legacy=items.map(({kind,id,revision})=>({kind,id,revision}));
    if(saved.count!==items.length)fail('MATERIAL_CHANGED');
    if(saved.hash!==batchHash){
     if(saved.hash!==hash(legacy))fail('MATERIAL_CHANGED');
     for(const item of items)await this.materials.assertReferenceWorkspace(item);
    }
    return this.summary(draft);
   }
   if(draft.state!=='open'||offset!==draft[slot].count||offset+items.length>draft.command.totals[slot])fail('MATERIAL_CHANGED');
   for(const [i,ref] of refs.entries()){
    // Validate supplied workspace identities before retaining the normalized ref.
    await this.materials.checkReference(items[i]);
    const seen=root+'/'+id+'/members/'+slot+'/'+hash(ref)+'.json';
    if(await this.workspace.readMetadata(seen,128)!==null)fail('MATERIAL_DUPLICATE');
    await this.workspace.writeMetadata(seen,JSON.stringify({offset:offset+i}));
   }
   draft[slot]=await this.materials.sequences.append(draft[slot],refs);
   await this.workspace.writeMetadata(receipt,JSON.stringify({hash:batchHash,count:items.length}));
   await this.workspace.writeMetadata(this.file(id),JSON.stringify(draft));
   return this.summary(draft);
  });
 }
 async page({id,slot='inputs',offset=0,limit=20}){
  if(!['inputs','outputs'].includes(slot)||!Number.isSafeInteger(limit)||limit<1||limit>50)fail();
  return this.materials.readSnapshot(async()=>{const draft=await this.authorized(id);return this.materials.describeReferences(await this.materials.sequences.page(draft[slot],{offset,limit}));});
 }
 async finish(id){
  return this.workspace.withLock(async()=>{
   const draft=await this.authorized(id);if(draft.state==='completed')return draft.result;
   if(draft.state!=='open'||['inputs','outputs'].some(k=>draft[k].count!==draft.command.totals[k]))fail('MATERIAL_DRAFT_INCOMPLETE');
   const {kind,recordId,title,id:materialId,expectedRevision,tool,version,parameters}=draft.command;
   const method=draft.command.method;if(method)for(const ref of analysisMethodReferences(method))await this.materials.checkReference(ref);
   const content={inputsIndex:draft.inputs,...(kind==='analysis'?{outputsIndex:draft.outputs,tool,version,parameters,...(method?{method}:{})}: {})};
   draft.result=await this.materials.commit({kind,recordId,title,id:materialId,expectedRevision,content});draft.state='completed';
   await this.workspace.writeMetadata(this.file(id),JSON.stringify(draft));await this.unlist(draft);return draft.result;
  });
 }
 async unlist(draft){const feed=this.feed(draft.command.recordId);await this.workspace.removeMetadata(feed.order+'/'+feed.key({id:draft.draftId,createdAt:draft.createdAt}));}
 async cancel(id){return this.workspace.withLock(async()=>{const draft=await this.authorized(id);if(draft.state==='open'){draft.state='cancelled';await this.workspace.writeMetadata(this.file(id),JSON.stringify(draft));await this.unlist(draft);}return this.summary(draft);});}
 async verify(check){
  for await(const id of this.workspace.metadataNames(root)){
   if(!researchId(id))continue;const draft=await this.read(id);
   if(draft.command.method)for(const ref of analysisMethodReferences(draft.command.method))await check(ref);
   for(const slot of ['inputs','outputs']){let offset=0;
    for await(const ref of this.materials.sequences.items(draft[slot])){
     await check(ref);
     const raw=await this.workspace.readMetadata(root+'/'+id+'/members/'+slot+'/'+hash(ref)+'.json',128);
     let member;try{member=JSON.parse(raw);}catch{fail('CATALOGUE_DAMAGED');}
     if(member?.offset!==offset++)fail('CATALOGUE_DAMAGED');
    }
    if(offset!==draft[slot].count)fail('CATALOGUE_DAMAGED');
    for(let accepted=0;accepted<offset;)accepted+=(await this.receipt(draft,slot,accepted)).count;
   }
   if(draft.state==='completed'){
    await check(draft.result);const doc=await this.materials.read(draft.result),command=draft.command;
    if(doc.recordId!==command.recordId||doc.title!==command.title||doc.previous!==command.expectedRevision||hash(doc.content.inputsIndex)!==hash(draft.inputs)||
     command.kind==='analysis'&&(hash(doc.content.outputsIndex)!==hash(draft.outputs)||hash(doc.content.method??null)!==hash(command.method??null)||['tool','version','parameters'].some(key=>doc.content[key]!==command[key])))fail('CATALOGUE_DAMAGED');
   }
   const feed=this.feed(draft.command.recordId),pointer=await this.workspace.readMetadata(feed.order+'/'+feed.key({id,createdAt:draft.createdAt}),1024);
   if((pointer!==null)!==(draft.state==='open'))fail('CATALOGUE_DAMAGED');
   if(pointer!==null){let item;try{item=JSON.parse(pointer);}catch{fail('CATALOGUE_DAMAGED');}
    if(item.id!==id||item.createdAt!==draft.createdAt||!await feed.initialized())fail('CATALOGUE_DAMAGED');}
  }
 }
 async list(recordId,options={}){
  return this.materials.readSnapshot(async()=>{
  await this.materials.assertOwner(recordId);const feed=this.feed(recordId);
  // The feed is written atomically with every new draft, so absence means empty.
  if(!await feed.initialized())return {items:[],next:null};
  const page=await feed.page(options),items=[];
  for(const pointer of page.items){const draft=await this.read(pointer.id);if(draft.state!=='open'||draft.command.recordId!==recordId)fail('CATALOGUE_DAMAGED');items.push(this.summary(draft));}
  return {...page,items};
  });
 }
}
