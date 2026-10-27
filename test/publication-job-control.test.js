import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicationJobControlRoutes,publicationJobControlRequest} from '../src/publication-job-policy.js';
import {executePublicationJobControl} from '../src/publication-job-control.js';
import {projectPublicationRequest} from '../src/project-publication-requests.js';
import {requestLane} from '../src/request-admission.js';
import {workspaceSnapshotRequest} from '../src/workspace-read-admission.js';
import {websiteEditorReads,websiteEditorOperations} from '../src/website-editor-policy.js';
import {AppError} from '../src/errors.js';

test('every publication control declares consistent transport, ownership, admission and privacy policy',()=>{
 const owner=randomUUID();
 for(const [name,contract] of Object.entries(publicationJobControlRoutes)){
  const route='/api/publication-jobs/'+name,selected=projectPublicationRequest(route);
  assert.equal(contract.method,'POST');assert.equal(contract.input,'json');assert.equal(contract.authority,'unlocked-selected-owner');assert.equal(contract.owner,'selected-website');assert.ok(contract.limit>0);assert.ok(contract.schema);assert.ok(contract.output);assert.ok(contract.cancellation);
  assert.equal(Object.hasOwn(selected,'operation'),false);assert.equal(selected.write,contract.write);assert.equal(selected.limit,contract.limit);assert.equal(requestLane(contract.method,route),contract.admission);assert.equal(requestLane(contract.method,'/api/projects/'+owner+'/'+route.slice(5)),contract.admission);assert.equal(workspaceSnapshotRequest(contract.method,route),contract.snapshot);
 }
 assert.equal(publicationJobControlRequest('/api/publication-jobs/__proto__'),null);assert.equal(publicationJobControlRequest('/api/publication-jobs/unknown'),null);
});
function context(contract){
 const job={id:randomUUID(),type:contract.jobType,state:'queued',attempt:0,privateInput:'withheld-sentinel'},calls=[];
 const authorize=async()=>calls.push('authorize'),control=async(_queue,id,action)=>{calls.push(action);return {...job,state:action==='cancel'?'cancelled':'queued'};};
 const queue={read:async id=>id===job.id?job:null,authorize,diagnostic:async()=>{calls.push('diagnostic');return {stage:'synthetic'};}};
 return {job,calls,options:{queue,releases:{control},reviews:{authorize,control},worker:{cancel:()=>calls.push('cancel-worker'),wake:()=>calls.push('wake')},check:async()=>calls.push('check')}};
}
test('all registered controls authorize their exact job type and return only the declared result',async()=>{
 for(const [name,contract] of Object.entries(publicationJobControlRoutes)){
  const {job,calls,options}=context(contract),result=await executePublicationJobControl(name,{id:job.id},options);
  assert.deepEqual(calls.slice(0,3),['check','authorize','check']);assert.doesNotMatch(JSON.stringify(result),/withheld-sentinel/);
  if(contract.action==='diagnostics')assert.deepEqual(result,{diagnostic:{stage:'synthetic'}});else assert.equal(result.job.id,job.id);
  if(contract.write)assert.ok(calls.includes(contract.action==='cancel'?'cancel-worker':'wake'));else assert.equal(calls.some(value=>value==='cancel-worker'||value==='wake'),false);
 }
});
test('wrong owner, wrong type, malformed input and cancellation cannot reach diagnostics or mutations',async()=>{
 for(const [name,contract] of Object.entries(publicationJobControlRoutes)){
  for(const failure of ['authority','type','cancel','malformed','extra','attempt']){
   const {job,calls,options}=context(contract);let data={id:job.id};
   if(failure==='authority'){const deny=async()=>{throw new AppError('ACCESS_DENIED');};options.queue.authorize=deny;options.reviews.authorize=deny;}
   if(failure==='type')job.type='unrelated.job';
   if(failure==='cancel'){const controller=new AbortController();controller.abort();options.signal=controller.signal;}
   if(failure==='malformed')data={id:'invalid'};
   if(failure==='extra')data={id:job.id,grant:'forged'};if(failure==='attempt')data={id:job.id,attempt:-1};
   await assert.rejects(executePublicationJobControl(name,data,options));assert.equal(calls.some(value=>['diagnostic','cancel','retry','cancel-worker','wake'].includes(value)),false);
  }
 }
});

test('every website editor operation is routed under independent owners with its declared write policy',()=>{
 for(const operation of websiteEditorOperations){const request=projectPublicationRequest('/api/websites/editor/'+operation);assert.equal(request?.publication,'websites/editor/'+operation);assert.equal(request.write,!websiteEditorReads.includes(operation));}
});
