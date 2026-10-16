import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {moduleWorkbench} from '../src/web/module-workbench.js';
import {FEATURE_MODULES,registerFeatureModule} from '../src/web/feature-modules.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(t,{delayed=false,scoped=false}={}){
 const id='lifetime-'+randomUUID(),created=[],state={storage:{contextId:'workspace'},book:{id:randomUUID(),projects:[]},projectOwner:{projectId:randomUUID()},dashboardSettings:{enabledModules:[id]},page:'workspace',moduleId:id,modulePath:''};let renders=0;
 const module=registerFeatureModule({id,label:'Lifetime fixture',...(scoped?{locationTool:{label:'Scoped fixture',path:'item'}}:{}),load:async()=>()=>{},createUI:()=>{
  const gate=deferred(),instance={disposed:0,actions:[],creations:[],dispose(){this.disposed++;},action(...args){this.actions.push(args);},create(...args){this.creations.push(args);}};
  created.push({gate,instance});return delayed?gate.promise:Promise.resolve(instance);
 }});
 t.after(()=>{FEATURE_MODULES.splice(FEATURE_MODULES.indexOf(module),1);});
 const workbench=moduleWorkbench({state,esc:v=>v,render:()=>{renders++;},api:async()=>({})});
 return {id,state,created,workbench,get renders(){return renders;},open:()=>workbench.action({dataset:{action:'module-open',moduleId:id,createType:'item'}}),release(){for(const {gate,instance} of created)gate.resolve(instance);}};
}

test('a delayed module open cannot replace navigation to Preferences or create a draft there',async t=>{
 const f=fixture(t,{delayed:true}),opening=f.open();f.state.page='preferences';f.workbench.bind();f.release();await opening;
 assert.equal(f.state.page,'preferences');assert.equal(f.created[0].instance.creations.length,0);assert.equal(f.renders,0);
});

test('project changes create distinct module owners and dispose a late initializer',async t=>{
 const f=fixture(t,{delayed:true}),first=f.workbench.ready(f.id);f.state.projectOwner={projectId:randomUUID()};f.state.book={id:randomUUID()};const second=f.workbench.ready(f.id);
 const count=f.created.length;f.release();const [a,b]=await Promise.all([first,second]);
 assert.equal(count,2);assert.equal(a,null);assert.equal(b,f.created[1].instance);assert.equal(f.created[0].instance.disposed,1);
});

test('returning to the same owner cannot revive its superseded initializer',async t=>{
 const f=fixture(t,{delayed:true}),owner=f.state.projectOwner,first=f.workbench.ready(f.id);f.state.projectOwner={projectId:randomUUID()};f.workbench.bind();f.state.projectOwner=owner;const second=f.workbench.ready(f.id);
 const count=f.created.length;f.release();const [a,b]=await Promise.all([first,second]);assert.equal(count,2);assert.equal(a,null);assert.equal(b,f.created[1].instance);assert.equal(f.created[0].instance.disposed,1);
});

test('a module disabled and reenabled during initialization gets a fresh owner',async t=>{
 const f=fixture(t,{delayed:true}),first=f.workbench.ready(f.id);f.state.dashboardSettings.enabledModules=[];f.workbench.bind();f.state.dashboardSettings.enabledModules=[f.id];const second=f.workbench.ready(f.id);
 const count=f.created.length;f.release();const [a,b]=await Promise.all([first,second]);assert.equal(count,2);assert.equal(a,null);assert.equal(b,f.created[1].instance);
});

test('late activation cannot return a replacement project editor',async t=>{
 const f=fixture(t),a=await f.workbench.ready(f.id),gate=deferred();a.activate=()=>gate.promise;const activation=f.workbench.ready(f.id);
 f.state.projectOwner={projectId:randomUUID()};f.state.book={id:randomUUID()};const b=f.workbench.ready(f.id);gate.resolve();
 const [old,current]=await Promise.all([activation,b]);assert.equal(old,null);assert.equal(current,f.created[1]?.instance);assert.equal(a.disposed,1);
});

test('a delayed reference handler cannot dispatch its old command to the new project editor',async t=>{
 const f=fixture(t),a=await f.workbench.ready(f.id),gate=deferred();f.state.page='module';a.referenceAction=()=>gate.promise;
 const action=f.workbench.action({dataset:{action:'module-command',command:'remove',id:randomUUID()}});
 f.state.projectOwner={projectId:randomUUID()};f.state.book={id:randomUUID()};const b=await f.workbench.ready(f.id);gate.resolve(false);await action;
 assert.equal(b.actions.length,0);assert.equal(a.actions.length,0);
});

