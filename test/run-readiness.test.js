import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {intakeFixture,hash} from './fixtures/local-intake.js';
import {RunReadiness} from '../src/run-readiness.js';
import {ResearchRecords,recordRevision} from '../src/research.js';
import {ResearchMaterials} from '../src/research-materials.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {publicationText} from './publication-fixture.js';

const validation=(f,view)=>({...f.command,id:randomUUID(),kind:'validation',expectedRevision:view.revision,expectedEvidenceRevision:view.evidenceRevision,sourceRevision:'PRIVATE source revision one',sourceSha256:hash('private source'),statement:'PRIVATE validation scope',tool:'Synthetic validator',toolVersion:'1',toolSha256:hash('validator')});
async function apply(f){const preview=await f.service.preview(f.command),command={...f.command,expectedPin:preview.pin};await f.service.stage(command);await f.worker.runOnce();await f.service.apply(command);await f.worker.runOnce();const result=await f.service.status(command);assert.equal(result.state,'completed');return result.receipt;}

test('first receipt can be linked directly without opening readiness first',async t=>{
 const f=await intakeFixture(t),ready=new RunReadiness(f.ws),command=validation(f,{revision:f.manifest.expectedRevision}),store=ready.receiptStore(f.record.id);
 assert.equal(await store.metadata(),null);
 await assert.rejects(ready.link({...command,expectedRevision:hash('outdated record')}),{code:'RECORD_CHANGED'});assert.equal(await store.metadata(),null);
 const receipt=await ready.link(command);assert.equal(receipt.recordRevision,command.expectedRevision);assert.deepEqual(await ready.link(command),receipt);assert.equal((await store.page()).total,1);
 assert.equal((await ready.view(f.command)).receipts[0].current,true);
});

test('manual receipts pin record and evidence, reject stale forms, replay lost responses and enforce completion atomically',async t=>{
 const f=await intakeFixture(t),ready=new RunReadiness(f.ws),records=new ResearchRecords(f.ws,{}),materials=new ResearchMaterials(f.ws);
 let view=await ready.view(f.command);const initial=validation(f,view),receipt=await ready.link(initial);
 assert.equal(receipt.source.revision,initial.sourceRevision);assert.equal(receipt.tool.sha256,initial.toolSha256);
 const other=f.book.entries[1],otherRef=await f.ws.withLock(()=>materials.retainRecord(other));await materials.analysis({recordId:other.id,title:'Unrelated analysis',tool:'Synthetic',version:'1',parameters:'',inputs:[otherRef],outputs:[]});
 assert.equal((await ready.view(f.command)).receipts[0].current,true);
 const acquired=await apply(f);view=await ready.view(f.command);assert.equal(view.receipts.find(r=>r.id===receipt.id).current,false);assert.equal(view.receipts.find(r=>r.id===receipt.id).evidenceChanged,true);
 await assert.rejects(ready.link({...initial,id:randomUUID()}),{code:'INTAKE_CHANGED'});
 assert.deepEqual(await ready.link(initial),receipt);
 const review=validation(f,view);await ready.link(review);await ready.setPolicy({...f.command,expectedProjectId:view.projectId,expectedPolicy:view.policy.etag,required:['validation','git']});
 const save=async record=>records.save({workspaceId:f.book.id,changes:[{id:record.id,expectedRevision:recordRevision((await f.ws.read()).book.entries.find(r=>r.id===record.id)),record}]},{receipt:true});
 await assert.rejects(save({...f.record,status:'completed'}),{code:'INTAKE_COMPLETION'});
 const git={...review,id:randomUUID(),kind:'git',repository:'PRIVATE repository',commit:'a'.repeat(40)};await ready.link(git);
 const head=(await materials.list({recordId:f.record.id,kind:'analysis'})).items[0],doc=await materials.read(head);
 await materials.analysis({recordId:f.record.id,id:head.id,expectedRevision:head.revision,title:head.title,tool:doc.content.tool,parameters:doc.content.parameters,inputs:acquired.files,outputs:[],version:'2'});
 await assert.rejects(save({...f.record,status:'completed'}),{code:'INTAKE_COMPLETION'});
 view=await ready.view(f.command);assert.deepEqual(view.missing,['validation','git']);
 await ready.link({...review,id:randomUUID(),expectedEvidenceRevision:view.evidenceRevision});await ready.link({...git,id:randomUUID(),expectedEvidenceRevision:view.evidenceRevision});await save({...f.record,status:'completed'});
 assert.deepEqual((await ready.view(f.command)).missing,[]);
 assert.deepEqual(await ready.link(initial),receipt);await assert.rejects(ready.link({...initial,statement:'Changed request'}),{code:'INTAKE_CHANGED'});
 const read=ResearchCatalogue.prototype.read;ResearchCatalogue.prototype.read=()=>{throw Error('Readiness must not load the whole book');};try{await ready.view(f.command);}finally{ResearchCatalogue.prototype.read=read;}
 const backup=await copyWorkspace(await copyPlan(f.ws.root,path.join(f.directory,'backup')),{vault:f.vault}),restored=new RunReadiness(new Workspace(backup,f.vault));assert.deepEqual(await restored.view(f.command),await ready.view(f.command));
});

