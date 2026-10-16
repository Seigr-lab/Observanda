import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {moduleEditor} from '../src/web/modules/workbench.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t,{holdWrite=false,includeCheckpoint=false,writeFailure=null,paged=false,scoped=false}={}){
 const host={inert:false,attributes:{},setAttribute(name,value){this.attributes[name]=value;},querySelectorAll:()=>[]};
 const previous=globalThis.document;globalThis.document={querySelector:selector=>selector==='.module-workbench'?host:null,querySelectorAll:()=>[],activeElement:null};t.after(()=>{globalThis.document=previous;});
 const workspaceId=randomUUID(),itemId=randomUUID(),checkpoint={workspaceId,moduleId:'inventory',id:randomUUID(),etag:'a'.repeat(64)},read=deferred(),write=deferred(),itemRead=deferred(),writes=[];
 const draft={id:itemId,type:'resource',expectedRevision:3,base:{name:'Earlier saved value'},data:{name:'Retained local value'}},state={page:'module',moduleId:'inventory',modulePath:'resource/'+itemId,book:{id:workspaceId,entries:[],projects:[]},storage:{contextId:randomUUID()}},result={etag:checkpoint.etag,draft:{...checkpoint,drafts:[draft]}};
 let context,renders=0,reads=0,selectedReads=0;
 const api=async(route,body)=>{
  if(route==='/api/modules/items')return {workspaceId,revision:3,items:[],offset:0,total:0,cursor:null,nextCursor:null,previousCursor:null};
  if(route==='/api/modules/item'){selectedReads++;return itemRead.promise;}
  if(route==='/api/modules/data')return {data:{workspaceId,revision:3,entities:[]}};
  if(route.endsWith('/drafts/list'))return {workspaceId,drafts:includeCheckpoint?[{id:checkpoint.id,moduleId:checkpoint.moduleId,revision:checkpoint.etag,updatedAt:new Date().toISOString(),count:1,titles:['Retained local value']}]:[],nextCursor:null,previousCursor:null};
  if(route.endsWith('/drafts/read')){reads++;return read.promise;}
  if(route.endsWith('/drafts/write')){writes.push(structuredClone(body));if(writeFailure)throw writeFailure;if(holdWrite&&body.id!==checkpoint.id)await write.promise;return {etag:'b'.repeat(64)};}
  throw Error('Unexpected route '+route);
 };
 const editor=await moduleEditor({state,api,esc:value=>value,field:()=>'',option:()=>'',render:()=>{renders++;},notify:()=>{}},{id:'inventory',label:'Inventory',paged,scoped,types:[{id:'resource',label:'Resources',singular:'resource'}],blank:()=>({name:''}),setup:value=>{context=value;},form:()=>''});
 t.after(()=>editor.dispose());return {state,editor,checkpoint,itemId,draft,read,write,itemRead,writes,result,context,host,get selectedReads(){return selectedReads;},get renders(){return renders;},get reads(){return reads;},token:{checkpoint,itemId}};
}

test('late return checkpoint cannot replace another clean item in the same module',async t=>{
 const f=await fixture(t),pending=f.editor.restoreReturn(f.token),rejected=assert.rejects(pending,{name:'AbortError'}),other=randomUUID();
 await f.context.edit(other,'resource');const route=f.state.modulePath;f.read.resolve(f.result);await rejected;
 assert.equal(f.context.current.id,other);assert.equal(f.state.modulePath,route);assert.equal(f.writes.length,0);
});

test('deactivation invalidates a pending return even when the same route is reentered',async t=>{
 const f=await fixture(t),route=f.state.modulePath,pending=f.editor.restoreReturn(f.token),rejected=assert.rejects(pending,{name:'AbortError'});
 f.editor.deactivate();f.state.modulePath='resource';f.state.modulePath=route;f.read.resolve(f.result);await rejected;
 assert.equal(f.context.current,undefined);assert.equal(f.state.modulePath,route);assert.equal(f.writes.length,0);
});