test('superseded startup failures are ignored while current startup failures remain visible',async t=>{
 const f=fixture(t,{delayed:true}),first=f.workbench.ready(f.id);f.state.projectOwner={projectId:randomUUID()};f.workbench.bind();f.created[0].gate.reject(Error('Old owner unavailable'));assert.equal(await first,null);
 const second=f.workbench.ready(f.id);f.created[1].gate.reject(Error('Current owner unavailable'));await assert.rejects(second,/Current owner unavailable/);
});

test('an unchanged current view opens once and creates the requested item',async t=>{
 const f=fixture(t,{delayed:true}),first=f.open(),same=f.workbench.ready(f.id);assert.equal(f.created.length,1);f.release();await Promise.all([first,same]);assert.equal(f.state.page,'module');assert.equal(f.created[0].instance.creations.length,1);assert.equal(f.created[0].instance.disposed,0);
});


test('returning to the same screen does not revive its old open request',async t=>{
 const f=fixture(t,{delayed:true});f.state.page='preferences';const opening=f.open();f.state.page='workspace';f.workbench.bind();f.state.page='preferences';f.workbench.bind();f.release();await opening;
 assert.equal(f.state.page,'preferences');assert.equal(f.created[0].instance.creations.length,0);assert.equal(f.renders,0);
});

test('a failed old module open cannot report an error on a later screen',async t=>{
 const f=fixture(t,{delayed:true}),opening=f.open();f.state.page='preferences';f.workbench.bind();f.created[0].gate.reject(Error('Old module load failed'));await opening;assert.equal(f.state.page,'preferences');assert.equal(f.renders,0);
});

test('a current unavailable module still opens its explanatory view',async t=>{
 const f=fixture(t);f.state.dashboardSettings.enabledModules=[];await f.open();assert.equal(f.state.page,'module');assert.equal(f.created.length,0);assert.equal(f.renders,1);
});

test('reference-return tokens are scoped to the originating owner, module and route',async t=>{
 const f=fixture(t),instance=await f.workbench.ready(f.id),checkpoint={id:randomUUID(),etag:'a'.repeat(64)},itemId=randomUUID(),restored=[];
 f.state.page='module';f.state.modulePath='item/'+itemId;instance.captureReturn=async()=>({checkpoint,itemId});instance.restoreReturn=async token=>{restored.push(token);return true;};
 const token=await f.workbench.captureReturn();assert.equal(token.workspaceId,f.state.book.id);assert.equal(token.modulePath,f.state.modulePath);assert.equal(await f.workbench.restoreReturn(token),true);
 for(const property of ['workspaceId','moduleId','modulePath'])await assert.rejects(f.workbench.restoreReturn({...token,[property]:'changed'}),{name:'AbortError'});
 assert.equal(restored.length,1);
 const held=deferred();instance.captureReturn=()=>held.promise;const pending=f.workbench.captureReturn(),rejected=assert.rejects(pending,{name:'AbortError'});f.state.modulePath='item/'+randomUUID();held.resolve({checkpoint,itemId});await rejected;
});

for(const warm of [false,true])test((warm?'reused':'new')+' scoped editors publish one canonical item route before activation',async t=>{
 const f=fixture(t,{scoped:true}),itemId=randomUUID(),path='scope/workspace/item/'+itemId;
 if(warm){const instance=await f.workbench.ready(f.id);instance.activate=async()=>{assert.equal(f.state.modulePath,path);f.state.modulePath=path;};}
 await f.workbench.action({dataset:{action:'module-open',moduleId:f.id,modulePath:'item/'+itemId}});
 assert.equal(f.state.page,'module');assert.equal(f.state.modulePath,path);assert.equal(f.renders,1);assert.equal(f.created.length,1);
});

test('scoped opening retains its selected location and discards an obsolete activation',async t=>{
 const f=fixture(t,{scoped:true}),projectId=randomUUID(),itemId=randomUUID(),gate=deferred();
 f.state.book.projects=[{id:projectId,parentId:null,tools:[f.id]}];const instance=await f.workbench.ready(f.id),path='scope/'+projectId+'/item/'+itemId;
 instance.activate=()=>{assert.equal(f.state.modulePath,path);return gate.promise;};
 const pending=f.workbench.action({dataset:{action:'module-open',moduleId:f.id,modulePath:path}});f.state.page='preferences';f.workbench.bind();gate.resolve();await pending;
 assert.equal(f.state.page,'preferences');assert.equal(f.renders,0);assert.equal(f.state.modulePath,path);
});