test('receipt edition selection respects each website, exact record revisions and completed preparations',async t=>{
 const f=await intakeFixture(t),ready=new RunReadiness(f.ws),sites=new WebsiteSites(f.ws),projectId=f.book.notebooks.find(n=>n.id===f.record.notebookId).projectId;
 const create=async(name,include)=>{
  const {id}=await sites.change({workspaceId:f.book.id,etag:(await f.ws.outline()).etag,operation:'create',name}),current=await sites.read(id);
  await sites.save(id,{workspaceId:f.book.id,baseEtag:current.etag,metadata:{},projects:[],changes:[],removed:[],selection:{defaultShare:false,includeProjects:[],records:[{id:include.id,share:true,attachments:[]}]}});return id;
 };
 const a=await create('Journal',f.record),b=await create('Different selection',f.book.entries[1]);
 const edition=async websiteId=>new PublicationJobs(websiteWorkspace(f.ws,websiteId)).inline({etag:(await f.ws.outline()).etag});
 const first=await edition(a),other=await edition(b),view=await ready.view(f.command),options={...f.command,expectedRevision:view.revision,websiteId:a};
 const available=await ready.editions(options);assert.equal(available.items.length,1);assert.equal(available.items[0].current,true);assert.equal(available.items[0].releaseId,first.id);
 assert.equal((await ready.editions({...options,websiteId:b})).items.length,0);
 const command={...options,id:randomUUID(),kind:'publication',publicationJob:first.jobId,expectedEvidenceRevision:view.evidenceRevision};const receipt=await ready.link(command);assert.equal(receipt.publication.websiteId,a);assert.equal(receipt.publication.websiteName,'Journal');
 await assert.rejects(ready.link({...command,id:randomUUID(),websiteId:b}),{code:'NOT_FOUND'});
 await assert.rejects(ready.link({...command,id:randomUUID(),websiteId:b,publicationJob:other.jobId}),{code:'INTAKE_RECEIPT'});
 await new ResearchRecords(f.ws,{}).save({workspaceId:f.book.id,changes:[{id:f.record.id,expectedRevision:view.revision,record:{...f.record,title:'Amended narrative'}}]},{receipt:true});
 const amended=await ready.view(f.command);assert.equal(amended.receipts[0].current,false);
 const older=await ready.editions({...options,expectedRevision:amended.revision});assert.equal(older.items[0].current,false);
 await assert.rejects(ready.link({...command,id:randomUUID(),expectedRevision:amended.revision}),{code:'INTAKE_RECEIPT'});
 assert.deepEqual(await ready.link(command),receipt);
 const next=await edition(a),latest=await ready.editions({...options,expectedRevision:amended.revision});assert.equal(latest.items.find(e=>e.releaseId===next.id).current,true);assert.equal(latest.items.find(e=>e.releaseId===first.id).current,false);
});

