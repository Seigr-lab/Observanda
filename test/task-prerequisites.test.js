import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {workspaceModules} from '../src/modules/index.js';
import {planningDefinitions,validateTask,validatePlanning} from '../src/modules/planning.js';
import {validatePlanningSource} from '../src/modules/planning-constraints.js';
import {evaluateTaskPrerequisites} from '../src/modules/task-prerequisite-graph.js';
import {ProjectDomains} from '../src/project-domains.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {moduleConstraint} from '../src/modules/constraints.js';
import {moduleMigrationDependencies} from '../src/project-module-ownership.js';
import {taskConstraintDraft,taskPrerequisiteEffect,validTaskDependencies,validTaskObservations,taskReferenceKey} from '../src/web/task-prerequisite-model.js';
import {digest,serialize} from '../src/storage-format.js';
import {AppError} from '../src/errors.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {seedModuleCurrent} from './module-current-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
const at='2026-01-01T00:00:00.000Z';
const reference=(workspaceId,id=randomUUID())=>({workspaceId,type:'task',id});
const data=(dependencies=[],status='todo')=>({title:'Task',description:'',status,priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies,links:[]});
const entity=(value,id=randomUUID())=>({id,type:'task',revision:1,createdAt:at,updatedAt:at,data:value});
const observation=(ref,canonicalReference=ref)=>({reference:ref,canonicalReference,revision:1,hash:'1'.repeat(64),constraintHash:'2'.repeat(64),observedAt:at});
function selected(ref,value,revision=1){const constraint=moduleConstraint(entity(value,ref.id));return {reference:ref,revision,hash:digest(serialize({id:ref.id,revision,data:value})),constraintHash:digest(serialize(constraint)),constraint};}
function reader(values){const map=new Map(values.map(value=>[taskReferenceKey(value.reference),value])),reads=new Map();return {reads,async read(ref){const key=taskReferenceKey(ref);reads.set(key,(reads.get(key)??0)+1);return structuredClone(map.get(key)??null);}};}
async function save(workspaceId,old,value,taskPrerequisites){let written;const tx={book:{id:workspaceId,projects:[]},now:at,taskPrerequisites,get:()=>old,expect:(_,revision)=>assert.equal(revision,old?.revision??null),put:(_,id,data)=>{written={id,data};}};await planningDefinitions.commands['task.save'](tx,{id:old?.id??randomUUID(),expectedRevision:old?.revision??null,data:value});return written;}
function ownedSource(workspaceId,entities){const facts=new Map(entities.map(item=>[item.id,moduleConstraint(item)]));return {workspaceId,async get(id){return facts.get(id)??null;},async *all(type){for(const item of facts.values())if(item.type===type)yield item;}};}

