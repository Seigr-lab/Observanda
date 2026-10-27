import {test} from 'node:test';
import assert from 'node:assert/strict';
import {researchMaterialsUI} from '../src/web/research-materials-loader.js';

function fixture(load){const state={page:'record-reader',selected:'record-a',storage:{contextId:'workspace-a'},book:{entries:[{id:'record-a',type:'run'}]}};return {state,ui:researchMaterialsUI({state},{load})};}
test('record reading renders evidence controls without loading analysis editors',async()=>{
 let loads=0;const {ui}=fixture(async()=>{loads++;throw Error('must not load');});
 assert.match(ui.view(),/material-open/);assert.match(ui.view(),/material-repeat/);assert.doesNotMatch(ui.view(undefined,{readonly:true}),/material-repeat/);
 assert.equal(await ui.action({dataset:{action:'another-feature'}}),false);assert.equal(ui.isBusy(),false);assert.equal(ui.isReadingReference(),false);assert.equal(loads,0);
});
test('first evidence use coalesces loading, retains instance state and retries a failed chunk',async()=>{
 let finish,loads=0,creates=0,calls=[];const pending=new Promise(resolve=>finish=resolve);
 const {ui}=fixture(async()=>{loads++;return pending;});
 const first=ui.action({dataset:{action:'material-open'}}),second=ui.openReference({id:'retained'});assert.equal(ui.isBusy(),true);assert.equal(loads,1);
 finish({researchMaterialsUI:()=>{creates++;return {action:async control=>{calls.push(control.dataset.action);return true;},openReference:async target=>calls.push(target.id),view:()=>'<p>ready</p>',isBusy:()=>false,isReadingReference:()=>true};}});
 assert.equal(await first,true);await second;assert.equal(creates,1);assert.deepEqual(calls,['material-open','retained']);assert.equal(ui.isBusy(),false);assert.equal(ui.isReadingReference(),true);assert.equal(ui.view(),'<p>ready</p>');
 let attempts=0;const retry=fixture(async()=>{if(!attempts++)throw Error('Unavailable chunk');return {researchMaterialsUI:()=>({action:async()=>true,isBusy:()=>false})};}).ui;
 await assert.rejects(retry.action({dataset:{action:'material-open'}}),/Unavailable chunk/);assert.equal(retry.isBusy(),false);assert.equal(await retry.action({dataset:{action:'material-open'}}),true);assert.equal(attempts,2);
});
test('a delayed evidence module cannot act on a different workspace or record',async()=>{
 let finish,called=0;const pending=new Promise(resolve=>finish=resolve),{state,ui}=fixture(()=>pending);
 const call=ui.openRevision({id:'old-revision'});state.storage.contextId='workspace-b';
 finish({researchMaterialsUI:()=>({openRevision:async()=>called++})});await assert.rejects(call);assert.equal(called,0);
});
