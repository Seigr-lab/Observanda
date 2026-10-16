import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {materialReferenceReader,inheritMaterialNamespace,materialOriginalRoute} from '../src/web/material-reference-requests.js';

test('reference reads select their address while edits keep their explicitly selected owner',async()=>{
 const ref={kind:'artifact',id:randomUUID(),revision:'a'.repeat(64),workspaceId:randomUUID()},foreign={...ref,workspaceId:randomUUID()},local=[],addressed=[],owners=[];
 const read=materialReferenceReader({api:async(route,data,options)=>{addressed.push({route,data,options});return {projectId:'resolved-owner',namespaceId:ref.workspaceId,value:{title:'Retained document'}};},local:async(...args)=>{local.push(args);return 'selected-owner';},onOwner:(result,name)=>owners.push([result.projectId,name])});
 assert.equal(await read('measurement-save',{measurement:{sources:[{ref:foreign}]}}),'selected-owner');
 assert.equal(await read('read',{ref:{kind:ref.kind,id:ref.id,revision:ref.revision}}),'selected-owner');
 assert.deepEqual(await read('read',{ref:foreign},{owner:'current-editor',adopt:true}),{title:'Retained document'});
 assert.deepEqual(addressed[0],{route:'/api/projects/material-reference/read',data:{ref:foreign},options:{owner:'current-editor',adopt:false}});
 await read('measurement-inspect',{source:{ref,selector:{kind:'bytes',offset:0,length:4}}});
 assert.equal(addressed[1].route,'/api/projects/material-reference/measurement-inspect');assert.equal(local.length,2);assert.deepEqual(owners,[['resolved-owner','read'],['resolved-owner','measurement-inspect']]);
 const original=structuredClone(foreign);assert.deepEqual(inheritMaterialNamespace(foreign,ref.workspaceId),foreign);assert.deepEqual(foreign,original);
 assert.equal(inheritMaterialNamespace({kind:ref.kind,id:ref.id,revision:ref.revision},ref.workspaceId).workspaceId,ref.workspaceId);
 assert.equal(materialOriginalRoute(foreign),'/api/projects/material-reference/original/'+foreign.workspaceId+'/'+foreign.id+'/'+foreign.revision);
});

test('failed owner authorization never retries a reference against the editor database',async()=>{
 const ref={kind:'artifact',id:randomUUID(),revision:'b'.repeat(64),workspaceId:randomUUID()},denied={code:'ACCESS_LOCKED',projectId:randomUUID()};
 const read=materialReferenceReader({api:async()=>{throw denied;},local:()=>assert.fail('Do not fall back to another owner'),onOwner:()=>assert.fail('Do not adopt an unauthorized owner')});
 await assert.rejects(read('read',{ref}),error=>error===denied);
});