test('continuing intake replays once, amends an analysis and regenerates selected output while retaining the earlier edition',async t=>{
 const f=await intakeFixture(t),materials=new ResearchMaterials(f.ws),records=new ResearchRecords(f.ws,{}),ready=new RunReadiness(f.ws),sites=new WebsiteSites(f.ws),projectId=f.book.notebooks.find(n=>n.id===f.record.notebookId).projectId;
 const {id:siteId}=await sites.change({workspaceId:f.book.id,etag:(await f.ws.outline()).etag,operation:'create',name:'Selected journal'}),site=await sites.read(siteId);
 await sites.save(siteId,{workspaceId:f.book.id,baseEtag:site.etag,metadata:{},projects:[],changes:[],removed:[],selection:{defaultShare:false,includeProjects:[],records:[{id:f.record.id,share:true,attachments:[]}]}});
 const releases=new PublicationJobs(websiteWorkspace(f.ws,siteId)),statementId=randomUUID(),editions=[],inputs=[];
 for(const number of [1,2]){
  const current=(await f.ws.read()).book.entries.find(r=>r.id===f.record.id);
  if(number===2){f.manifest.id=randomUUID();f.command.id=f.manifest.id;f.manifest.expectedRevision=recordRevision(current);f.manifest.files=[];f.manifest.purpose='amendment';f.manifest.source.revision='PRIVATE source revision two';f.manifest.source.sha256=hash('PRIVATE source revision two');f.manifest.analyses[0].expectedRevision=inputs[0].analyses[0].revision;f.manifest.analyses[0].inputs=inputs[0].files;f.manifest.analyses[0].version='2';await f.write();}
  const receipt=await apply(f);inputs.push(receipt);
  assert.deepEqual((await f.service.apply({...f.command,expectedPin:receipt.pin})).receipt,receipt);
  const result={id:statementId,kind:'conclusion',basis:'retained',source:receipt.analyses[0],title:'Bounded result',text:'Verified interpretation '+number,limitations:'Synthetic only; physical behavior unqualified.'};
  await records.save({workspaceId:f.book.id,changes:[{id:current.id,expectedRevision:recordRevision(current),record:{...current,results:{version:1,statements:[result]}}}]},{receipt:true});
  const view=await ready.view(f.command);await ready.link({...validation(f,view),sourceRevision:f.manifest.source.revision,sourceSha256:f.manifest.source.sha256});
  const edition=await releases.inline({etag:(await f.ws.outline()).etag});editions.push(edition);await ready.link({...f.command,id:randomUUID(),kind:'publication',websiteId:siteId,publicationJob:edition.jobId,expectedRevision:view.revision,expectedEvidenceRevision:view.evidenceRevision});
  const text=await publicationText(edition);assert.ok(text.includes(result.text));assert.ok(!text.includes('PRIVATE'));assert.ok(!text.includes(f.source));
 }
 assert.equal((await materials.list({recordId:f.record.id,kind:'artifact'})).items.length,1);assert.equal((await materials.list({recordId:f.record.id,kind:'analysis'})).items.length,1);
 assert.equal((await materials.read(inputs[0].analyses[0])).content.version,'1.0');assert.equal((await materials.read(inputs[1].analyses[0])).previous,inputs[0].analyses[0].revision);
 const original=await publicationText(await releases.read(editions[0].reviewId));assert.ok(original.includes('Verified interpretation 1'));assert.ok(!original.includes('Verified interpretation 2'));
 const view=await ready.view(f.command);assert.equal(view.receipts.filter(r=>r.kind==='publication'&&r.current).length,1);assert.equal(view.receipts.filter(r=>r.kind==='publication'&&!r.current).length,1);
});
