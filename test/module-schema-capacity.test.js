import {moduleDraftOwners} from './module-domain-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {largeCategory} from './module-capacity-fixture.js';
import {workspaceModules} from '../src/modules/index.js';
import {ModuleDrafts} from '../src/modules/drafts.js';
import {ModuleDraftTransfer} from '../src/modules/draft-transfer.js';
import {writeModuleCheckpoint} from '../src/web/modules/draft-transfer.js';
import {ModuleReader} from '../src/modules/reader.js';
import {moduleCurrentBytes,moduleEntityBytes} from '../src/modules/catalogue.js';
import {MODULE_BYTES} from '../src/modules/capacity.js';
import {Workspace} from '../src/storage.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';
import {createAccess,takeCreatedVault} from '../src/access.js';

test('schema near the unchanged 64 MiB storage boundary can be edited and recovered',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-schema-capacity-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),data=largeCategory({nearLimit:true}),id=randomUUID();
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const modules=workspaceModules(f.workspace),command=(expectedRevision,value)=>({workspaceId:book.id,commandId:randomUUID(),action:'category.save',payload:{id,expectedRevision,data:value}}),started=performance.now();
 await modules.execute(command(null,data),{compact:true});const createMs=performance.now()-started;
 const entity=(await new ModuleReader(f.workspace).selected({workspaceId:book.id,id})).entity,admitted=moduleCurrentBytes(book.id,1,{count:1,bytes:moduleEntityBytes(entity)});
 assert.ok(admitted>MODULE_BYTES-16384&&admitted<MODULE_BYTES);
 const {drafts,transfer}=moduleDraftOwners(f.workspace,book.id,'resources'),checkpoint={workspaceId:book.id,moduleId:'resources',id:randomUUID(),etag:null,drafts:[{id,type:'category',expectedRevision:1,baseRevision:1,data:{...data,name:'Recovered boundary schema'}}]};
 let largest=0;const before=performance.now();
 const result=await writeModuleCheckpoint(async(route,body)=>{largest=Math.max(largest,Buffer.byteLength(JSON.stringify(body)));return transfer[route.split('/').at(-1)](body);},checkpoint,{}),checkpointMs=performance.now()-before;
 assert.ok(largest<2*1024*1024);assert.ok(createMs<60000&&checkpointMs<60000);
 const recovered=await drafts.read(checkpoint.id);assert.equal(recovered.etag,result.etag);assert.deepEqual(recovered.draft.drafts[0].base,data);assert.equal(recovered.draft.drafts[0].data.name,'Recovered boundary schema');
 await modules.execute(command(1,recovered.draft.drafts[0].data),{compact:true});
 const oversized={...data,fields:[{...data.fields[0],choices:[...data.fields[0].choices,...Array.from({length:100},(_,i)=>'over_'+String(i).padStart(5,'0')+'y'.repeat(150))]},...data.fields.slice(1)]};
 await assert.rejects(modules.execute(command(2,oversized),{compact:true}),{code:'LIMIT'});
 assert.equal((await new ModuleReader(f.workspace).selected({workspaceId:book.id,id})).entity.revision,2);
 const copyStarted=performance.now(),ordinary=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'ordinary')),{vault:f.vault}),access=await createAccess('','large schema copy password'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh')),access,vault,f.vault);
 for(const workspace of [new Workspace(ordinary,f.vault),new Workspace(fresh,vault)]){
  const checkpoint=await moduleDraftOwners(workspace,book.id,'resources').drafts.read(recovered.draft.id);assert.equal(checkpoint.etag,recovered.etag);assert.deepEqual(checkpoint.draft,recovered.draft);
  assert.equal((await new ModuleReader(workspace).selected({workspaceId:book.id,id})).entity.revision,2);
 }
 const copiesMs=Math.round(performance.now()-copyStarted);assert.ok(copiesMs<120000);
 const peakRssMiB=Math.round(process.resourceUsage().maxRSS/1024);assert.ok(peakRssMiB<2048);
 t.diagnostic(JSON.stringify({admittedBytes:admitted,choices:data.fields[0].choices.length,createMs:Math.round(createMs),checkpointMs:Math.round(checkpointMs),copiesMs,largestRequestBytes:largest,peakRssMiB}));
});
