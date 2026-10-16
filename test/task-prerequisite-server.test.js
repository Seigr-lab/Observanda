import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile,unlink} from 'node:fs/promises';
import path from 'node:path';
import {fixture,result} from './task-prerequisite-fixture.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {readPlanningTask} from '../src/planning-task-reader.js';
import {taskConstraintDraft} from '../src/web/task-prerequisite-model.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {AppError} from '../src/errors.js';
import {MOVE_SOURCE} from '../src/workspace-move-state.js';

const ref=(workspaceId,id)=>({workspaceId,type:'task',id});
const data=(dependencies=[],status='todo',title='Task')=>({title,description:'',status,priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies,links:[]});
const command=(workspaceId,id,value,expectedRevision=null)=>({workspaceId,commandId:randomUUID(),action:'task.save',payload:{id,expectedRevision,data:value}});
const readiness=(workspaceId,id,value,expectedRevision=null,offset=0)=>({workspaceId,id,expectedRevision,data:taskConstraintDraft(value),offset,limit:25});

test('task prerequisites use addressed owner reads, retain completion and preserve replay without source grants',{timeout:180000},async t=>{
 const f=await fixture(t),id=randomUUID(),source=ref(f.a.namespaceId,id),local=ref(f.b.namespaceId,id),root='/api',routes=[[root,f.initial.id],[f.base,f.project.namespaceId],[f.other,f.b.namespaceId]];
 await result(await f.call(f.own+'/modules/command',command(source.workspaceId,id,data([],'done','Source task'))));
 await result(await f.call(f.other+'/modules/command',command(local.workspaceId,id,data([],'done','Independent local task'))));
 const before=await readPlanningTask(f.selected,source),sourceHead=await f.selected.catalogue(store=>store.head());
 const draft=data([source,id],'done','Dependent task'),savedCommand=command(local.workspaceId,randomUUID(),draft),route=f.other;
 const original=ModuleCatalogue.prototype.selected;ModuleCatalogue.prototype.selected=()=>{throw Error('Readiness cannot load authored task originals');};
 try{
  for(const [prefix,workspaceId] of routes){
   const response=await result(await f.call(prefix+'/modules/planning/readiness',readiness(workspaceId,randomUUID(),data([source]))));
   assert.equal(response.scope,'page');assert.equal(response.checked,1);assert.equal(response.items[0].taskStatus,'done');assert.equal(response.items[0].owner.notebookTitle,'Measurements');assert.equal(response.items[0].title,'Source task');
  }
  const sameUUID=await result(await f.call(route+'/modules/planning/readiness',readiness(local.workspaceId,savedCommand.payload.id,draft)));
  assert.deepEqual(sameUUID.items.map(item=>item.reference),[source,local]);assert.deepEqual(sameUUID.items.map(item=>item.title),['Source task','Independent local task']);
 }finally{ModuleCatalogue.prototype.selected=original;}
 // Readiness does not acquire an unrelated source or result research writer.
 let release,entered;const held=new Promise(resolve=>release=resolve),ready=new Promise(resolve=>entered=resolve),busy=f.selected.withLock(()=>f.sibling.withLock(async()=>{entered();await held;}));await ready;
 try{assert.equal((await f.call(route+'/modules/planning/readiness',readiness(local.workspaceId,savedCommand.payload.id,draft))).status,200);}finally{release();await busy;}
 const saved=await result(await f.call(route+'/modules/command',savedCommand)),entity=saved.entities[0],observations=entity.data.prerequisiteObservations;
 assert.equal(observations.length,1);assert.deepEqual(observations[0].reference,source);assert.equal(observations[0].revision,1);assert.equal(observations[0].hash,before.hash);assert.equal(observations[0].constraintHash,before.constraintHash);
 assert.deepEqual(await readPlanningTask(f.selected,source),before);assert.equal(await f.selected.catalogue(store=>store.head()),sourceHead);
 // The result routes share the same completion contract.
 for(const [prefix,workspaceId] of routes.slice(0,2)){const value=await result(await f.call(prefix+'/modules/command',command(workspaceId,randomUUID(),data([source],'done'))));assert.deepEqual(value.entities[0].data.prerequisiteObservations[0].reference,source);}
 await result(await f.call(f.own+'/modules/command',command(source.workspaceId,id,data([],'todo','Source reopened'),1)));
 const current=await result(await f.call(route+'/modules/planning/readiness',readiness(local.workspaceId,entity.id,entity.data,1)));
 assert.equal(current.items[0].changed,true);assert.equal(current.items[0].taskStatus,'todo');assert.equal(current.items[0].observedRevision,1);
 const unchanged=await result(await f.call(route+'/modules/item',{workspaceId:local.workspaceId,id:entity.id}));assert.equal(unchanged.entity.data.status,'done');assert.deepEqual(unchanged.entity.data.prerequisiteObservations,observations);
 const second=await f.client();await result(await f.call(f.own+'/access/lock',{}));
 const locked=await result(await f.call(route+'/modules/planning/readiness',readiness(local.workspaceId,entity.id,entity.data,1)));
 assert.equal(locked.items[0].status,'unavailable');assert.equal(locked.items[0].labBookId,f.a.labBookId);assert.equal(Object.hasOwn(locked.items[0],'title'),false);
 const cosmetic=command(local.workspaceId,entity.id,{...entity.data,title:'Renamed dependent'},1),edited=await result(await f.call(route+'/modules/command',cosmetic));assert.deepEqual(edited.entities[0].data.prerequisiteObservations,observations);
 const replay=await result(await f.call(route+'/modules/command',savedCommand));assert.equal(replay.replayed,true);assert.equal(replay.entities[0].data.title,'Renamed dependent');
 const conflict=await result(await f.call(route+'/modules/command',{...savedCommand,payload:{...savedCommand.payload,data:{...draft,title:'Different command'}}}),409);assert.equal(conflict.code,'MODULE_REPLAY');
 await result(await second(f.own+'/access/unlock',{}));
 const denied=await result(await f.call(route+'/modules/command',command(local.workspaceId,randomUUID(),data([source]))),401);assert.equal(denied.projectId,f.projectId);assert.equal(denied.labBookId,f.a.labBookId);
 await result(await f.call(f.own+'/access/unlock',{}));
 const transitive=command(local.workspaceId,randomUUID(),data([entity.id]));await result(await f.call(route+'/modules/command',transitive));
 const coordinator=new ProjectModuleCommands(f.sibling,local.workspaceId);
 await assert.rejects(coordinator.execute(command(local.workspaceId,randomUUID(),data([entity.id]))),{code:'TASK_PREREQUISITE_ACCESS'});
 const nativeCosmetic=await coordinator.execute(command(local.workspaceId,entity.id,{...edited.entities[0].data,title:'Cosmetic without source access'},2));assert.deepEqual(nativeCosmetic.entities[0].data.prerequisiteObservations,observations);
 await result(await f.call(f.own+'/modules/command',command(source.workspaceId,id,data([],'done','Source complete again'),2)));
 const write=ModuleCatalogue.prototype.writeChanges,httpRevoked=command(local.workspaceId,randomUUID(),data([source],'done'));
 ModuleCatalogue.prototype.writeChanges=async function(head,changes,event){const value=await write.call(this,head,changes,event);if(event.commandId===httpRevoked.commandId)await result(await f.call(f.own+'/access/lock',{}));return value;};
 try{const response=await result(await f.call(route+'/modules/command',httpRevoked),401);assert.equal(response.labBookId,f.a.labBookId);}finally{ModuleCatalogue.prototype.writeChanges=write;}
 await assert.rejects(readPlanningTask(f.sibling,ref(local.workspaceId,httpRevoked.payload.id)),{code:'NOT_FOUND'});await result(await f.call(f.own+'/access/unlock',{}));
 let authorized=true,closed=0;
 const verify=async()=>{if(!authorized)throw new AppError('ACCESS_LOCKED');};
 const taskSourceAccess=async()=>({async read(reference){await verify();assert.equal(reference.workspaceId,source.workspaceId);return readPlanningTask(f.selected,reference);},async useOwner(namespace,consume){await verify();assert.equal(namespace,source.workspaceId);return f.selected.catalogue(()=>consume(f.selected));},verify,async close(){closed++;}});
 const rejected=command(local.workspaceId,randomUUID(),data([source],'done'));
 authorized=false;await assert.rejects(coordinator.execute(rejected,{taskSourceAccess}),{code:'ACCESS_LOCKED'});authorized=true;
 ModuleCatalogue.prototype.writeChanges=async function(head,changes,event){const value=await write.call(this,head,changes,event);if(event.commandId===rejected.commandId){await assert.rejects(f.selected.withStorageHandoff(async()=>{}),{code:'LOCKED'});authorized=false;}return value;};
 try{await assert.rejects(coordinator.execute(rejected,{taskSourceAccess}),{code:'ACCESS_LOCKED'});}finally{ModuleCatalogue.prototype.writeChanges=write;authorized=true;}
 await assert.rejects(readPlanningTask(f.sibling,ref(local.workspaceId,rejected.payload.id)),{code:'NOT_FOUND'});
 const cancelled=command(local.workspaceId,randomUUID(),data([source],'done')),abort=new AbortController();
 ModuleCatalogue.prototype.writeChanges=async function(head,changes,event){const value=await write.call(this,head,changes,event);if(event.commandId===cancelled.commandId)abort.abort(Error('Synthetic task cancellation'));return value;};
 try{await assert.rejects(coordinator.execute(cancelled,{taskSourceAccess,signal:abort.signal}),/Synthetic task cancellation/);}finally{ModuleCatalogue.prototype.writeChanges=write;}
 await assert.rejects(readPlanningTask(f.sibling,ref(local.workspaceId,cancelled.payload.id)),{code:'NOT_FOUND'});
 const marker=path.join(f.selected.root,MOVE_SOURCE);await writeFile(marker,JSON.stringify({id:randomUUID(),destination:path.join(f.directory,'Moved source')}));
 try{await assert.rejects(coordinator.execute(rejected,{taskSourceAccess}),{code:'STORAGE_MOVED'});}finally{await unlink(marker);}
 assert.equal((await coordinator.execute(rejected,{taskSourceAccess})).entities[0].revision,1);assert.ok(closed>=5);
 const activity=await result(await f.call('/api/activity'));assert.equal(activity.operations.some(item=>item.kind.includes('/planning/readiness')),false);
});

