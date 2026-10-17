import '../src/storage.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {recordDraftParts} from '../src/record-draft-parts.js';
import {inspectRecordDraft} from '../src/record-draft-inspection.js';
import {DraftTemplateBuilder,DraftTemplateComparison} from '../src/record-draft-template.js';
import {RecordDocument,withRecordDocument} from '../src/record-document.js';
import {RecordContent} from '../src/record-content.js';
import {RecordValueTree} from '../src/record-value-tree.js';
import {RecordValues} from '../src/record-values.js';
import {ResearchDraftTransfer} from '../src/research-draft-transfer.js';
import {ResearchDrafts} from '../src/research-drafts.js';
import {verifyRetainedDraft} from '../src/research-draft-verification.js';
import {withDraftDocument} from '../src/record-draft-document.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {digest,serialize} from '../src/storage-format.js';
import {RECORD_DRAFT_CHUNK_BYTES as SIZE} from '../src/web/record-draft-protocol.js';
const schema=()=>({id:randomUUID(),profileId:null,label:'Observed choices',description:'Immutable schema',fields:[{key:'observed',label:'Observation',type:'select',unit:'',required:true,choices:Array.from({length:129},(_,i)=>'Choice '+i+' '+('x'.repeat(120)))},{key:'amount',label:'Amount',type:'number',unit:'m',required:false,choices:[],numeric:{version:1,representation:'rational',radix:10}}],values:{amount:'2/3'}});
const changes=record=>[{record,baseRevision:null,expectedRevision:null}];
async function* pieces(bytes,size=127){for(let at=0;at<bytes.length;at+=size)yield bytes.subarray(at,at+size);}
function blocks(){const nodes=new Map();return {async put(kind,value){const raw=serialize(value),revision=digest(raw);nodes.set(kind+':'+revision,raw);return revision;},async read(kind,revision){return JSON.parse(nodes.get(kind+':'+revision));},tree(){return new RecordValueTree(this);}};}

test('template transport emits bounded values and preserves exact native fields without a whole template read',async()=>{
 const template=schema(),record={...sampleNotebook().entries[0],template},storage=blocks(),builder=new DraftTemplateBuilder(storage),document=new RecordDocument(storage,await storage.tree().retain({template}));let root=null,count=0;
 const compare=new DraftTemplateComparison(document);document.field=()=>{throw Error('Template comparison read a complete field');};
 for await(const part of recordDraftParts(pieces(Buffer.from(JSON.stringify(changes(record))),7)))if(part.kind==='template'){
  assert.ok(JSON.stringify(part).length<1000);await compare.accept(part);root=await builder.accept(part)??root;if(part.path[2]==='choices'&&part.type==='value')count++;
 }
 assert.equal(count,129);assert.deepEqual(await storage.tree().read(root),template);assert.equal(compare.stack.length,0);
 const changed=await new RecordDocument(storage,document.root,{mutable:true}).replace(['template','fields','0','choices','128'],'Different choice'),damaged=new DraftTemplateComparison(changed);
 await assert.rejects(async()=>{for await(const part of recordDraftParts(pieces(Buffer.from(JSON.stringify(changes(record))))))if(part.kind==='template')await damaged.accept(part);},{code:'CATALOGUE_DAMAGED'});
});

test('template transport retains exact draft choice rules at arbitrary property order and rejects ambiguous late values',async()=>{
 const record={...sampleNotebook().entries[0],template:schema()},inspect=value=>inspectRecordDraft(pieces(Buffer.from(JSON.stringify(changes(value)))));
 for(const template of [record.template,Object.fromEntries(Object.entries(record.template).reverse())])assert.equal((await inspect({...record,template})).base.recordId,record.id);
 const selected=structuredClone(record);selected.template.values.observed=selected.template.fields[0].choices.at(-1);await inspect(selected);
 for(const change of [t=>t.fields[0].choices.push(t.fields[0].choices[0]),t=>t.fields[0].choices[128]=false,t=>t.fields.push(t.fields[0]),t=>t.values.observed='Unknown',t=>t.values.extra='Unknown',t=>t.fields[0].choices=[],t=>t.values.amount='not rational',t=>t.fields[1].numeric.extra=true,t=>delete t.values,t=>t.fields[0].choices='wrong']){const value=structuredClone(record);change(value.template);await assert.rejects(inspect(value),{code:'INVALID'});}
 const raw=JSON.stringify(changes(record)).replace('"amount":"2/3"','"amount":"2/3","amount":"1/3"');await assert.rejects(inspectRecordDraft(pieces(Buffer.from(raw))),{code:'INVALID'});
 const controller=new AbortController();let closed=false;
 async function* interrupted(){try{yield Buffer.from('[{"record":{"template":{"fields":[{"choices":[');for(let i=0;i<10000;i++){if(i===2)controller.abort(Error('Stopped template'));yield Buffer.from((i?',':'')+JSON.stringify('Choice '+i));}}finally{closed=true;}}
 await assert.rejects(inspectRecordDraft(interrupted(),{signal:controller.signal}),/Stopped template/);assert.equal(closed,true);
});

