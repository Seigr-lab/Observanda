import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {moduleOwnerApi} from '../src/web/modules/owner-api.js';
import {applyModuleDomainReceipt} from '../src/web/modules/patch.js';
import {validModuleRevision} from '../src/web/modules/revision.js';
import {projectApiRoute} from '../src/web/project-context.js';

test('module requests retain their selected project across navigation and cannot switch workspace sessions',async()=>{
 const id=randomUUID(),workspaceId=randomUUID(),state={storage:{contextId:'first'},book:{id:workspaceId},projectOwner:{projectId:id}},requests=[];
 const api=moduleOwnerApi({state,api:async(...args)=>{requests.push(args);return {}; }},'spreadsheet');
 await api('/api/modules/items',{workspaceId,type:'sheet'});
 state.projectOwner={projectId:randomUUID()};state.book={id:randomUUID()};
 await api('/api/modules/drafts/transfer/finish',{id:randomUUID()});
 assert.equal(requests[1][0],'/api/projects/'+id+'/modules/drafts/transfer/finish');
 assert.equal(requests[1][1].workspaceId,workspaceId);assert.equal(requests[1][1].moduleId,'spreadsheet');assert.equal(requests[1][2].adopt,false);
 assert.equal(requests[1][2].view,'#/owners/'+id+'/modules/spreadsheet');
 await api('/api/modules/history?id=entry&revision=2');assert.deepEqual(requests[2][1],{workspaceId,id:'entry',revision:2});assert.ok(requests[2][0].endsWith('/history/read'));
 assert.throws(()=>api('/api/modules/command',{workspaceId:state.book.id}),{code:'WORKSPACE_CHANGED'});
 state.storage.contextId='second';assert.throws(()=>api('/api/modules/drafts/list'),{code:'WORKSPACE_CHANGED'});assert.equal(requests.length,3);
 assert.equal(projectApiRoute('/api/modules/command?compact=1',id),'/api/projects/'+id+'/modules/command?compact=1');
 assert.equal(projectApiRoute('/api/modules/inventory/stock',id),'/api/projects/'+id+'/modules/inventory/stock');
});

test('partial editor receipts preserve separate domain revisions and reject incomplete or regressed changes',()=>{
 const workspaceId=randomUUID(),entity=(id,revision=1)=>({id,type:'sheet',revision,data:{name:'Example'}}),a=entity(randomUUID()),b=entity(randomUUID());
 const snapshot={workspaceId,partial:true,revision:'a'.repeat(64),revisions:{spreadsheet:2,calculator:7},entities:[a,b]},receipt={workspaceId,baseRevisions:{spreadsheet:2},revisions:{spreadsheet:3},entities:[{...a,revision:2}],changedIds:[a.id],replayed:false};
 const next=applyModuleDomainReceipt(snapshot,receipt);assert.deepEqual(next.revisions,{spreadsheet:3,calculator:7});assert.equal(next.revision,undefined);assert.equal(next.entities[0].revision,2);assert.deepEqual(next.entities[1],b);assert.equal(snapshot.entities[0].revision,1);
 assert.throws(()=>applyModuleDomainReceipt({...snapshot,partial:false},receipt));assert.throws(()=>applyModuleDomainReceipt(snapshot,{...receipt,changedIds:[]}));
 assert.throws(()=>applyModuleDomainReceipt(next,{...receipt,baseRevisions:{spreadsheet:0},revisions:{spreadsheet:1}}));
});

test('only opaque domain revisions and legacy nonnegative counters are admitted',()=>{
 for(const value of [0,4,'b'.repeat(64)])assert.equal(validModuleRevision(value),true);
 for(const value of [-1,NaN,{},'4','z'.repeat(64),null])assert.equal(validModuleRevision(value),false);
});
