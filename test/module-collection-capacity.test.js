import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {Workspace} from '../src/storage.js';
import {workspaceModules} from '../src/modules/index.js';
import {ModuleCatalogue,moduleEntityBytes} from '../src/modules/catalogue.js';
import {ModuleReader} from '../src/modules/reader.js';
import {MODULE_BYTES} from '../src/modules/capacity.js';
import {moduleDomainStore} from './module-domain-fixture.js';
import {largestSheet} from './module-capacity-fixture.js';

test('indexed module collections grow past the response budget and remain editable and verifiable',{timeout:300000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-collection-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),data=largestSheet();
 t.after(async()=>{await clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const modules=workspaceModules(f.workspace),now='2026-11-01T00:00:00.000Z';
 const itemBytes=moduleEntityBytes({id:randomUUID(),type:'sheet',revision:1,createdAt:now,updatedAt:now,data});
 // This is a workload measurement point just above the old aggregate ceiling,
 // not the number of sheets supported by the product.
 const count=Math.floor(MODULE_BYTES/itemBytes)+2,ids=Array.from({length:count},()=>randomUUID());
 const save=(id,expectedRevision,value)=>({workspaceId:book.id,commandId:randomUUID(),action:'sheet.save',payload:{id,expectedRevision,data:value}});
 const started=performance.now();
 t.mock.method(ModuleCatalogue.prototype,'read',()=>assert.fail('Compact authoring must not assemble the collection'));
 for(const [index,id] of ids.entries())await modules.execute(save(id,null,{...data,name:'Sheet '+String(index).padStart(4,'0')}),{compact:true});
 const createdMs=Math.round(performance.now()-started);
 const bytes=await moduleDomainStore(f.workspace,book.id,'spreadsheet',async store=>(await new ModuleCatalogue(store).head(book.id)).totalBytes);
 assert.ok(bytes>MODULE_BYTES);
 let selectedReads=0,viewReads=0;const selected=ModuleCatalogue.prototype.selected,view=ModuleCatalogue.prototype.view;
 t.mock.method(ModuleCatalogue.prototype,'selected',function(...args){selectedReads++;return selected.call(this,...args);});
 t.mock.method(ModuleCatalogue.prototype,'view',function(...args){viewReads++;return view.call(this,...args);});
 const reopened=new Workspace(f.workspace.root,f.vault),reader=new ModuleReader(reopened),page=await reader.list({workspaceId:book.id,type:'sheet'});
 assert.equal(page.total,count);assert.equal(page.items.length,Math.min(25,count));assert.equal(selectedReads,0);assert.equal(viewReads,page.items.length);
 assert.ok(Buffer.byteLength(JSON.stringify(page))<24000);
 const command=save(ids[0],1,{...data,name:'Edited after collection growth'}),first=await modules.execute(command,{compact:true}),replay=await modules.execute(command,{compact:true});
 assert.equal(first.replayed,false);assert.equal(replay.replayed,true);
 assert.equal((await reader.selected({workspaceId:book.id,id:ids[0]})).entity.revision,2);
 t.mock.restoreAll();
 await assert.rejects(workspaceModules(reopened).current(),{code:'LIMIT'},'Only the legacy whole-response endpoint retains its materialization budget');
 const verifyStarted=performance.now();
 await moduleDomainStore(reopened,book.id,'spreadsheet',async store=>{
  const catalogue=new ModuleCatalogue(store),validate={entity:e=>modules.validateEntity(e),event:e=>modules.validateEvent(e),constraints:source=>modules.validateSource(source)};
  await catalogue.verify(book.id,validate);
  await assert.rejects(catalogue.read(book.id,{history:false}),{code:'LIMIT'});
 });
 t.diagnostic(JSON.stringify({items:count,currentBytes:bytes,createdMs,verifiedMs:Math.round(performance.now()-verifyStarted),pageItems:page.items.length,pageBytes:Buffer.byteLength(JSON.stringify(page))}));
});