test('historical task constraint bytes stay unchanged and addressed same-owner edges remain local',async()=>{
 const workspaceId=randomUUID(),local=entity(data([], 'done')),old=entity(data([local.id]));
 const expected={id:old.id,type:'task',data:{dependencies:[local.id],status:'todo',checklist:[]}};
 assert.deepEqual(moduleConstraint(old),expected);assert.equal(digest(serialize(moduleConstraint(old))),digest(serialize(expected)));
 const qualified=entity(data([reference(workspaceId,local.id)],'done'));validateTask(qualified.data,{workspaceId});validatePlanning([qualified,local],{workspaceId});
 assert.equal(validTaskDependencies([local.id,reference(workspaceId,local.id)],workspaceId),false);
 local.data.status='todo';assert.throws(()=>validatePlanning([qualified,local],{workspaceId}),{code:'TASK_BLOCKED'});await assert.rejects(validatePlanningSource(ownedSource(workspaceId,[qualified,local])),{code:'TASK_BLOCKED'});
});
test('only server-derived completion observations can enter a task command',async()=>{
 const workspaceId=randomUUID(),foreign=reference(randomUUID()),value=data([foreign],'done'),retained=observation(foreign);
 await assert.rejects(save(workspaceId,null,{...value,prerequisiteObservations:[retained]},{prepare(){assert.fail('Untrusted observation reached admission');}}),{code:'TASK_PREREQUISITE_CHANGED'});
 await assert.rejects(save(workspaceId,null,value),{code:'TASK_PREREQUISITE_ACCESS'});
 const written=await save(workspaceId,null,value,{async prepare(previous,authored,options){assert.equal(previous,null);assert.equal(options.workspaceId,workspaceId);assert.equal(options.now,at);assert.equal(Object.hasOwn(authored,'prerequisiteObservations'),false);return {...authored,prerequisiteObservations:[retained]};}});
 assert.deepEqual(written.data.prerequisiteObservations,[retained]);assert.equal(validTaskObservations(written.data,workspaceId),true);
 const old=entity(written.data,written.id),cosmetic={...old.data,title:'Renamed'};
 assert.equal(taskPrerequisiteEffect(old,cosmetic,{workspaceId}).needsAccess,false);assert.deepEqual((await save(workspaceId,old,cosmetic)).data.prerequisiteObservations,[retained]);
 const {prerequisiteObservations,...withoutEcho}=cosmetic;void prerequisiteObservations;assert.deepEqual((await save(workspaceId,old,withoutEcho)).data.prerequisiteObservations,[retained]);
 const reopened=await save(workspaceId,old,{...old.data,status:'todo'});assert.equal(Object.hasOwn(reopened.data,'prerequisiteObservations'),false);
 await assert.rejects(save(workspaceId,old,{...old.data,checklist:[{id:randomUUID(),text:'Check',done:true}]}),{code:'TASK_PREREQUISITE_ACCESS'});
 await assert.rejects(save(workspaceId,old,{...old.data,prerequisiteObservations:[{...retained,revision:2}]}),{code:'TASK_PREREQUISITE_CHANGED'});
});
test('foreign completion captures full identity even when source and result share a task UUID',async()=>{
 const workspaceId=randomUUID(),foreign=reference(randomUUID()),source=selected(foreign,data([],'done'),7),r=reader([source]);
 const result=await evaluateTaskPrerequisites({workspaceId,id:foreign.id,data:taskConstraintDraft(data([foreign],'done'))},r.read,{observedAt:at});
 assert.deepEqual(result.observations,[{reference:foreign,canonicalReference:foreign,revision:7,hash:source.hash,constraintHash:source.constraintHash,observedAt:at}]);assert.equal(r.reads.size,1);assert.deepEqual(result.owners,[workspaceId,foreign.workspaceId]);
});
test('cross-owner cycles, local reopening and invalid completed source facts remain blocked',async t=>{
 await t.test('cross-owner back edge',async()=>{const a=reference(randomUUID()),b=reference(randomUUID()),r=reader([selected(b,data([a]))]);await assert.rejects(evaluateTaskPrerequisites({...a,data:taskConstraintDraft(data([b]))},r.read),{code:'MODULE_INVALID'});});
 await t.test('source has an unchecked checklist',async()=>{const a=reference(randomUUID()),b=reference(randomUUID()),value=data([],'done');value.checklist=[{id:randomUUID(),text:'Required check',done:false}];await assert.rejects(evaluateTaskPrerequisites({...a,data:taskConstraintDraft(data([b],'done'))},reader([selected(b,value)]).read),{code:'TASK_BLOCKED'});});
 await t.test('source local prerequisite reopened',async()=>{const a=reference(randomUUID()),b=reference(randomUUID()),c=reference(b.workspaceId);await assert.rejects(evaluateTaskPrerequisites({...a,data:taskConstraintDraft(data([b],'done'))},reader([selected(b,data([c.id],'done')),selected(c,data())]).read),{code:'TASK_BLOCKED'});});
 await t.test('source omitted foreign completion evidence',async()=>{const a=reference(randomUUID()),b=reference(randomUUID()),c=reference(randomUUID());await assert.rejects(evaluateTaskPrerequisites({...a,data:taskConstraintDraft(data([b],'done'))},reader([selected(b,data([c],'done')),selected(c,data([],'done'))]).read),{code:'MODULE_INVALID'});});
 await t.test('source access unavailable',async()=>{const a=reference(randomUUID()),b=reference(randomUUID());await assert.rejects(evaluateTaskPrerequisites({...a,data:taskConstraintDraft(data([b]))},async()=>{throw new AppError('TASK_PREREQUISITE_ACCESS');}),{code:'TASK_PREREQUISITE_ACCESS'});});
});
test('a retained foreign completion remains usable after its own foreign prerequisite reopens',async()=>{
 const a=reference(randomUUID()),b=reference(randomUUID()),c=reference(randomUUID()),bData={...data([c],'done'),prerequisiteObservations:[observation(c)]},bSource=selected(b,bData,4),r=reader([bSource,selected(c,data([], 'todo'),2)]);
 const result=await evaluateTaskPrerequisites({...a,data:taskConstraintDraft(data([b],'done'))},r.read,{observedAt:at});
 assert.equal(result.observations.length,1);assert.deepEqual(result.observations[0].reference,b);assert.equal(result.observations[0].revision,4);assert.equal(r.reads.size,2);
 await validatePlanningSource(ownedSource(b.workspaceId,[entity(bData,b.id)]));
 assert.deepEqual((await save(b.workspaceId,entity(bData,b.id),{...bData,title:'Retained completion'})).data.prerequisiteObservations,bData.prerequisiteObservations);
 await assert.rejects(evaluateTaskPrerequisites({...a,data:taskConstraintDraft(data([b],'done'))},async ref=>{if(ref.workspaceId===c.workspaceId)throw new AppError('TASK_PREREQUISITE_ACCESS');return bSource;}),{code:'TASK_PREREQUISITE_ACCESS'});
});
test('authenticated canonical aliases cannot duplicate a prerequisite or hide a cycle',async()=>{
 const a=reference(randomUUID()),canonical=reference(randomUUID()),alias={...canonical,workspaceId:randomUUID()},value=selected(canonical,data([],'done'));
 const read=async()=>value;await assert.rejects(evaluateTaskPrerequisites({...a,data:taskConstraintDraft(data([alias,canonical],'done'))},read),{code:'MODULE_INVALID'});
 let reads=0;await assert.rejects(evaluateTaskPrerequisites({...a,data:taskConstraintDraft(data([alias,canonical]))},async()=>selected(canonical,data([],'done'),++reads)),{code:'TASK_PREREQUISITE_CHANGED'});
 const backAlias={...a,workspaceId:randomUUID()},cycle=selected(a,data([backAlias]));await assert.rejects(evaluateTaskPrerequisites({...a,data:taskConstraintDraft(data([backAlias]))},async()=>cycle),{code:'MODULE_INVALID'});
});
test('foreign graph traversal bounds owners and preserves cancellation',async()=>{
 const refs=Array.from({length:33},()=>reference(randomUUID())),nodes=refs.slice(1).map((ref,index)=>selected(ref,data(index+2<refs.length?[refs[index+2]]:[])));
 await assert.rejects(evaluateTaskPrerequisites({...refs[0],data:taskConstraintDraft(data([refs[1]]))},reader(nodes).read),{code:'TASK_DEPENDENCY_OWNER_LIMIT'});
 const controller=new AbortController(),r=reader(nodes);await assert.rejects(evaluateTaskPrerequisites({...refs[0],data:taskConstraintDraft(data([refs[1]]))},async ref=>{const result=await r.read(ref);controller.abort();return result;},{signal:controller.signal}),{name:'AbortError'});assert.equal(r.reads.size,1);
});
test('wide foreign adjacency and shared targets stay bounded without repeated selected reads',async t=>{
 const root=reference(randomUUID()),owner=randomUUID(),leaf=reference(owner),branches=Array.from({length:2000},()=>reference(owner)),r=reader([...branches.map(ref=>selected(ref,data([leaf.id]))),selected(leaf,data())]),draft=taskConstraintDraft(data(branches));
 assert.ok(Buffer.byteLength(JSON.stringify(draft))>65536);const start=performance.now();await evaluateTaskPrerequisites({...root,data:draft},r.read);
 assert.equal(r.reads.size,2001);assert.ok([...r.reads.values()].every(count=>count===1));t.diagnostic(JSON.stringify({foreignEdges:branches.length,selectedFacts:r.reads.size,elapsedMs:Math.round(performance.now()-start)}));
});
test('foreign adjacency checks the last edge across the 32 and 33 item page boundary',async()=>{
 const root=reference(randomUUID()),owner=randomUUID();
 for(const count of [32,33]){const refs=Array.from({length:count},()=>reference(owner)),values=refs.map(ref=>selected(ref,data())),draft=taskConstraintDraft(data(refs));await evaluateTaskPrerequisites({...root,data:draft},reader(values).read);values.pop();await assert.rejects(evaluateTaskPrerequisites({...root,data:draft},reader(values).read),{code:'MODULE_INVALID'});}
});
test('deep cross-owner traversal remains iterative and detects the final back edge',async()=>{
 const owners=[randomUUID(),randomUUID()],refs=Array.from({length:650},(_,index)=>reference(owners[index%2])),nodes=refs.slice(1).map((ref,index)=>selected(ref,data(index+2<refs.length?[refs[index+2]]:[]))),root={...refs[0],data:taskConstraintDraft(data([refs[1]]))};
 await evaluateTaskPrerequisites(root,reader(nodes).read);
 nodes[nodes.length-1]=selected(refs.at(-1),data([refs[0]]));await assert.rejects(evaluateTaskPrerequisites(root,reader(nodes).read),{code:'MODULE_INVALID'});
});
test('portable owner verification survives deleting its source owner and rejects retained byte corruption',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-task-prerequisites-')),book=sampleNotebook(),sourceBook=sampleNotebook(),f=await encryptedFixture(directory,book),source=await encryptedFixture(path.join(directory,'source'),sourceBook);
 t.after(async()=>{clearVault(f.vault);clearVault(source.vault);await rm(directory,{recursive:true,force:true});});
 const sourceTask=entity(data([],'done'));await seedModuleCurrent(source.workspace,sourceBook.id,[sourceTask]);
 const foreign=reference(sourceBook.id,sourceTask.id),itemId=randomUUID(),draft=data([foreign],'done');let sourceReads=0;
 const result=await evaluateTaskPrerequisites({workspaceId:book.id,id:itemId,data:taskConstraintDraft(draft)},async ref=>{
  assert.deepEqual(ref,foreign);sourceReads++;
  return new ProjectDomains(source.workspace,sourceBook.id).run(['tasks'],async get=>{const catalogue=new ModuleCatalogue(get('tasks')),head=await catalogue.head(sourceBook.id),member=await catalogue.member(head,sourceTask.id);return {reference:foreign,revision:member.revision,hash:member.hash,constraintHash:member.constraintHash,constraint:await catalogue.constraint(head,member)};});
 },{observedAt:at});
 const item=entity({...draft,prerequisiteObservations:result.observations},itemId);await seedModuleCurrent(f.workspace,book.id,[item]);
 assert.deepEqual([...moduleMigrationDependencies(item,book.id)],[{kind:'external',...foreign}]);
 await f.workspace.catalogue(store=>workspaceModules(f.workspace).verifyCatalogue(store,book.id));
 const copied=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'copy')),{vault:f.vault});
 assert.equal(path.relative(directory,source.workspace.root),path.join('source','workspace'));clearVault(source.vault);await rm(source.workspace.root,{recursive:true,force:true});await assert.rejects(stat(source.workspace.root),{code:'ENOENT'});
 const restored=new Workspace(copied,f.vault),modules=workspaceModules(restored);
 assert.deepEqual((await modules.current()).entities.find(value=>value.id===item.id),item);await restored.catalogue(store=>modules.verifyCatalogue(store,book.id));assert.equal(sourceReads,1);
 const damaged=structuredClone(item);delete damaged.data.prerequisiteObservations;
 await assert.rejects(validatePlanningSource(ownedSource(book.id,[damaged])),{code:'MODULE_INVALID'});
 await new ProjectDomains(restored,book.id).run(['tasks'],async get=>{const store=get('tasks'),rows=await store.db.all('UPDATE module_entities SET payload=$1 WHERE id=$2 RETURNING id',store.encode('module-entity',item.id+'/1',damaged),item.id);assert.deepEqual(rows,[{id:item.id}]);},{write:['tasks']});
 await assert.rejects(restored.catalogue(store=>modules.verifyCatalogue(store,book.id)),{code:'CATALOGUE_DAMAGED'});
});
