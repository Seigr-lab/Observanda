import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InventoryProjection} from '../src/modules/inventory-projection.js';
import {inventoryQuantities,inventoryScopeItems} from '../src/modules/inventory-query.js';
import {moduleConstraintSource} from '../src/modules/constraint-source.js';
import {moduleConstraint} from '../src/modules/constraints.js';
import {balance} from '../src/web/modules/quantities.js';

const entity=(type,data,id=randomUUID())=>({id,type,revision:1,data});
const resource=(projectId,kind='material')=>entity('resource',{projectId,placementId:projectId,kind,status:'available',name:'Material',unit:'items'});
async function fixture(values,workspaceId=randomUUID()){
 const state=new Map(),entities=new Map(values.map(value=>[value.id,value])),calls={nodes:0,values:0,scans:0,constraints:0};
 const store={encode:(_kind,_id,value)=>Buffer.from(JSON.stringify(value)),decode:(_kind,_id,value)=>JSON.parse(value),db:{
  async get(_sql,key){calls[key.startsWith('module-stock-value:')?'values':'nodes']++;return state.has(key)?{payload:state.get(key)}:null;},
  async run(sql,...values){if(sql.startsWith('INSERT INTO state ')){for(let i=0;i<values.length;i+=2)state.set(values[i],values[i+1]);}else if(sql.startsWith('DELETE FROM state ')){for(const key of values[0])state.delete(key);}else assert.fail('Unexpected SQL');}
 }};
 const catalogue={store,async *members(){calls.scans++;yield* entities.values();},async member(_head,id){return entities.get(id)??null;},async constraint(_head,member){calls.constraints++;return moduleConstraint(entities.get(member.id));}};
 const head={workspaceId,entities:[...entities.values()]},index=new InventoryProjection(catalogue);head.stockIndex={version:1,root:await index.prepare(head)};
 catalogue.stockProjection=()=>[{head,index:new InventoryProjection(catalogue)}];
 const context={head,book:{id:workspaceId},members:options=>catalogue.members(head,options),member:id=>catalogue.member(head,id),constraint:member=>catalogue.constraint(head,member),view:async member=>({title:member.data.name}),stockProjection:()=>catalogue.stockProjection()};
 const replace=async(after)=>{const before=entities.get(after.id);head.stockIndex.root=await new InventoryProjection(catalogue).replace(head.stockIndex.root,before?moduleConstraint(before):null,moduleConstraint(after),workspaceId);entities.set(after.id,after);};
 Object.assign(calls,{nodes:0,values:0,scans:0,constraints:0});return {state,entities,head,catalogue,context,index,calls,replace};
}
const normalize=map=>[...map.values()].map(item=>({...item,locations:[...item.locations].sort((a,b)=>String(a.projectId).localeCompare(String(b.projectId)))}));
async function compare(f,ids,scope=null){
 const expected=await inventoryQuantities({...f.context,stockProjection:undefined},ids,{scope}),actual=await inventoryQuantities(f.context,ids,{scope});assert.deepEqual(normalize(actual),normalize(expected));
 if(scope)assert.deepEqual([...await inventoryScopeItems(f.context,scope)].sort(),[...await inventoryScopeItems({...f.context,stockProjection:undefined},scope)].sort());
}

