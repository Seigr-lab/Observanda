import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {materialRoutes,materialRequest} from '../src/material-route-policy.js';
import {workspaceSnapshotRequest} from '../src/workspace-read-admission.js';
import {requestLane} from '../src/request-admission.js';
import {projectMaterialReferenceRequest} from '../src/project-material-reference.js';
import {materialHttp} from '../src/material-http.js';
import {executeMaterialRequest} from '../src/material-requests.js';

const id='00000000-0000-4000-8000-000000000001',revision='a'.repeat(64),prefix='/api/research/materials/';
const suffix=name=>name==='original'?name+'/'+id+'/'+revision:name==='chunk'?name+'/'+id+'/0':name;

test('every evidence command handler has a declared admission and privacy contract',()=>{
 const implemented=new Set([...executeMaterialRequest.toString().matchAll(/\bcase '([a-z-]+)'/g)].map(match=>match[1]));
 const declared=new Set(Object.keys(materialRoutes).map(name=>name==='original'?'download':name));
 assert.deepEqual([...implemented].sort(),[...declared].sort());
});

test('every evidence route declares one policy shared by workspace and independent-owner admission',()=>{
 for(const [name,contract] of Object.entries(materialRoutes)){
  assert.ok(Object.isFrozen(contract));
  for(const key of ['method','input','schema','authority','owner','admission','cancellation','output'])assert.equal(typeof contract[key],'string',name+': '+key);
  assert.equal(typeof contract.write,'boolean');assert.equal(typeof contract.snapshot,'boolean');assert.ok(Number.isSafeInteger(contract.limit)&&contract.limit>=0);
  assert.ok(!contract.snapshot||!contract.write,'A mutation cannot be admitted as a retained snapshot');
  const route=prefix+suffix(name),resolved=materialRequest(route);assert.ok(resolved,name);
  assert.equal(requestLane(contract.method,route),contract.admission);
  assert.equal(requestLane(contract.method,'/api/projects/'+id+'/lab-books/'+id+'/research/materials/'+suffix(name)),contract.admission);
  assert.equal(workspaceSnapshotRequest(contract.method,route),contract.snapshot);
  assert.equal(workspaceSnapshotRequest(contract.method==='POST'?'GET':'POST',route),false);
 }
 assert.equal(materialRequest(prefix+'verify').write,true,'Integrity verification can repair a derived index');
 assert.equal(materialRequest(prefix+'job').snapshot,false,'Queue inspection may activate a worker');
});

test('evidence route parsing rejects undeclared operations, unsafe identifiers and malformed addressed downloads',()=>{
 for(const path of ['__proto__','constructor','unknown','original','chunk','chunk/'+id+'/-1','chunk/'+id+'/9007199254740992','original/'+id+'/'+revision+'/extra','../overview'])assert.equal(materialRequest(prefix+path),null,path);
 assert.equal(materialRequest('/api/research/materials-other/overview'),null);
 const request=projectMaterialReferenceRequest('/api/projects/material-reference/original/'+id+'/'+id+'/'+revision);
 assert.equal(request.owner,'addressed-evidence-owner');assert.equal(request.authority,'authorized-material-reference');assert.equal(request.write,false);assert.equal(request.output,'private-download');
 assert.equal(projectMaterialReferenceRequest('/api/projects/material-reference/verify'),null);
});

test('material HTTP refuses stale contexts, wrong methods and malformed or oversized selections before execution',async()=>{
 const contract=materialRequest(prefix+'retained-figure-export');let calls=0;
 const options={contextId:'selected',body:async()=>{throw Error('GET must not read a JSON body');},json:()=>{},execute:async data=>{calls++;return data;}};
 for(const [method,url,code] of [
  ['POST','/?context=selected&selection=%7B%7D','NOT_FOUND'],
  ['GET','/?context=stale&selection=%7B%7D','WORKSPACE_CHANGED'],
  ['GET','/?context=selected&selection=%7B%7D&selection=%7B%7D','INVALID'],
  ['GET','/?context=selected&selection=not-json','INVALID'],
  ['GET','/?context=selected&selection=%5B%5D','INVALID'],
  ['GET','/?context=selected&selection='+encodeURIComponent(JSON.stringify({text:'x'.repeat(contract.limit)})),'INVALID']
 ])await assert.rejects(materialHttp({method,url,headers:{}},new EventEmitter(),contract,options),{code});
 assert.equal(calls,0);
 assert.deepEqual(await materialHttp({method:'GET',url:'/?context=selected&selection=%7B%7D',headers:{}},new EventEmitter(),contract,options),{});
 assert.equal(calls,1);
});
