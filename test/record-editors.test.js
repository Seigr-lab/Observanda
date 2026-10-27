import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deferredRecordEditor} from '../src/web/record-editors.js';
const state=()=>({storage:{contextId:'storage'},book:{id:'workspace'},page:'record-reader',selected:'one',access:{locked:false}});

test('selected editor loading preserves recovery and coalesces initial requests',async()=>{
 const options={state:state()};let loads=0,created=0,locks=0,resolve;
 const editor=deferredRecordEditor(options,()=>{loads++;return new Promise(done=>{resolve=done;});});
 assert.equal(loads,0);const first=editor.open({recordId:'one'}),second=editor.recover({draft:'retained'});await Promise.resolve();assert.equal(loads,1);
 resolve(received=>{assert.equal(received,options);created++;return {open:value=>value.recordId,recover:value=>value.draft,locked:()=>locks++};});
 assert.deepEqual(await Promise.all([first,second]),['one','retained']);assert.equal(created,1);editor.locked();assert.equal(locks,1);
 assert.equal(await editor.open({recordId:'again'}),'again');assert.equal(loads,1);
});

for(const change of ['record','owner','lock cycle'])test('delayed editor refuses changed '+change,async()=>{
 const current=state();let resolve,created=0;
 const editor=deferredRecordEditor({state:current},()=>new Promise(done=>{resolve=done;}));
 const request=editor.open({recordId:'one'}),refused=assert.rejects(request);await Promise.resolve();
 if(change==='record')current.selected='two';else if(change==='owner')current.projectOwner={projectId:'different'};else{current.access.locked=true;editor.locked();current.access.locked=false;}
 resolve(()=>{created++;return {open:()=>true};});await refused;assert.equal(created,0);
});

test('locked editors do not load; failed downloads can be retried',async()=>{
 const current=state();let loads=0;current.access.locked=true;
 const editor=deferredRecordEditor({state:current},async()=>{if(!loads++)throw Error('Chunk unavailable');return ()=>({open:()=>true});});
 await assert.rejects(editor.open({}));assert.equal(loads,0);current.access.locked=false;
 await assert.rejects(editor.open({}),/Chunk unavailable/);assert.equal(await editor.open({}),true);assert.equal(loads,2);
});
