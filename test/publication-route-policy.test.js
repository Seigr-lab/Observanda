import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {publicationRoutes,projectPublicationRequest} from '../src/project-publication-requests.js';
import {projectRequest} from '../src/project-application.js';
import {projectContentHttp} from '../src/project-content-http.js';
import {workspaceSnapshotRequest} from '../src/workspace-read-admission.js';
import {requestLane} from '../src/request-admission.js';

const id='00000000-0000-4000-8000-000000000001';
test('all declared publication routes share transport, capacity and lifecycle policy across owners',()=>{
 for(const [operation,contract] of Object.entries(publicationRoutes)){
  const route='/api/'+operation;assert.ok(Object.isFrozen(contract));
  for(const key of ['method','input','schema','authority','owner','admission','cancellation','output'])assert.equal(typeof contract[key],'string',operation+': '+key);
  assert.equal(projectPublicationRequest(route,contract.method),contract);
  assert.equal(requestLane(contract.method,route),contract.admission);
  assert.equal(workspaceSnapshotRequest(contract.method,route),contract.snapshot);
  const wrong=contract.method==='GET'?'POST':'GET';assert.equal(projectPublicationRequest(route,wrong),null);assert.equal(workspaceSnapshotRequest(wrong,route),false);
  const selected=projectRequest('/api/projects/'+id+'/'+operation,contract.method);assert.ok(selected,operation);
  // workspace/save has its own owner lifecycle adapter; other publication
  // commands carry the exact contract through the common content transport.
  if(operation!=='workspace/save')for(const key of Object.keys(contract))assert.equal(selected[key],contract[key],operation+': '+key);
 }
 for(const operation of ['__proto__','constructor','websites/unknown','publication-jobs/status/extra'])assert.equal(projectPublicationRequest('/api/'+operation),null);
});

test('worker reads, exports and mutations stay outside relocation-safe snapshots',()=>{
 for(const operation of ['publication-jobs/list','publication-jobs/open','publication-jobs/status','publication-jobs/start','publication-jobs/analysis-review','websites/editor/save','websites/editor/sources','local-export/apply','export'])assert.equal(workspaceSnapshotRequest('POST','/api/'+operation),false,operation);
 for(const operation of ['websites/editor/open','websites/editor/window','websites/editor/item','website/research/record','publication-selections/window','design-preview'])assert.equal(workspaceSnapshotRequest('POST','/api/'+operation),true,operation);
 for(const operation of ['deployment-jobs/status','deployment-jobs/cancel','repository-setup/status','repository-setup/cancel','publishing/verification','publishing/verification-cancel','github-connection/cancel'])assert.equal(requestLane('POST','/api/'+operation),'control',operation);
 for(const operation of ['deployment-jobs/start','deployment-jobs/retry','repository-setup/initialize','publishing/deploy','github-connection/start','websites/editor/save'])assert.equal(requestLane('POST','/api/'+operation),'work',operation);
 const hash='a'.repeat(64);
 for(const route of ['/api/publication-preview/'+hash+'/index.html','/api/export/'+hash,'/api/appearance-preview/'+hash+'/index.html']){
  const selected=projectPublicationRequest(route,'GET');assert.equal(selected.binary,true);assert.equal(selected.write,false);assert.equal(selected.snapshot,false);assert.equal(projectPublicationRequest(route,'POST'),null);
 }
 assert.equal(projectPublicationRequest('/api/appearance-preview/'+hash+'/pages','GET').snapshot,true);
});

test('shared publication controls reject wrong-method transport before any domain call',async()=>{
 let calls=0;
 for(const contract of Object.values(publicationRoutes)){
  const wrong=contract.method==='GET'?'POST':'GET';
  await assert.rejects(projectContentHttp({method:wrong,url:'/',headers:{}},new EventEmitter(),contract,{execute:async()=>{calls++;},body:async()=>assert.fail('Wrong method must not parse a body')}),{code:'NOT_FOUND'});
 }
 assert.equal(calls,0);
});

test('durable repository review controls retain bounded admission across owners',()=>{
 for(const route of ['/api/publishing/plan-operation','/api/projects/'+id+'/publishing/plan-operation']){
  const contract=route.startsWith('/api/projects/')?projectRequest(route,'POST'):projectPublicationRequest(route,'POST');
  assert.equal(requestLane('POST',route),'control');assert.equal(contract.limit,1024);assert.equal(contract.write,true);assert.equal(contract.snapshot,false);
 }
 assert.equal(requestLane('POST','/api/publishing/plan'),'work');
});
