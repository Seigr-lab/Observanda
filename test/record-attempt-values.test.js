import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {preparation,event,assessment} from './fixtures/attempts.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {RecordValues} from '../src/record-values.js';
import {RecordValueDrafts,verifyRecordValueDraft} from '../src/record-value-drafts.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {withRecordDocument,RecordDocument} from '../src/record-document.js';
import {withDraftDocument} from '../src/record-draft-document.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {emptyAttempt,validAttempt,validAttemptFact} from '../src/web/attempt-model.js';
import {attemptDraft,attemptDraftRow} from '../src/web/attempt-draft.js';
import {RecordAttemptIndex} from '../src/record-attempt-index.js';
import {RecordQueryDocuments} from '../src/record-query-documents.js';
const target=(f,kind,id)=>({workspaceId:f.book.id,recordId:f.record.id,field:'attempt:'+kind+':'+id});
const save=(f,base,item)=>f.values.save({workspaceId:base.workspaceId,recordId:base.recordId,field:base.field,expectedRevision:base.revision,value:{value:item}});
async function read(f,path){return f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),f.record.id);return withRecordDocument(store,row.id,row.revision,async doc=>(await doc.field(path)).value);});}
const forbid=(t,f)=>{const read=ResearchCatalogue.prototype.record;t.mock.method(ResearchCatalogue.prototype,'record',function(id,...args){if(id===f.record.id)throw Error('Run-detail editing reconstructed the selected record');return read.call(this,id,...args);});};

test('unfinished facts have strict structural admission without claiming completed scientific facts',()=>{
 for(const kind of ['preparation','event','assessment']){
  const value=attemptDraft(kind,emptyAttempt(),[]);if(kind==='event')value.preparationId=null;
  assert.ok(validAttemptFact(kind,value,{draft:true}));assert.equal(validAttemptFact(kind,{...value,unexpected:true},{draft:true}),false);
 }
 const p=attemptDraft('preparation',emptyAttempt(),[]);p.conditions.push({...attemptDraftRow('conditions'),basis:'inherited'});p.inputs.push({...attemptDraftRow('inputs'),hash:'unfinished hash'});p.criteria.push({...attemptDraftRow('criteria'),scope:'exploratory'});
 assert.ok(validAttemptFact('preparation',p,{draft:true}));assert.equal(validAttempt({...emptyAttempt(),preparations:[p]}),false);
 p.protocols.push({workspaceId:randomUUID(),id:randomUUID(),kind:'record',label:'Unpinned source'});assert.equal(validAttemptFact('preparation',p,{draft:true}),false);
});

test('selected run facts preserve methods, independent additions, immutable history and retry identity',async t=>{
 const f=await figureValueFixture();t.after(f.close);
 const method={...structuredClone(f.record),id:randomUUID(),title:'Retained method',type:'protocol',sections:[],figures:[],body:'Initial method',relations:[]};delete method.results;
 await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:method.id,expectedRevision:null,record:method}]});
 const savedMethod=(await f.workspace.read()).book.entries.find(r=>r.id===method.id),ref={...await f.materials.pinRecord(method.id,recordRevision(savedMethod)),label:method.title};forbid(t,f);
 const p=preparation({protocols:[ref]}),base=await f.values.read(target(f,'preparation',p.id)),etag=(await f.workspace.outline()).etag;
 const competing=preparation(),other=await f.values.read(target(f,'preparation',competing.id));
 await save(f,base,p);assert.equal((await read(f,['relations'])).filter(l=>l.role==='uses-method').length,1);
 await assert.rejects(save(f,other,competing),{code:'ATTEMPT_CONFLICT'});
 const a=event(p,{references:[{...f.analysis,workspaceId:f.book.id,label:'Returned observations'}]}),b=event(p,{label:'Independent later event'}),ab=await f.values.read(target(f,'event',a.id)),bb=await f.values.read(target(f,'event',b.id));
 await save(f,ab,a);await save(f,bb,b);const head=(await f.workspace.outline()).etag;await save(f,ab,a);assert.equal((await f.workspace.outline()).etag,head);
 await assert.rejects(save(f,await f.values.read(target(f,'event',a.id)),{...a,label:'Rewritten'}),{code:'ATTEMPT_IMMUTABLE'});
 const assessment1=assessment(p),as=await f.values.read(target(f,'assessment',assessment1.id));await save(f,as,assessment1);
 const correct={...a,id:randomUUID(),supersedes:a.id,reason:'Checked acquisition receipt',extent:'partial'},cb=await f.values.read(target(f,'event',correct.id));
 const rival={...correct,id:randomUUID(),reason:'Other review'},rb=await f.values.read(target(f,'event',rival.id));await save(f,cb,correct);await assert.rejects(save(f,rb,rival),{code:'ATTEMPT_CONFLICT'});
 const amended={...structuredClone(p),id:randomUUID(),supersedes:p.id,applicability:'Later acquisitions',reason:'New conditions'};amended.conditions[0].value='240';await save(f,await f.values.read(target(f,'preparation',amended.id)),amended);
 assert.equal((await read(f,['relations'])).filter(l=>l.role==='uses-method').length,1);
 const attempt=await read(f,['attempt']);assert.deepEqual(attempt.events,[a,b,correct]);assert.deepEqual(attempt.assessments,[assessment1]);assert.equal(attempt.preparations[0].conditions[0].value,'120');assert.equal(attempt.events[0].preparationId,p.id);
 const wrong=event(p,{references:[{...ref,workspaceId:randomUUID()}]});await assert.rejects(save(f,await f.values.read(target(f,'event',wrong.id)),wrong),{code:'ATTEMPT_REFERENCE'});
 const self=event(p,{references:[{...ref,id:f.record.id}]});await assert.rejects(save(f,await f.values.read(target(f,'event',self.id)),self),{code:'ATTEMPT_REFERENCE'});
 await f.workspace.catalogue(async store=>{const snapshot=await store.snapshot(etag),row=await store.member(snapshot,f.record.id);await withRecordDocument(store,row.id,row.revision,async doc=>assert.equal((await doc.field(['attempt'])).found,false));await store.verifySnapshot(undefined,f.book.id);});
 assert.deepEqual(await read(f,['sections']),f.record.sections);assert.deepEqual(await read(f,['figures']),f.record.figures);assert.equal((await f.materials.read(ref)).body,'Initial method');
});

