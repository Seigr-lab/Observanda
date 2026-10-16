import {test} from 'node:test';
import assert from 'node:assert/strict';
import {websiteResearchClient} from '../src/web/website-research-client.js';
import {websiteSelectionDraft} from '../src/web/website-selection.js';

test('leaving the website cancels discovery and prevents late updates to another panel',async()=>{
 const state={page:'website',book:{id:'workspace',projects:[]},etag:'snapshot',storage:{contextId:'a',researchStorage:'catalogue',researchFormatVersion:21}},signals=[];
 let updates=0;
 const client=websiteResearchClient({state,selection:websiteSelectionDraft(),onChange:()=>updates++,api:(_route,_body,{signal})=>new Promise((resolve,reject)=>{signals.push(signal);signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});})});
 client.refresh();assert.equal(signals.length,1);assert.equal(signals[0].aborted,false);
 state.page='module';client.close();await new Promise(resolve=>setImmediate(resolve));assert.equal(signals[0].aborted,true);assert.equal(updates,0);assert.equal(client.error(),'');
 state.page='website';client.refresh();assert.equal(signals.length,2);assert.equal(signals[1].aborted,false);
 state.storage.contextId='b';client.sync();await new Promise(resolve=>setImmediate(resolve));assert.equal(signals[1].aborted,true);assert.equal(updates,0);
});
