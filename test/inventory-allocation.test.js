import {assertPrivateCatalogue} from './postgres-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../src/storage.js';
import {createNotebook} from '../src/model.js';
import {workspaceModules} from '../src/modules/index.js';
import {balance} from '../src/web/modules/quantities.js';
import {inventoryItems,inventoryQuantity,assetPlacement} from '../src/web/modules/inventory-model.js';
import {registerResources} from '../src/web/modules/operations-data.js';
import {InventoryReader} from '../src/modules/inventory-reader.js';

const details=(overrides={})=>({projectId:null,placementId:null,name:'Apples',code:'APP',kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'apples',capacity:1,status:'available',links:[],...overrides});
async function setup(){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-allocations-')),book=createNotebook('Seigr'),a=randomUUID(),b=randomUUID(),nested=randomUUID();
 book.projects=[{id:a,title:'Studio',parentId:null,kind:'Wing',description:'',share:false,logoId:null,tools:['resources']},{id:b,title:'Field work',parentId:null,kind:'Wing',description:'',share:false,logoId:null,tools:['resources']},{id:nested,title:'Garden',parentId:b,kind:'Project',description:'',share:false,logoId:null,tools:['resources']}];
 const vault={id:randomUUID(),key:Buffer.alloc(32,7)},ws=new Workspace(root,vault);await ws.create(book);
 const store=workspaceModules(ws),cmd=(action,payload,commandId=randomUUID())=>store.execute({workspaceId:book.id,commandId,action,payload});
 const get=async id=>(await store.read()).entities.find(e=>e.id===id);
 const create=async(data=details(),quantity='100',projectId=null)=>{const id=randomUUID();await cmd('resource.create',{id,data,openingStock:{quantity,projectId}});return id;};
 const transfer=async(id,from,to,quantity)=>cmd('stock.transfer',{resourceId:id,expectedRevision:(await get(id)).revision,fromProjectId:from,toProjectId:to,quantity,reason:'Allocation',links:[]});
 return {book,a,b,nested,root,ws,vault,store,cmd,get,create,transfer};
}
test('workspace inventory distributes 100 apples without duplication and branch consumption reduces the shared total',async()=>{
 const s=await setup(),id=await s.create();
 await s.transfer(id,null,s.a,'40');await s.transfer(id,null,s.b,'35');
 let entities=(await s.store.read()).entities;
 assert.deepEqual(balance(entities,id),{physical:'100',reserved:'0',available:'100'});
 assert.equal(inventoryQuantity(s.book,entities,id,null,false).physical,'25');
 assert.equal(inventoryQuantity(s.book,entities,id,s.a).physical,'40');
 assert.equal(inventoryQuantity(s.book,entities,id,s.b).physical,'35');
 assert.equal(entities.filter(e=>e.type==='resource').length,1);
 assert.equal((await s.get(id)).data.projectId,null);
 await s.cmd('stock.move',{resourceId:id,expectedRevision:(await s.get(id)).revision,projectId:s.a,delta:'-5',reason:'Used',links:[]});
 entities=(await s.store.read()).entities;
 assert.equal(balance(entities,id).physical,'95');
 assert.equal(inventoryQuantity(s.book,entities,id,s.a).physical,'35');
 assert.equal(inventoryQuantity(s.book,entities,id,s.b).physical,'35');
 assert.equal((await s.ws.read()).book.entries.length,0);
 await assertPrivateCatalogue(s.root,'Apples');
 assert.equal(balance((await workspaceModules(new Workspace(s.root,s.vault)).read()).entities,id).physical,'95');
});
test('local reservations and atomic transfers prevent overdraw, stale writes and duplicate retries',async()=>{
 const s=await setup(),id=await s.create();await s.transfer(id,null,s.a,'40');
 await s.cmd('stock.reserve',{resourceId:id,expectedRevision:(await s.get(id)).revision,projectId:s.a,quantity:'30',reason:'Planned work',links:[]});
 let before=await s.store.read();
 await assert.rejects(s.transfer(id,s.a,s.b,'11'),{code:'STOCK_UNAVAILABLE'});
 assert.deepEqual(await s.store.read(),before);
 const revision=(await s.get(id)).revision,request={resourceId:id,expectedRevision:revision,fromProjectId:s.a,toProjectId:s.b,quantity:'10',reason:'Move spare stock',links:[]},commandId=randomUUID();
 await s.cmd('stock.transfer',request,commandId);await s.cmd('stock.transfer',request,commandId);
 assert.equal(inventoryQuantity(s.book,(await s.store.read()).entities,id,s.b).physical,'10');
 await assert.rejects(s.cmd('stock.transfer',{...request,toProjectId:null}),{code:'MODULE_CHANGED'});
 const reservation=(await s.store.read()).entities.find(e=>e.type==='reservation');
 await s.cmd('stock.resolve',{id:reservation.id,expectedRevision:reservation.revision,decision:'consume'});
 const entities=(await s.store.read()).entities;
 assert.equal(balance(entities,id).physical,'70');assert.equal(inventoryQuantity(s.book,entities,id,s.a).physical,'0');
 assert.equal(inventoryQuantity(s.book,entities,id,s.b).physical,'10');
 assert.equal(inventoryItems(s.book,entities,s.a).filter(e=>e.type==='resource').length,1,'Keep zero-stock items visible for their ledger history');
});
test('invalid opening stock or transfers create no partial item or ledger entries',async()=>{
 const s=await setup(),before=await s.store.read();
 await assert.rejects(s.create(details(),'-1'));assert.deepEqual(await s.store.read(),before);
 const id=await s.create(),current=await s.store.read();
 for(const [from,to,quantity] of [[null,s.a,'101'],[null,null,'1'],[null,randomUUID(),'1'],[null,s.a,'0']]){
  await assert.rejects(s.transfer(id,from,to,quantity));assert.deepEqual(await s.store.read(),current);
 }
 const r=await s.get(id);
 await assert.rejects(s.cmd('resource.save',{id,expectedRevision:r.revision,data:{...r.data,projectId:s.a}}));
 assert.deepEqual(await s.store.read(),current);
});
test('fractional allocations, descendants and dashboard totals derive from the same ledger even when a project view is disabled',async()=>{
 const s=await setup(),id=await s.create(details({name:'Solder',unit:'g'}),'1.25');
 await s.transfer(id,null,s.nested,'0.2');
 const entities=(await s.store.read()).entities,providers=[];registerResources({register:p=>providers.push(p)});
 const provider=providers.find(p=>p.id==='resources');
 const reader=new InventoryReader(s.ws),read=async(options={})=>provider.items({book:s.book},await provider.load({context:{book:s.book},options,api:(path,command)=>reader.page(command)}));
 assert.equal((await read())[0].data.physical,'1.25');
 assert.equal((await read({projectId:s.b}))[0].data.physical,'0.2');
 assert.equal(inventoryItems(s.book,entities,s.a).filter(e=>e.type==='resource').length,0);
 assert.equal(inventoryQuantity(s.book,entities,id,s.b,false).physical,'0');
 s.book.projects.find(p=>p.id===s.nested).tools=[];
 assert.equal((await read())[0].data.physical,'1.25');
 s.book.projects.find(p=>p.id===s.nested).parentId=s.a;
 assert.equal(inventoryQuantity(s.book,entities,id,s.a).physical,'0.2');assert.equal(inventoryQuantity(s.book,entities,id,s.b).physical,'0');
});
test('individual equipment changes placement without changing ownership; software licences use allocated stock',async()=>{
 const s=await setup(),id=await s.create(details({name:'Synthesizer',kind:'equipment',unit:'',code:'SYN'}),'0');
 const r=await s.get(id);
 await s.cmd('resource.assign',{resourceId:id,expectedRevision:r.revision,toProjectId:s.a,reason:'Studio session',links:[]});
 const moved=await s.get(id);assert.equal(moved.data.projectId,null);assert.equal(assetPlacement(moved),s.a);
 assert.equal(inventoryItems(s.book,(await s.store.read()).entities,s.a).filter(e=>e.type==='resource').length,1);
 await assert.rejects(s.cmd('resource.save',{id,expectedRevision:moved.revision,data:{...moved.data,placementId:s.b}}));
 const software=await s.create(details({name:'Audio software licences',code:'LIC',kind:'software',unit:'licences'}),'3');
 await s.transfer(software,null,s.a,'2');
 const entities=(await s.store.read()).entities;
 assert.equal(balance(entities,software).physical,'3');assert.equal(inventoryQuantity(s.book,entities,software,s.a).physical,'2');
});
test('old unlocated stock keeps its original owner placement and gains explicit locations on new transactions',async()=>{
 const s=await setup(),id=randomUUID(),data=details({projectId:s.a});delete data.placementId;
 await s.cmd('resource.save',{id,expectedRevision:null,data});
 await s.cmd('stock.move',{resourceId:id,expectedRevision:1,delta:'12',reason:'Existing opening',links:[]});
 const original=(await s.store.read()).entities;
 // Old format movements omit a location. Pure projections preserve their meaning.
 const legacy=structuredClone(original);delete legacy.find(e=>e.type==='movement').data.projectId;
 assert.deepEqual(balance(original,id),balance(legacy,id));
 assert.equal(inventoryQuantity(s.book,legacy,id,s.a).physical,'12');
 await s.transfer(id,s.a,s.b,'4');
 const entities=(await s.store.read()).entities;
 assert.equal(inventoryQuantity(s.book,entities,id,s.a).physical,'8');assert.equal(inventoryQuantity(s.book,entities,id,s.b).physical,'4');
});

