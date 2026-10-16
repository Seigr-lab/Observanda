import {publicationText,publicationInputBook} from './publication-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {publicationSource} from '../src/publication-source.js';
import {publicProjection} from '../src/publication.js';
import {publicationSelection} from '../src/publication-selection.js';
import {publicationReferences} from '../src/publication-revisions.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {createFigure} from '../src/web/figure-model.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';

async function fixture(t,count=42,{publicPrefix=0}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-saved-publication-')),book=upgradeNotebook(sampleNotebook()),seed=book.entries[0];
 book.entries=Array.from({length:count},(_,i)=>({...structuredClone(seed),id:randomUUID(),title:'PRIVATE_TITLE_'+i,body:'PRIVATE_BODY_'+i,share:false,attachments:[],figures:[],relations:[],sections:[]}));
 for(const i of [2,count-1])Object.assign(book.entries[i],{share:true,title:'Public observation '+i,body:'Selected readable content '+i});
 for(let i=0;i<publicPrefix;i++)Object.assign(book.entries[i],{share:true,title:'Public observation '+i,body:'Selected readable content '+i});
 const f=await encryptedFixture(directory,book),jobs=workspaceJobs(f.workspace);
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 return {...f,...jobs,book,releases:new PublicationJobs(f.workspace)};
}
function forbidPrivateReads(t,ids){
 const read=ResearchCatalogue.prototype.read,manifest=ResearchCatalogue.prototype.manifest,record=ResearchCatalogue.prototype.record,loaded=[];
 ResearchCatalogue.prototype.read=ResearchCatalogue.prototype.manifest=()=>{throw Error('Whole book requested by publication');};
 ResearchCatalogue.prototype.record=function(id,...args){assert.ok(ids.includes(id),'Private original requested: '+id);loaded.push(id);return record.call(this,id,...args);};
 const restore=()=>{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.manifest=manifest;ResearchCatalogue.prototype.record=record;};
 t.after(restore);return {loaded,restore};
}

