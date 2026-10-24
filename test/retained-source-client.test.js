import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {retainedSourceClient} from '../src/web/retained-source-client.js';
const setup=()=>({book:{id:id()},storage:{contextId:id()},projectOwner:{projectId:id(),labBookId:id()}});
const reference=()=>({workspaceId:id(),kind:'dataset',id:id(),revision:'a'.repeat(64)});
const owner=ref=>({workspaceId:ref.workspaceId,projectId:id(),labBookId:id()});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
test('retained selection reads stay with the result owner and exact immutable source',async()=>{
 const state=setup(),ref=reference(),before=structuredClone(state),calls=[];let prompts=0;
 const client=retainedSourceClient({state,access:async run=>{prompts++;return run();},api:async(route,body,options)=>{calls.push({route,body,options});return {workspaceId:state.book.id,reference:ref,owner:owner(ref),title:'Observation dataset'};}});
 await client.resolve({...ref,label:'Old label'},{unlock:true});assert.equal(prompts,1);assert.deepEqual(state,before);assert.deepEqual(calls[0].body,{workspaceId:state.book.id,ref});assert.deepEqual(calls[0].options.owner,state.projectOwner);assert.equal(calls[0].options.adopt,false);assert.match(calls[0].route,/\/lab-books\/[^/]+\/research\/materials\/source-resolve$/);
 await client.resolve(ref);assert.equal(prompts,1);
});
test('retained source pages reject changed identities, duplicate revisions and unbounded windows',async()=>{
 const state=setup(),ref=reference(),destination=owner(ref),item={reference:ref,title:'Dataset'};let response;
 const client=retainedSourceClient({state,api:async()=>response}),page={workspaceId:state.book.id,sourceId:ref.workspaceId,owner:destination,items:[item],next:null,changed:false,scanned:1};response=page;await client.items({sourceId:ref.workspaceId,kind:'dataset'});
 for(const invalid of [{...page,items:[item,item]},{...page,owner:{...destination,workspaceId:id()}},{...page,items:[{...item,reference:{...ref,kind:'artifact'}}]},{...page,next:''},{...page,items:Array(26).fill(item)}]){response=invalid;await assert.rejects(client.items({sourceId:ref.workspaceId,kind:'dataset'}),/RETAINED_SOURCE_RESPONSE/);}
 response={workspaceId:state.book.id,reference:{...ref,revision:'b'.repeat(64)},owner:destination,title:'Dataset'};await assert.rejects(client.resolve(ref),/RETAINED_SOURCE_RESPONSE/);
});
test('late source reads and access retries cannot escape the original comparison or owner',async()=>{
 for(const mutate of [state=>state.book.id=id(),state=>state.projectOwner.labBookId=id(),state=>state.storage.contextId=id(),state=>state.access={locked:true}]){
  const state=setup(),ref=reference(),held=deferred();let signal;
  const client=retainedSourceClient({state,api:async(_path,_body,options)=>{signal=options.signal;return held.promise;}}),pending=client.resolve(ref),rejected=assert.rejects(pending,{name:'AbortError'});mutate(state);held.resolve({workspaceId:state.book.id,reference:ref,owner:owner(ref),title:'Late dataset'});await rejected;assert.equal(signal.aborted,false);
 }
 const state=setup(),held=deferred();let calls=0;const client=retainedSourceClient({state,access:async run=>{await held.promise;return run();},api:async()=>{calls++;}}),pending=client.resolve(reference(),{unlock:true}),rejected=assert.rejects(pending,{name:'AbortError'});client.cancel();held.resolve();await rejected;assert.equal(calls,0);
});

test('late access failures are cancelled before the access surface can prompt',async()=>{
 const state=setup();let reject,prompts=0,seen;
 const pendingRead=new Promise((_resolve,no)=>reject=no),client=retainedSourceClient({state,api:()=>pendingRead,access:async run=>{try{return await run();}catch(error){seen=error;if(error.code==='ACCESS_LOCKED')prompts++;throw error;}}});
 const pending=client.resolve(reference(),{unlock:true}),rejected=assert.rejects(pending,{name:'AbortError'});state.storage.contextId=id();reject({code:'ACCESS_LOCKED',message:'Old owner locked'});await rejected;assert.equal(seen.name,'AbortError');assert.equal(prompts,0);
});


test('pending source authorization cannot reopen a view after Back or dialog close',async()=>{
 for(const phase of ['authorization','request'])for(const navigation of ['back','close']){
  const state=setup(),ref=reference(),held=deferred();let view=1,open=true,calls=0,opened=0;
  const client=retainedSourceClient({state,identity:()=>[view,state.projectOwner.labBookId],active:()=>open,access:async run=>{if(phase==='authorization')await held.promise;return run();},api:async()=>{calls++;if(phase==='request')await held.promise;return {workspaceId:state.book.id,reference:ref,owner:owner(ref),title:'Selected reading'};}});
  const pending=client.resolve(ref,{unlock:true}).then(()=>opened++),rejected=assert.rejects(pending,{name:'AbortError'});if(navigation==='back')view++;else open=false;held.resolve();await rejected;assert.equal(opened,0);assert.equal(calls,phase==='authorization'?0:1);
 }
});
