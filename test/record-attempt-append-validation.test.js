import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {RecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordAttemptIndex} from '../src/record-attempt-index.js';
import {validateAttemptDocument,validateAttemptDocumentChange,attemptGroups} from '../src/record-attempt-document.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {digest,serialize} from '../src/storage-format.js';
import {validAttempt,emptyAttempt} from '../src/web/attempt-model.js';
import {attemptFixture,preparation,event,assessment} from './fixtures/attempts.js';

async function fixture(attempt=attemptFixture()){
 assert.ok(validAttempt(attempt));const nodes=new Map(),blocks={reads:0,
  async put(kind,value){const encoded=serialize(value),revision=digest(encoded);nodes.set(kind+':'+revision,encoded);return revision;},
  async read(kind,revision){this.reads++;return JSON.parse(nodes.get(kind+':'+revision));},tree(){return new RecordValueTree(this);}};
 const root=await blocks.tree().retain({attempt}),source=new RecordDocument(blocks,root),attemptIndex=await RecordAttemptIndex.retain(source);
 return {attempt,blocks,document:new RecordDocument(blocks,root,{mutable:true,attemptIndex})};
}
async function append(document,values){
 for(const group of attemptGroups)if(values[group]?.length)document=await document.splice(['attempt',group],await document.tree.arrayLength(document.root,['attempt',group]),0,values[group]);
 return document;
}

test('append validation and source admission read new facts and selected context without walking earlier history',async t=>{
 for(const count of [19,95,251]){
  const p=preparation(),attempt={...emptyAttempt(),preparations:[p],events:Array.from({length:count},()=>event(p)),assessments:[assessment(p)]},f=await fixture(attempt);
  const q={...preparation(),supersedes:p.id,reason:'New inputs'},last=attempt.events.at(-1),next=await append(f.document,{preparations:[q],events:[event(q),{...last,id:randomUUID(),supersedes:last.id,reason:'Corrected acquisition'}],assessments:[assessment(q)]});
  const base=next.attemptAppendBase(),items=next.items,read=next.tree.read,oldFacts=new Set();
  for(const group of ['events','assessments'])for await(const item of f.document.items(['attempt',group]))oldFacts.add(item.value);
  next.items=async function*(path,options){assert.equal(options.offset,base[path[1]],'Validation traversed earlier facts');yield* items.call(this,path,options);};
  next.tree.read=async function(ref){assert.equal(oldFacts.has(ref),false,'Validation assembled an old event or assessment');return read.call(this,ref);};
  f.blocks.reads=0;await validateAttemptDocument(next);await validateAttemptDocumentChange({},randomUUID(),f.document,next,randomUUID(),{validated:true});
  assert.ok(f.blocks.reads<1000,`${count}: ${f.blocks.reads} block reads`);t.diagnostic(`${count} earlier events: ${f.blocks.reads} reads for validation and source admission of four new facts`);
 }
});