test('1000 workspace posters stay entirely central when every project enables its inventory view',async()=>{
 const s=await setup();
 s.book.projects.forEach(p=>{p.tools=[];});
 s.book=(await s.ws.save(s.book,(await s.ws.read()).etag)).book;
 const id=await s.create(details({name:'Posters',unit:'posters'}),'1000'),before=await s.store.read();
 for(const p of s.book.projects)p.tools=['resources'];
 s.book=(await s.ws.save(s.book,(await s.ws.read()).etag)).book;
 const after=await s.store.read();
 assert.deepEqual(after,before,'Enabling a project tool must not write inventory transactions');
 assert.equal(balance(after.entities,id).physical,'1000');
 assert.equal(inventoryQuantity(s.book,after.entities,id,null,false).physical,'1000');
 for(const p of s.book.projects){
  assert.equal(inventoryQuantity(s.book,after.entities,id,p.id).physical,'0');
  assert.equal(inventoryItems(s.book,after.entities,p.id).filter(e=>e.type==='resource').length,0);
 }
 assert.equal(after.entities.filter(e=>e.type==='resource').length,1);
});

test('workspace inventory can be created and received without any projects or lab books',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-central-')),book=createNotebook('Independent artist'),ws=new Workspace(root);
 await ws.create(book);const store=workspaceModules(ws),id=randomUUID();
 await store.execute({workspaceId:book.id,commandId:randomUUID(),action:'resource.create',payload:{id,data:details({name:'Strings',unit:'sets'}),openingStock:{quantity:'12',projectId:null}}});
 assert.deepEqual(balance((await store.read()).entities,id),{physical:'12',reserved:'0',available:'12'});
 const saved=(await ws.read()).book;assert.equal(saved.projects.length,0);assert.equal(saved.notebooks.length,0);assert.equal(saved.entries.length,0);
});
