import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as wait} from 'node:timers/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {seedModuleCurrent} from './module-current-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {DurableJobs} from '../src/jobs.js';
import {InventoryMaintenanceJobs,inventoryMaintenanceJobDefinitions} from '../src/inventory-maintenance-jobs.js';
import {InventoryReconciliation} from '../src/modules/inventory-reconciliation.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {startServer} from '../src/server.js';
import {fixture as projectFixture,result as httpResult} from './task-prerequisite-fixture.js';

async function fixture(t,movements=200){
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-maintenance-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),now=new Date().toISOString();let app;
 t.after(async()=>{await app?.close();await clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.equal(await realpath(directory),directory);await rm(directory,{recursive:true,force:true});});
 const resource={id:randomUUID(),type:'resource',revision:1,createdAt:now,updatedAt:now,data:{projectId:null,placementId:null,name:'Maintenance stock',code:'',kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]}},values=[resource];
 for(let i=0;i<movements;i++)values.push({id:randomUUID(),type:'movement',revision:1,createdAt:now,updatedAt:now,data:{resourceId:resource.id,projectId:null,delta:'1',unit:'items',reason:'Retained fixture movement',links:[],reservationId:null}});
 await seedModuleCurrent(f.workspace,book.id,values);
 const queueFor=workspace=>{let queue;queue=new DurableJobs(workspace,inventoryMaintenanceJobDefinitions(workspace,()=>queue));return queue;};
 return {...f,book,queueFor,async server(){app=await startServer({root:f.workspace.root,port:0,headless:true,deviceStore:f.deviceStore});return app;}};
}
test('encrypted inventory checkpoints resume across worker replacement and release the writer between slices',{timeout:180000},async t=>{
 const f=await fixture(t,1000),queue=f.queueFor(f.workspace),service=new InventoryMaintenanceJobs(f.workspace,queue),enqueued=await service.start(),job=await queue.claim(),controller=new AbortController();let foreground=0,reads=0,largestSliceMs=0;
 assert.equal(job.id,enqueued.id);assert.equal((await service.start()).id,job.id);const selected=ModuleCatalogue.prototype.selected;t.mock.method(ModuleCatalogue.prototype,'selected',async function(...args){reads++;return selected.apply(this,args);});
 const write=async operation=>{const before=Date.now(),result=await queue.checkpoint(job.id,job.lease.token,operation);largestSliceMs=Math.max(largestSliceMs,Date.now()-before);await f.workspace.withLock(()=>f.workspace.writeMetadata('.observanda/maintenance-foreground.json',JSON.stringify({turn:++foreground})));const state=await new InventoryReconciliation(f.workspace,job).read();if(state.read>=64)controller.abort(Error('Interrupted maintenance'));return result;};
 await assert.rejects(service.prepare(job,{signal:controller.signal,write}),/Interrupted maintenance/);const checkpoint=await new InventoryReconciliation(f.workspace,job).read();assert.equal(checkpoint.read,64);assert.ok(foreground>=3);
 const object='metadata:.observanda/inventory-maintenance/'+job.id+'/checkpoint.json',payload=await f.workspace.catalogue(async store=>(await store.db.get('SELECT payload FROM objects WHERE id=$1',object)).payload);assert.equal(Buffer.from(payload).includes(Buffer.from('"phase"')),false);
 const corrupt=Buffer.from(payload);corrupt[corrupt.length-1]^=1;await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('UPDATE objects SET payload=$1 WHERE id=$2',corrupt,object)));
 try{await assert.rejects(new InventoryReconciliation(new Workspace(f.workspace.root,f.vault),job).read());}finally{await f.workspace.withLock(()=>f.workspace.catalogue(store=>store.db.run('UPDATE objects SET payload=$1 WHERE id=$2',payload,object)));}
 await queue.release(job.id,job.lease.token,{paused:true});await service.control(job.id,'cancel');assert.equal((await service.start()).id,job.id);assert.equal((await service.current()).state,'cancelled');await service.control(job.id,'retry');
 const resumedWorkspace=new Workspace(f.workspace.root,f.vault),resumed=f.queueFor(resumedWorkspace),next=await resumed.claim();assert.equal(next.attempt,2);
 const maintenance=new InventoryMaintenanceJobs(resumedWorkspace,resumed),prepared=await maintenance.prepare(next,{write:operation=>resumed.checkpoint(next.id,next.lease.token,operation)}),completed=await resumed.complete(next.id,next.lease.token,prepared);
 assert.equal(completed.state,'completed');assert.equal(completed.result.verified,true);assert.equal(completed.result.members,1001);assert.equal(reads,1001);assert.equal((await resumedWorkspace.metadataPage('.observanda/inventory-maintenance/'+job.id+'/values')).items.length,0);
 t.diagnostic(JSON.stringify({ledgerOriginals:1001,seedCommandEvents:1,originalReads:reads,foregroundTurns:foreground,largestObservedCheckpointMs:largestSliceMs,projectionRows:completed.result.rows}));
});
test('inventory maintenance resumes committed progress after its worker process is killed',{timeout:120000},async t=>{
 const f=await fixture(t,80),queue=f.queueFor(f.workspace),enqueued=await new InventoryMaintenanceJobs(f.workspace,queue).start();
 const code=`import {Workspace} from './src/storage.js';import {DurableJobs} from './src/jobs.js';import {inventoryMaintenanceJobDefinitions} from './src/inventory-maintenance-jobs.js';import {InventoryReconciliation} from './src/modules/inventory-reconciliation.js';let input='';for await(const bytes of process.stdin)input+=bytes;const value=JSON.parse(input),workspace=new Workspace(value.root,{id:value.id,key:Buffer.from(value.key,'base64')});let queue;queue=new DurableJobs(workspace,inventoryMaintenanceJobDefinitions(workspace,()=>queue),{leaseMs:1000});const job=await queue.claim();await new InventoryReconciliation(workspace,job,{batch:16}).prepare({write:async operation=>{const result=await queue.checkpoint(job.id,job.lease.token,operation),state=await new InventoryReconciliation(workspace,job).read();if(state.read===32){process.stdout.write('checkpoint\\n');setInterval(()=>{},1000);await new Promise(()=>{});}return result;}});`;
 const child=spawn(process.execPath,['--input-type=module','-e',code],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']}),exited=once(child,'exit');let errors='';child.stderr.on('data',bytes=>errors+=bytes);
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 const checkpoint=new Promise((resolve,reject)=>{child.stdout.on('data',bytes=>{if(String(bytes).includes('checkpoint'))resolve();});child.once('error',reject);child.once('exit',()=>reject(Error('Worker exited before checkpoint: '+errors)));});
 child.stdin.end(JSON.stringify({root:f.workspace.root,id:f.vault.id,key:f.vault.key.toString('base64')}));await checkpoint;child.kill('SIGKILL');await exited;
 const stopped=await queue.read(enqueued.id);assert.equal(stopped.state,'running');assert.equal((await new InventoryReconciliation(f.workspace,stopped).read()).read,32);await wait(Math.max(0,stopped.lease.until-await queue.now())+25);
 const next=await queue.claim();assert.equal(next.attempt,2);let reads=0;const selected=ModuleCatalogue.prototype.selected;t.mock.method(ModuleCatalogue.prototype,'selected',async function(...args){reads++;return selected.apply(this,args);});
 const prepared=await queue.definition(next).prepare(next,{write:operation=>queue.checkpoint(next.id,next.lease.token,operation)}),done=await queue.complete(next.id,next.lease.token,prepared);assert.equal(done.state,'completed');assert.equal(done.result.members,81);assert.equal(reads,49);assert.equal(done.result.verified,true);
});

test('inventory maintenance HTTP controls require the active session and expose a durable result',{timeout:180000},async t=>{
 const f=await fixture(t,20),app=await f.server();
 assert.equal((await fetch(app.origin+'/api/maintenance/inventory/start',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:'{}'})).status,401);
 const auth=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(auth.status,200);const cookie=auth.headers.get('x-observanda-session').split(';')[0],storage=await (await fetch(app.origin+'/api/storage',{headers:{'X-Observanda-Session':cookie}})).json(),headers={Origin:app.origin,'Content-Type':'application/json','X-Observanda-Session':cookie,'X-Observanda-Workspace':storage.contextId,'X-Observanda-Wait':'1'};
 const call=(operation,data={})=>fetch(app.origin+'/api/maintenance/inventory/'+operation,{method:'POST',headers,body:JSON.stringify(data)});
 assert.equal((await call('start',{unexpected:true})).status,422);const response=await call('start'),started=await response.json();assert.equal(response.status,202,JSON.stringify(started));assert.equal(started.job.type,'inventory.reconcile');
 let result;for(let i=0;i<400;i++){result=await (await call('status')).json();if(['completed','failed','cancelled'].includes(result.job?.state))break;await wait(25);}
 assert.equal(result.job.state,'completed',JSON.stringify(result));assert.equal(result.job.result.verified,true);assert.equal(result.job.result.members,21);assert.equal((await call('cancel',{id:randomUUID()})).status,422);
});
test('project and lab-book maintenance preserve independent owner access and job identity',{timeout:240000},async t=>{
 const f=await projectFixture(t),routes=[f.base,f.own,f.other],ids=[];
 for(const route of routes){const initial=await httpResult(await f.call(route+'/maintenance/inventory/status',{}));assert.equal(initial.job,null);const started=await httpResult(await f.call(route+'/maintenance/inventory/start',{}));assert.equal(started.job.type,'inventory.reconcile');ids.push(started.job.id);}
 assert.equal(new Set(ids).size,3);
 for(let owner=0;owner<routes.length;owner++){let result;for(let i=0;i<400;i++){result=await httpResult(await f.call(routes[owner]+'/maintenance/inventory/status',{}));if(['completed','failed','cancelled'].includes(result.job.state))break;await wait(25);}assert.equal(result.job.state,'completed',JSON.stringify(result));assert.equal(result.job.result.verified,true);}
 await httpResult(await f.call(f.own+'/access/lock',{}));assert.equal((await f.call(f.own+'/maintenance/inventory/status',{})).status,401);assert.equal((await f.call(f.other+'/maintenance/inventory/cancel',{id:ids[1]})).status,422);
});