test('incremental and compatibility admission agree on duplicate identities, corrections, context and unfinished facts',async()=>{
 const attempt=attemptFixture(),p=attempt.preparations[0],first=attempt.events[0],a=attempt.assessments[0];
 attempt.events.push({...first,id:randomUUID(),supersedes:first.id,reason:'Existing correction'});const f=await fixture(attempt);
 const second=attempt.events[1],later={...preparation(),supersedes:p.id,reason:'Later preparation'},newEvent=event(p),newAssessment=assessment(p);
 const cases=[
  {events:[newEvent]},
  {preparations:[later],events:[event(later)],assessments:[assessment(later)]},
  {events:[{...second,id:randomUUID(),supersedes:second.id,reason:'Correction'}]},
  {events:[newEvent,{...newEvent,id:randomUUID(),supersedes:newEvent.id,reason:'Correction in appended tail'}]},
  {events:[{...newEvent,id:p.id}]}, {preparations:[{...later,id:first.id}]}, {events:[newEvent,newEvent]},
  {events:[{...newEvent,preparationId:randomUUID()}]}, {events:[{...newEvent,preparationId:a.id}]},
  {events:[{...newEvent,supersedes:first.id,reason:'Already corrected'}]},
  {events:[{...newEvent,supersedes:a.id,reason:'Different group'}]},
  {events:[{...newEvent,supersedes:newEvent.id,reason:'Self correction'}]},
  {events:[{...second,id:randomUUID(),supersedes:newEvent.id,reason:'Forward correction'},newEvent]},
  {events:[{...newEvent,supersedes:second.id,reason:'First'},{...newEvent,id:randomUUID(),supersedes:second.id,reason:'Second'}]},
  {preparations:[preparation()]},
  {assessments:[{...newAssessment,criterionId:randomUUID()}]},
  {assessments:[{...newAssessment,supersedes:a.id,criterionId:p.criteria[1].id,reason:'Different criterion'}]},
  {preparations:[later],assessments:[{...assessment(later),supersedes:a.id,reason:'Different preparation'}]},
  {events:[{...newEvent,time:{meaning:'device-counter',value:''}}]},
  {events:[{...newEvent,unexpected:'property'}]}
 ];
 for(const [position,additions] of cases.entries()){
  const combined=structuredClone(attempt);for(const group of attemptGroups)combined[group].push(...additions[group]??[]);
  const next=await append(f.document,additions),compatibility=new RecordDocument(f.blocks,next.root);
  for(const draft of [false,true])for(const document of [next,compatibility]){
   if(validAttempt(combined,{draft}))assert.deepEqual(await validateAttemptDocument(document,{draft}),emptyAttempt(),`case ${position}, draft ${draft}`);
   else await assert.rejects(validateAttemptDocument(document,{draft}),{code:'INVALID'},`case ${position}, draft ${draft}`);
  }
 }
});

test('changed prefixes and different saved bases retain complete immutable-history checks',async()=>{
 const f=await fixture(),next=await append(f.document,{events:[event(f.attempt.preparations[0])]}),workspaceId=randomUUID(),recordId=randomUUID();
 for(const changed of [await next.replace(['attempt','events','0','label'],'Rewritten'),await next.splice(['attempt','events'],0,1,[])]){
  assert.equal(changed.attemptAppendBase(),null);
  await assert.rejects(validateAttemptDocumentChange({},workspaceId,f.document,changed,recordId),{code:'ATTEMPT_IMMUTABLE'});
 }
 const other=await f.document.replace(['attempt','events','0','label'],'Another saved base');
 await assert.rejects(validateAttemptDocumentChange({},workspaceId,other,next,recordId),{code:'ATTEMPT_IMMUTABLE'});
 const malformed=await next.replace(['attempt','events','0','time'],{meaning:'device-counter',value:''});
 await assert.rejects(validateAttemptDocument(malformed),{code:'INVALID'});
 const checkpoint=new RecordDocument(f.blocks,next.root,{mutable:true});assert.equal(checkpoint.attemptAppendBase(),null);
 await validateAttemptDocumentChange({},workspaceId,f.document,checkpoint,recordId);
});

test('new source references remain checked once, reject wrong ownership, and honour cancellation',async t=>{
 const f=await fixture(),p=f.attempt.preparations[0],workspaceId=randomUUID(),recordId=randomUUID(),ref={workspaceId,id:randomUUID(),kind:'record',revision:'a'.repeat(64),label:'Exact retained method'},checked=[];
 t.mock.method(ResearchMaterials.prototype,'checkReference',async value=>{checked.push(value);});
 const next=await append(f.document,{events:[event(p,{references:[ref]}),event(p,{references:[ref]})]});
 await validateAttemptDocumentChange({},workspaceId,f.document,next,recordId);assert.deepEqual(checked,[ref]);
 for(const invalid of [{...ref,workspaceId:randomUUID()},{...ref,id:recordId}]){
  const rejected=await append(f.document,{events:[event(p,{references:[invalid]})]});
  await assert.rejects(validateAttemptDocumentChange({},workspaceId,f.document,rejected,recordId),{code:'ATTEMPT_REFERENCE'});
 }
 const controller=new AbortController();controller.abort(Error('Stop append validation'));
 await assert.rejects(validateAttemptDocument(next,{signal:controller.signal}),/Stop append validation/);
 await assert.rejects(validateAttemptDocumentChange({},workspaceId,f.document,next,recordId,{signal:controller.signal}),/Stop append validation/);
});
