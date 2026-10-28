import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {reviewRoutes,reviewRequest,reviewOperations,reviewReadOperations} from '../src/review-route-policy.js';
import {reviewRequest as dispatched} from '../src/review-requests.js';
import {projectRequest} from '../src/project-application.js';
import {workspaceSnapshotRequest} from '../src/workspace-read-admission.js';
import {requestLane} from '../src/request-admission.js';
import {reviewHttp} from '../src/review-http.js';

const id='00000000-0000-4000-8000-000000000001';
test('signed review transport and all owner dispatchers preserve one admission contract',()=>{
 assert.equal(dispatched,reviewRequest);assert.equal(reviewOperations.length,14);assert.equal(reviewReadOperations.length,8);
 for(const [operation,route] of Object.entries(reviewRoutes)){
  assert.ok(Object.isFrozen(route));
  for(const key of ['method','input','schema','authority','owner','admission','cancellation','output'])assert.equal(typeof route[key],'string',operation+': '+key);
  const pathname='/api/reviews/'+operation;
  assert.equal(reviewRequest(pathname,route.method),route);assert.equal(workspaceSnapshotRequest(route.method,pathname),route.snapshot);
  assert.equal(requestLane(route.method,pathname),'work','Review capture and export cannot consume emergency control capacity');
  for(const prefix of ['/api/projects/'+id+'/','/api/projects/'+id+'/lab-books/'+id+'/']){
   const selected=projectRequest(prefix+'reviews/'+operation,route.method);assert.ok(selected,operation);
   for(const key of Object.keys(route))assert.equal(selected[key],route[key],operation+': '+key);
   assert.equal(requestLane(route.method,prefix+'reviews/'+operation),route.admission);
   for(const method of ['GET','POST','PUT','DELETE'].filter(method=>method!==route.method))assert.equal(projectRequest(prefix+'reviews/'+operation,method),null,operation+': '+method);
  }
  for(const method of ['GET','POST','PUT','DELETE'].filter(method=>method!==route.method)){
   assert.equal(reviewRequest(pathname,method),null);assert.equal(workspaceSnapshotRequest(method,pathname),false);
  }
 }
 for(const name of ['__proto__','constructor','read/extra','../download','unknown'])assert.equal(reviewRequest('/api/reviews/'+name),null);
 assert.equal(reviewRequest('/api/reviews-other/read'),null);
});

test('review upload and download refuse wrong context, content type and ambiguous selections before execution',async()=>{
 let calls=0;const options={contextId:'selected',body:async()=>assert.fail('Selection must come from the query'),json:value=>value,execute:async()=>{calls++;return {};}};
 const selection=encodeURIComponent(JSON.stringify({workspaceId:id})),upload=reviewRoutes.receive,download=reviewRoutes.download;
 const request=(method,url,headers={})=>({method,url,headers});
 const invalid=[
  [upload,request('GET','/?selection='+selection)],
  [upload,request('POST','/?selection='+selection,{'x-observanda-workspace':'stale','content-type':'application/octet-stream'})],
  [upload,request('POST','/?selection='+selection,{'x-observanda-workspace':'selected','content-type':'application/json'})],
  [upload,request('POST','/?selection='+selection+'&selection='+selection,{'x-observanda-workspace':'selected','content-type':'application/octet-stream'})],
  [download,request('GET','/?context=stale&selection='+selection)],
  [download,request('GET','/?context=selected&selection=%5B%5D')]
 ];
 for(const [route,req] of invalid)await assert.rejects(reviewHttp(req,new EventEmitter(),route,options));
 assert.equal(calls,0);
 let seenLimit;const res=new EventEmitter();
 assert.deepEqual(await reviewHttp(request('POST','/',{'x-observanda-workspace':'selected'}),res,reviewRoutes.read,{...options,body:async(_req,limit)=>{seenLimit=limit;return {workspaceId:id,id};}}),{});
 assert.equal(seenLimit,reviewRoutes.read.limit);assert.equal(calls,1);assert.equal(res.listenerCount('close'),0);
});
