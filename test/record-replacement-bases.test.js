import {test} from 'node:test';
import assert from 'node:assert/strict';
import {figureValueFixture} from './record-figure-values-fixture.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {recordReplacementBase} from '../src/record-replacement-bases.js';
import {withRecordDocument} from '../src/record-document.js';
import {preparation} from './fixtures/attempts.js';
import {RecordValues} from '../src/record-values.js';
import {randomUUID} from 'node:crypto';
const records=f=>new ResearchRecords(f.workspace,{get:async()=>{throw Error('Unexpected media');}});
async function basis(f){return f.workspace.catalogue(async s=>recordReplacementBase(s,await s.member(await s.snapshot(),f.record.id)));}
const command=(f,base,record)=>({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:base.revision,record}]});
test('record replacements validate from stored bases, preserve timestamps and history, and reject stale writes',async t=>{
 const f=await figureValueFixture({large:true});t.after(f.close);const base=await basis(f),replacement={...structuredClone(f.record),title:'Reviewed replacement',sections:f.record.sections.slice(0,2)};
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Replacement reconstructed a saved record');});
 const before=await f.workspace.outline(),finish=ResearchCatalogue.prototype.finishRecordChanges;
 t.mock.method(ResearchCatalogue.prototype,'finishRecordChanges',async function(...args){await finish.apply(this,args);throw Error('Interrupted replacement');});
 await assert.rejects(records(f).save(command(f,base,replacement),{receipt:true}),/Interrupted replacement/);ResearchCatalogue.prototype.finishRecordChanges.mock.restore();assert.equal((await f.workspace.outline()).etag,before.etag);
 replacement.createdAt='2001-01-01T00:00:00.000Z';await records(f).save(command(f,base,replacement),{receipt:true});const saved=await basis(f);assert.equal(saved.createdAt,base.createdAt);assert.notEqual(saved.revision,base.revision);
 await assert.rejects(records(f).save(command(f,base,replacement),{receipt:true}),{code:'RECORD_CHANGED'});
 replacement.createdAt=saved.createdAt;replacement.updatedAt=saved.updatedAt;const head=(await f.workspace.outline()).etag;await records(f).save(command(f,saved,replacement),{receipt:true});assert.equal((await f.workspace.outline()).etag,head);
 await f.workspace.catalogue(async s=>{const row=await s.member(await s.snapshot(before.etag),f.record.id);await withRecordDocument(s,row.id,row.revision,async doc=>assert.equal(await doc.tree.arrayLength(doc.root,['sections']),73));await s.verifySnapshot(undefined,f.book.id);});
});
test('full replacements cannot rewrite immutable run facts through the stored-base path',async t=>{
 const f=await figureValueFixture();t.after(f.close);const p=preparation(),values=new RecordValues(f.workspace),target={workspaceId:f.book.id,recordId:f.record.id,field:'attempt:preparation:'+p.id},selected=await values.read(target);
 await values.save({...target,expectedRevision:selected.revision,value:{value:p}});const original=(await f.workspace.read()).book.entries[0],base=await basis(f);
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Replacement reconstructed an attempted record');});
 const invalid=structuredClone(original);invalid.attempt.preparations[0].inputs[0].hash='c'.repeat(64);await assert.rejects(records(f).save(command(f,base,invalid),{receipt:true}),{code:'ATTEMPT_IMMUTABLE'});
 await records(f).save(command(f,base,{...original,title:'Later narrative'}),{receipt:true});assert.equal((await basis(f)).title,'Later narrative');
});

test('replacement batches preserve frozen field definitions and check unchanged siblings atomically',async t=>{
 const f=await figureValueFixture();t.after(f.close);const initial=await f.workspace.read(),record=initial.book.entries[0];
 record.template={id:randomUUID(),profileId:null,label:'Original interpretation',description:'Frozen schema',fields:[{key:'note',label:'Observation',type:'text',unit:'',required:false,choices:[]}],values:{note:'Initial'}};
 const sibling={...structuredClone(record),id:randomUUID(),title:'Unchanged sibling',body:'',sections:[],figures:[],relations:[]};delete sibling.results;initial.book.entries.push(sibling);
 await f.workspace.save(initial.book,initial.etag);const saved=await f.workspace.read(),a=saved.book.entries[0],b=saved.book.entries[1],base=await basis(f),service=records(f);
 t.mock.method(ResearchCatalogue.prototype,'record',()=>{throw Error('Template replacement reconstructed a saved record');});
 const edited=structuredClone(a);edited.template.values.note='Reviewed observation';const changedSchema=structuredClone(edited);changedSchema.template.fields[0].label='Reinterpreted field';
 await assert.rejects(service.save(command(f,base,changedSchema),{receipt:true}),{code:'INVALID'});
 const changes=[{id:a.id,expectedRevision:base.revision,record:edited},{id:b.id,expectedRevision:'0'.repeat(64),record:b}];
 await assert.rejects(service.save({workspaceId:f.book.id,changes},{receipt:true}),{code:'RECORD_CHANGED'});assert.equal((await f.workspace.outline()).etag,saved.etag);
 changes[1].expectedRevision=recordRevision(b);await service.save({workspaceId:f.book.id,changes},{receipt:true});
 await f.workspace.catalogue(async store=>{const snapshot=await store.snapshot(),row=await store.member(snapshot,a.id),unchanged=await store.member(snapshot,b.id);await withRecordDocument(store,row.id,row.revision,async document=>{assert.equal((await document.field(['template','values','note'])).value,'Reviewed observation');assert.equal((await document.field(['template','label'])).value,'Original interpretation');});assert.equal((await recordReplacementBase(store,unchanged)).revision,recordRevision(b));});
});
