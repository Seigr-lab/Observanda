import {moduleDomainStore} from './module-domain-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {ModuleReader} from '../src/modules/reader.js';
import {workspaceModules} from '../src/modules/index.js';
import {seedModuleCurrent,legacyModuleHead} from './module-current-fixture.js';
async function fixture(t,count){
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-module-members-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),now=new Date().toISOString();
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const entities=Array.from({length:count},(_,i)=>({id:randomUUID(),type:'calculation',revision:1,createdAt:now,updatedAt:now,data:{name:'Calculation '+i,links:[],engine:1,mode:'expression',angle:'rad',expression:'sqrt(4)',digits:'',fromBase:10,toBase:6}}));
 await seedModuleCurrent(f.workspace,book.id,entities);return {...f,book,entities};
}
for(const count of [65,650])test('module membership reads and updates one authenticated path at '+count+' items',async t=>{
 const f=await fixture(t,count),target=f.entities.at(-1);let queries=0;
 await moduleDomainStore(f.workspace,f.book.id,'calculator',async store=>{
  const query=store.db.client.query.bind(store.db.client);store.db.client.query=(...args)=>{queries++;return query(...args);};
  const catalogue=new ModuleCatalogue(store),head=await catalogue.head(f.book.id);assert.equal(head.entities,undefined);assert.equal(head.root.count,count);assert.ok(Buffer.byteLength(JSON.stringify(head))<600);
  assert.deepEqual(await catalogue.selected(head,target.id),target);assert.ok(queries>0&&queries<35,'Selected reads must follow a tree path, not enumerate membership');store.db.client.query=query;
 });
 t.diagnostic(JSON.stringify({items:count,selectedQueries:queries}));
 const modules=workspaceModules(f.workspace),changed=await modules.execute({workspaceId:f.book.id,commandId:randomUUID(),action:'calculation.save',payload:{id:target.id,expectedRevision:1,data:{...target.data,name:'Updated'}}},{compact:true});
 assert.equal(changed.entities[0].revision,2);
 await moduleDomainStore(f.workspace,f.book.id,'calculator',async store=>{
  const catalogue=new ModuleCatalogue(store),head=await catalogue.head(f.book.id),controller=new AbortController();let seen=0;
  for await(const member of catalogue.members(head)){assert.ok(member.id);seen++;}assert.equal(seen,count);
  controller.abort();await assert.rejects(async()=>{for await(const item of catalogue.members(head,{signal:controller.signal}))void item;},{name:'AbortError'});
 });
});
test('member damage is rejected by selected reads and streaming pages',async t=>{
 const f=await fixture(t,40),reader=new ModuleReader(f.workspace),target=f.entities[17];
 await moduleDomainStore(f.workspace,f.book.id,'calculator',async store=>{
  const slot='module-member:'+target.id,row=await store.db.get('SELECT payload FROM state WHERE slot=$1',slot),value=store.decode('state',slot,row.payload);value.revision++;
  await store.db.run('UPDATE state SET payload=$1 WHERE slot=$2',store.encode('state',slot,value),slot);
 },{write:true});
 await assert.rejects(reader.selected({workspaceId:f.book.id,id:target.id}),{code:'CATALOGUE_DAMAGED'});
 await assert.rejects(reader.list({workspaceId:f.book.id,type:'calculation'}),{code:'CATALOGUE_DAMAGED'});
});
test('legacy membership becomes indexed in the same successful command transaction',async t=>{
 const f=await fixture(t,65),modules=workspaceModules(f.workspace),target=f.entities[0];
 await moduleDomainStore(f.workspace,f.book.id,'calculator',async store=>{
  const head=await legacyModuleHead(store,f.book.id);await store.db.run("UPDATE state SET payload=$1 WHERE slot='modules'",store.encode('state','modules',head));
 },{write:true});
 const command={workspaceId:f.book.id,commandId:randomUUID(),action:'calculation.save',payload:{id:target.id,expectedRevision:1,data:{...target.data,name:'After upgrade'}}};
 const write=ModuleCatalogue.prototype.writeChanges;t.mock.method(ModuleCatalogue.prototype,'writeChanges',async function(...args){await write.apply(this,args);throw Object.assign(Error('Synthetic disk full'),{code:'ENOSPC'});});
 await assert.rejects(modules.execute(command,{compact:true}),{code:'ENOSPC'});t.mock.restoreAll();
 await moduleDomainStore(f.workspace,f.book.id,'calculator',async store=>{const head=await new ModuleCatalogue(store).head(f.book.id);assert.equal(head.entities.length,65);assert.equal(await store.db.get("SELECT 1 FROM state WHERE starts_with(slot,'module-member:') LIMIT 1"),undefined);});
 await modules.execute(command,{compact:true});await f.workspace.catalogue(store=>modules.verifyCatalogue(store,f.book.id));
 await moduleDomainStore(f.workspace,f.book.id,'calculator',async store=>{const head=await new ModuleCatalogue(store).head(f.book.id);assert.equal(head.memberVersion,1);assert.equal(head.entities,undefined);});
});
