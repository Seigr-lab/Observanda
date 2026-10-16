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
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {ModuleHistory} from '../src/modules/history.js';
const task=title=>({title,description:'Private task body',status:'todo',priority:'normal',dueOn:null,assignees:[],checklist:[],dependencies:[],links:[]});
async function fixture(t,count=45){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-history-')),f=await encryptedFixture(directory,sampleNotebook()),modules=workspaceModules(f.workspace),workspaceId=(await f.workspace.outline()).metadata.id,id=randomUUID();
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const save=(revision,entityId=id)=>modules.execute({workspaceId,commandId:randomUUID(),action:'task.save',payload:{id:entityId,expectedRevision:revision||null,data:task('Take '+(revision+1))}});
 for(let i=0;i<count;i++)await save(i);
 return {...f,modules,workspaceId,id,save,history:new ModuleHistory(f.workspace),write:operation=>moduleDomainStore(f.workspace,workspaceId,'tasks',operation,{write:true})};
}
test('current module data, saves and summary pages do not load retained event bodies; pages stay anchored',async t=>{
 const f=await fixture(t),event=ModuleCatalogue.prototype.event;let loaded=0;
 ModuleCatalogue.prototype.event=function(...args){loaded++;return event.apply(this,args);};t.after(()=>{ModuleCatalogue.prototype.event=event;});
 const read=ModuleCatalogue.prototype.read;ModuleCatalogue.prototype.read=()=>{throw Error('Current bodies loaded by version check');};
 try{const version=await f.modules.version();assert.equal(version.workspaceId,f.workspaceId);assert.equal(version.revisions.tasks,45);}finally{ModuleCatalogue.prototype.read=read;}
 assert.equal((await f.modules.current()).events,undefined);
 const first=await f.history.page({id:f.id}),second=await f.history.page({id:f.id,cursor:first.nextCursor}),third=await f.history.page({id:f.id,cursor:second.nextCursor});
 assert.equal(first.items.length,20);assert.equal(second.items.length,20);assert.equal(third.items.length,5);assert.equal(third.nextCursor,null);
 assert.deepEqual([...first.items,...second.items,...third.items].map(v=>v.revision),Array.from({length:45},(_,i)=>45-i));
 assert.ok(!JSON.stringify(first).includes('Private task body'));assert.ok(JSON.stringify(first).length<14000);assert.equal(loaded,0);
 await f.save(45);assert.equal(loaded,0);
 const next=await f.history.page({id:f.id,cursor:first.nextCursor});assert.deepEqual(next.items,second.items);assert.equal(next.total,45);assert.equal(next.changed,true);
 const selected=await f.history.read({id:f.id,revision:12});assert.equal(loaded,1);assert.equal(selected.entity.data.title,'Take 12');assert.equal(selected.currentRevision,46);
 const other=randomUUID();await f.save(0,other);
 await assert.rejects(f.history.page({id:other,cursor:first.cursor}),{code:'MODULE_HISTORY_CURSOR'});
 await assert.rejects(f.history.page({id:f.id,cursor:first.cursor,limit:10}),{code:'MODULE_HISTORY_CURSOR'});
 const bytes=Buffer.from(first.cursor,'base64url');bytes[bytes.length-4]^=1;await assert.rejects(f.history.page({id:f.id,cursor:bytes.toString('base64url')}),{code:'MODULE_HISTORY_CURSOR'});
 await assert.rejects(f.history.read({id:f.id,revision:99}),{code:'NOT_FOUND'});
});
test('older receipts remain readable without treating missing indexed revisions as legacy',async t=>{
 const f=await fixture(t,25);
 await f.write(async store=>{
  const {legacyModuleHead}=await import('./module-current-fixture.js'),head=await legacyModuleHead(store,f.workspaceId);
  delete head.historyVersion;for(const e of head.entities)delete e.historyFrom;
  await store.db.run("UPDATE state SET payload=$1 WHERE slot='modules'",store.encode('state','modules',head));
  await store.db.run("DELETE FROM state WHERE starts_with(slot,'module-history:')");
 });
 await f.save(25);
 const page=await f.history.page({id:f.id});assert.equal(page.total,26);assert.deepEqual(page.items.map(e=>e.revision),Array.from({length:20},(_,i)=>26-i));
 assert.equal((await f.history.read({id:f.id,revision:1})).entity.data.title,'Take 1');
 await f.workspace.catalogue(store=>f.modules.verifyCatalogue(store,f.workspaceId));
 await f.write(store=>store.db.run('DELETE FROM state WHERE slot=$1','module-history:'+f.id+':26'));
 await assert.rejects(f.history.page({id:f.id}),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.workspace.catalogue(store=>f.modules.verifyCatalogue(store,f.workspaceId)),{code:'CATALOGUE_DAMAGED'});
});
test('module audits stream history and detect replayed entity revisions and changed locator summaries',async t=>{
 const f=await fixture(t,3),slot='module-history:'+f.id+':2';let original;
 await f.write(async store=>{
  original=(await store.db.get('SELECT payload FROM state WHERE slot=$1',slot)).payload;
  const value=store.decode('state',slot,original);value.action='incorrect.summary';await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',slot,value),slot);
 });
 await assert.rejects(f.workspace.catalogue(store=>f.modules.verifyCatalogue(store,f.workspaceId)),{code:'CATALOGUE_DAMAGED'});
 await f.write(async store=>{
  await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',original,slot);
  const row=await store.db.get('SELECT command_id,ordinal,payload FROM module_events WHERE ordinal=2'),event=store.decode('module-event',row.command_id+'/'+row.ordinal,row.payload);
  event.changes[0].revision=1;await store.db.run('UPDATE module_events SET payload=$1 WHERE command_id=$2',store.encode('module-event',row.command_id+'/'+row.ordinal,event),row.command_id);
 });
 await assert.rejects(f.history.read({id:f.id,revision:2}),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(f.workspace.catalogue(store=>f.modules.verifyCatalogue(store,f.workspaceId)),{code:'CATALOGUE_DAMAGED'});
});
