import {moduleDomainStore,moduleDraftOwners} from './module-domain-fixture.js';
import {ProjectDraftCatalogue} from '../src/project-draft-catalogue.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {largestSheet} from './module-capacity-fixture.js';
import {ModuleDrafts} from '../src/modules/drafts.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {workspaceModules} from '../src/modules/index.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';
import {ModuleReader} from '../src/modules/reader.js';
import {legacyModuleHead} from './module-current-fixture.js';
import {Workspace} from '../src/storage.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {serialize} from '../src/storage-format.js';

for(const count of [1,10])test('maximum Unicode sheets checkpoint and recover among '+count+' full-size items',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-capacity-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),data=largestSheet(),modules=workspaceModules(f.workspace),drafts=moduleDraftOwners(f.workspace,book.id,'spreadsheet').drafts;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 assert.equal(JSON.stringify(data.cells).length,600000);assert.ok(Buffer.byteLength(JSON.stringify(data))>2*1024*1024);
 const ids=Array.from({length:count},()=>randomUUID()),save=(id,expectedRevision,value)=>({workspaceId:book.id,commandId:randomUUID(),action:'sheet.save',payload:{id,expectedRevision,data:value}});
 for(const id of ids)await modules.execute(save(id,null,data),{compact:true});
 if(count===10)await moduleDomainStore(f.workspace,book.id,'spreadsheet',async store=>{const old=await legacyModuleHead(store,book.id);delete old.currentVersion;delete old.viewVersion;delete old.historyVersion;await store.db.run("UPDATE state SET payload=$1 WHERE slot='modules'",store.encode('state','modules',old));},{write:true});
 t.mock.method(ModuleCatalogue.prototype,'read',()=>{throw Error('Full module read');});
 const reader=new ModuleReader(f.workspace),beforePage=performance.now(),page=await reader.list({workspaceId:book.id,type:'sheet'}),pageMs=performance.now()-beforePage;
 assert.equal(page.total,count);assert.ok(Buffer.byteLength(JSON.stringify(page))<24000);assert.ok(pageMs<10000);
 const id=ids[0],checkpoint={workspaceId:book.id,id:randomUUID(),moduleId:'spreadsheet',etag:null,drafts:[{id,type:'sheet',expectedRevision:1,baseRevision:1,data:{...data,name:'Unfinished maximum sheet'}}]},started=performance.now(),saved=await drafts.write(checkpoint),writeMs=performance.now()-started;
 const raw=await moduleDraftOwners(f.workspace,book.id,'spreadsheet').run(({workspace})=>workspace.readMetadata('.observanda/module-drafts/'+checkpoint.id+'.json',4*1024*1024));assert.equal(JSON.parse(raw).drafts[0].base,undefined);assert.ok(Buffer.byteLength(raw)<3*1024*1024);assert.ok(writeMs<5000);
 assert.equal((await drafts.write(checkpoint)).etag,saved.etag,'Lost reply is idempotent');
 await modules.execute(save(id,1,{...data,name:'Concurrent title'}),{compact:true});
 const recovered=await drafts.read(checkpoint.id);assert.deepEqual(recovered.draft.drafts[0].base,data);assert.equal(recovered.draft.drafts[0].data.name,'Unfinished maximum sheet');
 await assert.rejects(modules.execute(save(id,1,recovered.draft.drafts[0].data),{compact:true}),{code:'MODULE_CHANGED'});
 const put=ProjectDraftCatalogue.prototype.putObject;t.mock.method(ProjectDraftCatalogue.prototype,'putObject',function(key,...args){if(key.startsWith('metadata:.observanda/module-draft-list/'))throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});return put.call(this,key,...args);});
 await assert.rejects(drafts.write({...checkpoint,etag:saved.etag,drafts:[{...checkpoint.drafts[0],data:{...data,name:'Failed write'}}]}),{code:'ENOSPC'});t.mock.restoreAll();
 assert.equal((await drafts.read(checkpoint.id)).etag,saved.etag);
 for(const invalid of [{...checkpoint.drafts[0],baseRevision:2},{...checkpoint.drafts[0],expectedRevision:99,baseRevision:99},{...checkpoint.drafts[0],type:'calculation'}])await assert.rejects(drafts.write({...checkpoint,etag:saved.etag,drafts:[invalid]}),{code:'MODULE_INVALID'});
 await assert.rejects(drafts.write({...checkpoint,etag:saved.etag,drafts:[checkpoint.drafts[0],{...checkpoint.drafts[0],id:ids.at(-1)}]}),{code:'MODULE_INVALID'});
 const tooLarge=structuredClone(data);tooLarge.cells[0][0]+='x';await assert.rejects(modules.execute(save(randomUUID(),null,tooLarge),{compact:true}),{code:'MODULE_INVALID'});
 // Both recovery modes must retain the exact revision referenced by the draft.
 if(count===10){
  const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup')),{vault:f.vault}),access=await createAccess('','fresh maximum sheet recovery'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
  const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh')),access,vault,f.vault);
  for(const ws of [new Workspace(backup,f.vault),new Workspace(fresh,vault)])assert.deepEqual((await moduleDraftOwners(ws,book.id,'spreadsheet').drafts.read(checkpoint.id)).draft,recovered.draft);
 }
 assert.ok(process.memoryUsage().heapUsed<512*1024*1024);
 t.diagnostic(JSON.stringify({largestItems:count,legacyHead:count===10,pageMs:Math.round(pageMs),checkpointMs:Math.round(writeMs),dataBytes:Buffer.byteLength(JSON.stringify(data)),checkpointBytes:Buffer.byteLength(raw),duplicatedCheckpointBytes:Buffer.byteLength(serialize({...checkpoint,drafts:[{...checkpoint.drafts[0],base:data}]})),heapMiB:Math.round(process.memoryUsage().heapUsed/1024/1024)}));
});
