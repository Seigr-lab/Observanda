import {moduleDomainStore} from './module-domain-fixture.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {clearVault} from '../src/encryption.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {InventoryReader} from '../src/modules/inventory-reader.js';
import {seedModuleCurrent} from './module-current-fixture.js';
import {ModuleReader} from '../src/modules/reader.js';
import {Workspace} from '../src/storage.js';
import {createAccess,takeCreatedVault} from '../src/access.js';
import {copyPlan,copyWorkspace,encryptedCopy} from '../src/locations.js';

for(const count of [65,650])test('inventory queries include all ledger facts while opening only a page of '+count+' item originals',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-inventory-current-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),now=new Date().toISOString(),projectId=book.projects[0].id;
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const entity=(type,data)=>({id:randomUUID(),type,revision:1,createdAt:now,updatedAt:now,data});
 const resources=Array.from({length:count},(_,i)=>entity('resource',{projectId:null,placementId:null,name:'Item '+String(i).padStart(3,'0'),code:'PART-'+i,kind:'material',description:'Private inventory notes. '.repeat(2800),categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'Bench',unit:'pieces',capacity:1,status:'available',links:[]}));
 const movements=resources.map(r=>entity('movement',{resourceId:r.id,projectId:null,delta:'100.000000000000000001',unit:'pieces',reason:'Opening stock',links:[],reservationId:null}));
 const transfers=resources.map(r=>entity('stock-transfer',{resourceId:r.id,fromProjectId:null,toProjectId:projectId,quantity:'30',unit:'pieces',reason:'Project allocation',links:[]}));
 await seedModuleCurrent(f.workspace,book.id,[...resources,...movements,...transfers]);
 const read=ModuleCatalogue.prototype.read,selected=ModuleCatalogue.prototype.selected,loaded=[];
 ModuleCatalogue.prototype.read=()=>{throw Error('Full inventory snapshot read');};ModuleCatalogue.prototype.selected=async function(head,id){const result=await selected.call(this,head,id);if(result)loaded.push(id);return result;};
 t.after(()=>{ModuleCatalogue.prototype.read=read;ModuleCatalogue.prototype.selected=selected;});
 const reader=new InventoryReader(f.workspace),started=performance.now(),stock=await reader.stock({workspaceId:book.id,ids:[resources[0].id]});
 assert.deepEqual(loaded,[]);assert.equal(stock.items[0].locations.find(r=>r.projectId===null).available,'70.000000000000000001');assert.equal(stock.items[0].locations.find(r=>r.projectId===projectId).physical,'30');
 const stockMs=performance.now()-started,first=await reader.page({workspaceId:book.id,type:'resource',scopeIds:[projectId],limit:7}),pageMs=performance.now()-started-stockMs;
 assert.equal(first.total,count);assert.equal(first.items.length,7);assert.equal(loaded.length,7);assert.deepEqual(new Set(loaded),new Set(first.items.map(i=>i.key)));assert.ok(first.items.every(i=>i.data.available==='30'));assert.ok(JSON.stringify(first).length<1024*1024);
 loaded.length=0;const discovery=await reader.discover({workspaceId:book.id,type:'resource',offset:24,limit:12});assert.equal(discovery.items.length,12);assert.equal(discovery.total,count);assert.deepEqual(loaded,[]);
 const next=await reader.page({workspaceId:book.id,type:'resource',scopeIds:[projectId],limit:7,cursor:first.nextCursor});assert.equal(next.offset,7);assert.ok(next.items.every(i=>!first.items.some(j=>j.key===i.key)));
 await assert.rejects(reader.page({workspaceId:book.id,type:'resource',scopeIds:[null],limit:7,cursor:first.nextCursor}),{code:'MODULE_QUERY_CURSOR'});
 loaded.length=0;const ledger=await reader.page({workspaceId:book.id,type:'stock-transfer',resourceId:resources[0].id,limit:7});assert.equal(ledger.total,1);assert.deepEqual(loaded,[transfers[0].id]);
 await assert.rejects(reader.stock({workspaceId:book.id,ids:resources.slice(0,26).map(i=>i.id)}),{code:'INVALID'});
 const controller=new AbortController();controller.abort();await assert.rejects(reader.stock({workspaceId:book.id,ids:[resources[0].id]},{signal:controller.signal}),{name:'AbortError'});
 assert.ok(stockMs<2500);assert.ok(pageMs<3000);assert.ok(process.memoryUsage().heapUsed<512*1024*1024);
 t.diagnostic(JSON.stringify({items:count,ledgerItems:count*2,stockMs:Math.round(stockMs),pageMs:Math.round(pageMs),pageBytes:Buffer.byteLength(JSON.stringify(first)),heapMiB:Math.round(process.memoryUsage().heapUsed/1024/1024)}));
});

