import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {recordRevision} from '../src/research.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {publicationReferences,revisionPageId} from '../src/publication-revisions.js';
import {defaultEditionRecord} from '../src/web/publication-selection.js';
import {contentBuffer} from '../src/file-content.js';
import {publicationText} from './publication-fixture.js';
import {verifyPublicationCandidate} from '../src/retained-publication-files.js';
import {PublicationLinks} from '../src/publication-links.js';
import {PublicationRollback} from '../src/publication-rollback.js';
import {Publisher,defaultPublishing} from '../src/publishing.js';
import {DeploymentJobs} from '../src/deployment-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {githubFixture} from './github-fixture.js';

import {historicalFixture} from './publication-revisions-fixture.js';
test('explicit old revision publishes exact selected text at a stable page and survives later changes',async t=>{
 const f=await historicalFixture(t),choice=defaultEditionRecord(f.old,f.target.revision);choice.sections=[];
 const edition={version:1,records:[],history:[choice]},candidate=await f.releases.inline({...f.source,edition}),id=revisionPageId(f.book.id,f.old.id,f.target.revision),text=await publicationText(candidate);
 const page=(await contentBuffer(await candidate.files.get('entries/'+id+'.html'))).toString(),run=(await contentBuffer(await candidate.files.get('entries/'+f.run.id+'.html'))).toString();
 assert.match(page,/Exact older procedure/);assert.match(page,/Retained revision:/);assert.ok(page.includes(f.target.revision),page.match(/Retained revision:[^<]*/)?.[0]+' expected '+f.target.revision);assert.ok(!page.includes('New procedure'));assert.ok(run.includes('entries/'+id+'.html'));
 for(const secret of ['HISTORICAL_PRIVATE_INSTRUCTIONS','Withheld instructions','PRIVATE_REFERENCE_LABEL',f.book.entries[2].title])assert.ok(!text.includes(secret),secret);
 assert.ok(!(await contentBuffer(await candidate.files.get('browse.html'))).toString().includes(id));await verifyPublicationCandidate(candidate);
 const saved=await f.workspace.read();saved.book.entries.find(r=>r.id===f.method.id).body='Newest procedure';await f.workspace.save(saved.book,saved.etag);
 assert.equal(await publicationText(await f.releases.read(candidate.reviewId)),text);
 const next=await f.releases.inline({...f.source,...await f.releases.workspace.outline(),edition});assert.ok(await next.files.has('entries/'+id+'.html'));
});
test('excluded references expose only the approved statement and reject unrelated history/notes',async t=>{
 const f=await historicalFixture(t),edition={version:1,records:[],availability:[{recordId:f.run.id,target:f.target,statement:'The method is available on request.'}]},candidate=await f.releases.inline({...f.source,edition}),text=await publicationText(candidate);
 assert.match(text,/The method is available on request/);for(const secret of [f.target.revision,'Exact older procedure','PRIVATE_REFERENCE_LABEL','HISTORICAL_PRIVATE_INSTRUCTIONS'])assert.ok(!text.includes(secret),secret);
 assert.equal(candidate.researchReview.references.count,1);
 await assert.rejects(f.releases.inline({...f.source,edition:{...edition,availability:[{...edition.availability[0],target:{...f.target,id:randomUUID()}}]}}),{code:'INVALID'});
 await assert.rejects(f.releases.inline({...f.source,edition:{version:1,records:[],history:[defaultEditionRecord({...f.old,id:randomUUID()},f.target.revision)]}}),{code:'INVALID'});
});
test('authenticated revision review is bounded, returns exact text and rejects stale selection',async t=>{
 const f=await historicalFixture(t),loaded=[],read=ResearchCatalogue.prototype.read,record=ResearchCatalogue.prototype.record;
 ResearchCatalogue.prototype.read=()=>{throw Error('Whole workspace read');};ResearchCatalogue.prototype.record=function(id,...args){loaded.push(id);return record.call(this,id,...args);};
 try{
  const result=await publicationReferences(f.workspace,{source:f.source,recordId:f.run.id});assert.equal(result.items.length,1);assert.equal(result.items[0].preview.body,'Exact older procedure');assert.equal(result.items[0].record.choice.revision,f.target.revision);assert.deepEqual(loaded,[f.run.id]);
 }finally{ResearchCatalogue.prototype.read=read;ResearchCatalogue.prototype.record=record;}
 await assert.rejects(publicationReferences(f.workspace,{source:{...f.source,etag:'0'.repeat(64),websitePin:{...f.source.websitePin,researchSnapshotId:'0'.repeat(64)}},recordId:f.run.id}),{code:'CONFLICT'});
 await assert.rejects(publicationReferences(f.workspace,{source:f.source,recordId:f.run.id,choice:{include:true}}),{code:'INVALID'});
});

