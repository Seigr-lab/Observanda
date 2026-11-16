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

test('shared publication controls reject wrong-method transport before any domain call',async()=>{
 let calls=0;
 for(const contract of Object.values(publicationRoutes)){
  const wrong=contract.method==='GET'?'POST':'GET';
  await assert.rejects(projectContentHttp({method:wrong,url:'/',headers:{}},new EventEmitter(),contract,{execute:async()=>{calls++;},body:async()=>assert.fail('Wrong method must not parse a body')}),{code:'NOT_FOUND'});
 }
 assert.equal(calls,0);
});
