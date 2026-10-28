import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {pdfDocumentRoutes,pdfDocumentRequest} from '../src/pdf-route-policy.js';
import {pdfDocumentRequest as dispatched,executePdfRequest} from '../src/pdf-document-requests.js';
import {workspaceSnapshotRequest} from '../src/workspace-read-admission.js';
import {requestLane,RequestAdmission} from '../src/request-admission.js';
import {projectContentHttp} from '../src/project-content-http.js';

const id='00000000-0000-4000-8000-000000000001';
test('PDF dispatch, snapshot and request admission use the same declared contracts',()=>{
 assert.equal(dispatched,pdfDocumentRequest);assert.equal(Object.keys(pdfDocumentRoutes).length,31);
 for(const [name,route] of Object.entries(pdfDocumentRoutes)){
  assert.ok(Object.isFrozen(route));
  for(const key of ['method','input','schema','authority','owner','admission','cancellation','output'])assert.equal(typeof route[key],'string',name+': '+key);
  assert.ok(Number.isSafeInteger(route.limit)&&route.limit>0);assert.equal(typeof route.binary,'boolean');assert.equal(route.snapshot,!route.write);
  const pathname='/api/pdf/'+name;assert.equal(pdfDocumentRequest(pathname),route);assert.equal(pdfDocumentRequest(pathname,'GET'),null);
  assert.equal(workspaceSnapshotRequest('POST',pathname),route.snapshot);assert.equal(workspaceSnapshotRequest('GET',pathname),false);
  for(const prefix of ['/api/','/api/projects/'+id+'/','/api/projects/'+id+'/lab-books/'+id+'/'])assert.equal(requestLane('POST',prefix+'pdf/'+name),route.admission);
 }
 for(const name of ['__proto__','constructor','verify','unknown','export-status/extra','../export-cancel'])assert.equal(pdfDocumentRequest('/api/pdf/'+name),null);
 assert.equal(pdfDocumentRequest('/api/pdf-other/list'),null);
 for(const name of ['export-status','export-cancel'])assert.equal(pdfDocumentRoutes[name].admission,'control');
 for(const name of ['export-start','export-resume','export','preflight','export-download'])assert.equal(pdfDocumentRoutes[name].admission,'work');
});

test('PDF controls remain admitted under ordinary request saturation without bypassing owner checks',async()=>{
 const admission=new RequestAdmission({active:1,queued:0,controlActive:1}),work=await admission.acquire('work');
 try{
  assert.throws(()=>admission.acquire(requestLane('POST','/api/pdf/export-start')),{code:'WORKLOAD_BUSY'});
  for(const name of ['export-status','export-cancel']){
   const request=pdfDocumentRequest('/api/pdf/'+name),control=await admission.acquire(requestLane('POST','/api/pdf/'+name));
   try{
    let checked=0;const refusal=Object.assign(Error('Access revoked'),{code:'ACCESS_LOCKED'});
    await assert.rejects(executePdfRequest({},request,{workspaceId:id,id},{check:async()=>{checked++;throw refusal;}}),error=>error===refusal);assert.equal(checked,1);
    await assert.rejects(executePdfRequest({labBookId:id},request,{workspaceId:id,id}),{code:'INVALID'});
   }finally{control.release();}
  }
 }finally{work.release();}
 assert.equal(admission.stats().control.active,0);
});

test('PDF control transport enforces its body limit, method and selected context before execution',async()=>{
 const request=pdfDocumentRequest('/api/pdf/export-status');let calls=0;
 const options={contextId:'selected',body:async(req,limit)=>{assert.equal(limit,1024);return {id};},json:value=>value,execute:async data=>{calls++;return data;}};
 await assert.rejects(projectContentHttp({method:'GET',url:'/',headers:{}},new EventEmitter(),request,options),{code:'NOT_FOUND'});
 await assert.rejects(projectContentHttp({method:'POST',url:'/?context=stale',headers:{}},new EventEmitter(),request,options),{code:'WORKSPACE_CHANGED'});assert.equal(calls,0);
 const tooLarge={...options,body:async(req,limit)=>{assert.equal(limit,1024);throw Object.assign(Error('too large'),{code:'INVALID'});}};
 await assert.rejects(projectContentHttp({method:'POST',url:'/',headers:{}},new EventEmitter(),request,tooLarge),{code:'INVALID'});assert.equal(calls,0);
 assert.deepEqual(await projectContentHttp({method:'POST',url:'/?context=selected',headers:{}},new EventEmitter(),request,options),{id});assert.equal(calls,1);
});