test('unfinished run facts on heavy records recover with a new key and prove their exact edit scope',async t=>{
 const f=await figureValueFixture({large:true});t.after(f.close);assert.ok(Buffer.byteLength(JSON.stringify(f.record))>2*1024*1024);forbid(t,f);
 const p=attemptDraft('preparation',emptyAttempt(),[]);p.inputs.push({...attemptDraftRow('inputs'),label:'Awaiting digest',hash:'partial'});
 const base=await f.values.read(target(f,'preparation',p.id)),drafts=new RecordValueDrafts(f.workspace),command={id:randomUUID(),workspaceId:f.book.id,recordId:f.record.id,expectedRevision:null,selection:{field:base.field,revision:base.revision,storageRevision:base.storageRevision},value:{value:p}};
 const receipt=await drafts.write(command),lookup={workspaceId:f.book.id,id:command.id,expectedRevision:receipt.revision};assert.deepEqual(await drafts.write(command),receipt);assert.deepEqual((await drafts.read(lookup)).value,command.value);await assert.rejects(save(f,base,p),{code:'INVALID'});
 const retained=await new ResearchDrafts(f.workspace).read(command.id,{header:true});await f.workspace.withLock(()=>f.workspace.catalogue(store=>withDraftDocument(store,retained.draft,async doc=>{
  for(const [path,value] of [[['sections','72','title'],'Unselected heading'],[['figures','0','title'],'Unselected figure']]){
   const changed=await new RecordDocument(doc.blocks,doc.root,{mutable:true}).replace(path,value);await changed.blocks.flush();await assert.rejects(verifyRecordValueDraft(store,{...retained.draft,document:{...retained.draft.document,root:changed.root}}),{code:'CATALOGUE_DAMAGED'});
  }
 })));
 const access=await createAccess('','synthetic attempt recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(f.directory,'recovered')),access,vault,f.vault),workspace=new Workspace(root,vault),recovered=await new RecordValueDrafts(workspace).read(lookup);
 assert.deepEqual(recovered.value,command.value);recovered.value.value.applicability='Later acquisition';recovered.value.value.inputs[0].hash='a'.repeat(64);
 await new RecordValues(workspace).save({...target(f,'preparation',p.id),expectedRevision:base.revision,value:recovered.value});await workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));assert.equal(await read(f,['attempt']),undefined);
});

test('an interrupted run-fact transaction leaves no partial history or projection',async t=>{
 const f=await figureValueFixture();t.after(f.close);forbid(t,f);const p=preparation(),base=await f.values.read(target(f,'preparation',p.id)),etag=(await f.workspace.outline()).etag;
 const finish=ResearchCatalogue.prototype.finishRecordChanges;t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted attempt commit');});
 await assert.rejects(save(f,base,p),/Interrupted attempt commit/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();assert.equal((await f.workspace.outline()).etag,etag);assert.equal(await read(f,['attempt']),undefined);await save(f,base,p);await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
 const added=event(p),selected=await f.values.read(target(f,'event',added.id)),indexedHead=(await f.workspace.outline()).etag;
 t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted indexed append');});
 await assert.rejects(save(f,selected,added),/Interrupted indexed append/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();assert.equal((await f.workspace.outline()).etag,indexedHead);assert.deepEqual((await read(f,['attempt'])).events,[]);
 await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));await save(f,selected,added);assert.deepEqual((await read(f,['attempt'])).events,[added]);await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});

test('ordinary fact saves carry their append proof through validation and projection to storage',async t=>{
 const f=await figureValueFixture();t.after(f.close);const p=preparation();await save(f,await f.values.read(target(f,'preparation',p.id)),p);
 const retain=RecordAttemptIndex.retain,query=RecordQueryDocuments.prototype.retainDocument;let extensions=0,queries=0;
 t.mock.method(RecordQueryDocuments.prototype,'retainDocument',async function(document,...args){
  const base=document.attemptAppendBase(),items=document.items,field=document.field;assert.ok(base);queries++;
  document.items=function(path,...options){assert.notEqual(path[0],'attempt','Query enumerated earlier facts');return items.call(this,path,...options);};
  document.field=function(path,...options){if(path[0]==='attempt'&&path.length>=3)assert.ok(Number(path[2])>=base[path[1]],'Query read an earlier fact');return field.call(this,path,...options);};
  try{return await query.call(this,document,...args);}finally{document.items=items;document.field=field;}
 });
 t.mock.method(RecordAttemptIndex,'retain',async function(document,options){
  const base=document.attemptAppendBase();assert.ok(base,'The commit discarded its append proof');extensions++;
  const items=document.items;document.items=async function*(path,options){assert.equal(options.offset,base[path[1]],'Storage re-indexed the old prefix');yield* items.call(this,path,options);};
  try{return await retain.call(this,document,options);}finally{delete document.items;}
 });
 for(const item of [event(p),event(p,{kind:'reviewed'})])await save(f,await f.values.read(target(f,'event',item.id)),item);
 assert.equal(extensions,2);assert.equal(queries,2);t.mock.restoreAll();await f.workspace.catalogue(store=>store.verifySnapshot(undefined,f.book.id));
});
