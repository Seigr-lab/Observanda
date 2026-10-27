import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,realpath} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {performance} from 'node:perf_hooks';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {TestDeviceStore} from './device-fixture.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {databaseCapacity} from '../src/postgres.js';
import {nativeResources} from '../src/native-resource-budget.js';
import {processTreeResources} from './process-tree-resources.js';

// Explicit real-runtime qualification, not part of every source check. Data and
// credentials are disposable; load is observed rather than assumed exclusive.
test('one, ten and fifty native owners retain a bounded runtime footprint and reopen exact snapshots',{skip:process.env.OBSERVANDA_TEST_OWNER_CAPACITY!=='1',timeout:1800000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-owner-capacity-'));
 const deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',deviceStore),vault=takeCreatedVault(access);
 const owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner),stores=[],held=[];
 t.after(async()=>{await Promise.all(held.map(db=>db.close()));await owner.close();detach();clearVault(vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-owner-capacity-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 async function measure(phase,latencies=[]){
  const roots=[process.pid];for(const {storage} of stores)try{const value=Number((await readFile(path.join(storage.root,'.observanda/postgresql/data/postmaster.pid'),'utf8')).split('\n')[0]);if(Number.isSafeInteger(value)&&value>0)roots.push(value);}catch(error){if(error.code!=='ENOENT')throw error;}
  const memory=process.memoryUsage(),runtime=nativeResources.stats(),pool=owner.projects.stats();assert.ok(runtime.managedRuntimes<=runtime.runtimeLimit);assert.ok(runtime.reservedBytes<=runtime.memoryLimitBytes);
  const report={phase,owners:stores.length,elapsedMs:latencies,...await processTreeResources(roots),nodeExternalBytes:memory.external,nodeArrayBufferBytes:memory.arrayBuffers,native:runtime,pool,connections:databaseCapacity()};console.log(JSON.stringify({qualification:'native-owner-capacity',...report}));return report;
 }
 await measure('baseline');
 for(let index=0;index<50;index++){
  const book=sampleNotebook(),name='Owner '+(index+1);book.title=book.projects[0].title=name;
  const storage=await initializeProjectLocation(path.join(directory,name),book.projects[0].id,book,access,vault);stores.push({storage,etag:(await storage.outline()).etag});
  if([1,10,50].includes(stores.length)){
   const elapsed=[];for(const {storage,etag} of stores){const start=performance.now();assert.equal((await storage.outline()).etag,etag);elapsed.push(Math.round(performance.now()-start));}
   await measure('visited',elapsed);
  }
 }
 // Hold real reads until aggregate admission refuses another runtime. A refusal
 // must not invalidate any retained connection or snapshot; no budget is raised.
 let refused=0;
 for(const {storage} of stores){try{held.push(await storage.openCatalogue());}catch(error){assert.equal(error.code,'WORKLOAD_BUSY');refused++;break;}}
 assert.ok(refused>0);for(const db of held)assert.equal((await db.get('SELECT 17 AS value')).value,17);await measure('saturated');
 await Promise.all(held.splice(0).map(db=>db.close()));
 // Normal idle expiry is sixty seconds. Poll only the in-memory counters while
 // waiting; reading owners here would itself reset their idle lifetime.
 for(let index=0;owner.projects.stats().open&&index<180;index++)await delay(1000);
 assert.equal(owner.projects.stats().open,0);const idle=await measure('idle');assert.equal(idle.native.managedRuntimes,0);assert.equal(idle.connections.active,0);
 const start=performance.now();assert.equal((await stores[0].storage.outline()).etag,stores[0].etag);await measure('reopened',[Math.round(performance.now()-start)]);
});
