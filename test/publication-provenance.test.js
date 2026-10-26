import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {attemptFixture} from './fixtures/attempts.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {recordRevision} from '../src/research.js';
import {buildPublication,publicProjection} from '../src/publication.js';
import {EDITION_DETAILS,defaultEditionRecord,selectEditionRecord,validEditionRecord} from '../src/web/publication-selection.js';
import {PublicationEditionSelections} from '../src/publication-edition-selections.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {openPublicationInput} from '../src/publication-input-reader.js';
import {PublicationDocumentBuilder} from '../src/publication-document.js';
import {publicationText} from './publication-fixture.js';
import {websiteDocument} from '../src/web/website-sites-model.js';
import {websiteWorkspace,websiteJobQueue} from '../src/website-workspace.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {Workspace} from '../src/storage.js';
import {copyPlan,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';

function data(){
 const book=upgradeNotebook(sampleNotebook()),[record,publicSource,privateSource]=book.entries;
 for(const row of book.entries){row.figures=[];row.attachments=[];row.sections=[];row.relations=[];row.contributors=[];}
 const target=row=>({workspaceId:book.id,kind:'record',id:row.id,revision:recordRevision(row),label:row.title});
 record.body='Public observation remains available';record.attempt=attemptFixture();
 const input=record.attempt.preparations[0].inputs[0];
 input.label='PRIVATE_INPUT source/repository/driver.c';input.reference=target(privateSource);
 record.attempt.preparations[0].inputs.push({...input,id:randomUUID(),label:'PUBLIC_INPUT',hash:'c'.repeat(64),reference:target(publicSource)},
  {...input,id:randomUUID(),label:'UNLINKED_INPUT',hash:'d'.repeat(64),reference:null});
 record.attempt.events[0].actor='WITHHOLD_ACTOR';record.attempt.events[0].source='WITHHOLD_RECEIPT';
 record.contributors=[{id:randomUUID(),name:'WITHHOLD_CONTRIBUTOR',role:'Author'}];
 const {label,...reference}=target(publicSource);
 record.relations=[{id:randomUUID(),type:'WITHHOLD_RELATION',target:reference,label}];
 record.results={version:1,statements:[{id:randomUUID(),kind:'conclusion',basis:'authored',title:'WITHHOLD_RESULT',text:'WITHHOLD_RESULT_TEXT',limitations:'Limited to this observation',source:null}]};
 return {book,record,privateSource,publicSource};
}

test('public projection withholds private input rows, including labels and hashes, without modifying originals',()=>{
 const {book,record,privateSource}=data(),before=structuredClone(book),projection=publicProjection(book),inputs=projection.entries.find(row=>row.id===record.id).attempt.preparations[0].inputs;
 assert.deepEqual(inputs.map(row=>row.label),['PUBLIC_INPUT','UNLINKED_INPUT']);
 const output=buildPublication(book),text=[...output.files.values()].filter(value=>typeof value==='string').join('\n');
 for(const secret of ['PRIVATE_INPUT','source/repository/driver.c','b'.repeat(64),privateSource.id,privateSource.title])assert.ok(!text.includes(secret),secret);
 for(const visible of ['PUBLIC_INPUT','UNLINKED_INPUT','WITHHOLD_ACTOR','Public observation remains available'])assert.ok(text.includes(visible),visible);
 assert.deepEqual(book,before);
});

test('edition detail choices filter only derivatives and reject unknown or duplicated controls',()=>{
 const {record}=data(),before=structuredClone(record),choice=defaultEditionRecord(record,recordRevision(record));
 assert.equal(Object.hasOwn(choice,'details'),false,'Keep existing authenticated inventory defaults unchanged');
 assert.ok(validEditionRecord(choice));assert.deepEqual(selectEditionRecord(record,choice),record);
 for(const details of [[],...EDITION_DETAILS.map(key=>EDITION_DETAILS.filter(item=>item!==key))]){
  const selected=selectEditionRecord(record,{...choice,details});
  assert.equal(!!selected.attempt,details.includes('attempt'));
  if(selected.attempt)assert.equal(selected.attempt.preparations[0].inputs.length,details.includes('preparationInputs')?3:0);
  assert.equal(selected.relations.length,details.includes('relations')?1:0);
  assert.equal(selected.contributors.length,details.includes('contributors')?1:0);
  assert.equal(!!selected.results,details.includes('results'));assert.equal(selected.body,record.body);
 }
 for(const details of [['unknown'],['attempt','attempt'],null,'attempt'])assert.equal(validEditionRecord({...choice,details}),false);
 assert.deepEqual(record,before);
});

test('named workspace release prepares with saved provenance exclusions and retains them through fresh-key recovery',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-publication-provenance-')),d=data(),websiteId=randomUUID();
 d.book.websites=[{id:websiteId,name:'Independent research website',projectId:null,document:websiteDocument(d.book),projects:d.book.projects.map(({id,share,logoId})=>({id,share,logoId})),selection:{defaultShare:false,includeProjects:d.book.projects.map(row=>row.id),records:[]}}];
 const f=await encryptedFixture(directory,d.book),jobs=workspaceJobs(f.workspace),site=websiteWorkspace(f.workspace,websiteId),releases=new PublicationJobs(site);
 t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const active='project-source-authority:active';
 await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('INSERT INTO state VALUES ($1,$2)',active,store.encode('state',active,{version:1}))));
 const before=await f.workspace.read(),record=before.book.entries.find(row=>row.id===d.record.id),source={workspaceId:d.book.id,...await site.outline()},choices=new PublicationEditionSelections(site),opened=await choices.operate('open',{source});
 const choice={...defaultEditionRecord(record,recordRevision(record)),details:[]};
 const saved=await choices.operate('checkpoint',{selection:opened.selection,commandId:randomUUID(),changes:[{collection:'records',id:record.id,value:choice}]});
 const reopened=new PublicationEditionSelections(websiteWorkspace(new Workspace(f.workspace.root,f.vault),websiteId));
 assert.deepEqual((await reopened.operate('read',{selection:saved.selection,keys:[{collection:'records',id:record.id}]})).items[0].value,choice);
 const job=await releases.start({...source,edition:saved.selection},websiteJobQueue(jobs.queue,websiteId));
 assert.equal(job.input.websiteId,websiteId);
 const claimed=await jobs.queue.claim(),prepared=await jobs.queue.definition(claimed).prepare(claimed,{signal:new AbortController().signal,progress:async()=>{}});
 await jobs.queue.complete(job.id,claimed.lease.token,prepared);assert.equal((await jobs.queue.read(job.id)).state,'completed');
 const candidate=await releases.read(prepared.reviewId),text=await publicationText(candidate);
 for(const secret of ['PRIVATE_INPUT','PUBLIC_INPUT','UNLINKED_INPUT','WITHHOLD_','b'.repeat(64),'c'.repeat(64),'d'.repeat(64)])assert.ok(!text.includes(secret),secret);
 assert.ok(text.includes('Public observation remains available'));assert.deepEqual(await f.workspace.read(),before);
 const pinned=await openPublicationInput(site,await releases.source(job.id));assert.deepEqual((await pinned.get('records',record.id)).selection.details,[]);
 assert.equal((await pinned.record(record.id)).attempt,undefined);
 assert.ok(pinned.document.collectionNames().includes('editionDetails'),'The exact source schema refuses readers predating detail exclusions');
 const sourceInput=await releases.source(job.id),header=await pinned.fullHeader();delete header.editionDetails;
 for(const stripCollection of [false,true]){
  const document=await site.withLock(async()=>{const writer=await PublicationDocumentBuilder.open(site,sourceInput.document);if(stripCollection)delete writer.collections.editionDetails;return writer.finish({header});});
  const altered={...sourceInput,document};
  await assert.rejects(async()=>{const reader=await openPublicationInput(site,altered);await reader.record(record.id);},{code:'JOB_DAMAGED'});
 }
 const access=await createAccess('','Disposable publication recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const root=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'recovered'),{vault:f.vault}),access,vault,f.vault),restored=new Workspace(root,vault),restoredSite=websiteWorkspace(restored,websiteId);
 assert.deepEqual((await restored.read()).book.entries.find(row=>row.id===record.id),record);
 const restoredChoices=new PublicationEditionSelections(restoredSite);assert.deepEqual((await restoredChoices.operate('read',{selection:saved.selection,keys:[{collection:'records',id:record.id}]})).items[0].value,choice);
 assert.equal(await publicationText(await new PublicationJobs(restoredSite).read(candidate.reviewId)),text);
});
