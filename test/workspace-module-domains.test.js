import {readWorkspaceDashboard,writeWorkspaceDashboard} from '../src/security/dashboard-storage.js';
import {catalogueStamp} from '../src/postgres.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {copyWorkspaceTo,copyPlan,encryptedCopy} from '../src/locations.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {ProjectDomains} from '../src/project-domains.js';
import {ProjectModuleDrafts} from '../src/project-module-drafts.js';
import {workspaceModules} from '../src/modules/index.js';
import {ModuleReader} from '../src/modules/reader.js';
import {ModuleHistory} from '../src/modules/history.js';
import {readCalendar} from '../src/calendar/reader.js';
import {readProjectDomainRegistry} from '../src/project-domain-registry.js';
import {catalogueFormat} from '../src/catalogue-format.js';
import {testServer} from './device-fixture.js';
import {calculation,calendar} from './project-domain-fixture.js';
const detached=AsyncLocalStorage.snapshot();
function gate(){let enter,release;return {started:new Promise(r=>enter=r),hold:new Promise(r=>release=r),enter:()=>enter(),release:()=>release()};}
async function setup(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-workspace-domains-'));
 const runtime=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(runtime),vaults=[];
 t.after(async()=>{await runtime.close();detach();for(const vault of vaults)clearVault(vault);assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-workspace-domains-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const book=sampleNotebook(),f=await encryptedFixture(directory,book);vaults.push(f.vault);
 return {...f,directory,runtime,vaults,book,projectId:null,storage:f.workspace,domains:new ProjectDomains(f.workspace,book.id)};
}
const verify=f=>f.storage.catalogue(store=>store.verify({format:'observanda-research-catalogue',version:2,workspaceId:f.book.id}));

test('new workspace modules have independent writers, history, drafts and lifecycle fences',{timeout:180000},async t=>{
 const f=await setup(t),modules=workspaceModules(f.storage),cmd=calculation(f),scheduled=calendar(f);
 const registry=await f.storage.catalogue(readProjectDomainRegistry);assert.equal(registry.version,2);assert.equal(registry.projectId,null);assert.equal(await f.storage.catalogue(s=>catalogueFormat(s.db)),25);
 const research=gate(),held=detached(()=>f.storage.withLock(async()=>{research.enter();await research.hold;}));await research.started;
 try{assert.equal((await modules.execute(cmd)).revisions.calculator,1);}finally{research.release();await held;}
 const calculator=gate(),writer=detached(()=>f.domains.run(['calculator'],async()=>{calculator.enter();await calculator.hold;},{write:['calculator']}));await calculator.started;
 const checkpoint={workspaceId:f.book.id,moduleId:'scientific-calculator',id:randomUUID(),etag:null,drafts:[{id:cmd.payload.id,type:'calculation',expectedRevision:1,baseRevision:1,data:{...cmd.payload.data,name:'Unfinished'}}]};
 const drafts=new ProjectModuleDrafts(f.storage,f.book.id);
 try{
  assert.equal((await modules.execute(scheduled)).revisions.calendars,1);
  const beforeDraft=await catalogueStamp(f.storage.root),researchHead=(await f.storage.outline()).etag;
  assert.ok((await drafts.write(checkpoint)).etag);
  const afterDraft=await catalogueStamp(f.storage.root);assert.notEqual(afterDraft.revision,beforeDraft.revision);assert.ok(afterDraft.bytes>beforeDraft.bytes);assert.equal((await f.storage.outline()).etag,researchHead);
  await assert.rejects(f.storage.withStorageHandoff(async()=>{}),{code:'LOCKED'});
 }finally{calculator.release();await writer;}
 assert.equal((await new ModuleReader(f.storage).selected({workspaceId:f.book.id,id:cmd.payload.id})).entity.data.name,cmd.payload.data.name);
 assert.equal((await new ModuleHistory(f.storage).read({id:cmd.payload.id,revision:1})).entity.data.name,cmd.payload.data.name);
 assert.equal((await drafts.read({workspaceId:f.book.id,moduleId:checkpoint.moduleId,id:checkpoint.id})).draft.drafts[0].base.name,cmd.payload.data.name);
 assert.equal((await readCalendar(f.storage,f.book,{from:'2026-01-01',to:'2026-02-01',timeZone:'UTC'})).sources[0].name,scheduled.payload.data.name);
 assert.equal((await modules.current()).entities.length,2);assert.equal((await modules.version()).revisions.calculator,1);
 const lifecycle=gate(),handoff=detached(()=>f.storage.withStorageHandoff(async()=>{lifecycle.enter();await lifecycle.hold;}));await lifecycle.started;
 try{await assert.rejects(modules.execute(calculation(f)),{code:'LOCKED'});}finally{lifecycle.release();await handoff;}
 await assert.rejects(f.storage.withLock(()=>f.storage.catalogue(store=>store.assertModuleWrite())),{code:'ACCESS_UPGRADE'});
 await assert.rejects(f.storage.withLock(()=>f.storage.writeMetadata('.observanda/module-drafts/'+randomUUID()+'.json','{}')),{code:'ACCESS_UPGRADE'});
 await verify(f);
 await f.storage.withLock(()=>f.storage.catalogue(store=>store.db.run("DELETE FROM state WHERE slot='project-domains'")));
 await assert.rejects(modules.execute(calculation(f)),{code:'CATALOGUE_DAMAGED'});
});

test('workspace module API uses dedicated owners under a held research writer',{timeout:180000},async t=>{
 const f=await setup(t),app=await testServer({root:f.storage.root,port:0,headless:true,deviceStore:f.deviceStore});t.after(()=>app.close());
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})}),cookie=session.headers.get('set-cookie').split(';')[0];let context;
 const request=async(route,data)=>{const response=await fetch(app.origin+route,{...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),headers:{Origin:app.origin,Cookie:cookie,'Content-Type':'application/json',...(context?{'X-Observanda-Workspace':context}:{})}}),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
 context=(await request('/api/storage')).contextId;
 const g=gate(),held=detached(()=>f.storage.withLock(async()=>{g.enter();await g.hold;}));await g.started;
 try{
  const cmd=calculation(f),result=await request('/api/modules/command?compact=1',cmd);assert.equal(result.revisions.calculator,1);
  const items=await request('/api/modules/items',{workspaceId:f.book.id,type:'calculation'});assert.equal(items.items.length,1);
  const checkpoint={workspaceId:f.book.id,moduleId:'scientific-calculator',id:randomUUID(),etag:null,drafts:[{id:cmd.payload.id,type:'calculation',expectedRevision:1,baseRevision:1,data:{...cmd.payload.data,name:'HTTP draft'}}]};
  assert.ok((await request('/api/modules/drafts/write',checkpoint)).etag);
  const read=await request('/api/modules/drafts/read',{workspaceId:f.book.id,moduleId:checkpoint.moduleId,id:checkpoint.id});assert.equal(read.draft.drafts[0].data.name,'HTTP draft');
  assert.equal((await request('/api/modules/version')).revisions.calculator,1);
  assert.equal((await request('/api/modules/history?id='+cmd.payload.id+'&revision=1')).entity.data.name,cmd.payload.data.name);
 }finally{g.release();await held;}
 await app.close();await verify(f);
});

