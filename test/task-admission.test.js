import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {AsyncLocalStorage} from 'node:async_hooks';
import {reserveTaskAdmissionBudget} from '../src/task-admission-budget.js';
import {withPlanningTaskLeases} from '../src/planning-task-leases.js';
import {acquireTaskAdmission,taskAdmissionDatabase} from '../src/task-admission-lock.js';
import {ProjectDomains} from '../src/project-domains.js';
import {fixture} from './project-domain-fixture.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {TestDeviceStore} from './device-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';

const database=(endpoint,index)=>({endpoint,physical:endpoint+'/'+index});
test('task gate physical identity follows the connected server without merging separate loopback listeners',()=>{
 const db=host=>({id:randomUUID(),client:{connectionParameters:{host,port:5432,database:'tasks'}}}),ipv4=db('127.0.0.1'),ipv6=db('::1'),named=db('localhost');
 assert.equal(taskAdmissionDatabase(ipv4).endpoint,taskAdmissionDatabase(ipv6).endpoint);
 assert.notEqual(taskAdmissionDatabase(ipv4).physical,taskAdmissionDatabase(ipv6).physical);
 assert.notEqual(taskAdmissionDatabase(named).physical,taskAdmissionDatabase(ipv4).physical);
 named.client.connection={stream:{remoteAddress:'127.0.0.1',remotePort:5432}};
 assert.equal(taskAdmissionDatabase(named).physical,taskAdmissionDatabase(ipv4).physical);
 named.client.connection.stream.remotePort=5433;
 assert.notEqual(taskAdmissionDatabase(named).physical,taskAdmissionDatabase(ipv4).physical);
});
test('task gate budgets reserve complete endpoint sets and preserve read/write headroom',()=>{
 const release=reserveTaskAdmissionBudget([database('one',1),database('one',1),database('one',2),database('two',1)]);
 const second=reserveTaskAdmissionBudget([database('one',3),database('one',4)]);
 assert.throws(()=>reserveTaskAdmissionBudget([database('three',1),database('one',5)]),{code:'DATABASE_BUSY'});
 const third=reserveTaskAdmissionBudget([database('three',1),database('three',2),database('three',3),database('three',4)]);third();
 assert.throws(()=>reserveTaskAdmissionBudget(Array.from({length:5},(_,i)=>database('four',i))),{code:'TASK_DEPENDENCY_DATABASE_LIMIT'});
 second();release();release();
 const again=reserveTaskAdmissionBudget(Array.from({length:4},(_,i)=>database('one',i)));again();
});

