import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {RecordDocument} from '../src/record-document.js';
import {RecordWriting} from '../src/record-writing.js';
import {RecordStarterSource} from '../src/record-starter-source.js';
import {validStarter} from '../src/web/record-starter-model.js';
import {researchReference} from '../src/web/research-reference.js';

async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-starter-source-')),book=sampleNotebook(),record=book.entries[0];
 record.body='Completed results must remain separate';record.sections=Array.from({length:129},(_,i)=>({id:randomUUID(),title:'Method section '+(i+1),body:'Retained instructions '+i+' '+('measurement '.repeat(100))}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const snapshotId=(await f.workspace.outline()).etag;return {...f,book,record,source:new RecordStarterSource(f.workspace),target:{workspaceId:book.id,recordId:record.id,snapshotId}};
}

test('template source pages read headings only, and preparation reads only chosen pinned instructions',async t=>{
 const f=await fixture(t),original=ResearchCatalogue.prototype.record,field=RecordDocument.prototype.field,paths=[];
 ResearchCatalogue.prototype.record=()=>{throw Error('Template source reconstructed a record');};
 RecordDocument.prototype.field=function(path,...options){paths.push(path);return field.call(this,path,...options);};
 t.after(()=>{ResearchCatalogue.prototype.record=original;RecordDocument.prototype.field=field;});
 const first=await f.source.page({...f.target,offset:0}),late=await f.source.page({...f.target,offset:120});
 assert.equal(first.values.length,20);assert.equal(late.values.length,9);assert.equal(late.total,129);assert.equal(late.values[8].title,'Method section 129');assert.equal(late.storageRevision,first.storageRevision);
 assert.equal(paths.some(path=>path.includes('body')||path.length===1&&path[0]==='sections'),false);
 const writing=new RecordWriting(f.workspace),selected={workspaceId:f.book.id,recordId:f.record.id,sectionId:f.record.sections[128].id},base=await writing.read(selected);
 await writing.save({...selected,expectedRevision:base.revision,value:{...base.value,body:'New method must not replace the selected source'}});
 const current=(await f.workspace.outline()).etag;paths.length=0;
 const prepared=await f.source.prepare({...f.target,body:false,sections:[{id:f.record.sections[128].id,body:true},{id:f.record.sections[2].id,body:false}]});
 assert.deepEqual(prepared.draft.sections,[{title:f.record.sections[2].title,body:''},{title:f.record.sections[128].title,body:f.record.sections[128].body}]);assert.equal(prepared.draft.body,'');assert.equal(prepared.storageRevision,first.storageRevision);
 assert.deepEqual(paths.filter(path=>path.at(-1)==='body'),[['sections','128','body']]);assert.equal((await f.workspace.outline()).etag,current);
 assert.equal(validStarter(prepared.draft),true);assert.equal(JSON.stringify(prepared).includes('New method must not'),false);assert.equal(JSON.stringify(prepared).includes('Completed results'),false);
});

test('template capture rejects ambiguous selections, changed workspace and cancellation without saving partial data',async t=>{
 const f=await fixture(t),section={id:f.record.sections[0].id,body:true};
 for(const sections of [[section,section],[{...section,position:0}],[{...section,body:'true'}]])await assert.rejects(f.source.prepare({...f.target,body:false,sections}),{code:'INVALID'});
 await assert.rejects(f.source.prepare({...f.target,body:false,sections:[{id:randomUUID(),body:true}]}),{code:'MISSING'});
 await assert.rejects(f.source.page({...f.target,workspaceId:randomUUID(),offset:0}),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(f.source.page({...f.target,offset:130}),{code:'INVALID'});
 await assert.rejects(f.source.page({...f.target,offset:0},{signal:AbortSignal.abort()}),{name:'AbortError'});
 // Source bodies travel in bounded batches; native capture continues across
 // any number of batches without a total template section envelope.
 await assert.rejects(f.source.prepare({...f.target,body:false,sections:f.record.sections.map(({id})=>({id,body:false}))}),{code:'INVALID'});
 assert.equal((await f.workspace.outline()).etag,f.target.snapshotId);
 const empty=await f.source.prepare({...f.target,body:false,sections:[]});assert.deepEqual(empty.draft.sections,[]);assert.equal(empty.draft.body,'');
});

test('captured workspace references remain editable for review but cannot enter a portable release unchanged',async t=>{
 const f=await fixture(t),writing=new RecordWriting(f.workspace),selected={workspaceId:f.book.id,recordId:f.record.id,sectionId:null},base=await writing.read(selected);
 const body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Review this source',marks:[{type:'link',attrs:{href:researchReference({workspaceId:f.book.id,kind:'record',id:f.book.entries[1].id}),title:'Earlier source',target:'_self',nofollow:false}}]}]}]};
 await writing.save({...selected,expectedRevision:base.revision,value:{body}});
 const prepared=await f.source.prepare({...f.target,snapshotId:(await f.workspace.outline()).etag,body:true,sections:[]});assert.deepEqual(prepared.draft.body,body);assert.equal(validStarter(prepared.draft,{portable:false}),true);assert.equal(validStarter(prepared.draft),false);
});