test('unsaved presentation and selection commands drive preview and retained releases without saving',async t=>{
 const f=await fixture(t),outline=await f.workspace.outline(),included=f.book.entries[0],excluded=f.book.entries[2],last=f.book.entries.at(-1);
 const command={workspaceId:f.book.id,baseEtag:outline.etag,metadata:{website:{...outline.metadata.website,footer:'Unsaved public footer'}},projects:[],changes:[],removed:[],selection:{includeProjects:[],records:[{id:included.id,share:true,attachments:[]},{id:excluded.id,share:false,attachments:[]}]}};
 const {loaded,restore}=forbidPrivateReads(t,[included.id,last.id]),request={etag:outline.etag,draft:command};
 const source=await publicationSource(f.workspace,request);assert.deepEqual(source.entries.map(r=>r.id),[included.id,last.id]);assert.equal(source.website.footer,'Unsaved public footer');
 assert.equal((await f.workspace.outline()).etag,outline.etag);assert.deepEqual(loaded,[included.id,last.id]);loaded.length=0;
 const job=await f.releases.start(request,f.queue),input=await f.releases.source(job.id);
 assert.deepEqual(await publicationInputBook(f.workspace,input),source);assert.deepEqual(loaded,[included.id,last.id]);assert.equal((await f.workspace.outline()).etag,outline.etag);
 restore();
 await assert.rejects(publicationSource(f.workspace,{...request,book:f.book}),{code:'INVALID'});
 await assert.rejects(publicationSource(f.workspace,{...request,draft:{...command,workspaceId:randomUUID()}}),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(publicationSource(f.workspace,{...request,draft:{...command,selection:{includeProjects:[],records:[{id:randomUUID(),share:true,attachments:[]}]}}}),{code:'RECORD_CHANGED'});
 await assert.rejects(publicationSource(f.workspace,{...request,draft:{...command,selection:{includeProjects:[],records:[{id:included.id,share:true,attachments:[{id:randomUUID(),share:true}]}]}}}),{code:'INVALID'});
});

test('publication choice pages and one-record reference inspection do not scan the unused corpus',async t=>{
 const decode=ResearchCatalogue.prototype.decode,record=ResearchCatalogue.prototype.record;let queries=0,bodies=0,measuring=false;
 ResearchCatalogue.prototype.decode=function(table,id,...rest){if(measuring&&table==='state'&&id.startsWith('record-query:'))queries++;return decode.call(this,table,id,...rest);};
 ResearchCatalogue.prototype.record=function(...args){if(measuring)bodies++;return record.apply(this,args);};
 t.after(()=>{ResearchCatalogue.prototype.decode=decode;ResearchCatalogue.prototype.record=record;});
 for(const count of [65,650]){
  const f=await fixture(t,count,{publicPrefix:45}),source={workspaceId:f.book.id,etag:(await f.workspace.outline()).etag};
  queries=0;bodies=0;measuring=true;
  const first=await publicationSelection(f.workspace,{source});measuring=false;
  assert.deepEqual(first.items.map(item=>item.id),f.book.entries.slice(0,20).map(r=>r.id));assert.equal(first.next,20);assert.equal(bodies,0);assert.equal(queries,21);
  queries=0;bodies=0;measuring=true;
  const refs=await publicationReferences(f.workspace,{source,recordId:f.book.entries.at(-1).id});measuring=false;
  assert.deepEqual(refs,{items:[],offset:0,next:null});assert.equal(queries,1);assert.equal(bodies,1);
  queries=0;bodies=0;measuring=true;
  const second=await publicationSelection(new Workspace(f.workspace.root,f.vault),{source,offset:first.next,cursor:first.nextCursor});measuring=false;
  assert.deepEqual(second.items.map(item=>item.id),f.book.entries.slice(20,40).map(r=>r.id));assert.equal(second.next,40);assert.equal(bodies,0);assert.equal(queries,21);
  const final=await publicationSelection(f.workspace,{source,offset:second.next,cursor:second.nextCursor});
  assert.deepEqual(final.items.map(item=>item.id),[...f.book.entries.slice(40,45),f.book.entries.at(-1)].map(r=>r.id));assert.equal(final.next,null);assert.equal(final.nextCursor,null);
  assert.deepEqual((await publicationSelection(f.workspace,{source,offset:first.next,cursor:first.nextCursor})).items,second.items,'Returning to a visited page keeps its identities');
  t.diagnostic(JSON.stringify({count,choiceQueries:21,choiceBodies:0,referenceQueries:1,referenceBodies:1}));
 }
});

test('edition continuation rejects tampering, changed draft selection, wrong offsets and source revisions',async t=>{
 const f=await fixture(t,65,{publicPrefix:45}),source={workspaceId:f.book.id,etag:(await f.workspace.outline()).etag},first=await publicationSelection(f.workspace,{source});
 assert.ok(first.nextCursor);const cursor=first.nextCursor,bytes=Buffer.from(cursor,'base64url');bytes[bytes.length-1]^=1;
 await assert.rejects(publicationSelection(f.workspace,{source,offset:20,cursor:bytes.toString('base64url')}),{code:'PUBLICATION_SELECTION_CURSOR'});
 await assert.rejects(publicationSelection(f.workspace,{source,offset:40,cursor}),{code:'PUBLICATION_SELECTION_CURSOR'});
 const draft={workspaceId:f.book.id,baseEtag:source.etag,metadata:{},projects:[],changes:[],removed:[],selection:{includeProjects:[],records:[{id:f.book.entries[25].id,share:false,attachments:[]}]}};
 await assert.rejects(publicationSelection(f.workspace,{source:{...source,draft},offset:20,cursor}),{code:'PUBLICATION_SELECTION_CURSOR'});
 const controller=new AbortController();controller.abort();await assert.rejects(publicationSelection(f.workspace,{source,offset:20,cursor},{signal:controller.signal}),{name:'AbortError'});
 const record=f.book.entries[0];await new ResearchRecords(f.workspace,{}).save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision(record),record:{...record,title:'Changed during review'}}]},{compact:true});
 await assert.rejects(publicationSelection(f.workspace,{source,offset:20,cursor}),{code:'CONFLICT'});
 await assert.rejects(publicationSelection(f.workspace,{source:{...source,etag:(await f.workspace.outline()).etag},offset:20,cursor}),{code:'PUBLICATION_SELECTION_CURSOR'});
});

test('paged publication still validates late selection overrides and never loads excluded originals',async t=>{
 const f=await fixture(t,65,{publicPrefix:45}),source={workspaceId:f.book.id,etag:(await f.workspace.outline()).etag},last=f.book.entries.at(-1),command={workspaceId:f.book.id,baseEtag:source.etag,metadata:{},projects:[],changes:[],removed:[],selection:{includeProjects:[],records:[{id:last.id,share:false,attachments:[]}]}};
 const guard=forbidPrivateReads(t,f.book.entries.slice(0,21).map(r=>r.id));
 const request={...source,draft:command},first=await publicationSelection(f.workspace,{source:request});assert.equal(first.items.length,20);assert.equal(guard.loaded.length,0);guard.loaded.length=0;
 await assert.rejects(publicationReferences(f.workspace,{source:request,recordId:last.id}),{code:'RECORD_CHANGED'});assert.equal(guard.loaded.length,0);
 for(const override of [{id:randomUUID(),share:true,attachments:[]},{id:last.id,share:true,attachments:[{id:randomUUID(),share:true}]}]){
  await assert.rejects(publicationSelection(f.workspace,{source:{...source,draft:{...command,selection:{includeProjects:[],records:[override]}}}}),{code:override.id===last.id?'INVALID':'RECORD_CHANGED'});
  assert.equal(guard.loaded.length,0);
 }
});
for(const count of [42,420])test('saved edition selects public originals before loading a '+count+'-record corpus',async t=>{
 const f=await fixture(t,count),outline=await f.workspace.outline(),command={workspaceId:f.book.id,etag:outline.etag},publicIds=f.book.entries.filter(e=>e.share).map(e=>e.id),{loaded}=forbidPrivateReads(t,publicIds);
 const source=await publicationSource(f.workspace,command);assert.deepEqual(loaded.sort(),publicIds.sort());
 assert.deepEqual(publicProjection(source),publicProjection(f.book));loaded.length=0;
 const job=await f.releases.start(command,f.queue),input=await f.releases.source(job.id);
 assert.equal(input.records.length,2);assert.ok(!JSON.stringify(input).includes('PRIVATE_BODY_'));assert.ok(!JSON.stringify(input).includes('PRIVATE_TITLE_'));
 assert.deepEqual(loaded.sort(),publicIds.sort());
 const leased=await f.queue.claim(),output=await f.releases.prepare(leased,{signal:new AbortController().signal,progress:async()=>{}});
 await f.queue.complete(leased.id,leased.lease.token,output);
 const candidate=await f.releases.read(output.reviewId),text=await publicationText(candidate);
 assert.ok(text.includes('Selected readable content'));assert.ok(!text.includes('PRIVATE_'));assert.deepEqual(loaded.sort(),publicIds.sort());
 await assert.rejects(f.releases.start({...command,workspaceId:randomUUID()},f.queue),{code:'WORKSPACE_CHANGED'});
 await assert.rejects(f.releases.start({...command,etag:'0'.repeat(64)},f.queue),{code:'CONFLICT'});
 const controller=new AbortController();controller.abort();await assert.rejects(publicationSource(f.workspace,command,{signal:controller.signal}),{name:'AbortError'});
});