test('opposing owner task saves cannot commit a cycle and exact simultaneous retries share a receipt',{timeout:180000},async t=>{
 const f=await fixture(t),left=randomUUID(),right=randomUUID(),a=ref(f.a.namespaceId,left),b=ref(f.b.namespaceId,right);
 await result(await f.call(f.own+'/modules/command',command(a.workspaceId,a.id,data())));await result(await f.call(f.other+'/modules/command',command(b.workspaceId,b.id,data())));
 const pair=await Promise.all([f.call(f.own+'/modules/command',command(a.workspaceId,a.id,data([b]),1)),f.call(f.other+'/modules/command',command(b.workspaceId,b.id,data([a]),1))]);
 const values=await Promise.all(pair.map(async response=>({status:response.status,value:await response.json()})));
 assert.equal(values.filter(value=>value.status===200).length,1,JSON.stringify(values));assert.equal(values.some(value=>value.status!==200&&['MODULE_INVALID','TASK_PREREQUISITE_CHANGED','MODULE_CHANGED'].includes(value.value.code)),true,JSON.stringify(values));
 const repeated=command(f.project.namespaceId,randomUUID(),data([],'todo','Exact retry'));
 const responses=await Promise.all([f.call(f.base+'/modules/command',repeated),f.call(f.base+'/modules/command',repeated)]),receipts=await Promise.all(responses.map(response=>result(response)));
 assert.equal(receipts.filter(value=>value.replayed).length,1);assert.equal(receipts[0].entities[0].revision,1);assert.equal(receipts[1].entities[0].revision,1);
 const sameOwnerSource=command(f.project.namespaceId,randomUUID(),data([],'done'));await result(await f.call(f.base+'/modules/command',sameOwnerSource));
 const sameOwnerDependent=command(f.project.namespaceId,randomUUID(),data([ref(f.project.namespaceId,sameOwnerSource.payload.id)],'done'));await result(await f.call(f.base+'/modules/command',sameOwnerDependent));
 const beforeSource=await readPlanningTask(f.parent,ref(f.project.namespaceId,sameOwnerSource.payload.id)),beforeDependent=await readPlanningTask(f.parent,ref(f.project.namespaceId,sameOwnerDependent.payload.id));
 const reopening=await f.call(f.base+'/modules/command',command(f.project.namespaceId,sameOwnerSource.payload.id,data([],'todo'),1));assert.notEqual(reopening.status,200);assert.equal((await reopening.json()).code,'TASK_BLOCKED');
 assert.deepEqual(await readPlanningTask(f.parent,ref(f.project.namespaceId,sameOwnerSource.payload.id)),beforeSource);assert.deepEqual(await readPlanningTask(f.parent,ref(f.project.namespaceId,sameOwnerDependent.payload.id)),beforeDependent);
});
