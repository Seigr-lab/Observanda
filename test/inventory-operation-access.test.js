import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture} from './project-tree-fixture.js';
import {ProjectApplication,projectRequest} from '../src/project-application.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
import {LabBookAccessSession} from '../src/lab-book-access-session.js';
import {ProjectModuleCommands} from '../src/project-module-commands.js';
import {ProjectDomains} from '../src/project-domains.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';
import {inventoryOperationAccessFactory} from '../src/inventory-operation-access.js';
import {assertInventoryObligationsSettled} from '../src/inventory-obligation-lifecycle.js';
import {blankBOM,bomLine} from '../src/web/modules/bom-model.js';

const command=(owner,action,payload)=>({workspaceId:owner.namespaceId,commandId:randomUUID(),action,payload});
const resource=id=>({projectId:null,placementId:null,name:'Selected material',code:id,kind:'material',description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]});

test('inventory participant checks preserve previous and current grants inside a real selected owner callback',{timeout:180000},async t=>{
 const f=await projectTreeFixture(t),app=new ProjectApplication(f.workspace,{deviceStore:f.deviceStore}),client={},adapters=[];
 t.after(async()=>{for(const adapter of adapters)await adapter.close();await app.close();});
 const call=(book,action,data={})=>app.run(client,projectRequest('/api/projects/'+book.projectId+'/lab-books/'+book.labBookId+'/access/'+action,'POST'),data);
 const owners=[];
 for(const book of f.books){
  await new LabBookDirectory(f.registry).register(book.projectId,book);
  await app.unlock(client,book.projectId,{});await call(book,'unlock',{password:'Protected observations 456!'});
  const storage=new LabBookStorage(book.root,book.labBookId,book.key),commands=new ProjectModuleCommands(storage,book.namespaceId);await commands.initialize();owners.push({...book,storage,commands});
 }
 const [host,source]=owners,sourceAccess=inventoryOperationAccessFactory(app,client,{scope:host.projectId,labBookId:host.labBookId}),options={inventorySourceAccess:sourceAccess},resourceId=randomUUID();
 for(const owner of owners)await owner.commands.execute(command(owner,'resource.create',{id:resourceId,data:resource(resourceId),openingStock:{quantity:'10',projectId:null}}));
 const bomId=randomUUID(),foreign={workspaceId:source.namespaceId,type:'resource',id:resourceId},lines=[{...bomLine(),resourceId,value:'Local part',quantity:'2'},{...bomLine(),resourceId:foreign,value:'Foreign part',quantity:'3'}];
 await host.commands.execute(command(host,'bom.save',{id:bomId,expectedRevision:null,data:{...blankBOM(),title:'Selected owner build',recordId:host.before.book.entries[0].id,lines}}),options);
 const reserve=command(host,'bom.reserve',{id:bomId,expectedRevision:1,resources:[{id:resourceId,revision:1},{id:foreign,revision:1}]}),reserved=await host.commands.execute(reserve,options);
 assert.equal(reserved.operationPending,undefined,JSON.stringify(reserved.operation));assert.equal(reserved.entities[0].data.status,'reserved');assert.equal(reserved.entities[0].data.allocations.length,2);
 const finish=command(host,'bom.finish',{id:bomId,expectedRevision:2,usage:lines.map(line=>({lineId:line.id,used:'0.5',scrapped:'0.25'}))}),finished=await host.commands.execute(finish,options);
 assert.equal(finished.operationPending,undefined,JSON.stringify(finished.operation));assert.equal(finished.entities[0].data.status,'finished');assert.equal((await host.commands.execute(finish,options)).replayed,true);
 for(const allocation of finished.entities[0].data.allocations){
  const owner=owners.find(item=>item.namespaceId===allocation.workspaceId),held=await new ProjectDomains(owner.storage,owner.namespaceId).run(['inventory'],async get=>{const catalogue=new ModuleCatalogue(get('inventory'));return catalogue.selected(await catalogue.head(owner.namespaceId),allocation.reservationId);});
  assert.equal(held.revision,2);assert.deepEqual([held.data.managed.settlement.used,held.data.managed.settlement.scrapped],['0.5','0.25']);
 }
 for(const owner of owners)await assertInventoryObligationsSettled(owner.storage);
 // The verifier inside the current callback still checks a previous owner,
 // although that owner's selected connection and operation key have closed.
 const adapter=await inventoryOperationAccessFactory(app,client)(f.registry.workspaceId);adapters.push(adapter);
 await adapter.useOwner(host.namespaceId,()=>{});
 await adapter.useOwner(source.namespaceId,async(_storage,_owner,{check})=>{
  await adapter.verify();await check();await call(host,'lock');
  await assert.rejects(adapter.verify(),error=>error.code==='ACCESS_LOCKED'&&error.labBookId===host.labBookId);
 });
 await assert.rejects(adapter.verify(),error=>error.code==='ACCESS_LOCKED'&&error.labBookId===host.labBookId);await adapter.close();
 // A current grant revoked during the callback must also stop its result.
 const current=await inventoryOperationAccessFactory(app,client)(f.registry.workspaceId);adapters.push(current);let locking;
 try{await assert.rejects(current.useOwner(source.namespaceId,async()=>{
  const parent=f.projects.find(item=>item.projectId===source.projectId),storage=new ProjectStorage(parent.root,parent.projectId,parent.key);
  locking=new LabBookAccessSession(app,client,storage,source.labBookId,async()=>{}).lock();locking.catch(()=>{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.session(client).get('book:'+source.projectId+':'+source.labBookId).locked,true);
  await current.verify();assert.fail('A revoked current grant returned a result');
 }),error=>error.code==='ACCESS_LOCKED'&&error.labBookId===source.labBookId);}finally{await locking;await current.close();}
});
