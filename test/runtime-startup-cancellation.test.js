import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners} from 'node:events';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {setImmediate as tick} from 'node:timers/promises';
import {waitRuntimeStartup} from '../src/runtime-startup-wait.js';
import {WorkspacePostgres} from '../src/workspace-postgres.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {ProjectRuntimePool} from '../src/project-runtime-pool.js';
import {publishCatalogueBinding} from '../src/postgres-activation.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {withDatabaseRequest} from '../src/database-request-context.js';
import {openCatalogue} from '../src/postgres.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
async function directory(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-startup-cancellation-'));
 t.after(()=>rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 await mkdir(path.join(root,'.observanda'));return root;
}

test('request cancellation detaches its listener and observes a late startup failure',async()=>{
 const gate=deferred(),controller=new AbortController(),reason=Error('Request cancelled');
 const waiting=waitRuntimeStartup(gate.promise,controller.signal);
 assert.equal(getEventListeners(controller.signal,'abort').length,1);
 const rejected=assert.rejects(waiting,error=>error===reason);controller.abort(reason);await rejected;
 assert.equal(getEventListeners(controller.signal,'abort').length,0);
 gate.reject(Error('Shared startup later failed'));await tick();
 const already=new AbortController();already.abort(reason);
 await assert.rejects(waitRuntimeStartup(Promise.resolve('ready'),already.signal),error=>error===reason);
});

test('an authenticated workspace wait can cancel without retiring the shared startup',async t=>{
 const root=await directory(t),gate=deferred(),vault={id:randomUUID(),key:randomBytes(32)},controller=new AbortController(),env={};let closed=0;
 const owner=new WorkspacePostgres(),identity=createHash('sha256').update(vault.id).update(vault.key).digest('hex');
 const entry={identity,pending:gate.promise};owner.instances.set(root,entry);
 t.after(async()=>{gate.resolve({env,service:{close:async()=>{closed++;}}});await owner.close();vault.key.fill(0);});
 const waiting=owner.open(root,vault,{signal:controller.signal}),reason=Error('Preview replaced');
 const rejected=assert.rejects(waiting,error=>error===reason);
 for(let tries=0;tries<100&&!getEventListeners(controller.signal,'abort').length;tries++)await tick();
 assert.equal(getEventListeners(controller.signal,'abort').length,1);controller.abort(reason);await rejected;
 assert.equal(owner.instances.get(root),entry);assert.equal(closed,0);
 await assert.rejects(owner.open(root,{id:vault.id,key:randomBytes(32)}),{code:'ACCESS_DENIED'});
 const next=owner.open(root,vault);gate.resolve({env,service:{close:async()=>{closed++;}}});
 assert.equal(await next,env);await owner.close();assert.equal(closed,1);
});

for(const kind of ['project','lab-book'])test(`${kind} catalogue cancellation drains the request and releases the late shared-start lease`,async t=>{
 const root=await directory(t),ownerId=randomUUID(),id=randomUUID(),vault={id:randomUUID(),key:randomBytes(32)};
 const options=kind==='project'?{projectId:id}:{labBookId:id};await publishCatalogueBinding(root,randomUUID(),options);
 const owner=new WorkspaceDatabases({directory:path.join(root,'runtime'),ownerId}),gate=deferred(),entered=deferred(),controller=new AbortController(),env={};let starts=0,shared,requestReleased=false;
 const pool=new ProjectRuntimePool({idleMs:60000,maxIdle:2,close:async()=>{}});
 const replacement={acquire(location,selected,key){
  assert.equal(location,root);assert.equal(selected,id);assert.equal(key,vault);entered.resolve();
  return pool.acquire(location,()=>{if(!shared){starts++;shared=gate.promise;}return shared;});
 },close:()=>pool.closeAll()};
 const property=kind==='project'?'projects':'labBooks';await owner[property].close();owner[property]=replacement;
 const detach=installDatabaseProvider(owner);
 t.after(async()=>{gate.resolve(env);detach();await owner.close();vault.key.fill(0);});
 const reason=Error('Preview cancelled');
 const waiting=withDatabaseRequest(controller.signal,async()=>{
  try{return await openCatalogue(root,{vault,...options});}finally{requestReleased=true;}
 });
 const rejected=assert.rejects(waiting,error=>error===reason);await entered.promise;controller.abort(reason);await rejected;
 assert.equal(requestReleased,true);assert.equal(starts,1);
 // This remaining reference owns the unfinished startup, not a SQL client.
 assert.equal(pool.stats().references,1);
 const next=owner.acquireEnvironment(root,{vault,...options});gate.resolve(env);
 const lease=await next;await tick();assert.equal(lease.env,env);assert.equal(starts,1);assert.equal(pool.stats().references,1);
 lease.release();assert.equal(pool.stats().references,0);assert.equal(pool.stats().idle,1);
});

test('a cancelled project startup failure releases the pending lease without a late rejection',async t=>{
 const root=await directory(t),id=randomUUID(),gate=deferred(),entered=deferred(),controller=new AbortController();
 await publishCatalogueBinding(root,randomUUID(),{projectId:id});
 const owner=new WorkspaceDatabases({directory:path.join(root,'runtime'),ownerId:randomUUID()}),pool=new ProjectRuntimePool({close:async()=>{}});
 await owner.projects.close();owner.projects={acquire(location){entered.resolve();return pool.acquire(location,()=>gate.promise);},close:()=>pool.closeAll()};
 t.after(async()=>{gate.reject(Error('Startup failed'));await owner.close();});
 const waiting=owner.acquireEnvironment(root,{projectId:id,signal:controller.signal});
 const rejected=assert.rejects(waiting,{name:'AbortError'});await entered.promise;controller.abort();await rejected;
 gate.reject(Error('Startup failed'));await tick();assert.equal(pool.stats().references,0);assert.equal(pool.stats().open,0);
});

test('scratch startup remains shared when an archive request stops waiting',async t=>{
 const root=await directory(t),owner=new WorkspaceDatabases({directory:path.join(root,'runtime'),ownerId:randomUUID()}),gate=deferred(),controller=new AbortController(),env={};let stopped=0;
 owner.scratchStart=gate.promise;t.after(async()=>{gate.resolve({env,service:{close:async()=>{stopped++;}}});await owner.close();});
 const waiting=owner.archiveEnvironment(root,undefined,undefined,{signal:controller.signal});
 const rejected=assert.rejects(waiting,{name:'AbortError'});controller.abort();await rejected;
 assert.equal(stopped,0);gate.resolve({env,service:{close:async()=>{stopped++;}}});assert.equal(await owner.scratch(),env);
 await owner.close();assert.equal(stopped,1);
});
