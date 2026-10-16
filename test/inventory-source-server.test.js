import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,result} from './task-prerequisite-fixture.js';
import path from 'node:path';
import {ProjectDomains} from '../src/project-domains.js';
import {InventoryOperationStore} from '../src/inventory-operation-store.js';
import {ProjectBookCopy} from '../src/project-book-copy.js';
import {ProjectDeletions} from '../src/project-deletion.js';
import {WorkspaceDeletions} from '../src/workspace-deletion.js';
import {workspaceDeletion} from '../src/workspace-delete-state.js';
import {ModuleCatalogue} from '../src/modules/catalogue.js';

const resource=(workspaceId,id,name,quantity,kind='material')=>({workspaceId,commandId:randomUUID(),action:'resource.create',payload:{id,data:{projectId:null,placementId:null,name,code:id,kind,description:'',categoryId:null,schemaRevision:null,fieldSchema:[],values:{},location:'',unit:'items',capacity:1,status:'available',links:[]},openingStock:{quantity,projectId:null}}});
test('BOM source previews preserve owner access and containing owner deletion honors nested obligations',{timeout:180000},async t=>{
 const f=await fixture(t),id=randomUUID(),equipment=randomUUID(),reference={workspaceId:f.a.namespaceId,type:'resource',id};
 await result(await f.call(f.own+'/modules/command',resource(f.a.namespaceId,id,'Source material','12.5')));
 await result(await f.call(f.other+'/modules/command',resource(f.b.namespaceId,id,'Independent material','77')));
 await result(await f.call(f.own+'/modules/command',resource(f.a.namespaceId,equipment,'Equipment','0','equipment')));
 const selected=ModuleCatalogue.prototype.selected;ModuleCatalogue.prototype.selected=()=>assert.fail('A stock preview read an authored original');
 try{
  for(const [route,workspaceId] of [['/api',f.initial.id],[f.base,f.project.namespaceId],[f.other,f.b.namespaceId]]){
   const value=await result(await f.call(route+'/modules/bom/stock',{workspaceId,reference,scopeIds:[null]}));
   assert.equal(value.reference.workspaceId,f.a.namespaceId);assert.equal(value.resource.data.name,'Source material');assert.equal(value.stock.locations[0].physical,'12.5');assert.equal(value.owner.labBookId,f.a.labBookId);assert.ok(value.placements.length<=25);assert.deepEqual(value.selectedPlacements,[value.placements[0]]);
  }
  const stock=await result(await f.call(f.other+'/modules/bom/stock',{workspaceId:f.b.namespaceId,reference:{...reference,workspaceId:f.b.namespaceId}}));assert.equal(stock.resource.data.name,'Independent material');assert.equal(stock.stock.locations[0].physical,'77');
  const query={workspaceId:f.b.namespaceId,sourceId:f.a.namespaceId,types:['resource'],query:'',cursor:null,limit:25};
  assert.equal((await result(await f.call(f.other+'/modules/references/query',query))).items.length,2);
  const filtered=await result(await f.call(f.other+'/modules/references/query',{...query,kind:'material'}));assert.deepEqual(filtered.items.map(item=>item.id),[id]);
  assert.notEqual((await f.call(f.other+'/modules/references/query',{...query,kind:'equipment'})).status,200);
  const batch=await result(await f.call(f.other+'/modules/bom/stock',{workspaceId:f.b.namespaceId,references:[reference],scopeIds:[null]}));assert.equal(batch.items.length,1);assert.deepEqual(batch.items[0].reference,reference);
  assert.notEqual((await f.call(f.other+'/modules/bom/stock',{workspaceId:f.b.namespaceId,reference:{...reference,id:equipment}})).status,200);
  assert.notEqual((await f.call(f.other+'/modules/bom/stock',{workspaceId:f.b.namespaceId,references:Array.from({length:26},()=>({...reference,id:randomUUID()}))})).status,200);
 }finally{ModuleCatalogue.prototype.selected=selected;}
 const second=await f.client();await result(await f.call(f.own+'/access/lock',{}));
 const locked=await result(await f.call(f.other+'/modules/bom/stock',{workspaceId:f.b.namespaceId,reference}),401);assert.equal(locked.labBookId,f.a.labBookId);assert.equal(JSON.stringify(locked).includes('Source material'),false);
 await result(await second(f.own+'/access/unlock',{}));assert.equal((await f.call(f.other+'/modules/bom/stock',{workspaceId:f.b.namespaceId,reference})).status,401);
 await result(await f.call(f.own+'/access/unlock',{}));assert.equal((await f.call(f.other+'/modules/bom/stock',{workspaceId:f.b.namespaceId,reference})).status,200);
 const domains=new ProjectDomains(f.selected,f.a.namespaceId);await domains.initialize(['inventory']);const obligationId=randomUUID();
 await domains.run(['inventory'],get=>new InventoryOperationStore(get('inventory')).write('live',obligationId,{version:1,id:obligationId}),{write:['inventory']});
 const withBook=async(parent,id,use)=>{assert.equal(parent.projectId,f.projectId);return use(id===f.a.labBookId?f.selected:f.sibling);},withProject=async(id,use)=>{assert.equal(id,f.projectId);return use(f.parent);};
 const copies=new ProjectBookCopy(f.parent);
 try{await assert.rejects(copies.prepare((id,use)=>withBook(f.parent,id,use)),{code:'INVENTORY_OBLIGATIONS'});}finally{copies.close();}
 await assert.rejects(new ProjectDeletions(f.registry,f.projectId).run(f.parent.vault,{id:randomUUID(),withBook}),{code:'INVENTORY_OBLIGATIONS'});
 const deletions=new WorkspaceDeletions(path.join(f.directory,'deletion-receipts')),review=await deletions.review(f.workspace,{});
 await assert.rejects(deletions.begin(f.workspace,review,{withProject,withBook}),{code:'INVENTORY_OBLIGATIONS'});
 for(const owner of [f.workspace,f.parent,f.selected,f.sibling]){assert.equal(await workspaceDeletion(owner.root),null);await owner.outline();}
 await domains.run(['inventory'],get=>new InventoryOperationStore(get('inventory')).remove('live',obligationId),{write:['inventory']});

});
