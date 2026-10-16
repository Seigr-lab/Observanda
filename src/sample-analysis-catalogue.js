// Immutable encrypted sample-analysis records and summaries. A small head pins
// their indexes; a command updates one record and appends one event atomically.
import {ObjectIndex,validIndexRef} from './object-index.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {blank,validateLab,validateSampleAnalysisEvent,applySampleAnalysisCommand} from './sample-analysis-model.js';
import {randomUUID} from 'node:crypto';
import {operationAdvance} from './operation-progress.js';
const hash=value=>digest(serialize(value));
const fail=()=>{throw new AppError('LAB_INVALID');};
const pad=value=>String(value).padStart(5,'0');
const countKeys=['samples','analyses','review','archive','approved','events'];
const empty=()=>({formatVersion:2,revision:0,root:null,counts:Object.fromEntries(countKeys.map(k=>[k,0])),bytes:{samples:0,analyses:0,events:0},lastEventHash:''});
// Size of an item in the unchanged, human-readable v1 representation, including
// its indentation but excluding the array separator. No growing serialization.
const itemBytes=value=>Buffer.byteLength(JSON.stringify(value,null,2).split('\n').map(line=>'    '+line).join('\n'));
function logicalBytes(head){
 let size=Buffer.byteLength(serialize({...blank(),revision:head.revision}));
 for(const kind of ['samples','analyses','events']){const count=kind==='analyses'?head.counts.analyses+head.counts.archive:head.counts[kind];if(count)size+=head.bytes[kind]+2*(count-1)+4;}
 return size;
}
function validHead(head){
 if(!head||Object.keys(head).sort().join()!=='bytes,counts,formatVersion,lastEventHash,revision,root')fail();
 if(!head||head.formatVersion!==2||!Number.isSafeInteger(head.revision)||head.revision<0||!validIndexRef(head.root)||!head.counts||Object.keys(head.counts).sort().join()!==[...countKeys].sort().join()||Object.values(head.counts).some(v=>!Number.isSafeInteger(v)||v<0)||!head.bytes||Object.keys(head.bytes).sort().join()!=='analyses,events,samples'||Object.values(head.bytes).some(v=>!Number.isSafeInteger(v)||v<0)||typeof head.lastEventHash!=='string'||(head.counts.events?!/^[a-f0-9]{64}$/.test(head.lastEventHash):head.lastEventHash!==''))fail();
 if(head.counts.samples>5000||head.counts.analyses+head.counts.archive>10000||head.counts.events>50000||head.counts.review+head.counts.approved>head.counts.analyses)fail();
 if(logicalBytes(head)>16*1024*1024)throw new AppError('LIMIT');return head;
}
export class SampleAnalysisCatalogue{
 constructor(store){this.store=store;this.index=new ObjectIndex(store,{namespace:'sample-analysis-index:',immutable:true});}
 async source(etag=null,{retained=true}={}){
  let value=await this.store.object('laboratory'),current=value?hash(value):'new';
  if(etag!==null&&etag!==current){
   if(!retained)throw new AppError('LAB_STALE');
   if(etag==='new')return {head:empty(),etag:'new'};
   value=await this.store.object('laboratory-history/'+etag);if(!value)throw new AppError('NOT_FOUND');if(hash(value)!==etag)fail();current=etag;
  }
  if(value&&value.formatVersion!==2)return null;
  return {head:value?validHead(value):empty(),etag:current};
 }
 async retain(value){
  const revision=hash(value),slot='sample-analysis-value:'+revision,row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);
  if(row){if(hash(this.store.decode('state',slot,row.payload))!==revision)fail();}
  else await this.store.db.run('INSERT INTO state VALUES ($1,$2)',slot,this.store.encode('state',slot,value));return revision;
 }
 async value(revision){
  const slot='sample-analysis-value:'+revision,row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot),value=this.store.decode('state',slot,row?.payload);
  if(hash(value)!==revision)fail();return value;
 }
 async member(head,kind,id){
  const entry=await this.index.find(head,kind+':'+id);if(!entry)return null;const member=await this.value(entry.revision);
  if(member.kind!==kind||member.id!==id||!Number.isSafeInteger(member.position)||member.position<0)fail();return member;
 }
 async range(head,prefix){const lower=await this.index.rank(head,prefix),upper=await this.index.rank(head,prefix+'\uffff');return {lower,upper,total:upper-lower};}
 async selected(source,kind,id){
  const member=await this.member(source.head,kind,id);if(!member)throw new AppError('NOT_FOUND');
  const record=await this.value(member.revision),sample=kind==='analysis'?await this.member(source.head,'sample',record.sampleId):null;
  const original=sample?await this.value(sample.revision):null;
  validateLab({...blank(),samples:kind==='sample'?[record]:original?[original]:[],analyses:kind==='analysis'?[record]:[]});
  if(record.id!==id)fail();return {record,revision:member.revision,...(original?{sample:original}:{})};
 }
 keys(member){
  const {kind,id,position,summary:s}=member,order=pad(position)+':'+id;
  if(kind==='event')return ['list:events:'+order,'record-events:'+s.recordId+':'+order];
  const keys=[kind+':'+id,'code:'+kind+':'+digest(s.code.toLowerCase()),'list:'+(kind==='sample'?'samples':'all')+':'+order];
  if(kind==='analysis'){
   keys.push('sample-analyses:'+s.sampleId+':'+order,'list:'+(s.status==='archived'?'archive':'analyses')+':'+order);
   if(s.status==='in review')keys.push('list:review:'+order);
  }
  return keys;
 }
 async put(head,member,before=null){
  const keys=this.keys(member),revision=await this.retain(member);
  for(const key of before?this.keys(before):[])if(!keys.includes(key))head.root=await this.index.change(head.root,key,null);
  for(const key of keys)head.root=await this.index.change(head.root,key,revision);
 }
 describe(kind,record,position,sample=null){
  let summary=record;
  if(kind==='analysis'){const {notes,...result}=record.result;void notes;summary={id:record.id,code:record.code,sampleId:record.sampleId,sampleCode:sample.code,status:record.status,updatedAt:record.updatedAt,result};}
  if(kind==='event'){const {hash,previous,...rest}=record;void hash;void previous;summary=rest;}
  return {kind,id:record.id,position,revision:hash(record),summary};
 }
 count(head,record,delta){
  if(!record)return;
  head.counts[record.status==='archived'?'archive':'analyses']+=delta;
  if(record.status==='in review')head.counts.review+=delta;
  if(record.status==='approved')head.counts.approved+=delta;
 }
 async change(source,command){
  const {expectedRecordRevision,...data}=command,head=structuredClone(source.head),kind=data.action==='create-sample'?'sample':'analysis',create=['create-sample','create-analysis'].includes(data.action);
  const before=create?null:await this.member(head,kind,data.id);
  if(expectedRecordRevision!==undefined){if(!before||before.revision!==expectedRecordRevision)throw new AppError('LAB_STALE');}
  else if(data.etag!==source.etag)throw new AppError('LAB_STALE');
  const existing=before?await this.value(before.revision):null,sampleId=data.analysis?.sampleId??existing?.sampleId;
  const sourceSample=sampleId?await this.selected(source,'sample',sampleId):null;
  const now=new Date().toISOString(),{record,actor,reason}=applySampleAnalysisCommand(data,{existing,sourceSample:sourceSample?.record,now});
  if(create&&await this.index.find(head,'code:'+kind+':'+digest(record.code.toLowerCase())))fail();
  const event={id:randomUUID(),at:now,action:data.action,recordId:record.id,actor,reason,previous:head.lastEventHash};event.hash=hash(event);
  const group=kind==='sample'?'samples':'analyses',position=before?.position??(kind==='sample'?head.counts.samples:head.counts.analyses+head.counts.archive);
  if(kind==='sample')head.counts.samples++;else{this.count(head,existing,-1);this.count(head,record,1);}
  head.bytes[group]+=itemBytes(record)-(existing?itemBytes(existing):0);head.bytes.events+=itemBytes(event);head.counts.events++;head.revision++;head.lastEventHash=event.hash;
  // Validate capacity before attempting any persistent write.
  validHead(head);
  await this.retain(record);await this.put(head,this.describe(kind,record,position,sourceSample?.record),before);
  await this.retain(event);await this.put(head,this.describe('event',event,head.counts.events-1));await this.index.flush(head.root);
  if(source.etag!=='new')await this.store.putObject('laboratory-history/'+source.etag,source.head);
  await this.store.putObject('laboratory',head);
  return {etag:hash(head),selectedId:record.id,recordRevision:hash(record)};
 }
 async summary(head,member){
  const row=member.summary;
  return member.kind==='sample'?{...row,analyses:(await this.range(head,'sample-analyses:'+row.id+':')).total}:row;
 }
 async query(source,{view,search,sampleId,recordId,key,offset,limit,signal,collect}){
  const {head}=source,kind=view==='samples'?'sample':view==='events'?'event':'analysis';
  const prefix=view==='events'&&recordId?'record-events:'+recordId+':':kind==='analysis'&&sampleId?'sample-analyses:'+sampleId+':':'list:'+view+':';
  const range=await this.range(head,prefix),needle=search.trim().toLocaleLowerCase('en'),items=[];
  const filter=!!(needle||key||recordId&&view!=='events'||sampleId&&kind!=='analysis'||sampleId&&kind==='analysis'&&view!=='all');let total=filter?0:range.total;
  const owner=this;
  async function* members(){
   if(key){const member=await owner.member(head,kind,key);if(member)yield member;return;}
   if(collect||filter){for await(const entry of owner.index.entries(head,prefix)){const member=await owner.value(entry.revision);if(!owner.keys(member).includes(entry.id))fail();yield member;}return;}
   for(let at=range.lower+offset;at<Math.min(range.upper,range.lower+offset+limit);at++){
    const entry=await owner.index.entryAt(head,at),member=await owner.value(entry.revision);if(!owner.keys(member).includes(entry.id))fail();yield member;
   }
  }
  for await(const member of members()){
   signal?.throwIfAborted();const row=member.summary;if(member.kind!==kind)fail();
   if(key&&row.id!==key||recordId&&(kind==='event'?row.recordId:row.id)!==recordId||sampleId&&(kind==='sample'?row.id:row.sampleId)!==sampleId)continue;
   if(kind==='analysis'&&view!=='all'&&(view==='archive'?row.status!=='archived':row.status==='archived')||view==='review'&&row.status!=='in review')continue;
   const fields=kind==='sample'?[row.code,row.material,row.source]:kind==='event'?[row.action,row.actor,row.reason]:[row.code,row.result.analyte,row.sampleCode];
   if(needle&&!fields.join(' ').toLocaleLowerCase('en').includes(needle))continue;
   if(collect){if(filter)total++;await collect(row);continue;}
   if(filter&&total++<offset||items.length===limit)continue;
   items.push(await this.summary(head,member));
  }
  return {items,total,counts:head.counts};
 }
 async assemble(source){
  const lab={...blank(),revision:source.head.revision};
  for(const [field,view] of [['samples','samples'],['analyses','all'],['events','events']])for await(const entry of this.index.entries(source.head,'list:'+view+':')){
   const member=await this.value(entry.revision);if(!this.keys(member).includes(entry.id))fail();lab[field].push(await this.value(member.revision));
  }
  validateLab(lab);
  if(lab.samples.length!==source.head.counts.samples||lab.analyses.length!==source.head.counts.analyses+source.head.counts.archive||lab.events.length!==source.head.counts.events||Buffer.byteLength(serialize(lab))!==logicalBytes(source.head)||(lab.events.at(-1)?.hash??'')!==source.head.lastEventHash)fail();return lab;
 }
 // Complete integrity qualification belongs to backup/audit, not every edit.
 async verify(source){
  const head=validHead(source.head),actual=empty();actual.revision=head.revision;let previous='',entries=0;
  for(const [kind,view] of [['sample','samples'],['analysis','all'],['event','events']]){
   let position=0;
   for await(const entry of this.index.entries(head,'list:'+view+':')){
    const member=await this.value(entry.revision),record=await this.value(member.revision);if(member.position!==position++||member.id!==record.id||member.kind!==kind)fail();
    const sample=kind==='analysis'?await this.selected(source,'sample',record.sampleId):null;
    if(hash(this.describe(kind,record,member.position,sample?.record))!==entry.revision)fail();
    if(kind==='sample'){validateLab({...blank(),samples:[record]});actual.counts.samples++;actual.bytes.samples+=itemBytes(record);}
    else if(kind==='analysis'){validateLab({...blank(),samples:[sample.record],analyses:[record]});this.count(actual,record,1);actual.bytes.analyses+=itemBytes(record);}
    else{validateSampleAnalysisEvent(record,previous);if(!await this.member(head,'sample',record.recordId)&&!await this.member(head,'analysis',record.recordId))fail();previous=record.hash;actual.counts.events++;actual.bytes.events+=itemBytes(record);}
    for(const key of this.keys(member)){if((await this.index.find(head,key))?.revision!==entry.revision)fail();entries++;}
   }
  }
  if(entries!==(head.root?.count??0)||hash(actual.counts)!==hash(head.counts)||hash(actual.bytes)!==hash(head.bytes)||previous!==head.lastEventHash)fail();
  for await(const entry of this.index.entries(head)){const member=await this.value(entry.revision);if(!this.keys(member).includes(entry.id))fail();}
 }
}
export async function verifySampleAnalysisCatalogue(store){
 const owner=new SampleAnalysisCatalogue(store);
 const check=async(value)=>{if(value.formatVersion===2)await owner.verify({head:value,etag:hash(value)});else validateLab(value);operationAdvance();};
 const current=await store.object('laboratory');if(current)await check(current);
 for await(const id of store.objectIdEntries('laboratory-history/')){
  const value=await store.object(id);if(!value||id!=='laboratory-history/'+hash(value))fail();await check(value);
 }
}