test('workspace module originals and draft bases survive portable copy and key replacement',{timeout:240000},async t=>{
 const f=await setup(t),cmd=calculation(f);await workspaceModules(f.storage).execute(cmd);
 const checkpoint={workspaceId:f.book.id,moduleId:'scientific-calculator',id:randomUUID(),etag:null,drafts:[{id:cmd.payload.id,type:'calculation',expectedRevision:1,baseRevision:1,data:{...cmd.payload.data,name:'Retained draft'}}]};await new ProjectModuleDrafts(f.storage,f.book.id).write(checkpoint);
 const beforeSettings=await readWorkspaceDashboard(f.storage),settings=structuredClone(beforeSettings.settings);settings.enabledModules=['planning'];await writeWorkspaceDashboard(f.storage,settings,beforeSettings.etag);
 const portable=path.join(f.directory,'portable');await copyWorkspaceTo(f.storage.root,portable,{vault:f.vault});
 const access=await createWorkspaceAccess('','Synthetic copy password',f.deviceStore),vault=takeCreatedVault(access);f.vaults.push(vault);const successor=path.join(f.directory,'successor');
 await encryptedCopy(await copyPlan(f.storage.root,successor,{vault:f.vault}),access,vault,f.vault);
 for(const [root,key] of [[portable,f.vault],[successor,vault]]){
  const storage=new Workspace(root,key);assert.deepEqual((await readWorkspaceDashboard(storage)).settings,settings);assert.equal((await workspaceModules(storage).current()).entities[0].data.name,cmd.payload.data.name);
  assert.equal((await new ProjectModuleDrafts(storage,f.book.id).read({workspaceId:f.book.id,moduleId:checkpoint.moduleId,id:checkpoint.id})).draft.drafts[0].base.name,cmd.payload.data.name);
  await storage.catalogue(store=>store.verify({format:'observanda-research-catalogue',version:2,workspaceId:f.book.id}));await f.runtime.closeWorkspace(root);
  assert.equal((await workspaceModules(new Workspace(root,key)).version()).revisions.calculator,1);
 }
 await verify(f);
});
