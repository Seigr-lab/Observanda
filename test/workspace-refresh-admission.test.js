import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspaceRefresh} from '../src/web/workspace-refresh.js';

function environment(){
 const restore=[];
 for(const [key,value] of Object.entries({document:{hidden:true,querySelector:selector=>selector.startsWith('.operation-progress')?{}:null,addEventListener(){},removeEventListener(){}},window:{addEventListener(){},removeEventListener(){}},location:{hash:'#/records/example'}})){
  const prior=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});restore.push(()=>prior?Object.defineProperty(globalThis,key,prior):delete globalThis[key]);
 }
 return {state:{book:{id:'workspace'},etag:'a'.repeat(64),storage:{contextId:'context'}},restore:()=>restore.forEach(fn=>fn())};
}
test('a completed save can refresh beneath background progress while dirty edits remain protected',async t=>{
 const {state,restore}=environment();let dirty=false,reads=0,applied=0;
 const live=workspaceRefresh({state,blocked:()=>dirty,api:async()=>({workspaceId:'workspace',etag:'b'.repeat(64)}),read:async()=>{reads++;return {book:state.book,etag:'b'.repeat(64)};},apply:()=>applied++,notify:()=>{}});t.after(()=>{live.stop();restore();});
 assert.equal(await live.check({background:true}),false);assert.equal(reads,0);
 dirty=true;assert.equal(await live.check(),false);assert.equal(reads,0);
 dirty=false;assert.equal(await live.check(),true);assert.equal(reads,1);assert.equal(applied,1);
});
test('an explicit post-save refresh follows an older in-flight version poll',async t=>{
 const {state,restore}=environment();document.hidden=false;let release,calls=0,applied=0;
 const gate=new Promise(resolve=>release=resolve),live=workspaceRefresh({state,blocked:()=>false,api:async()=>{calls++;if(calls===1){await gate;return {workspaceId:'workspace',etag:state.etag};}return {workspaceId:'workspace',etag:'b'.repeat(64)};},read:async()=>({book:state.book,etag:'b'.repeat(64)}),apply:()=>applied++,notify:()=>{}});t.after(()=>{live.stop();restore();});
 const polling=live.check({background:true}),saved=live.check();release();await polling;await saved;assert.equal(calls,2);assert.equal(applied,1);
});


test('a folder-operation fence defers polling without a failed-read banner or access reset',async t=>{
 const {state,restore}=environment();document.hidden=false;
 const status={hidden:true,textContent:''},logo={setAttribute(){}};
 document.querySelector=selector=>selector.startsWith('.brand')?logo:selector==='[data-workspace-refresh-status]'?status:null;
 let code='STORAGE_RENAMING',applied=0,accessErrors=0;
 const live=workspaceRefresh({state,blocked:()=>false,api:async()=>{if(code)throw {code};return {workspaceId:'workspace',etag:'b'.repeat(64)};},read:async()=>({book:state.book,etag:'b'.repeat(64)}),apply:()=>applied++,notify:()=>{},onAccessError:()=>accessErrors++});t.after(()=>{live.stop();restore();});
 for(code of ['STORAGE_RENAMING','STORAGE_DELETING']){assert.equal(await live.check({background:true}),false);assert.equal(status.hidden,true);assert.equal(accessErrors,0);}
 code=null;assert.equal(await live.check({background:true}),true);assert.equal(applied,1);
 code='DATABASE_UNAVAILABLE';await live.check({background:true});assert.equal(status.hidden,false);assert.match(status.textContent,/Could not check/);
});


test('website refresh observes its own revision at the same research snapshot and preserves newer editor state',async t=>{
 const {state,restore}=environment();document.hidden=false;state.websiteId=null;state.websitePin={researchSnapshotId:state.etag,websiteId:null,websiteRevision:'b'.repeat(64)};
 const next={...state.websitePin,websiteRevision:'c'.repeat(64)};let dirty=true,reads=0,applied=0,release;
 const live=workspaceRefresh({state,blocked:()=>dirty,version:async()=>({workspaceId:state.book.id,etag:state.etag,websitePin:next}),read:async({version})=>{reads++;assert.deepEqual(version.websitePin,next);if(release)await release.promise;return {book:state.book,etag:state.etag,websitePin:next};},apply:result=>{applied++;state.websitePin=result.websitePin;},notify:()=>{}});t.after(()=>{live.stop();restore();});
 assert.equal(await live.check(),false);assert.equal(reads,0);dirty=false;assert.equal(await live.check(),true);assert.equal(applied,1);assert.deepEqual(state.websitePin,next);
 const original={...state.websitePin,websiteRevision:'d'.repeat(64)};state.websitePin=original;release={};release.promise=new Promise(resolve=>release.resolve=resolve);
 const pending=live.check();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,2);state.websitePin={...original,websiteRevision:'e'.repeat(64)};release.resolve();
 assert.equal(await pending,false);assert.equal(applied,1);assert.equal(state.websitePin.websiteRevision,'e'.repeat(64));
});