test('inventory projections match ledger quantities, zero placements and build deduplication across owner scopes',async()=>{
 const workspaceId=randomUUID(),p=randomUUID(),q=randomUUID(),r=resource(p),asset=resource(q,'equipment'),managed=randomUUID(),local=randomUUID(),line1=randomUUID(),line2=randomUUID(),line3=randomUUID();
 const settled=(projectId,used,scrapped)=>entity('reservation',{resourceId:r.id,projectId,quantity:'4',status:'settled',managed:{bom:{workspaceId,id:managed},settlement:{action:'finish',used,scrapped}}});
 const values=[r,asset,entity('movement',{resourceId:r.id,delta:'20.000000000000000001'}),entity('movement',{resourceId:r.id,projectId:q,delta:'0'}),entity('stock-transfer',{resourceId:r.id,fromProjectId:p,toProjectId:q,quantity:'3.5'}),entity('reservation',{resourceId:r.id,projectId:q,quantity:'1.25',status:'active'}),settled(p,'0.5','0.125'),settled(q,'0.75','0.25'),settled(q,'0.25','0'),entity('bom',{status:'finished',lines:[{id:line1,resourceId:r.id,sourceProjectId:p},{id:line2,resourceId:r.id,sourceProjectId:p},{id:line3,resourceId:{workspaceId:randomUUID(),id:r.id},sourceProjectId:p}],usage:[{lineId:line1,used:'1',scrapped:'0.1'},{lineId:line2,used:'2',scrapped:'0.2'},{lineId:line3,used:'99',scrapped:'0'}]},local)];
 const f=await fixture(values,workspaceId);for(const scope of [null,new Set([p]),new Set([q]),new Set([p,q]),new Set(),new Set([null])])await compare(f,[r.id,asset.id],scope);
 const usage=(await inventoryQuantities(f.context,[r.id])).get(r.id).usage;assert.deepEqual(usage,{used:'4.5',scrapped:'0.675',builds:2});
 await new InventoryProjection(f.catalogue).verify(f.head);
 // Releasing a reservation keeps its historical zero-balance placement.
 const held=values.find(value=>value.type==='reservation'&&value.data.status==='active');await f.replace({...held,revision:2,data:{...held.data,status:'released'}});
 await f.replace({...r,revision:2,data:{...r.data,projectId:q}});for(const scope of [null,new Set([p]),new Set([q])])await compare(f,[r.id,asset.id],scope);
 const bom=f.entities.get(local);await f.replace({...bom,revision:2,data:{...bom.data,status:'cancelled'}});await compare(f,[r.id]);await new InventoryProjection(f.catalogue).verify(f.head);
});

test('projected command balances preserve staged changes and legacy ownership',async()=>{
 const p=randomUUID(),q=randomUUID(),r=resource(p),movement=entity('movement',{resourceId:r.id,delta:'5'}),held=entity('reservation',{resourceId:r.id,projectId:q,quantity:'1.5',status:'active'}),f=await fixture([r,movement,held]);
 const changed=new Map([[movement.id,{...movement,revision:2,data:{...movement.data,delta:'7'}}],[held.id,{...held,revision:2,data:{...held.data,status:'released'}}]]);
 const source=moduleConstraintSource(f.catalogue,f.head,changed,{work:{get(){assert.fail('A projected command must not rebuild the full ledger');}}});
 for(const scope of [null,new Set([p]),new Set([q]),new Set([null])])assert.deepEqual(await source.balance(r.id,scope),balance([r,...changed.values()],r.id,scope));
 assert.equal(f.calls.scans,0);
});

for(const count of [1000,10000])test('selected stock reads do not traverse '+count+' unrelated movements',async t=>{
 const r=resource(null),unrelated=resource(null),values=[r,unrelated,entity('movement',{resourceId:r.id,projectId:null,delta:'12.5'})];
 for(let i=0;i<count;i++)values.push(entity('movement',{resourceId:unrelated.id,projectId:null,delta:'1'}));
 const f=await fixture(values),stock=await inventoryQuantities(f.context,[r.id]);assert.equal(stock.get(r.id).locations[0].physical,'12.5');assert.equal(f.calls.scans,0);assert.equal(f.calls.constraints,1);assert.equal(f.calls.values,1);
 t.diagnostic(JSON.stringify({unrelatedMovements:count,selectedResources:1,constraints:f.calls.constraints,projectionValues:f.calls.values,indexReads:f.calls.nodes}));
});

test('inventory projection fallback, cancellation and authenticated damage remain explicit',async()=>{
 const r=resource(null),f=await fixture([r,entity('movement',{resourceId:r.id,projectId:null,delta:'2'})]),controller=new AbortController(),reason=Error('cancel stock');controller.abort(reason);
 await assert.rejects(inventoryQuantities(f.context,[r.id],{signal:controller.signal}),error=>error===reason);
 const index=new InventoryProjection(f.catalogue);assert.equal(index.available({entities:[r]}),false);assert.equal(index.available({entities:[]}),true);
 const entry=await index.tree.find(f.head.stockIndex,'quantity:'+r.id+':-'),slot='module-stock-value:'+(await import('../src/storage-format.js')).digest(entry.id),original=f.state.get(slot),value=JSON.parse(original);value.value.physical='200';f.state.set(slot,Buffer.from(JSON.stringify(value)));
 await assert.rejects(inventoryQuantities(f.context,[r.id]),{code:'CATALOGUE_DAMAGED'});f.state.set(slot,original);f.state.delete('module-stock-index:'+f.head.stockIndex.root.key);
 await assert.rejects(inventoryQuantities(f.context,[r.id]),{code:'CATALOGUE_DAMAGED'});
});
