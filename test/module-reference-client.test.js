import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id} from 'node:crypto';
import {moduleReferenceClient,referenceKey} from '../src/web/modules/reference-client.js';
const setup=()=>({page:'module',modulePath:'calculation/'+id(),book:{id:id()},storage:{contextId:id()},projectOwner:{projectId:id(),labBookId:null}});
const reference=()=>({workspaceId:id(),type:'record',id:id()});
const owner=ref=>({workspaceId:ref.workspaceId,projectId:id(),labBookId:id()});
const summary=ref=>({reference:ref,title:'Chosen record',openType:ref.type,openId:ref.id});
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};

test('reference reads retain the source owner and explicit target namespace without adopting research',async()=>{
 const state=setup(),target=reference(),before=structuredClone(state),calls=[];let prompts=0;
 const client=moduleReferenceClient({state,access:async run=>{prompts++;return run();},api:async(route,body,options)=>{calls.push({route,body,options});return {workspaceId:state.book.id,...summary(target),owner:owner(target),type:target.type,id:target.id};}});
 await client.resolve(target,{unlock:true});assert.equal(prompts,1);assert.deepEqual(state,before);assert.equal(calls[0].body.workspaceId,state.book.id);assert.deepEqual(calls[0].body.target,target);assert.equal(calls[0].options.adopt,false);
});

test('labels distinguish equal IDs in different namespaces and never authorize unavailable destinations',async()=>{
 const state=setup(),first=reference(),second={...first,workspaceId:id()};let prompts=0,response;
 const client=moduleReferenceClient({state,access:()=>{prompts++;throw Error('Unexpected prompt');},api:async()=>response});
 response={workspaceId:state.book.id,items:[{...summary(first),owner:owner(first),status:'available'},{reference:second,status:'unavailable',code:'ACCESS_LOCKED'}]};
 assert.equal((await client.labels([first,second])).items.length,2);assert.notEqual(referenceKey(first),referenceKey(second));assert.equal(prompts,0);
 response.items[1]={...summary(first),owner:owner(first),status:'available'};await assert.rejects(client.labels([first,second]),/MODULE_REFERENCE_RESPONSE/);
 response.items[1]={reference:second,status:'unavailable',code:'ACCESS_LOCKED',title:'Leaked title'};await assert.rejects(client.labels([first,second]),/MODULE_REFERENCE_RESPONSE/);
});

test('owner and result pages reject substituted namespaces, duplicates and overlarge windows',async()=>{
 const state=setup(),ref=reference(),destination=owner(ref),item={...destination,kind:'lab-book',label:'Book',ancestors:['Project']};let response;
 const client=moduleReferenceClient({state,api:async()=>structuredClone(response)});
 const directory={workspaceId:state.book.id,projectId:null,revision:'a'.repeat(64),items:[item],offset:0,total:1};response=directory;await client.owners();
 for(const bad of [{...directory,workspaceId:id()},{...directory,items:[item,item],total:2},{...directory,total:26,items:Array(26).fill(item)}]){response=bad;await assert.rejects(client.owners(),/MODULE_REFERENCE_RESPONSE/);}
 const page={workspaceId:state.book.id,sourceId:ref.workspaceId,owner:destination,revision:'b'.repeat(64),items:[summary(ref)],offset:0,total:1,cursor:null,nextCursor:null,previousCursor:null};response=page;await client.query({sourceId:ref.workspaceId,types:['record']});
 for(const bad of [{...page,owner:{...destination,workspaceId:id()}},{...page,items:[summary({...ref,workspaceId:id()})]},{...page,items:[summary(ref),summary(ref)],total:2}]){response=bad;await assert.rejects(client.query({sourceId:ref.workspaceId,types:['record']}),/MODULE_REFERENCE_RESPONSE/);}
});

test('late requests and authorization retries cannot outlive their source draft or owner',async()=>{
 for(const mutate of [state=>state.modulePath='calculation/'+id(),state=>state.book.id=id(),state=>state.projectOwner={projectId:id()},state=>state.page='entries',state=>state.access={locked:true}]){
  const state=setup(),target=reference(),held=deferred();let signal;
  const client=moduleReferenceClient({state,api:async(_path,_body,options)=>{signal=options.signal;return held.promise;}});
  const pending=client.resolve(target),rejected=assert.rejects(pending,{name:'AbortError'});mutate(state);client.sync();assert.equal(signal.aborted,true);held.resolve({workspaceId:state.book.id,...summary(target),owner:owner(target),type:target.type,id:target.id});await rejected;
 }
 const state=setup(),held=deferred();let calls=0;const client=moduleReferenceClient({state,access:async run=>{await held.promise;return run();},api:async()=>{calls++;}});
 const pending=client.resolve(reference(),{unlock:true}),rejected=assert.rejects(pending,{name:'AbortError'});client.cancel();held.resolve();await rejected;assert.equal(calls,0);
});

test('unavailable old research aliases retain exact reference identity while a fresh resolver supplies the current owner',async()=>{
 const state=setup(),target=reference(),canonical=owner({...target,workspaceId:id()});let result={workspaceId:state.book.id,...summary(target),owner:canonical,type:target.type,id:target.id};
 const client=moduleReferenceClient({state,api:async()=>result});assert.deepEqual((await client.resolve(target)).reference,target);
 result={...result,reference:{...target,workspaceId:canonical.workspaceId}};await assert.rejects(client.resolve(target),/MODULE_REFERENCE_RESPONSE/);
});

test('incoming references retain separate owners and expose bounded partial status without unrelated labels',async()=>{
 const state=setup(),target=reference(),first={...reference(),type:'calculation'},second={...first,workspaceId:id()},a=owner(first),b=owner(second);let response;
 const client=moduleReferenceClient({state,api:async()=>response});
 const valid={workspaceId:state.book.id,target,items:[{...summary(first),owner:a},{...summary(second),owner:b}],offset:0,total:2,cursor:null,nextCursor:null,previousCursor:null,partial:true,unavailable:[{...owner(reference()),code:'ACCESS_LOCKED'}],unavailableTotal:1};
 response=valid;assert.equal((await client.incoming({target,types:['calculation']})).items.length,2);
 for(const bad of [{...valid,items:[valid.items[0],valid.items[0]]},{...valid,partial:false},{...valid,unavailableTotal:0},{...valid,unavailable:Array(26).fill(valid.unavailable[0]),unavailableTotal:26},{...valid,target:{...target,workspaceId:id()}}]){response=bad;await assert.rejects(client.incoming({target,types:['calculation']}),/MODULE_REFERENCE_RESPONSE/);}
});