test('inventory filter facts survive ordinary and fresh-key restore, support older heads, and fail closed on damage',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-inventory-facts-')),book=sampleNotebook(),f=await encryptedFixture(directory,book),now=new Date().toISOString();
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const entity=(type,data)=>({id:randomUUID(),type,revision:1,createdAt:now,updatedAt:now,data}),projectId=book.projects[0].id;
 const category=entity('category',{name:'Active category',description:'Private schema notes',archived:false,fields:[]}),archived=entity('category',{name:'Archived category',description:'',archived:true,fields:[]});
 const resource=entity('resource',{projectId:null,placementId:projectId,name:'Shared scope',code:'',kind:'object',description:'Private item',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'',capacity:1,status:'available',links:[]});
 const transfer=entity('asset-transfer',{resourceId:resource.id,fromProjectId:null,toProjectId:projectId,reason:'Original reason',links:[]});
 await seedModuleCurrent(f.workspace,book.id,[category,archived,resource,transfer]);
 const query={workspaceId:book.id,type:'category',archived:false},scope={workspaceId:book.id,type:'asset-transfer',moduleId:'resources',projectId},reader=new ModuleReader(f.workspace);
 const selected=ModuleCatalogue.prototype.selected,loaded=[];t.mock.method(ModuleCatalogue.prototype,'selected',async function(head,id){loaded.push(id);return selected.call(this,head,id);});
 assert.deepEqual((await reader.list(query)).items.map(i=>i.id),[category.id]);assert.deepEqual((await reader.list(scope)).items.map(i=>i.id),[transfer.id]);assert.deepEqual(loaded,[]);
 const backup=await copyWorkspace(await copyPlan(f.workspace.root,path.join(directory,'backup')),{vault:f.vault});
 const access=await createAccess('','Synthetic inventory restore key'),vault=takeCreatedVault(access);t.after(()=>clearVault(vault));
 const fresh=await encryptedCopy(await copyPlan(f.workspace.root,path.join(directory,'fresh')),access,vault,f.vault);
 for(const [root,key] of [[backup,f.vault],[fresh,vault]]){
  const workspace=new Workspace(root,key);await workspace.outline();const restored=new ModuleReader(workspace);loaded.length=0;
  assert.deepEqual((await restored.list(query)).items,(await reader.list(query)).items);assert.deepEqual((await restored.list(scope)).items,(await reader.list(scope)).items);assert.deepEqual(loaded,[]);
 }
 await moduleDomainStore(f.workspace,book.id,'inventory',async store=>{
  const {legacyModuleHead}=await import('./module-current-fixture.js'),head=await legacyModuleHead(store,book.id);for(const member of head.entities)delete member.inventoryHash;
  await store.db.run("UPDATE state SET payload=$1 WHERE slot='modules'",store.encode('state','modules',head));
 },{write:true});
 loaded.length=0;assert.equal((await reader.list(query)).total,1);assert.deepEqual(new Set(loaded),new Set([category.id,archived.id]));
 loaded.length=0;assert.equal((await reader.list(scope)).total,1);assert.deepEqual(loaded,[transfer.id]);
 const restored=new Workspace(backup,f.vault);
 await moduleDomainStore(restored,book.id,'inventory',async store=>{
  const catalogue=new ModuleCatalogue(store),head=await catalogue.head(book.id),slot='module-inventory:'+(await catalogue.member(head,category.id)).inventoryHash;
  await store.db.run('DELETE FROM state WHERE slot=$1',slot);
 },{write:true});
 await assert.rejects(new ModuleReader(restored).list(query),{code:'CATALOGUE_DAMAGED'});
});
