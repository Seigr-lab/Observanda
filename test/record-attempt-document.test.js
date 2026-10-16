import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {RecordDocument,withRecordDocument} from '../src/record-document.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {digest,serialize} from '../src/storage-format.js';
import {validateAttemptDocument,validateAttemptDocumentChange,attemptDocumentSearchParts,attemptDocumentReadiness} from '../src/record-attempt-document.js';
import {validAttempt,attemptSearchText,emptyAttempt} from '../src/web/attempt-model.js';
import {attemptFixture,preparation,event,assessment} from './fixtures/attempts.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {RecordValues} from '../src/record-values.js';
import {RecordHistory} from '../src/record-history.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RunReadiness} from '../src/run-readiness.js';

async function memory(attempt){
 const nodes=new Map(),blocks={async put(kind,value){const encoded=serialize(value),revision=digest(encoded);nodes.set(kind+':'+revision,encoded);return revision;},async read(kind,revision){return JSON.parse(nodes.get(kind+':'+revision));},tree(){return new RecordValueTree(this);}};
 return new RecordDocument(blocks,await blocks.tree().retain({attempt}),{mutable:true});
}
test('fact-wise validation retains exact domain and correction semantics, including unfinished checkpoints',async()=>{
 const base=attemptFixture(),cases=[base,{...emptyAttempt()},...[
  a=>a.events.push({...a.events[0]}),a=>a.events[0].preparationId=randomUUID(),a=>a.assessments[0].criterionId=randomUUID(),
  a=>a.preparations.push(preparation()),a=>a.events[0].supersedes=a.events[1].id,a=>a.events[0].unexpected=true,
  a=>a.events.push({...a.events[0],id:randomUUID(),supersedes:a.events[0].id,reason:'Correction'}),
  a=>a.assessments.push({...a.assessments[0],id:randomUUID(),supersedes:a.assessments[0].id,reason:'Reassessment',criterionId:a.preparations[0].criteria[1].id}),
  a=>a.events[0].time={meaning:'device-counter',value:''},a=>a.preparations[0].inputs[0].hash='unfinished'
 ].map(change=>{const a=structuredClone(base);change(a);return a;})];
 for(const value of cases)for(const draft of [false,true]){
  const document=await memory(value);if(validAttempt(value,{draft}))assert.deepEqual(await validateAttemptDocument(document,{draft}),emptyAttempt());else await assert.rejects(validateAttemptDocument(document,{draft}),{code:'INVALID'});
 }
 const document=await memory(base),parts=[];for await(const part of attemptDocumentSearchParts(document))parts.push(part);assert.equal(parts.join(' '),attemptSearchText(base));
 const controller=new AbortController();controller.abort(Error('Stop validation'));await assert.rejects(validateAttemptDocument(document,{signal:controller.signal}),/Stop validation/);
});

test('stored admission, replacement, restore and verification never assemble a complete run history',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-attempt-document-')),book=sampleNotebook(),record=book.entries[0];book.entries=[record];record.status='draft';
 const p=preparation();record.attempt={...emptyAttempt(),preparations:[p],events:Array.from({length:96},(_,i)=>event(p,{label:'Acquisition '+i})),assessments:Array.from({length:96},(_,i)=>assessment(p,i%2,{observed:'Exact observation '+i}))};
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const initial=await f.workspace.read(),original=initial.book.entries[0],target={workspaceId:book.id,recordId:record.id},values=new RecordValues(f.workspace),history=new RecordHistory(f.workspace,{}),field=RecordDocument.prototype.field;
 t.mock.method(RecordDocument.prototype,'field',function(path,...args){if(path[0]==='attempt'&&(path.length===1||path.length===2&&path[1]!=='version'))throw Error('Assembled a complete run history');return field.call(this,path,...args);});
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Assembled a complete record');});
 const base=await values.read({...target,field:'title'});await values.save({...target,field:'title',expectedRevision:base.revision,value:{value:'Later interpretation'}});
 assert.deepEqual((await new RunReadiness(f.workspace).view(target)).unresolved,[{id:p.criteria[1].id,label:p.criteria[1].label}]);
 let listing=await history.list(target);const old=listing.versions.find(v=>!v.current);
 await history.restore({...target,...old,expectedRevision:listing.currentRevision},{receipt:true});
 listing=await history.list(target);const amended={...structuredClone(original),title:'Reviewed replacement'};amended.attempt.events.push(event(p,{label:'Later acquisition'}));
 await new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:listing.currentRevision,record:amended}]},{receipt:true});
 const latest=(await history.list(target)).currentRevision,invalid=structuredClone(amended);invalid.attempt.events[95].label='Changed physical history';
 await assert.rejects(new ResearchRecords(f.workspace,{}).save({workspaceId:book.id,changes:[{id:record.id,expectedRevision:latest,record:invalid}]},{receipt:true}),{code:'ATTEMPT_IMMUTABLE'});
 await f.workspace.catalogue(async store=>{await store.verifySnapshot(undefined,book.id);const row=await store.member(await store.snapshot(),record.id);await withRecordDocument(store,row.id,row.revision,async document=>{assert.equal(await document.tree.arrayLength(document.root,['attempt','events']),97);assert.equal((await document.field(['attempt','events','95','label'])).value,'Acquisition 95');});});
 assert.notEqual(latest,recordRevision(original));
});

test('readiness includes only applicable current assessments, including corrections on other pages',async()=>{
 const p=preparation(),a=assessment(p),b=assessment(p,1),attempt={...emptyAttempt(),preparations:[p],assessments:[a,b]};
 assert.deepEqual(await attemptDocumentReadiness(await memory(attempt)),[{id:p.criteria[1].id,label:p.criteria[1].label}]);
 attempt.assessments.push({...a,id:randomUUID(),supersedes:a.id,reason:'Original assessment withdrawn',outcome:'unresolved'});
 assert.deepEqual(await attemptDocumentReadiness(await memory(attempt)),p.criteria.map(({id,label})=>({id,label})));
 const later={...structuredClone(p),id:randomUUID(),supersedes:p.id,reason:'Later preparation'};attempt.preparations.push(later);
 assert.deepEqual(await attemptDocumentReadiness(await memory(attempt)),p.criteria.map(({id,label})=>({id,label})));
 attempt.assessments.push(assessment(later,1,{outcome:'not-met'}));
 assert.deepEqual(await attemptDocumentReadiness(await memory(attempt)),[{id:p.criteria[0].id,label:p.criteria[0].label}]);
});

test('document source admission rejects history deletion, invalid references and rewrites without reading whole collections',async()=>{
 const workspaceId=randomUUID(),recordId=randomUUID(),before=attemptFixture(),previous=await memory(before);
 const changed=structuredClone(before);changed.events[0].extent='failed';await assert.rejects(validateAttemptDocumentChange({},workspaceId,previous,await memory(changed),recordId),{code:'ATTEMPT_IMMUTABLE'});
 const removed=structuredClone(before);removed.events.pop();await assert.rejects(validateAttemptDocumentChange({},workspaceId,previous,await memory(removed),recordId),{code:'ATTEMPT_IMMUTABLE'});
 for(const ref of [{workspaceId:randomUUID(),id:randomUUID()},{workspaceId,id:recordId}]){
  const next=structuredClone(before);next.events.push(event(before.preparations[0],{references:[{...ref,kind:'record',revision:'a'.repeat(64),label:'Invalid reference'}]}));
  await assert.rejects(validateAttemptDocumentChange({},workspaceId,previous,await memory(next),recordId),{code:'ATTEMPT_REFERENCE'});
 }
});
