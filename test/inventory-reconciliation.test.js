import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {InventoryProjection} from '../src/modules/inventory-projection.js';
import {InventoryReconciliation,validateInventoryCheckpoint} from '../src/modules/inventory-reconciliation.js';
import {digest} from '../src/storage-format.js';

const entity=(type,data)=>({id:randomUUID(),type,revision:1,data});
async function fixture(movements=200){
 const owner=randomUUID(),resource=entity('resource',{kind:'material',projectId:null,status:'available'}),values=[resource,...Array.from({length:movements},()=>entity('movement',{resourceId:resource.id,projectId:null,delta:'1'}))],rows=new Map(),metadata=new Map(),counts={selected:0,heads:0,rawHeads:0,slices:0};
 const store={encode:(_table,_id,value)=>Buffer.from(JSON.stringify(value)),decode:(_table,_id,value)=>JSON.parse(value),db:{
  async get(_sql,key){if(key==='modules')counts.rawHeads++;return rows.has(key)?{payload:rows.get(key)}:null;},
  async run(sql,...args){if(sql.startsWith('INSERT INTO state ')){for(let i=0;i<args.length;i+=2)rows.set(args[i],args[i+1]);}else if(sql.startsWith('DELETE FROM state ')){for(const key of args[0])rows.delete(key);}else assert.fail('Unexpected SQL');}
 }};
 const entities=new Map(values.map(value=>[value.id,value])),head={workspaceId:owner,revision:values.length,memberVersion:1,root:{count:values.length}},catalogue={store,head:async()=>{counts.heads++;return structuredClone(head);},async *members(){yield* values;},constraint:async(_head,member)=>member,selected:async(_head,id)=>{counts.selected++;return entities.get(id);},membersIndex:{tree:{entryAt:async(_head,at)=>values[at]},decode:async(_head,value)=>value}};
 head.stockIndex={version:1,root:await new InventoryProjection(catalogue).prepare(head)};const saveHead=()=>rows.set('modules',Buffer.from(JSON.stringify(head)));saveHead();
 const workspace={async readMetadata(file,limit){const value=metadata.get(file)??null;if(value!==null)assert.ok(Buffer.byteLength(value)<=limit);return value;},async writeMetadata(file,value){metadata.set(file,value);},async removeMetadata(file){metadata.delete(file);},async metadataPage(prefix,{limit}){const entries=[...metadata].filter(([name])=>name.startsWith(prefix+'/')).sort(([a],[b])=>a.localeCompare(b)),items=entries.slice(0,limit).map(([name,text])=>({name:name.slice(prefix.length+1),text}));return {items,next:entries.length>limit?items.at(-1).name:null};}};
 const sources=async(_workspace,operation)=>operation([{domain:'inventory',namespaceId:owner,catalogue}],owner),job={id:randomUUID(),scope:owner,attempt:1},make=(options={})=>new InventoryReconciliation(workspace,job,{sources,...options});
 const write=async operation=>{const previous=new Map(metadata);try{const result=await operation();counts.slices++;return result;}catch(error){metadata.clear();for(const [key,value] of previous)metadata.set(key,value);throw error;}};
 return {head,values,entities,rows,metadata,counts,workspace,job,make,write,saveHead,catalogue};
}
test('inventory reconciliation resumes from a durable slice after cancellation and a new worker',{timeout:30000},async()=>{
 const f=await fixture(),controller=new AbortController();let slices=0;
 await assert.rejects(f.make({batch:10}).prepare({signal:controller.signal,write:async operation=>{const result=await f.write(operation);if(++slices===5)controller.abort(Error('Pause fixture'));return result;}}),/Pause fixture/);
 const saved=await f.make().read();assert.equal(saved.read,40);assert.equal(saved.phase,'build');const previousReads=f.counts.selected;f.job.attempt++;
 const prepared=await f.make({batch:10}).prepare({write:f.write}),result=await f.make().commit(prepared);assert.equal(result.verified,true);assert.equal(result.members,201);assert.equal(f.counts.selected-previousReads,161);assert.equal(f.counts.heads,2);assert.equal([...f.metadata].filter(([name])=>name.includes('/values/')).length,0);
});
test('inventory reconciliation resumes a large entity at its contribution cursor',async()=>{
 const f=await fixture(0),resource=f.values[0],bom=entity('bom',{status:'finished',lines:[],usage:[]});for(let i=0;i<300;i++){const id=randomUUID();bom.data.lines.push({id,resourceId:resource.id,sourceProjectId:null});bom.data.usage.push({lineId:id,used:'0.1',scrapped:'0'});}f.values.push(bom);f.entities.set(bom.id,bom);f.head.root.count++;f.head.revision++;
 f.head.stockIndex.root=await new InventoryProjection(f.catalogue).replace(f.head.stockIndex.root,null,bom,f.job.scope);f.saveHead();const controller=new AbortController();
 await assert.rejects(f.make({contributions:32}).prepare({signal:controller.signal,write:async operation=>{const result=await f.write(operation),saved=await f.make().read();if(saved.offset)controller.abort(Error('Pause contribution'));return result;}}),/Pause contribution/);
 assert.equal((await f.make().read()).offset,31);f.job.attempt++;const prepared=await f.make({contributions:32}).prepare({write:f.write});assert.equal((await f.make().commit(prepared)).verified,true);assert.equal(prepared.members,2);assert.equal(f.counts.selected,3,'The resumed large original is read once, not once per contribution page');
});
test('inventory reconciliation stops after bounded source-change restarts and retains stale progress',async()=>{
 const f=await fixture(10);await assert.rejects(f.make({batch:2}).prepare({write:async operation=>{const result=await f.write(operation);const state=await f.make().read();if(state.phase==='build'){f.head.revision++;f.saveHead();}return result;}}),{code:'CONFLICT'});
 const state=await f.make().read();assert.equal(state.phase,'stale');assert.equal(state.reset,3);assert.ok(state.previous);f.job.attempt++;
 const prepared=await f.make().prepare({write:f.write});assert.equal((await f.make().commit(prepared)).verified,true);
});
test('inventory reconciliation catches changed or missing projection values and stale final receipts',async()=>{
 const f=await fixture(8),original=f.rows.get('module-stock-value:'+digest('quantity:'+f.values[0].id+':-'));f.rows.delete('module-stock-value:'+digest('quantity:'+f.values[0].id+':-'));
 await assert.rejects(f.make().prepare({write:f.write}),{code:'CATALOGUE_DAMAGED'});f.rows.set('module-stock-value:'+digest('quantity:'+f.values[0].id+':-'),original);f.job.attempt++;
 const prepared=await f.make().prepare({write:f.write});f.head.revision++;f.saveHead();await assert.rejects(f.make().commit(prepared),{code:'CONFLICT'});
 const rebuilt=await f.make().prepare({write:f.write});assert.equal((await f.make().commit(rebuilt)).verified,true);
});
test('inventory checkpoint parsing rejects another owner or malformed cursor',async()=>{
 const f=await fixture(0),state=await f.write(()=>f.make().initialize());assert.throws(()=>validateInventoryCheckpoint(state,f.job.id,randomUUID()),{code:'JOB_DAMAGED'});
 for(const change of [{offset:-1},{member:2},{read:2},{checked:100},{member:1,offset:1},{phase:'ready'},{previous:{read:0,checked:0,unexpected:true}}])assert.throws(()=>validateInventoryCheckpoint({...state,...change},f.job.id,f.job.scope),{code:'JOB_DAMAGED'});
});
test('an owner without inventory domains completes without inventing ledger work',async()=>{
 const f=await fixture(0),make=()=>new InventoryReconciliation(f.workspace,f.job,{sources:async(_workspace,operation)=>operation([],f.job.scope)}),prepared=await make().prepare({write:f.write});assert.equal(prepared.members,0);assert.equal(prepared.rows,0);assert.equal((await make().commit(prepared)).verified,true);
});
for(const movements of [1000,10000])test('inventory maintenance performs bounded slices for '+movements+' retained ledger entries',{timeout:120000},async t=>{
 const f=await fixture(movements);let turns=0;const prepared=await f.make().prepare({write:async operation=>{turns++;return f.write(operation);}});await f.make().commit(prepared);
 assert.equal(f.counts.selected,movements+1);assert.equal(f.counts.heads,2);assert.ok(turns>=Math.ceil((movements+1)/32));t.diagnostic(JSON.stringify({movements,selectedOriginals:f.counts.selected,fullHeadAdmissions:f.counts.heads,sourceChecks:f.counts.rawHeads,committedSlices:turns,accumulatorRows:prepared.rows}));
});
