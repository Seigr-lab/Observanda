import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,calculation,calendar} from './project-domain-fixture.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {ProjectModuleQueries} from '../src/project-module-queries.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {blankBOM,bomLine} from '../src/web/modules/bom-model.js';
async function setup(t){const f=await fixture(t);f.commands=new ProjectModuleCommands(f.storage,f.book.id);await f.commands.initialize();f.queries=new ProjectModuleQueries(f.storage,f.book.id);f.cmd=(action,payload)=>f.commands.execute({workspaceId:f.book.id,commandId:randomUUID(),action,payload});return f;}

test('planning pages use only their declared parent facts and retain cursors across unrelated writes', {timeout:120000},async t=>{
 const f=await setup(t),a=calendar(f);a.payload.data.projectId=null;await f.commands.execute(a);const ids=[];
 for(let i=0;i<3;i++){const id=randomUUID();ids.push(id);await f.cmd('event.save',{id,expectedRevision:null,data:{title:'Event '+i,calendarId:a.payload.id,startsAt:'2026-10-01',endsAt:'2026-10-02',allDay:true,timeZone:'UTC',location:'',notes:'Only selected event notes',status:'confirmed'}});}
 const selected=ModuleCatalogue.prototype.selected,head=ModuleCatalogue.prototype.head,originals=[];
 t.mock.method(ModuleCatalogue.prototype,'head',async function(...args){assert.equal(this.store.domain,'calendars');return head.apply(this,args);});
 t.mock.method(ModuleCatalogue.prototype,'selected',async function(h,id){originals.push(id);return selected.call(this,h,id);});
 const query={workspaceId:f.book.id,type:'event',limit:1},first=await f.queries.run('planning','page',query);assert.deepEqual(first.items.map(i=>i.key),[ids[0]]);assert.deepEqual(originals,[ids[0]]);assert.deepEqual(first.revisions,{calendars:4});t.mock.restoreAll();
 await f.commands.execute(calculation(f));
 const next=await f.queries.run('planning','page',{...query,cursor:first.nextCursor});assert.equal(next.revision,first.revision);assert.equal(next.items[0].key,ids[1]);
 const discovery=await f.queries.run('planning','discover',{workspaceId:f.book.id,type:'event'});assert.equal(discovery.total,3);
 await f.commands.execute({...a,commandId:randomUUID(),payload:{...a.payload,expectedRevision:1,data:{...a.payload.data,name:'Changed calendar'}}});
 await assert.rejects(f.queries.run('planning','page',{...query,cursor:first.nextCursor}),{code:'MODULE_QUERY_CURSOR'});
});

test('inventory stock and ledger queries include BOM ownership without reading unrelated domains', {timeout:120000},async t=>{
 const f=await setup(t),id=randomUUID(),bomId=randomUUID();await f.cmd('resource.create',{id,data:{projectId:null,placementId:null,name:'Parts',code:id,kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]},openingStock:{quantity:'10',projectId:null}});
 await f.cmd('bom.save',{id:bomId,expectedRevision:null,data:{...blankBOM(),title:'Build',recordId:f.book.entries[0].id,lines:[{...bomLine(),resourceId:id,value:'Resistor',quantity:'2'}]}});
 await f.cmd('bom.reserve',{id:bomId,expectedRevision:1,resources:[{id,revision:1}]});
 const head=ModuleCatalogue.prototype.head;t.mock.method(ModuleCatalogue.prototype,'head',async function(...args){assert.ok(['inventory','bom'].includes(this.store.domain));return head.apply(this,args);});
 const db=await f.storage.openCatalogue();try{await db.run('BEGIN');await db.lock();
  const stock=await f.queries.run('inventory','stock',{workspaceId:f.book.id,ids:[id]});assert.equal(stock.items[0].locations[0].available,'8');assert.deepEqual(stock.revisions,{bom:2,inventory:2});
  const page=await f.queries.run('inventory','page',{workspaceId:f.book.id,type:'resource'});assert.equal(page.items[0].key,id);assert.equal(page.items[0].data.available,'8');
  const ledger=await f.queries.run('inventory','ledger',{workspaceId:f.book.id,resourceId:id,kind:'reservations'});assert.equal(ledger.items.length,1);assert.equal(ledger.items[0].data.quantity,'2');
 }finally{await db.close();t.mock.restoreAll();}
 await assert.rejects(f.queries.run('inventory','stock',{workspaceId:randomUUID(),ids:[id]}),{code:'WORKSPACE_CHANGED'});
});
