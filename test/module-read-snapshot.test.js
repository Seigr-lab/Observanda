import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {moduleDomainStore} from './module-domain-fixture.js';
import {seedModuleCurrent} from './module-current-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {ModuleReader} from '../src/modules/reader.js';
import {workspaceModules} from '../src/modules/index.js';

async function fixture(t){
 const temporaryRoot=path.resolve(os.tmpdir()),directory=await mkdtemp(path.join(temporaryRoot,'observanda-module-read-cache-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),now=new Date().toISOString();
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),temporaryRoot);assert.ok(path.basename(directory).startsWith('observanda-module-read-cache-'));await rm(directory,{recursive:true,force:true});});
 const resource={id:randomUUID(),type:'resource',revision:1,createdAt:now,updatedAt:now,data:{projectId:null,placementId:null,name:'Original name',code:'',kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]}};
 await seedModuleCurrent(f.workspace,book.id,[resource]);return {...f,book,resource,run:(operation,write=false)=>moduleDomainStore(f.workspace,book.id,'inventory',operation,{write})};
}

test('fixed module snapshots share encrypted facts and integrity checks while new operations see edits',async t=>{
 const f=await fixture(t);let retained,queries=0,checks=0,firstQueries;
 await f.run(async store=>{
  assert.equal(store.readOnly,true);retained=store.readCache;const get=store.db.get.bind(store.db);store.db.get=async(sql,...args)=>{queries++;if(sql.includes('FROM module_entities)::text'))checks++;return get(sql,...args);};
  const read=async()=>{const catalogue=new ModuleCatalogue(store),head=await catalogue.head(f.book.id),member=await catalogue.member(head,f.resource.id);return {head,view:await catalogue.view(head,member),constraint:await catalogue.constraint(head,member),references:await catalogue.references(head,member)};};
  const first=await read();firstQueries=queries;for(let i=0;i<30;i++){const value=await read();assert.deepEqual(value,first);value.view.title='Caller mutation';value.constraint.data.status='Caller mutation';}
  assert.equal(checks,1);assert.equal(queries,firstQueries);
  await workspaceModules(f.workspace).execute({workspaceId:f.book.id,commandId:randomUUID(),action:'resource.save',payload:{id:f.resource.id,expectedRevision:1,data:{...f.resource.data,name:'Changed name'}}},{compact:true});
  assert.deepEqual(await read(),first);assert.equal(queries,firstQueries);
 });
 assert.equal(retained.rows.size,0);assert.equal(retained.nodes.size,0);assert.equal(retained.proofs.size,0);assert.equal(retained.bytes,0);
 const fresh=await new ModuleReader(f.workspace).list({workspaceId:f.book.id,type:'resource'});assert.equal(fresh.items[0].title,'Changed name');
 t.diagnostic(JSON.stringify({repeatedReads:32,headIntegrityChecks:checks,totalQueries:queries,initialQueries:firstQueries}));
});

test('mutable domain transactions never reuse a stale fact or a failed head proof',async t=>{
 const f=await fixture(t),abort=Error('rollback synthetic damage');
 await assert.rejects(f.run(async store=>{
  assert.equal(store.readOnly,false);assert.equal(store.readCache,null);const catalogue=new ModuleCatalogue(store),head=await catalogue.head(f.book.id),member=await catalogue.member(head,f.resource.id);await catalogue.view(head,member);
  const slot='module-view:'+member.viewHash;await store.db.run('DELETE FROM state WHERE slot=$1',slot);await assert.rejects(catalogue.view(head,member),{code:'CATALOGUE_DAMAGED'});throw abort;
 },true),error=>error===abort);
 assert.equal((await new ModuleReader(f.workspace).list({workspaceId:f.book.id,type:'resource'})).items[0].title,f.resource.data.name);
 await f.run(store=>store.db.run('DELETE FROM module_events'),true);
 await f.run(async store=>{for(let i=0;i<2;i++)await assert.rejects(new ModuleCatalogue(store).head(f.book.id),{code:'CATALOGUE_DAMAGED'});assert.equal([...store.readCache.proofs.keys()].some(key=>key.startsWith('module-head:')),false);});
});
