import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
// Load domain registrations in application order before selecting a validator.
import '../src/modules/index.js';
import {validatePlanningSource} from '../src/modules/planning-constraints.js';
import {moduleConstraint} from '../src/modules/constraints.js';
const task=(dependencies=[],status='done',checklist=[])=>({id:randomUUID(),type:'task',data:{title:'Task',description:'',priority:'normal',dueOn:null,assignees:[],links:[],dependencies,status,checklist}});
function source(entities,{changes=null,previous}={}){
 const facts=new Map(entities.map(entity=>[entity.id,moduleConstraint(entity)])),reads=new Map(),scans=[];
 return {changes,previous,reads,scans,
  async get(id){reads.set(id,(reads.get(id)??0)+1);return structuredClone(facts.get(id)??null);},
  async *all(type){scans.push(type);for(const fact of facts.values())if(fact.type===type)yield structuredClone(fact);}
 };
}
test('wide task adjacency is read once through encrypted pages and shared diamond targets are reused',async t=>{
 const leaf=task(),branches=Array.from({length:2000},()=>task([leaf.id])),wide=task(branches.map(item=>item.id)),root=task([wide.id]),graph=source([root,wide,...branches,leaf]);
 assert.ok(Buffer.byteLength(JSON.stringify(moduleConstraint(wide)))>65536,'The adjacency must exceed the constraint cache entry limit');
 const start=performance.now();await validatePlanningSource(graph);
 assert.equal(graph.reads.get(wide.id),1);assert.equal(graph.reads.get(leaf.id),1);
 assert.equal(graph.reads.size,2002);assert.ok([...graph.reads.values()].every(count=>count===1));
 t.diagnostic(JSON.stringify({outgoingEdges:branches.length,adjacencyBytes:Buffer.byteLength(JSON.stringify(moduleConstraint(wide))),selectedFacts:graph.reads.size,elapsedMs:Math.round(performance.now()-start)}));
});
test('deep task traversal remains nonrecursive and detects a cycle at the end of the chain',async t=>{
 const tasks=Array.from({length:2000},()=>task());for(let i=0;i<tasks.length-1;i++)tasks[i].data.dependencies=[tasks[i+1].id];
 const graph=source(tasks);await validatePlanningSource(graph);
 assert.equal(graph.reads.size,tasks.length-1);assert.ok([...graph.reads.values()].every(count=>count===1));
 tasks.at(-1).data.dependencies=[tasks[0].id];await assert.rejects(validatePlanningSource(source(tasks)),{code:'MODULE_INVALID'});
 t.diagnostic(JSON.stringify({depth:tasks.length,selectedFacts:graph.reads.size}));
});
test('independent task roots need no selected reads and retain checklist completion checks',async t=>{
 const tasks=Array.from({length:2000},()=>task()),graph=source(tasks),start=performance.now();await validatePlanningSource(graph);
 assert.equal(graph.reads.size,0);t.diagnostic(JSON.stringify({independentTasks:tasks.length,elapsedMs:Math.round(performance.now()-start)}));
 tasks.at(-1).data.checklist=[{id:randomUUID(),text:'Unfinished',done:false}];await assert.rejects(validatePlanningSource(source(tasks)),{code:'TASK_BLOCKED'});
});
test('the last edge is checked on both sides of an encrypted adjacency page boundary',async t=>{
 for(const count of [32,33])await t.test(String(count)+' dependencies',async()=>{
  const leaves=Array.from({length:count},()=>task()),root=task(leaves.map(item=>item.id));await validatePlanningSource(source([root,...leaves]));
  root.data.dependencies[count-1]=randomUUID();await assert.rejects(validatePlanningSource(source([root,...leaves])),{code:'MODULE_INVALID'});
 });
});
test('cycles, missing targets and targets of another type are still rejected',async t=>{
 await t.test('diamond back edge',async()=>{const shared=task(),left=task([shared.id]),right=task([shared.id]),root=task([left.id,right.id]);shared.data.dependencies=[right.id];await assert.rejects(validatePlanningSource(source([root,left,right,shared])),{code:'MODULE_INVALID'});});
 await t.test('self cycle',async()=>{const item=task();item.data.dependencies=[item.id];await assert.rejects(validatePlanningSource(source([item])),{code:'MODULE_INVALID'});});
 await t.test('missing target',async()=>{await assert.rejects(validatePlanningSource(source([task([randomUUID()])])),{code:'MODULE_INVALID'});});
 await t.test('other type',async()=>{const resource={id:randomUUID(),type:'resource',data:{kind:'equipment',capacity:1}},item=task([resource.id]);await assert.rejects(validatePlanningSource(source([item,resource])),{code:'MODULE_INVALID'});});
});
test('cosmetic changes with identical authenticated constraints do not enumerate the graph',async()=>{
 const original=task([], 'todo',[{id:randomUUID(),text:'Check',done:false}]),changed=structuredClone(original);
 Object.assign(changed.data,{title:'Renamed',description:'Revised prose',priority:'high',assignees:['Researcher']});changed.data.checklist[0].text='Reworded check';
 let previousReads=0;const graph=source([changed],{changes:new Map([[changed.id,changed]]),previous:async id=>{assert.equal(id,original.id);previousReads++;return moduleConstraint(original);}});
 await validatePlanningSource(graph);assert.equal(previousReads,1);assert.deepEqual(graph.scans,[]);assert.equal(graph.reads.size,0);
});
test('semantic changes still check every task and prevent reopening completed prerequisites',async t=>{
 await t.test('reopened prerequisite encountered before its completed dependent',async()=>{
  const original=task(),changed={...original,data:{...original.data,status:'todo'}},dependent=task([original.id]),graph=source([changed,dependent],{changes:new Map([[changed.id,changed]]),previous:async()=>moduleConstraint(original)});
  await assert.rejects(validatePlanningSource(graph),{code:'TASK_BLOCKED'});assert.deepEqual(graph.scans,['task']);
 });
 await t.test('new prerequisite edge requires completion',async()=>{
  const prerequisite=task([],'todo'),original=task(),changed={...original,data:{...original.data,dependencies:[prerequisite.id]}};
  await assert.rejects(validatePlanningSource(source([changed,prerequisite],{changes:new Map([[changed.id,changed]]),previous:async()=>moduleConstraint(original)})),{code:'TASK_BLOCKED'});
 });
 await t.test('unchecked checklist item blocks a completed task',async()=>{
  const original=task([], 'done',[{id:randomUUID(),text:'Check',done:true}]),changed=structuredClone(original);changed.data.checklist[0].done=false;
  await assert.rejects(validatePlanningSource(source([changed],{changes:new Map([[changed.id,changed]]),previous:async()=>moduleConstraint(original)})),{code:'TASK_BLOCKED'});
 });
 await t.test('semantic edit still audits unrelated roots',async()=>{
  const original=task([],'todo'),changed={...original,data:{...original.data,status:'doing'}},broken=task([randomUUID()]);
  await assert.rejects(validatePlanningSource(source([changed,broken],{changes:new Map([[changed.id,changed]]),previous:async()=>moduleConstraint(original)})),{code:'MODULE_INVALID'});
 });
});
test('legacy audits and missing previous facts cannot take the cosmetic shortcut',async t=>{
 for(const mode of ['audit','no previous callback','new task','previous other type'])await t.test(mode,async()=>{
  const item=task();item.data.dependencies=[item.id];const changes=mode==='audit'?null:new Map([[item.id,item]]),previous=mode==='no previous callback'?undefined:async()=>mode==='new task'?null:mode==='previous other type'?{id:item.id,type:'resource',data:{}}:moduleConstraint(item);
  const graph=source([item],{changes,previous});await assert.rejects(validatePlanningSource(graph),{code:'MODULE_INVALID'});assert.deepEqual(graph.scans,['task']);
 });
});
test('skipping cosmetic task constraints does not skip changed equipment bookings',async()=>{
 const item=task(),resource={id:randomUUID(),type:'resource',data:{kind:'equipment',capacity:1}},booking=()=>({id:randomUUID(),type:'booking',data:{resourceId:resource.id,startsAt:'2026-01-01T00:00:00.000Z',endsAt:'2026-01-01T01:00:00.000Z',kind:'work',status:'confirmed',places:1}}),first=booking(),second=booking(),changed={...item,data:{...item.data,title:'Renamed'}};
 const graph=source([changed,resource,first,second],{changes:new Map([[changed.id,changed],[second.id,second]]),previous:async id=>id===item.id?moduleConstraint(item):null});
 await assert.rejects(validatePlanningSource(graph),{code:'BOOKING_CONFLICT'});assert.deepEqual(graph.scans,['booking']);
});