test('saved choice pins and format4 template checkpoints preserve selected reads, validation and exact transport verification',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-template-choice-')),book=sampleNotebook(),record=book.entries[2];book.entries=[record];record.template=schema();record.template.values.observed=record.template.fields[0].choices.at(-1);
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const choicesReference=await f.workspace.catalogue(async store=>{const row=await store.member(await store.snapshot(),record.id);return withRecordDocument(store,row.id,row.revision,document=>document.reference(['template','fields','0','choices']));});
 const readValue=RecordValueTree.prototype.read,readField=RecordDocument.prototype.field;
 t.mock.method(RecordValueTree.prototype,'read',function(revision,...options){assert.notEqual(revision,choicesReference,'Selected Save or Read hydrated the choice collection');return readValue.call(this,revision,...options);});
 t.mock.method(RecordDocument.prototype,'field',function(path,...options){assert.notDeepEqual(path,['template'],'Selected Save hydrated the complete template');return readField.call(this,path,...options);});
 const values=new RecordValues(f.workspace),target={workspaceId:book.id,recordId:record.id,field:'template:observed'},before=await values.read(target),pin={...target,storageRevision:before.storageRevision,schemaRevision:before.definition.schemaRevision,offset:128,query:''};
 assert.equal(before.definition.choiceCount,129);assert.equal(Object.hasOwn(before.definition,'choices'),false);assert.deepEqual((await values.choices(pin)).items,[record.template.values.observed]);
 await values.save({...target,expectedRevision:before.revision,value:{value:record.template.fields[0].choices[0]}});
 assert.deepEqual((await values.choices(pin)).items,[record.template.values.observed]);const current=await values.read(target);
 await assert.rejects(values.save({...target,expectedRevision:current.revision,value:{value:'Unknown'}}),{code:'INVALID'});
 await assert.rejects(values.save({...target,expectedRevision:current.revision,value:{value:null}}),{code:'INVALID'});
 await assert.rejects(values.choices({...pin,schemaRevision:'0'.repeat(64)}),{code:'RECORD_CHANGED'});
 await assert.rejects(values.choices({...pin,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 const reading=await new RecordContent(f.workspace).read({workspaceId:book.id,recordId:record.id,pagedHeader:true});assert.equal(reading.header.template.fields[0].choiceCount,129);assert.equal(Object.hasOwn(reading.header.template.fields[0],'choices'),false);assert.equal(reading.header.template.values.observed,record.template.fields[0].choices[0]);assert.deepEqual(reading.collections.fields,{offset:0,total:2,count:2});
 t.mock.restoreAll();
 const draftRecord={...record,id:randomUUID(),title:'Unfinished configured record',template:schema()},payload=Buffer.from(JSON.stringify(changes(draftRecord))),transfer=new ResearchDraftTransfer(f.workspace),owner={id:randomUUID(),workspaceId:book.id},sha256=digest(payload);
 await transfer.start({...owner,expectedRevision:null,bytes:payload.length,sha256});
 for(let index=0;index*SIZE<payload.length;index++){const bytes=payload.subarray(index*SIZE,(index+1)*SIZE);await transfer.part({...owner,transferHash:sha256,index,bytes:bytes.toString('base64'),sha256:digest(bytes)});}
 await transfer.finish({...owner,transferHash:sha256});const {draft}=await new ResearchDrafts(f.workspace).read(owner.id,{header:true});assert.equal(draft.formatVersion,4);
 const field=RecordDocument.prototype.field;t.mock.method(RecordDocument.prototype,'field',function(path,...options){assert.ok(path[0]!=='template','Draft verification hydrated its template');return field.call(this,path,...options);});
 await f.workspace.withLock(()=>f.workspace.catalogue(async store=>{
  await verifyRetainedDraft(store,draft);await withDraftDocument(store,draft,async source=>{
   const changed=await new RecordDocument(source.blocks,source.root,{mutable:true}).replace(['template','fields','0','choices','128'],'Changed retained choice');await changed.blocks.flush();
   await assert.rejects(verifyRetainedDraft(store,{...draft,document:{...draft.document,root:changed.root}}),{code:'CATALOGUE_DAMAGED'});
  });
 }));
});
