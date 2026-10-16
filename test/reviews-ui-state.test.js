import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {reviewsUI} from '../src/web/reviews-ui.js';
function fixture(t){
 const prior=Object.fromEntries(['location','document'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperty(globalThis,'location',{configurable:true,value:{hash:'#/owners/'+randomUUID()+'/records/'+randomUUID()+'/read'}});
 Object.defineProperty(globalThis,'document',{configurable:true,value:{querySelector:()=>null}});
 t.after(()=>{for(const [key,value] of Object.entries(prior)){if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];}});
 const state={book:{id:randomUUID(),entries:[],notebooks:[]},storage:{contextId:'workspace-context'},projectOwner:{projectId:randomUUID()},page:'record-reader',selected:randomUUID()},frames=[];let resolve;
 const pending=new Promise(done=>resolve=done),ui=reviewsUI({state,api:()=>pending,esc:value=>String(value),showDialog:html=>frames.push(html),notify:()=>{},render:()=>{}});
 return {state,frames,ui,resolve:()=>resolve({contacts:[],items:[],total:0,offset:0,previousCursor:null,nextCursor:null})};
}
test('redrawing a record while its reviews load preserves the in-flight dialog',async t=>{
 const f=fixture(t),opening=f.ui.action({dataset:{action:'review-witnesses'}});f.ui.release();f.ui.release();f.resolve();await opening;
 assert.equal(f.frames.length,1);assert.match(f.frames[0],/Witnessed by/);assert.equal(f.ui.isBusy(),false);
});
test('changing project while reviews load discards the previous owner response',async t=>{
 const f=fixture(t),opening=f.ui.action({dataset:{action:'review-witnesses'}});f.state.projectOwner={projectId:randomUUID()};f.ui.release();f.resolve();await opening;
 assert.equal(f.frames.length,0);assert.equal(f.ui.isBusy(),false);
});
test('leaving the record before its reviews return keeps the destination unobstructed',async t=>{
 const f=fixture(t),opening=f.ui.action({dataset:{action:'review-witnesses'}});f.state.page='preferences';location.hash='#/preferences/general';f.ui.release();f.resolve();await opening;
 assert.equal(f.frames.length,0);assert.equal(f.ui.isBusy(),false);
});
