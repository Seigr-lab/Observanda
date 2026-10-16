import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {moduleReferenceDestination,moduleReferenceNavigation,availableOwnedModule} from '../src/web/module-reference-navigation.js';
import {researchReturn} from '../src/web/research-return.js';
const deferred=()=>{let resolve,reject;return {promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),resolve,reject};};
const fixture=(type='record')=>{
 const source=randomUUID(),owner={workspaceId:randomUUID(),projectId:randomUUID(),labBookId:randomUUID()},target={workspaceId:owner.workspaceId,type,id:randomUUID()};
 const state={storage:{contextId:'session'},book:{id:source},projectOwner:{projectId:randomUUID(),labBookId:randomUUID()},page:'module',moduleId:'scientific-calculator',modulePath:'calculation/'+randomUUID()};
 const result={workspaceId:source,reference:target,owner,type,id:target.id,title:'Selected item',openType:type,openId:target.id};return {source,owner,target,state,result};
};
test('reference destinations discover module capabilities and preserve namespace-qualified identity',()=>{
 const f=fixture('calculation');assert.equal(moduleReferenceDestination(f.result,f.target,f.source).module.moduleId,'scientific-calculator');
 const extra={id:'custom-tool',entityTypes:['custom-value'],createUI:()=>{}};
 const value=fixture('custom-value');assert.equal(moduleReferenceDestination(value.result,value.target,value.source,[extra]).module.moduleId,'custom-tool');
 assert.equal(availableOwnedModule('custom-tool',[extra]),true);assert.equal(availableOwnedModule('projects'),false);
 const stock=fixture('movement');stock.result.openType='resource';stock.result.openId=randomUUID();assert.equal(moduleReferenceDestination(stock.result,stock.target,stock.source).module.modulePath,'resource/'+stock.result.openId);
 for(const change of [{workspaceId:randomUUID()},{reference:{...f.target,id:randomUUID()}},{owner:{...f.owner,workspaceId:randomUUID()}},{owner:{...f.owner,projectId:null}},{openId:'bad'},{openType:'missing-type'}])assert.throws(()=>moduleReferenceDestination({...f.result,...change},f.target,f.source),{code:'INVALID'});
});
test('authenticated research aliases navigate to the canonical owner and retain the referenced record',()=>{
 const f=fixture();f.result.owner.workspaceId=randomUUID();
 assert.deepEqual(moduleReferenceDestination(f.result,f.target,f.source),{research:{workspaceId:f.result.owner.workspaceId,kind:'record',id:f.target.id}});
 assert.throws(()=>moduleReferenceDestination({...f.result,openId:randomUUID()},f.target,f.source),{code:'INVALID'});
});
test('reference resolution retains the source owner across explicit access retries and captures return before navigation',async()=>{
 const f=fixture(),owner=structuredClone(f.state.projectOwner),calls=[],origin={page:'module',modulePath:f.state.modulePath};let attempts=0;
 const open=moduleReferenceNavigation({state:f.state,api:async(route,body,options)=>{calls.push({route,body,options});if(++attempts===1)throw {code:'ACCESS_LOCKED'};return f.result;},access:async run=>{try{return await run();}catch(error){assert.equal(error.code,'ACCESS_LOCKED');return run();}},captureReturn:async()=>{calls.push('capture');return origin;},openResearch:async(target,returned)=>{assert.equal(returned,origin);calls.push(target);},openModule:()=>assert.fail('Expected research destination')});
 await open(f.target);assert.equal(calls.length,4);
 for(const call of calls.slice(0,2)){assert.equal(call.route,'/api/modules/references/resolve');assert.deepEqual(call.body,{workspaceId:f.source,target:f.target});assert.deepEqual(call.options,{owner,adopt:false});}
 assert.equal(calls[2],'capture');assert.deepEqual(calls[3],{workspaceId:f.owner.workspaceId,kind:'record',id:f.target.id});
});
test('late reference replies and checkpoint failures cannot replace a newer page',async()=>{
 for(const reject of [false,true]){
  const f=fixture(),wait=deferred();let captured=false,opened=false;
  const open=moduleReferenceNavigation({state:f.state,api:()=>wait.promise,captureReturn:async()=>{captured=true;},openResearch:()=>{opened=true;}});
  const pending=assert.rejects(open(f.target),{name:'AbortError'});f.state.page='preferences';if(reject)wait.reject({code:'ACCESS_LOCKED'});else wait.resolve(f.result);await pending;assert.equal(captured,false);assert.equal(opened,false);
 }
 const f=fixture();let opened=false;
 const open=moduleReferenceNavigation({state:f.state,api:async()=>f.result,captureReturn:async()=>{throw {code:'LOCKED'};},openResearch:()=>{opened=true;}});
 await assert.rejects(open(f.target),{code:'LOCKED'});assert.equal(opened,false);
});
test('new reference navigation supersedes older selection and checks identity again after checkpointing',async()=>{
 const f=fixture(),wait=deferred(),opened=[];let call=0;
 const open=moduleReferenceNavigation({state:f.state,api:()=>++call===1?wait.promise:Promise.resolve(f.result),openResearch:target=>opened.push(target)});
 const first=assert.rejects(open(f.target),{name:'AbortError'});await open(f.target);wait.resolve(f.result);await first;assert.equal(opened.length,1);
 const checkpoint=deferred(),second=moduleReferenceNavigation({state:f.state,api:async()=>f.result,captureReturn:()=>checkpoint.promise,openResearch:()=>assert.fail('Obsolete return')});
 const pending=assert.rejects(second(f.target),{name:'AbortError'});await new Promise(resolve=>setImmediate(resolve));f.state.modulePath='another';checkpoint.resolve({});await pending;
});
test('research return preserves module and owner identities without retaining editable data',()=>{
 const f=fixture();f.state.project='selected-project';f.state.notebook='all';f.state.moduleData={privateDraft:'text'};
 const origin=researchReturn(f.state);assert.equal(origin.page,'module');assert.equal(origin.moduleId,'scientific-calculator');assert.equal(origin.modulePath,f.state.modulePath);assert.deepEqual(origin.owner,f.state.projectOwner);assert.notEqual(origin.owner,f.state.projectOwner);assert.equal(Object.hasOwn(origin,'moduleData'),false);
 f.state.page='entries';assert.equal(Object.hasOwn(researchReturn(f.state),'modulePath'),false);
});
