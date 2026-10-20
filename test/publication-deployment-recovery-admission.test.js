import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest,serialize} from '../src/storage.js';
import {PublicationJobs} from '../src/publication-jobs.js';

function fixture(){
 const id=randomUUID(),scope=randomUUID(),intent={reviewId:'a'.repeat(64),releaseId:'b'.repeat(64),key:'c'.repeat(64),config:{kind:'github'}},deployment={version:1,id,scope,intent,journal:{pushAttempted:true,commit:'d'.repeat(40)}};
 const job={format:1,id,type:'publication.deploy',scope,input:{revision:digest(serialize(intent))}},active={id},metadata={id:scope};
 const values=new Map([['.observanda/deployments/'+id+'.json',deployment],['.observanda/jobs/'+id+'.json',job],['.observanda/deployment-active/'+intent.key+'.json',active]]);
 const workspace={websiteContext:true,websiteId:null,metadataPath:name=>name,readMetadata:async name=>values.has(name)?serialize(values.get(name)):null,currentOutline:async()=>({metadata})},releases=new PublicationJobs(workspace),read=[];
 releases.stored=async reviewId=>{read.push(reviewId);return null;};
 return {id,scope,intent,deployment,job,active,metadata,releases,read};
}

test('deployment recovery cannot open output without matching persisted activation and job authority',async()=>{
 for(const [label,change,code] of [
  ['unattempted',f=>{f.deployment.journal.pushAttempted=false;},'JOB_DAMAGED'],
  ['missing activation commit',f=>{delete f.deployment.journal.commit;},'JOB_DAMAGED'],
  ['changed intent',f=>{f.intent.reviewId='e'.repeat(64);},'JOB_CHANGED'],
  ['different job',f=>{f.job.id=randomUUID();},'JOB_CHANGED'],
  ['invalid job format',f=>{f.job.format=0;},'JOB_CHANGED'],
  ['inactive deployment',f=>{f.active.id=randomUUID();},'JOB_CHANGED'],
  ['different owner',f=>{f.metadata.id=randomUUID();},'WORKSPACE_CHANGED']
 ]){
  const f=fixture();change(f);await assert.rejects(f.releases.readForDeploymentRecovery(f.id),{code},label);assert.deepEqual(f.read,[],label+' must not read retained output');
 }
 const f=fixture();await assert.rejects(f.releases.readForDeploymentRecovery('../other'),{code:'INVALID'});assert.deepEqual(f.read,[]);
 await assert.rejects(f.releases.readForDeploymentRecovery(f.id),{code:'JOB_DAMAGED'});assert.deepEqual(f.read,[f.intent.reviewId],'A valid persisted attempt selects only its own exact edition');
});

test('SSH recovery requires the attempted release identity as its activation commit',async()=>{
 const f=fixture();f.intent.config.kind='ssh';f.job.input.revision=digest(serialize(f.intent));
 await assert.rejects(f.releases.readForDeploymentRecovery(f.id),{code:'JOB_DAMAGED'});assert.deepEqual(f.read,[]);
 f.deployment.journal.commit=f.intent.releaseId;await assert.rejects(f.releases.readForDeploymentRecovery(f.id),{code:'JOB_DAMAGED'});assert.deepEqual(f.read,[f.intent.reviewId]);
});


test('older retained database editions bind recovery to their authenticated captured owner',async()=>{
 for(const kind of ['matching','wrong input','wrong explicit owner','missing current owner']){
  const f=fixture(),inputReads=[],contentsReads=[],outputReached=Error('Retained output admission reached');
  const candidate={version:kind==='missing current owner'?3:2,id:f.intent.releaseId,reviewId:f.intent.reviewId,jobId:randomUUID(),blockedValues:[],...(kind==='wrong explicit owner'?{workspaceId:randomUUID()}:{})};
  f.releases.stored=async()=>candidate;
  f.releases.source=async id=>{inputReads.push(id);return {workspaceId:kind==='wrong input'?randomUUID():f.scope};};
  f.releases.contents=async function*(){contentsReads.push(candidate.reviewId);throw outputReached;};
  await assert.rejects(f.releases.readForDeploymentRecovery(f.id),kind==='matching'?error=>error===outputReached:{code:'JOB_DAMAGED'},kind);
  assert.deepEqual(inputReads,['matching','wrong input'].includes(kind)?[candidate.jobId]:[],kind);
  assert.deepEqual(contentsReads,kind==='matching'?[candidate.reviewId]:[],kind);
 }
});
