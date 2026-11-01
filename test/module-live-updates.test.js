import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationsUpdates} from '../src/web/modules/live-updates.js';
import {randomUUID} from 'node:crypto';
function fixture(t,request){
 const previous={window:globalThis.window,document:globalThis.document};globalThis.window=new EventTarget();globalThis.document={hidden:false};
 const state={book:{id:randomUUID()},storage:{contextId:randomUUID()},page:'workspace',dashboardSettings:{enabledModules:['resources']},access:{locked:false}};state.moduleData={workspaceId:state.book.id,revision:4,entities:[]};
 let draws=0,editing=false;const calls=[],updates=operationsUpdates({state,api:async(...args)=>{calls.push(args);return request(...args,state);},onChange:()=>draws++,isEditing:()=>editing});
 t.after(()=>{updates.stop();globalThis.window=previous.window;globalThis.document=previous.document;});
 return {state,updates,calls,get draws(){return draws;},edit:(value=true)=>editing=value};
}
test('ten idle minutes only check revisions and defer one changed revision until editing ends',async t=>{
 let now=0,version=4;t.mock.method(Date,'now',()=>now);
 const f=fixture(t,async(_route,_body,_options,state)=>({workspaceId:state.book.id,revision:version}));
 await f.updates.refresh();assert.equal(f.draws,1);
 for(let i=0;i<40;i++){now+=15000;await f.updates.refresh();}assert.equal(f.draws,1);assert.ok(f.calls.every(([route])=>route==='/api/modules/version'));
 f.edit();version=5;await f.updates.refresh();version=6;await f.updates.refresh();assert.equal(f.draws,1);
 f.edit(false);await f.updates.refresh();assert.equal(f.draws,2);await f.updates.refresh();assert.equal(f.draws,2);
 document.hidden=true;const count=f.calls.length;version=7;await f.updates.refresh();assert.equal(f.calls.length,count);document.hidden=false;await f.updates.refresh();assert.equal(f.draws,3);
});
test('project refreshes transfer only revisions without replacing an active form',async t=>{
 let version=4;
 const f=fixture(t,async(route,body,options,state)=>{
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(route,'/api/modules/version');return {workspaceId:state.book.id,revision:version};
 });
 f.state.page='project';
 await f.updates.refresh();await f.updates.refresh();assert.equal(f.calls.filter(([path])=>path.endsWith('/data')).length,0);
 f.edit();const before=f.draws;version=5;await f.updates.refresh();await f.updates.refresh();
 assert.equal(f.state.moduleRevision.revision,5);assert.equal(f.state.moduleData.revision,4);assert.equal(f.draws,before);
 // A response started before a newer local save must not reload older data.
 f.state.moduleRevision.revision=6;await f.updates.refresh();assert.equal(f.state.moduleRevision.revision,6);
});
test('invalid, failed and stale version replies cannot refresh another workspace or overwrite retained module data',async t=>{
 let response,release,held=false;
 const f=fixture(t,async(route)=>{assert.equal(route,'/api/modules/version');if(held)await new Promise(resolve=>release=resolve);if(response instanceof Error)throw response;return response;});
 for(const value of [{workspaceId:randomUUID(),revision:5},{workspaceId:f.state.book.id,revision:-1},null,Error('Disconnected')]){response=value;await f.updates.refresh();assert.equal(f.state.moduleData.revision,4);assert.equal(f.draws,0);}
 response={workspaceId:f.state.book.id,revision:5};held=true;const pending=f.updates.refresh();await new Promise(setImmediate);f.state.storage.contextId=randomUUID();release();await pending;assert.equal(f.draws,0);
 const stopped=f.updates.refresh();await new Promise(setImmediate);const signal=f.calls.at(-1)[2].signal;f.updates.stop();assert.equal(signal.aborted,true);release();await stopped;
 const count=f.calls.length;window.dispatchEvent(new Event('focus'));await f.updates.refresh();assert.equal(f.calls.length,count);
});

for(const moduleId of ['planning','resources'])test(moduleId+' refreshes retain only the revision and leave active drafts alone',async t=>{
 let version=4;
 const f=fixture(t,async(route,body,options,state)=>{assert.equal(route,'/api/modules/version');return {workspaceId:state.book.id,revision:version};});
 f.state.page='module';f.state.moduleId=moduleId;f.state.dashboardSettings.enabledModules=[moduleId];
 await f.updates.refresh();assert.equal(f.draws,1);assert.equal(f.state.moduleRevision.revision,4);
 version=5;await f.updates.refresh();assert.equal(f.draws,2);assert.equal(f.state.moduleRevision.revision,5);
 f.edit();version=6;await f.updates.refresh();assert.equal(f.draws,2);assert.equal(f.state.moduleRevision.revision,6);
 assert.equal(f.state.moduleData.revision,4);
});