test('navigation while the restored checkpoint saves preserves the original checkpoint and never renders over the new route',async t=>{
 const f=await fixture(t,{holdWrite:true}),pending=f.editor.restoreReturn(f.token),rejected=assert.rejects(pending,{name:'AbortError'});f.read.resolve(f.result);await turn();
 assert.equal(f.context.current.data.name,'Retained local value');f.editor.deactivate();f.state.modulePath='resource';const renders=f.renders;f.write.resolve();await rejected;
 assert.equal(f.writes.length,1);assert.notEqual(f.writes[0].id,f.checkpoint.id);assert.equal(f.state.modulePath,'resource');assert.equal(f.renders,renders);
});

test('successful return retains the original saved revision and retires only the exact checkpoint after durable replacement',async t=>{
 const f=await fixture(t),pending=f.editor.restoreReturn(f.token);f.read.resolve(f.result);assert.equal(await pending,true);
 assert.deepEqual(f.context.current,f.draft);assert.equal(f.writes.length,2);assert.notEqual(f.writes[0].id,f.checkpoint.id);assert.equal(f.writes[1].id,f.checkpoint.id);assert.equal(f.writes[1].etag,f.checkpoint.etag);assert.deepEqual(f.writes[1].drafts,[]);
});

test('a newer pending navigation cancels return before route or editor disposal occurs',async t=>{
 const f=await fixture(t);let current=true;const pending=f.editor.restoreReturn(f.token,{current:()=>current}),rejected=assert.rejects(pending,{name:'AbortError'});
 current=false;f.read.resolve(f.result);await rejected;assert.equal(f.context.current,undefined);assert.equal(f.writes.length,0);
});

test('parking a checkpoint after list navigation redraws the list to remove its released in-memory draft',async t=>{
 const f=await fixture(t,{holdWrite:true});await f.context.edit(f.itemId,'resource');f.context.current.data.name='Parked edit';f.context.change();await f.context.list();await turn();const rendered=f.renders;
 f.write.resolve();await turn();await turn();assert.equal(f.editor.isDirty(),false);assert.ok(f.renders>rendered,'The displayed list must remove the draft after its durable checkpoint replaces it');
});


test('restoring another checkpoint parks current edits separately before reading or retiring the selected checkpoint',async t=>{
 const f=await fixture(t,{holdWrite:true,includeCheckpoint:true}),originalId=randomUUID();await f.context.edit(originalId,'resource');f.context.current.data.name='Original unfinished item';f.context.change();
 const pending=f.editor.action('recover',{dataset:{id:f.checkpoint.id}});await turn();assert.equal(f.reads,0,'Selected draft must wait for the authored draft to become independently durable');
 f.write.resolve();await turn();f.read.resolve(f.result);await pending;
 assert.equal(f.context.current.id,f.itemId);assert.equal(f.context.current.data.name,'Retained local value');assert.equal(f.writes.length,3);
 assert.notEqual(f.writes[0].id,f.writes[1].id);assert.equal(f.writes[0].drafts.length,1);assert.equal(f.writes[0].drafts[0].id,originalId);assert.equal(f.writes[1].drafts.length,1);assert.equal(f.writes[1].drafts[0].id,f.itemId);assert.equal(f.writes[2].id,f.checkpoint.id);assert.equal(f.writes[2].etag,f.checkpoint.etag);assert.deepEqual(f.writes[2].drafts,[]);
});


test('failed durable parking preserves authored input and never consumes the selected recovery checkpoint',async t=>{
 const f=await fixture(t,{includeCheckpoint:true,writeFailure:Error('Interrupted checkpoint')}),originalId=randomUUID();await f.context.edit(originalId,'resource');f.context.current.data.name='Still authored here';f.context.change();
 await assert.rejects(f.editor.action('recover',{dataset:{id:f.checkpoint.id}}),/Interrupted checkpoint/);
 assert.equal(f.context.current.id,originalId);assert.equal(f.context.current.data.name,'Still authored here');assert.equal(f.reads,0);assert.equal(f.writes.length,1);assert.notEqual(f.writes[0].id,f.checkpoint.id);
});