test('private retained inputs are checked by pinned membership without entering the edition',async t=>{
 const f=await fixture(t),materials=new ResearchMaterials(f.workspace),records=new ResearchRecords(f.workspace,{}),method=f.book.entries[0],conclusion=f.book.entries[2];
 const pinned=await materials.pinRecord(method.id,recordRevision(method)),bytes=Buffer.from('Condition,Value\nTrial,2\n');
 const intake=await materials.startImport({recordId:method.id,name:'measurements.csv',size:bytes.length,provenance:'Private source',derivesFrom:[pinned]});
 await materials.appendImport(intake.id,0,[bytes]);const artifact=await materials.finishImport(intake.id);
 const column=(name,representation)=>({name,representation,radix:10,unit:'',missing:[{value:'',meaning:'Not acquired'}],time:{kind:'none',reference:'',resolution:'',uncertainty:''}});
 const dataset=await materials.dataset({recordId:method.id,title:'Private measurements',artifact,columns:[column('Condition','text'),column('Value','decimal')]});
 const result=await materials.plot({recordId:conclusion.id,title:'Public result',dataset,base:createFigure(),mapping:{x:0,xKind:'category',values:[{column:1,error:null}],group:null,operation:'mean',kind:'bar',order:'source',mode:'replace',decimal:'.'}});
 await records.save({workspaceId:f.book.id,changes:[{id:conclusion.id,expectedRevision:recordRevision(conclusion),record:{...conclusion,figures:[result.figure]}}]},{compact:true});
 const before=await f.workspace.outline(),command={workspaceId:f.book.id,etag:before.etag},guard=forbidPrivateReads(t,f.book.entries.filter(e=>e.share).map(e=>e.id));
 const first=await f.releases.start(command,f.queue),source=await f.releases.source(first.id);
 assert.deepEqual({...source.researchReview,analysis:undefined},{references:{count:0,items:[]},retainedFigures:1,changedInputs:0,editedFigures:0,analysis:undefined});assert.deepEqual(source.researchReview.analysis.items,[]);assert.ok(!JSON.stringify(source).includes(method.title));
 guard.restore();
 const draft=await f.workspace.read(),unsaved=await f.releases.start(draft,f.queue);
 assert.equal((await f.releases.source(unsaved.id)).researchReview.changedInputs,0,'Unsaved editions resolve related originals across the whole supplied draft');
 await records.save({workspaceId:f.book.id,changes:[{id:method.id,expectedRevision:recordRevision(method),record:{...method,body:'Revised private procedure'}}]},{compact:true});
 forbidPrivateReads(t,f.book.entries.filter(e=>e.share).map(e=>e.id));
 // The original edition keeps its correct historical assessment after an edit.
 assert.equal((await materials.releaseSources(await publicationInputBook(f.workspace,source),[conclusion.id],{sourceEtag:command.etag})).warnings.length,0);
 const second=await f.releases.start({...command,etag:(await f.workspace.outline()).etag},f.queue),changed=await f.releases.source(second.id);
 assert.deepEqual({...changed.researchReview,analysis:undefined},{references:{count:0,items:[]},retainedFigures:1,changedInputs:1,editedFigures:0,analysis:undefined});assert.equal(changed.researchReview.analysis.items.length,1);assert.notEqual(changed.researchReview.analysis.fingerprint,source.researchReview.analysis.fingerprint);
 assert.equal((await f.releases.source(first.id)).researchReview.changedInputs,0);
 await assert.rejects(f.releases.start(command,f.queue),{code:'CONFLICT'});
});
