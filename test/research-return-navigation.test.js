import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {researchReturnNavigation} from '../src/web/research-return.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(overrides={}){
 const owner={projectId:randomUUID(),labBookId:randomUUID()},moduleReturn={workspaceId:randomUUID(),moduleId:'scientific-calculator',modulePath:'calculation/'+randomUUID(),checkpoint:{id:randomUUID(),etag:'a'.repeat(64)},itemId:randomUUID()};
 const origin={page:'module',project:owner.projectId,notebook:owner.labBookId,moduleId:moduleReturn.moduleId,modulePath:moduleReturn.modulePath,filterWorkspaceId:moduleReturn.workspaceId,owner,moduleReturn};
 const state={storage:{contextId:'session'},book:{id:randomUUID()},page:'record-reader',project:randomUUID(),notebook:randomUUID(),moduleId:'scientific-calculator',modulePath:'calculation',recordReturn:origin};
 const calls=[],controller=researchReturnNavigation({state,enterOwner:async(...ids)=>{calls.push(['owner',...ids]);state.projectOwner={...owner};state.project=owner.projectId;state.notebook=owner.labBookId;state.book={id:moduleReturn.workspaceId};},readyModule:async id=>{calls.push(['ready',id]);},restoreModule:async(token,{current})=>{assert.equal(current(),true);calls.push(['restore',token]);},render:()=>calls.push(['render',state.page]),...overrides});
 return {state,origin,owner,moduleReturn,calls,controller};
}

test('Back restores the selected owner before its module and exact recovery token',async()=>{
 const f=fixture();assert.equal(await f.controller.back(),true);
 assert.deepEqual(f.calls,[['owner',f.owner.projectId,f.owner.labBookId],['ready',f.moduleReturn.moduleId],['restore',f.moduleReturn],['render','module']]);
 assert.equal(f.state.modulePath,f.origin.modulePath);assert.equal(f.state.book.id,f.moduleReturn.workspaceId);
 assert.equal(Object.hasOwn(f.state,'moduleReturn'),false);assert.equal(Object.hasOwn(f.state,'owner'),false);
 assert.equal(f.state.recordReturn,f.origin);
});

test('Back retains legacy research origins and the ordinary records fallback',async()=>{
 const f=fixture();f.state.recordReturn={page:'entries',project:randomUUID(),notebook:'all',search:'selected',filter:'published'};
 assert.equal(await f.controller.back(),true);assert.deepEqual(f.calls,[['render','entries']]);assert.equal(f.state.search,'selected');
 f.calls.length=0;f.state.recordReturn=null;f.state.page='record-reader';f.state.recordBrowse={query:'old'};
 assert.equal(await f.controller.back(),true);assert.deepEqual(f.calls,[['render','entries']]);assert.equal(f.state.search,'');assert.equal(f.state.filter,'all');assert.equal(f.state.recordBrowse,null);
});

test('new navigation cancels every pending Back stage, including late failures',async()=>{
 for(const stage of ['enterOwner','readyModule','restoreModule'])for(const failure of [false,true]){
  const held=deferred(),entered=deferred();let lifetime;
  const f=fixture({[stage]:async(...args)=>{lifetime=args[1]?.current;entered.resolve();await held.promise;}});
  const pending=f.controller.back();await entered.promise;f.controller.invalidate();f.state.page='preferences';f.state.modulePath='newer';
  if(lifetime)assert.equal(lifetime(),false);
  if(failure)held.reject(new Error('Obsolete owner response'));else held.resolve();
  assert.equal(await pending,false,stage);assert.equal(f.state.page,'preferences');assert.equal(f.state.modulePath,'newer');
  assert.equal(f.calls.some(call=>call[0]==='render'),false);assert.equal(f.state.recordReturn,f.origin);
 }
});

test('an invalidated Back cannot hydrate a draft even before the newer route changes',async()=>{
 const held=deferred(),entered=deferred();let applied=false;
 const f=fixture({restoreModule:async(token,{current})=>{entered.resolve();await held.promise;if(current())applied=true;}});
 const pending=f.controller.back();await entered.promise;f.controller.invalidate();held.resolve();
 assert.equal(await pending,false);assert.equal(applied,false);assert.equal(f.calls.some(call=>call[0]==='render'),false);
});

test('Back detects a replaced route, storage session, lock or return token without applying the old origin',async()=>{
 for(const change of [state=>{state.page='preferences';},state=>{state.storage.contextId='new-session';},state=>{state.access={locked:true};},state=>{state.recordReturn={page:'entries'};}]){
  const held=deferred(),entered=deferred(),f=fixture({enterOwner:async()=>{entered.resolve();await held.promise;}});
  const pending=f.controller.back();await entered.promise;change(f.state);const page=f.state.page;held.resolve();
  assert.equal(await pending,false);assert.equal(f.state.page,page);assert.deepEqual(f.calls,[]);
 }
});

test('a second Back supersedes the earlier owner opening',async()=>{
 const held=deferred(),entered=deferred(),f=fixture({enterOwner:async()=>{entered.resolve();await held.promise;}});
 const first=f.controller.back();await entered.promise;
 f.state.recordReturn={page:'entries',project:'second-project',notebook:'all'};
 assert.equal(await f.controller.back(),true);held.resolve();assert.equal(await first,false);
 assert.equal(f.state.project,'second-project');assert.deepEqual(f.calls,[['render','entries']]);
});

test('current access and recovery failures remain visible and retain the return checkpoint',async()=>{
 for(const stage of ['enterOwner','readyModule','restoreModule']){
  const error=new Error('Current owner unavailable'),f=fixture({[stage]:async()=>{throw error;}});
  await assert.rejects(f.controller.back(),value=>value===error);
  assert.equal(f.state.recordReturn,f.origin);assert.deepEqual(f.state.recordReturn.moduleReturn,f.moduleReturn);
  assert.equal(f.calls.filter(call=>call[0]==='render').length,stage==='enterOwner'?0:1);
 }
});

test('cancelled access returns without an error or replacing the current screen',async()=>{
 const f=fixture({enterOwner:async()=>{throw new DOMException('Cancelled','AbortError');}});
 assert.equal(await f.controller.back(),false);assert.equal(f.state.page,'record-reader');assert.deepEqual(f.calls,[]);
});
