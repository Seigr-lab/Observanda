import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {workspaceModules} from '../src/modules/index.js';
import {moduleDomainCommands,moduleCommandPlan} from '../src/modules/domain-command-plan.js';

test('each registered module command declares its storage owners without a catch-all writer',()=>{
 assert.deepEqual(moduleDomainCommands,Object.keys(workspaceModules({root:'.'}).definitions.commands).sort());
 assert.throws(()=>moduleCommandPlan({action:'unknown.save'}),{code:'MODULE_FORMAT'});
 for(const action of ['calculation.save','sheet.save','reaction.save','chemical.save','timeline-view.save']){const plan=moduleCommandPlan({action});assert.equal(plan.read.length,0);assert.deepEqual(plan.write,[plan.primary]);}
 assert.deepEqual(moduleCommandPlan({action:'task.save'}),{primary:'tasks',read:[],write:['tasks']});
 assert.deepEqual(moduleCommandPlan({action:'calendar.save'}),{primary:'calendars',read:[],write:['calendars']});
});
test('cross-domain invariants and selected links add only their actual transaction participants',()=>{
 assert.deepEqual(moduleCommandPlan({action:'booking.save'}),{primary:'equipment',read:['inventory'],write:['equipment']});
 assert.deepEqual(moduleCommandPlan({action:'resource.save'}),{primary:'inventory',read:['equipment'],write:['inventory']});
 assert.deepEqual(moduleCommandPlan({action:'stock.resolve'}),{primary:'inventory',read:['bom'],write:['inventory']});
 for(const action of ['bom.reserve','bom.finish','bom.cancel'])assert.deepEqual(moduleCommandPlan({action}),{primary:'bom',read:[],write:['bom','inventory']});
 for(const action of ['resource.create','stock.move','stock.reserve','stock.transfer','resource.assign'])assert.deepEqual(moduleCommandPlan({action}),{primary:'inventory',read:[],write:['inventory']});
 const workspaceId=randomUUID(),link=type=>({workspaceId,id:randomUUID(),type});
 assert.deepEqual(moduleCommandPlan({workspaceId,action:'calculation.save',payload:{data:{links:[link('record'),link('event'),link('event'),link('calculation'),{...link('resource'),workspaceId:randomUUID()}]}}}),{primary:'calculator',read:['calendars'],write:['calculator']});
 assert.deepEqual(moduleCommandPlan({workspaceId,action:'stock.move',payload:{links:[link('bom')]}}),{primary:'inventory',read:['bom'],write:['inventory']});
});