test('historical methods and chapter fragments survive interrupted publication, newer authoring and reviewed rollback',async t=>{
 const f=await historicalFixture(t),remote=githubFixture(),publisher=new Publisher(f.workspace.root,{request:remote.request},f.vault),config=defaultPublishing();
 Object.assign(config.github,{owner:'example',repository:'notebook',branch:'observanda-site',pages:false});config.publicUrl='https://public.example/research/';const saved=await publisher.save(config,'new');await publisher.connect('synthetic_github_token_1234567890');
 const jobs=workspaceJobs(f.workspace,publisher),deployments=new DeploymentJobs(f.workspace,publisher,jobs.queue);
 const work=async()=>{const job=await jobs.queue.claim();try{return await jobs.queue.complete(job.id,job.lease.token,await jobs.queue.definition(job).prepare(job,{signal:new AbortController().signal,progress:p=>jobs.queue.pulse(job.id,job.lease.token,p)}));}catch(error){return jobs.queue.release(job.id,job.lease.token,{error});}};
 const links=new PublicationLinks(f.workspace);await links.save({workspaceId:f.book.id,etag:'new',config:{version:1,pages:[{id:randomUUID(),path:'archive/experiment.html',title:'Earlier experiment',anchors:[{id:randomUUID(),fragment:'run',label:'Run report',target:{workspaceId:f.book.id,kind:'record',id:f.run.id}},{id:randomUUID(),fragment:'method',label:'Method used',target:f.target}]}]}});
 const prepare=async()=>{const current=await f.workspace.read(),method=current.book.entries.find(r=>r.id===f.method.id),old=defaultEditionRecord(f.old,f.target.revision);old.sections=[];return f.releases.inline({workspaceId:f.book.id,...await f.releases.workspace.outline(),edition:{version:1,records:[{...defaultEditionRecord(method,recordRevision(method)),include:false}],history:[old]}});};
 const first=await prepare(),reviewId=first.reviewId,intent={id:reviewId,configEtag:saved.etag,reviewed:true};
 let once=true;remote.setHook((call,phase)=>{if(once&&call.route.endsWith('/git/refs')&&phase==='after'){once=false;throw Error('Lost publication response');}});
 const job=await deployments.start(intent);assert.equal((await work()).state,'failed');assert.ok(remote.head);remote.setHook(null);await jobs.queue.control(job.id,'retry');assert.equal((await work()).state,'completed');assert.equal(remote.commits.size,1);
 const local=await f.workspace.read();local.book.entries.find(r=>r.id===f.run.id).title='A revised run report';local.book.entries.find(r=>r.id===f.method.id).body='PRIVATE_LATEST_METHOD_COMMAND';await f.workspace.save(local.book,local.etag);
 const next=await prepare(),plan=await publisher.reviewDestination(next,saved.etag);await deployments.start({id:next.reviewId,configEtag:saved.etag,reviewed:true,destinationReview:plan.id,destinationReviewed:true});assert.equal((await work()).state,'completed');
 const rollback=new PublicationRollback(f.workspace,publisher),approval=await rollback.review({id:reviewId}),restorePlan=await publisher.reviewDestination(first,saved.etag);
 await deployments.start({...intent,rollbackReview:approval.review.id,rollbackConfirmed:true,destinationReview:restorePlan.id,destinationReviewed:true});assert.equal((await work()).state,'completed');
 remote.setManifest(await contentBuffer(await first.files.get('publication.json')));const verified=await publisher.verifyLive();assert.ok(verified.verification.files>0);
 const id=revisionPageId(f.book.id,f.method.id,f.target.revision),tree=remote.trees.get(remote.commits.get(remote.head).tree),read=name=>remote.blobs.get(tree.find(e=>e.path===name).sha).toString();
 assert.match(read('entries/'+id+'.html'),/Exact older procedure/);assert.ok(read('archive/experiment.html').includes('href="../entries/'+id+'.html"'));assert.match(read('archive/experiment.html'),/id="run"/);assert.match(read('archive/experiment.html'),/id="method"/);
 assert.ok(!read('entries/'+f.run.id+'.html').includes('A revised run report'));assert.equal((await f.workspace.read()).book.entries.find(r=>r.id===f.run.id).title,'A revised run report');
 for(const bytes of remote.blobs.values())for(const secret of ['PRIVATE_LATEST_METHOD_COMMAND','HISTORICAL_PRIVATE_INSTRUCTIONS','PRIVATE_REFERENCE_LABEL',f.workspace.root])assert.ok(!bytes.includes(Buffer.from(secret)),secret);
});