test('navigation during recovery parking leaves its durable authored draft intact and never loads the selected checkpoint',async t=>{
 const f=await fixture(t,{holdWrite:true,includeCheckpoint:true}),originalId=randomUUID();await f.context.edit(originalId,'resource');f.context.current.data.name='Keep for later';f.context.change();
 const pending=f.editor.action('recover',{dataset:{id:f.checkpoint.id}}),rejected=assert.rejects(pending,{name:'AbortError'});await turn();f.editor.deactivate();f.state.page='preferences';const rendered=f.renders;f.write.resolve();await rejected;
 assert.equal(f.reads,0);assert.equal(f.writes.length,1);assert.equal(f.writes[0].drafts[0].data.name,'Keep for later');assert.equal(f.renders,rendered);assert.equal(f.state.page,'preferences');
});


test('a failed selected checkpoint read leaves the authored checkpoint parked on the module list',async t=>{
 const f=await fixture(t,{includeCheckpoint:true}),originalId=randomUUID();await f.context.edit(originalId,'resource');f.context.current.data.name='Independently parked item';f.context.change();
 const pending=f.editor.action('recover',{dataset:{id:f.checkpoint.id}}),rejected=assert.rejects(pending,/no longer available/);await turn();f.read.resolve({...f.result,etag:'c'.repeat(64)});await rejected;
 assert.equal(f.state.modulePath,'resource');assert.equal(f.context.current,undefined);assert.equal(f.writes.length,1);assert.notEqual(f.writes[0].id,f.checkpoint.id);assert.equal(f.writes[0].drafts[0].id,originalId);assert.equal(f.writes[0].drafts[0].data.name,'Independently parked item');assert.equal(f.host.attributes['aria-busy'],'false');
});

for(const failure of [false,true])test('an obsolete recovery '+(failure?'failure':'success')+' cannot release a newer selected item request',async t=>{
 const f=await fixture(t,{includeCheckpoint:true,paged:true}),pending=f.editor.action('recover',{dataset:{id:f.checkpoint.id}}),rejected=assert.rejects(pending,{name:'AbortError'});await turn();assert.equal(f.reads,1);
 f.editor.deactivate();const other=randomUUID();f.state.modulePath='resource/'+other;const opening=f.editor.activate();await turn();const rendered=f.renders;assert.equal(f.selectedReads,1);assert.equal(f.host.attributes['aria-busy'],'true');assert.equal(f.host.inert,true);
 if(failure)f.read.reject(Error('Obsolete selected checkpoint failure'));else f.read.resolve(f.result);await rejected;
 assert.equal(f.host.attributes['aria-busy'],'true');assert.equal(f.host.inert,true);assert.equal(f.renders,rendered);assert.equal(f.state.modulePath,'resource/'+other);assert.equal(f.writes.length,0);
 f.itemRead.resolve({workspaceId:f.state.book.id,revision:3,entity:{id:other,type:'resource',revision:2,data:{name:'Newer selected item'}}});await opening;assert.equal(f.context.current.id,other);assert.equal(f.host.attributes['aria-busy'],'false');assert.equal(f.host.inert,false);
});

for(const explicitScope of [false,true])test('scoped item route is final before loading begins '+(explicitScope?'with a selected location':'without an explicit location'),async t=>{
 const f=await fixture(t,{paged:true,scoped:true}),projectId=explicitScope?randomUUID():null;
 if(projectId){f.state.book.projects.push({id:projectId,title:'Selected location',parentId:null,tools:['inventory']});f.state.modulePath='scope/'+projectId+'/resource/'+f.itemId;}
 const expected='scope/'+(projectId??'workspace')+'/resource/'+f.itemId;
 assert.match(f.editor.view(f.state.modulePath),/Opening saved item/);assert.equal(f.state.modulePath,expected);
 await turn();assert.equal(f.selectedReads,1);
 f.itemRead.resolve({workspaceId:f.state.book.id,revision:3,entity:{id:f.itemId,type:'resource',revision:2,data:{name:'Opened item',projectId}}});await turn();
 assert.equal(f.context.current.id,f.itemId);assert.equal(f.state.modulePath,expected);assert.equal(f.selectedReads,1);
});
