import {moduleDomainStore} from './module-domain-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {workspaceModules} from '../src/modules/index.js';
import {ModuleHistory} from '../src/modules/history.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {Workspace} from '../src/storage.js';
for(const count of [75,750])test('module history retains '+count+' full revisions with bounded current reads, pages and audit memory',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-growth-')),f=await encryptedFixture(directory,sampleNotebook()),modules=workspaceModules(f.workspace),workspaceId=(await f.workspace.outline()).metadata.id,id=randomUUID(),history=new ModuleHistory(f.workspace);
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const description='Private original field observations. '.repeat(2700),command=revision=>({workspaceId,commandId:randomUUID(),action:'task.save',payload:{id,expectedRevision:revision||null,data:{title:'Revision '+(revision+1),description,status:'todo',priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies:[],links:[]}}});
 let peakHeap=0;const sampler=setInterval(()=>{peakHeap=Math.max(peakHeap,process.memoryUsage().heapUsed);},25);sampler.unref();
 try{
  let start=performance.now();for(let i=0;i<count;i++)await modules.execute(command(i));const saveMs=performance.now()-start;assert.ok(saveMs<120000);
  start=performance.now();const current=await modules.current(),currentMs=performance.now()-start;assert.equal(current.events,undefined);assert.equal(current.entities[0].revision,count);assert.ok(currentMs<1000);
  start=performance.now();const first=await history.page({id}),pageMs=performance.now()-start;assert.equal(first.items.length,20);assert.ok(pageMs<1000);assert.ok(JSON.stringify(first).length<14000);
  let last=first;while(last.nextCursor)last=await history.page({id,cursor:last.nextCursor});assert.equal(last.items.at(-1).revision,1);
  start=performance.now();const latest=command(count);await modules.execute(latest);const editMs=performance.now()-start;assert.ok(editMs<1000);
  assert.equal((await modules.execute(latest)).replayed,true);assert.equal((await history.page({id,cursor:first.cursor})).changed,true);
  start=performance.now();await f.workspace.catalogue(store=>modules.verifyCatalogue(store,workspaceId));const auditMs=performance.now()-start;assert.ok(auditMs<60000);
  const retainedBytes=await moduleDomainStore(f.workspace,workspaceId,'tasks',async store=>Number((await store.db.get('SELECT sum(octet_length(payload))::text AS bytes FROM module_events')).bytes));
  if(count===750)assert.ok(retainedBytes>64*1024*1024);
  start=performance.now();const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup')),{vault:f.vault});
  const access=await createAccess('','Synthetic rekeyed module history'),key=takeCreatedVault(access);t.after(()=>clearVault(key));
  const rekeyed=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'rekeyed')),access,key,f.vault),restoreMs=performance.now()-start;assert.ok(restoreMs<120000);
  for(const [root,vault] of [[backup,f.vault],[rekeyed,key]]){
   const ws=new Workspace(root,vault),h=new ModuleHistory(ws);assert.deepEqual((await h.page({id})).items.map(v=>v.revision),Array.from({length:20},(_,i)=>count+1-i));
   assert.equal((await h.read({id,revision:1})).entity.data.description,description);assert.equal((await workspaceModules(ws).execute(latest)).replayed,true);
  }
  assert.ok(peakHeap<256*1024*1024);
  t.diagnostic(JSON.stringify({count,platform:process.platform,node:process.version,cpu:os.cpus()[0].model,retainedBytes,saveMs:Math.round(saveMs),currentMs:Math.round(currentMs),pageMs:Math.round(pageMs),editMs:Math.round(editMs),auditMs:Math.round(auditMs),restoreMs:Math.round(restoreMs),sampledHeapMiB:Math.round(peakHeap/1024**2)}));
 }finally{clearInterval(sampler);}
});