async function mocked(t,count,{sameDatabase=false,rollbackError=false}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-task-leases-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const owners=Array.from({length:count},(_,i)=>({namespace:randomUUID(),catalogueId:randomUUID(),root,database:sameDatabase?'same':'database'+i})),opened=[],queries=[];
 let failCleanup=rollbackError;
 t.mock.method(ProjectDomains.prototype,'connection',async function(){
  const owner=owners.find(value=>value.namespace===this.namespaceId),db={id:owner.catalogueId,closed:false,client:{connectionParameters:{host:'127.0.0.1',port:5432,database:owner.database}},
   async run(sql){queries.push({sql,id:this.id,database:owner.database});if(sql==='ROLLBACK'&&failCleanup)throw Error('Synthetic cleanup failure');},
   async get(sql,key){queries.push({sql,key,id:this.id,database:owner.database});return {locked:true};},
   async close(){this.closed=true;}
  };opened.push(db);return db;
 });
 const useOwner=(namespace,consume)=>{const owner=owners.find(value=>value.namespace===namespace);return consume({root:owner.root});};
 return {owners,opened,queries,useOwner,setCleanupFailure:value=>{failCleanup=value;}};
}
test('authenticated owners in one database share one gate connection and keep separate lock identities',async t=>{
 const f=await mocked(t,3,{sameDatabase:true}),namespaces=f.owners.map(value=>value.namespace);
 await withPlanningTaskLeases(namespaces,f.useOwner,async()=>{
  assert.equal(f.opened.filter(db=>!db.closed).length,1);
  const calls=f.queries.length,first=f.opened.find(db=>!db.closed);
  for(const owner of f.owners){const alias=Object.create(first);alias.id=owner.catalogueId;await acquireTaskAdmission(alias,owner.namespace);}
  assert.equal(f.queries.length,calls,'Only internally held exact owner identities can skip reacquisition');
  const alias=Object.create(first);alias.id=randomUUID();await acquireTaskAdmission(alias,namespaces[0]);assert.equal(f.queries.length,calls+1);
 });
 assert.equal(f.queries.filter(value=>value.sql==='BEGIN READ ONLY').length,1);
 assert.equal(new Set(f.queries.filter(value=>value.key?.startsWith('Observanda/task-admission/')).map(value=>value.key)).size,4);
 assert.ok(f.opened.every(db=>db.closed));
});
test('failed or cancelled task admission closes every group and preserves the original failure',async t=>{
 const f=await mocked(t,3,{rollbackError:true}),namespaces=f.owners.map(value=>value.namespace),failure=Object.assign(Error('Original source grant revoked'),{code:'ACCESS_LOCKED'});
 await assert.rejects(withPlanningTaskLeases(namespaces,f.useOwner,async()=>{throw failure;}),error=>error===failure);
 assert.ok(f.opened.every(db=>db.closed));assert.equal(f.queries.filter(value=>value.sql==='ROLLBACK').length,3);
 f.setCleanupFailure(false);let finished=false;
 await withPlanningTaskLeases(namespaces,f.useOwner,async()=>{finished=true;});assert.equal(finished,true);
 assert.ok(f.opened.every(db=>db.closed));
});
test('a closure above the endpoint budget retains no graph gates or database connections',async t=>{
 const f=await mocked(t,5);
 await assert.rejects(withPlanningTaskLeases(f.owners.map(value=>value.namespace),f.useOwner,async()=>assert.fail('Over-budget work was admitted')),{code:'TASK_DEPENDENCY_DATABASE_LIMIT'});
 assert.ok(f.opened.every(db=>db.closed));assert.equal(f.queries.length,0);
 await withPlanningTaskLeases(f.owners.slice(0,4).map(value=>value.namespace),f.useOwner,async()=>{});
 assert.ok(f.opened.every(db=>db.closed));
});
test('real task graph gates permit their result writer and exclude independent task and lifecycle mutations',{timeout:120000},async t=>{
 const f=await fixture(t);await f.domains.initialize(['tasks','calculator']);
 const detached=AsyncLocalStorage.snapshot(),useOwner=(namespace,consume)=>{assert.equal(namespace,f.book.id);return consume(f.storage);};
 await withPlanningTaskLeases([f.book.id],useOwner,async()=>{
  await f.domains.run(['tasks'],async()=>{}, {write:['tasks']});
  await detached(()=>f.domains.run(['calculator'],async()=>{}, {write:['calculator']}));
  await assert.rejects(detached(()=>f.domains.run(['tasks'],async()=>{}, {write:['tasks']})),{code:'LOCKED'});
  await assert.rejects(detached(()=>f.storage.withStorageHandoff(async()=>{})),{code:'LOCKED'});
 });
 await f.domains.run(['tasks'],async()=>{}, {write:['tasks']});await f.storage.withStorageHandoff(async()=>{});
 const abort=new AbortController();await assert.rejects(withPlanningTaskLeases([f.book.id],useOwner,async()=>{abort.abort(Error('Synthetic cancellation'));},{signal:abort.signal}),/Synthetic cancellation/);
 await f.domains.run(['tasks'],async()=>{}, {write:['tasks']});
});
test('competing graph closures leave database headroom and reject an unreserved fifth gate promptly',{timeout:120000},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-task-headroom-')),owners=[],vaults=[];
 // The test runner supplies one isolated external PostgreSQL profile. Route
 // separate owned schemas to it so this test truly shares an endpoint.
 const detach=installDatabaseProvider({environment:async(root,{projectId})=>({...process.env,OBSERVANDA_PROJECT_DATABASE_ROOT:root,OBSERVANDA_PROJECT_ID:projectId}),scratch:async()=>process.env});
 t.after(async()=>{detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-task-headroom-'));await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 for(let i=0;i<5;i++){
  const book=sampleNotebook(),access=await createWorkspaceAccess('','',new TestDeviceStore({file:path.join(root,'device'+i)})),vault=takeCreatedVault(access);vaults.push(vault);
  book.title=book.projects[0].title='Owner '+i;
  const storage=await initializeProjectLocation(path.join(root,book.title),book.projects[0].id,book,access,vault);
  await new ProjectDomains(storage,book.id).initialize(['tasks']);owners.push({namespace:book.id,storage});
 }
 // Match the source reader's active catalogue callback while the gate opens
 // another short-lived connection. Each closure reserves its complete set.
 const useOwner=(namespace,consume)=>{const owner=owners.find(value=>value.namespace===namespace);return owner.storage.catalogue(()=>consume(owner.storage));};
 const descriptors=[];for(const owner of owners){const db=await new ProjectDomains(owner.storage,owner.namespace).connection();try{
  const descriptor=taskAdmissionDatabase(db);assert.ok(db.client.connection.stream.remoteAddress);assert.deepEqual(JSON.parse(descriptor.physical),[db.client.connection.stream.remoteAddress.toLowerCase(),db.client.connection.stream.remotePort,db.client.connectionParameters.database]);descriptors.push(descriptor);
 }finally{await db.close();}}
 assert.equal(new Set(descriptors.map(value=>value.endpoint)).size,1,'The real contention case must share one endpoint');
 t.diagnostic('Disposable physical databases: '+new Set(descriptors.map(value=>value.physical)).size);
 let release;const held=new Promise(resolve=>release=resolve),runs=[];
 try{
  for(const pair of owners.slice(0,4).map(owner=>[owner])){
   let entered;const ready=new Promise(resolve=>entered=resolve);
   const run=withPlanningTaskLeases(pair.map(owner=>owner.namespace),useOwner,async()=>{entered();await held;});runs.push(run);await ready;
  }
  const start=performance.now();
  await assert.rejects(withPlanningTaskLeases([owners[4].namespace],useOwner,async()=>assert.fail('A fifth gate was admitted')),{code:'DATABASE_BUSY'});
  assert.ok(performance.now()-start<5000,'Resource admission must fail before waiting on its own pool reservations');
  for(const owner of owners)assert.equal((await owner.storage.catalogue(store=>store.snapshot())).metadata.id,owner.namespace);
 }finally{release();await Promise.all(runs);}
 await withPlanningTaskLeases([owners[4].namespace],useOwner,async()=>{});
});
