import {test} from 'node:test';
import assert from 'node:assert/strict';
import {serviceHealth,probeDatabaseHealth} from '../src/service-health.js';
import {WorkspacePostgres} from '../src/workspace-postgres.js';
import path from 'node:path';
import {EventEmitter} from 'node:events';

test('readiness reports the selected and scratch databases independently without starting owners',async()=>{
 const selected={identity:'selected'},scratch={identity:'scratch'},broken=new Set(['scratch']);let environments=0;
 const provider={healthEnvironments:()=>({selected,scratch}),environment:()=>{environments++;throw Error('Must not start');},scratch:()=>{throw Error('Must not start');}};
 const probe=async env=>({scope:'database-connection',ready:!broken.has(env.identity),state:broken.has(env.identity)?'unavailable':'ready'});
 let report=await serviceHealth({root:'private-root-sentinel',locked:false,provider,probe});assert.equal(report.scratch.ready,false);assert.equal(report.selectedWorkspace.ready,true);assert.equal(report.scope,'service-liveness');assert.equal(report.selectedWorkspace.catalogueIntegrity,'not-checked');
 broken.clear();broken.add('selected');report=await serviceHealth({root:'private-root-sentinel',locked:false,provider,probe});assert.equal(report.scratch.ready,true);assert.equal(report.selectedWorkspace.ready,false);assert.equal(environments,0);assert.doesNotMatch(JSON.stringify(report),/private-root-sentinel/);
});
test('locked or unselected workspaces do not trigger selected database probes',async()=>{
 const selected={},scratch={},seen=[],provider={healthEnvironments:()=>({selected,scratch})},probe=async env=>{seen.push(env);return {ready:true,state:'ready'};};
 assert.equal((await serviceHealth({root:'synthetic',locked:true,provider,probe})).selectedWorkspace.state,'locked');assert.deepEqual(seen,[scratch]);seen.length=0;
 assert.equal((await serviceHealth({root:null,locked:false,provider,probe})).selectedWorkspace.state,'not-selected');assert.deepEqual(seen,[scratch]);
});
test('observing an unopened or closing runtime never waits for startup or resolves a filesystem path',()=>{
 const runtimes=new WorkspacePostgres(),root=path.resolve('synthetic-health-owner'),env={};
 assert.equal(runtimes.healthEnvironment(root),null);const entry={pending:new Promise(()=>{})};runtimes.instances.set(root,entry);assert.equal(runtimes.healthEnvironment(root),null);
 entry.env=env;assert.equal(runtimes.healthEnvironment(root),env);entry.closing=Promise.resolve();assert.equal(runtimes.healthEnvironment(root),null);
});
test('health reserves only two control connections and rejects excess probes promptly',async()=>{
 const env={OBSERVANDA_DATABASE_URL:'postgresql://synthetic:password@127.0.0.1:5432/health'},gates=[];
 class Client extends EventEmitter{
  async connect(){} query(){return new Promise(resolve=>gates.push(resolve));}async end(){}
 }
 const one=probeDatabaseHealth(env,{Client}),two=probeDatabaseHealth(env,{Client});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(gates.length,2);assert.equal((await probeDatabaseHealth(env,{Client})).code,'DATABASE_BUSY');for(const resolve of gates)resolve();assert.equal((await one).ready,true);assert.equal((await two).ready,true);
 assert.equal((await probeDatabaseHealth({OBSERVANDA_DATABASE_URL:'private-secret'})).code,'DATABASE_CONFIG');
});
