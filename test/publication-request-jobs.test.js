import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {comparisonFixture} from './analysis-comparison-fixture.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {AnalysisPublicationReview} from '../src/analysis-publication-review.js';
import {AnalysisPublicationReviewJobs,verifyAnalysisPublicationOperations} from '../src/analysis-publication-review-jobs.js';
import {PublicationSourceAccess} from '../src/publication-source-access.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {Workspace} from '../src/storage.js';
import {AppError} from '../src/errors.js';

async function fixture(t){
 const f=await comparisonFixture(t,{groups:2}),analysis=await f.m.comparisons.save(f.command),previous=await f.m.read(f.dataset),column=(await f.m.retainedSchemaPage(previous,{limit:1})).items[0];
 await f.m.dataset({recordId:f.recordId,title:previous.title,id:f.dataset.id,expectedRevision:f.dataset.revision,artifact:f.artifact,baseDataset:f.dataset,columnChanges:[{index:0,column:{...column,unit:'ticks'}}]});
 const current=await f.workspace.read(),record=current.book.entries.find(value=>value.id===f.recordId);record.share=true;record.results={version:1,statements:Array.from({length:7},(_,index)=>({id:randomUUID(),kind:'conclusion',title:'Interpretation '+index,text:'A retained interpretation for explicit review.',basis:'retained',source:analysis,limitations:'Synthetic qualification.'}))};await f.workspace.save(current.book,current.etag);
 const releases=new PublicationJobs(f.workspace),outline=await releases.workspace.outline(),candidate=await releases.inline({etag:outline.etag,websitePin:outline.websitePin}),review=new AnalysisPublicationReview(releases.workspace),page=await review.window(candidate,{limit:32}),decisions=page.items.map(item=>({id:item.id,reason:'Retain the original interpretation and disclose the changed input.'}));
 assert.equal(decisions.length,7);return {...f,releases,candidate,review,decisions};
}
async function run(jobs,id){jobs.worker.enabled=true;try{await jobs.worker.runOnce();}finally{jobs.worker.enabled=false;}return jobs.queue.read(id);}

test('queued analysis review retains seven decisions across restart and commits one exact receipt',async t=>{
 const f=await fixture(t),jobs=workspaceJobs(f.workspace),service=new AnalysisPublicationReviewJobs(f.workspace),command={id:f.candidate.reviewId,commandId:randomUUID(),decisions:f.decisions},job=await service.start(command,jobs.queue);
 assert.equal(job.state,'queued');assert.equal(await f.review.read(f.candidate),null);await assert.rejects(f.review.assert(f.candidate),{code:'ANALYSIS_REVIEW'});
 assert.equal((await service.start(command,jobs.queue)).id,job.id);await assert.rejects(service.start({...command,decisions:[{...f.decisions[0],reason:'Different intent'}]},jobs.queue),{code:'JOB_CHANGED'});
 const reopened=new Workspace(f.workspace.root,f.vault),restarted=workspaceJobs(reopened),again=new AnalysisPublicationReviewJobs(reopened);assert.equal((await again.current(command.id,undefined,restarted.queue)).id,job.id);
 const done=await run(restarted,job.id);assert.equal(done.state,'completed',done.error);assert.equal(done.result.decided,7);assert.equal(done.result.reviewed,true);assert.deepEqual(done.result.decisions,f.decisions);
 assert.equal((await f.review.verify(f.candidate)).decided,7);await f.review.assert(f.candidate);await verifyAnalysisPublicationOperations(f.releases.workspace);
 const fresh=f.review.fresh;t.mock.method(AnalysisPublicationReview.prototype,'fresh',()=>assert.fail('Completed acknowledgement must not recheck current inputs'));
 assert.equal((await again.start(command,restarted.queue)).state,'completed');AnalysisPublicationReview.prototype.fresh.mock.restore();assert.equal(f.review.fresh,fresh);
});

test('review cancellation and a changed local snapshot leave all decisions unapplied',async t=>{
 const f=await fixture(t),jobs=workspaceJobs(f.workspace),service=new AnalysisPublicationReviewJobs(f.workspace),command={id:f.candidate.reviewId,commandId:randomUUID(),decisions:f.decisions},queued=await service.start(command,jobs.queue),claimed=await jobs.queue.claim(),definition=jobs.queue.definition(claimed),options={signal:new AbortController().signal,progress:async()=>{}};
 const prepared=await definition.prepare(claimed,options),checked=await definition.beforeComplete(claimed,prepared,options);
 const current=await f.workspace.read();current.book.title+=' changed';await f.workspace.save(current.book,current.etag);
 await assert.rejects(jobs.queue.transaction(()=>definition.commit(claimed,checked)),{code:'ANALYSIS_REVIEW'});assert.equal(await f.review.read(f.candidate),null);
 await service.control(jobs.queue,queued.id,'cancel');await jobs.queue.release(claimed.id,claimed.lease.token,{error:new AppError('JOB_CANCELLED')});assert.equal((await jobs.queue.read(queued.id)).state,'cancelled');assert.equal(await f.review.read(f.candidate),null);
 const replacement=await service.start({...command,commandId:randomUUID()},jobs.queue);
 await assert.rejects(service.control(jobs.queue,queued.id,'retry'),{code:'JOB_CHANGED'});
 assert.equal((await service.current(command.id,undefined,jobs.queue)).id,replacement.id);
 assert.equal((await jobs.queue.read(queued.id)).state,'cancelled');
});

test('interrupted analysis authorization retains its exact submitted decisions for explicit retry',async t=>{
 const f=await fixture(t),grants=new PublicationSourceAccess(),jobs=workspaceJobs(f.workspace,undefined,{sourceAccess:grants}),sourceReader=async()=>{throw Error('Unused reader');};sourceReader.materialAccess=()=>{throw new AppError('ACCESS_LOCKED');};
 const service=new AnalysisPublicationReviewJobs(f.workspace,undefined,{sourceReader,sourceAccess:grants}),command={id:f.candidate.reviewId,commandId:randomUUID(),decisions:f.decisions},job=await service.start(command,jobs.queue),failed=await run(jobs,job.id);
 assert.equal(failed.state,'failed');assert.equal(failed.error,'ACCESS_LOCKED');assert.equal(await f.review.read(f.candidate),null);assert.deepEqual(failed.input.request.decisions,f.decisions);
 await new AnalysisPublicationReviewJobs(f.workspace).control(jobs.queue,job.id,'retry');const done=await run(jobs,job.id);assert.equal(done.state,'completed',done.error);assert.equal(done.id,job.id);assert.equal(done.result.decided,7);
});
