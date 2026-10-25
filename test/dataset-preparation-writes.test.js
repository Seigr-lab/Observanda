import {test} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {MaterialSequence} from '../src/material-sequence.js';
import {withDatasetPreparationWrites} from '../src/dataset-preparation-writes.js';
import {serialize} from '../src/storage-format.js';
function fixture(){const objects=new Map(),reads=new Map(),outsideReads=new Map(),batches=[];let current=null,fail=null,commit=0;const workspace={root:path.join(os.tmpdir(),'absent-dataset-batch-'+randomUUID()),readMetadata:async(key,limit)=>{reads.set(key,(reads.get(key)??0)+1);if(!current)outsideReads.set(key,(outsideReads.get(key)??0)+1);const raw=objects.get(key)??null;if(raw!==null&&Buffer.byteLength(raw)>limit)throw Object.assign(Error('Metadata limit'),{code:'LIMIT'});return raw;},writeMetadata:async(key,text)=>{assert.ok(current,'Writes require supplied authority');current.push({key,text});objects.set(key,text);}};const materials={workspace,sequences:new MaterialSequence(workspace),put:async(file,value)=>workspace.writeMetadata(file,JSON.stringify(value))};
 materials.relative=file=>file;
 const writePage=async fn=>{const before=new Map(objects);current=[];try{const result=await fn();commit++;batches.push(current);if(fail?.at===commit){if(!fail.durable){objects.clear();for(const row of before)objects.set(...row);}throw Error('Interrupted '+commit);}return result;}finally{current=null;}};return {materials,objects,reads,outsideReads,batches,writePage,setFail:value=>{fail=value;}};}
async function prepare(f,count=400,options={}){return withDatasetPreparationWrites(f.materials,{writePage:f.writePage,...options},async m=>{const b=m.sequences.builder('cells',fn=>fn());for(let i=0;i<count;i++)await b.append({kind:'string',value:'v'+i});return b.finish();});}
test('preparation batches bounded immutable children and commits the final root before returning',async()=>{const f=fixture(),ref=await prepare(f,2000);assert.equal(ref.count,2000);assert.ok(f.batches.length<100);for(const batch of f.batches){assert.ok(batch.length<=32);assert.ok(batch.reduce((n,r)=>n+Buffer.byteLength(r.text),0)<=256*1024);}assert.equal((await f.materials.sequences.item(ref,1999)).value,'v1999');const before=f.objects.size;assert.deepEqual(await prepare(f,2000),ref);assert.equal(f.objects.size,before);});
test('lost commit acknowledgement and rollback never return an unpublished root and retry exact content',async()=>{for(const durable of [false,true]){const f=fixture();f.setFail({at:2,durable});await assert.rejects(prepare(f),/Interrupted 2/);f.setFail(null);const ref=await prepare(f);assert.equal((await f.materials.sequences.item(ref,399)).value,'v399');}const f=fixture();f.setFail({at:1,durable:true});await assert.rejects(prepare(f,1),/Interrupted 1/);f.setFail(null);assert.equal((await prepare(f,1)).count,1);});
test('cancellation clears unsaved staging and oversized individual metadata writes directly',async()=>{const f=fixture(),controller=new AbortController();await assert.rejects(withDatasetPreparationWrites(f.materials,{writePage:f.writePage,signal:controller.signal},async m=>{await m.sequences.put('chunks',{kind:'cell-text',offset:0,items:['x']});controller.abort();}),{name:'AbortError'});assert.equal(f.objects.size,0);
 const value={kind:'cell-text',offset:0,items:Array.from({length:16},()=> 'x'.repeat(16384))};assert.ok(Buffer.byteLength(serialize(value))>256*1024);const id=await withDatasetPreparationWrites(f.materials,{writePage:f.writePage},m=>m.sequences.put('chunks',value));assert.equal(f.batches.length,1);assert.equal(f.batches[0].length,1);assert.deepEqual(await f.materials.sequences.read('chunks',id),value);});

const sequenceFile=(kind,id)=>'.observanda/materials/sequences/'+kind+'/'+id+'.json';
const seed=(f,kind,value)=>f.writePage(()=>f.materials.sequences.put(kind,value));
test('repeated schema reads remain bounded after row writes evict the initial staging cache',async()=>{
 const f=fixture(),columns=Array.from({length:4},(_,i)=>({name:'Column '+i,representation:'text'}));
 const schema=await f.writePage(async()=>{const builder=f.materials.sequences.builder('columns',fn=>fn());for(const column of columns)await builder.append(column);return builder.finish();}),schemaFiles=[...f.objects.keys()];f.reads.clear();
 await withDatasetPreparationWrites(f.materials,{writePage:f.writePage},async m=>{
  for(let i=0;i<80;i++)await m.sequences.put('chunks',{kind:'cells',offset:i,items:[{kind:'string',value:String(i)}]});
  for(let i=80;i<240;i++){assert.deepEqual((await m.sequences.page(schema)).items,columns);await m.sequences.put('chunks',{kind:'cells',offset:i,items:[{kind:'string',value:String(i)}]});}
 });
 for(const file of schemaFiles)assert.equal(f.reads.get(file),1,'A reused schema is authenticated once within this preparation');
});
test('read cache evicts by count and bytes while hits retain their recency without growing its accounting',async()=>{
 const f=fixture(),values=Array.from({length:65},(_,i)=>({index:i})),ids=[];for(const value of values)ids.push(await seed(f,'chunks',value));f.reads.clear();
 await withDatasetPreparationWrites(f.materials,{writePage:f.writePage},async m=>{
  for(let i=0;i<64;i++)assert.deepEqual(await m.sequences.read('chunks',ids[i]),values[i]);
  await m.sequences.read('chunks',ids[0]);await m.sequences.read('chunks',ids[64]);await m.sequences.read('chunks',ids[0]);
  assert.equal(f.reads.get(sequenceFile('chunks',ids[0])),1);await m.sequences.read('chunks',ids[1]);assert.equal(f.reads.get(sequenceFile('chunks',ids[1])),2);
 });
 const large=Array.from({length:3},(_,i)=>({index:i,text:'x'.repeat(100*1024)})),largeIds=[];for(const value of large)largeIds.push(await seed(f,'chunks',value));
 const oversized={text:'x'.repeat(256*1024)},oversizedId=await seed(f,'chunks',oversized);f.reads.clear();
 await withDatasetPreparationWrites(f.materials,{writePage:f.writePage},async m=>{
  await m.sequences.read('chunks',largeIds[0]);await m.sequences.read('chunks',largeIds[1]);
  for(let i=0;i<100;i++)await m.sequences.read('chunks',largeIds[0]);
  await m.sequences.read('chunks',largeIds[1]);assert.equal(f.reads.get(sequenceFile('chunks',largeIds[1])),1);
  await m.sequences.read('chunks',largeIds[2]);await m.sequences.read('chunks',largeIds[0]);assert.equal(f.reads.get(sequenceFile('chunks',largeIds[0])),2);
  for(let i=0;i<2;i++)assert.deepEqual(await m.sequences.read('chunks',oversizedId),oversized);assert.equal(f.reads.get(sequenceFile('chunks',oversizedId)),2);
 });
});
test('cached reads preserve authenticated identities, namespaces, limits and caller isolation',async()=>{
 const f=fixture(),value={items:['retained schema']},other={items:['another schema']},id=await seed(f,'chunks',value),otherId=await seed(f,'chunks',other);await seed(f,'nodes',value);f.reads.clear();
 await withDatasetPreparationWrites(f.materials,{writePage:f.writePage},async m=>{
  const first=await m.sequences.read('chunks',id);first.items[0]='caller edit';
  const again=await m.sequences.read('chunks',id);assert.deepEqual(again,value);again.items.push('another edit');assert.deepEqual(await m.sequences.read('chunks',id),value);
  await assert.rejects(m.sequences.read('chunks',id,1),{code:'LIMIT'});
  assert.deepEqual(await m.sequences.read('nodes',id),value);assert.deepEqual(await m.sequences.read('chunks',otherId),other);
  assert.equal(f.reads.get(sequenceFile('chunks',id)),1);assert.equal(f.reads.get(sequenceFile('nodes',id)),1);assert.equal(f.reads.get(sequenceFile('chunks',otherId)),1);
 });
 const file=sequenceFile('chunks',id),original=f.objects.get(file);f.objects.set(file,serialize(other));
 await withDatasetPreparationWrites(f.materials,{writePage:f.writePage},async m=>{
  await assert.rejects(m.sequences.read('chunks',id),{code:'MATERIAL_MISSING'});f.objects.set(file,original);assert.deepEqual(await m.sequences.read('chunks',id),value);
  const absent='0'.repeat(64);assert.equal(await m.sequences.read('chunks',absent),null);assert.equal(await m.sequences.read('chunks',absent),null);assert.equal(f.reads.get(sequenceFile('chunks',absent)),2);
 });
});
test('reading an existing immutable value never substitutes for retaining it through writer authority',async()=>{
 const f=fixture(),value={items:['existing child']},id=await seed(f,'chunks',value),before=f.batches.length;
 await withDatasetPreparationWrites(f.materials,{writePage:f.writePage},async m=>{
  assert.deepEqual(await m.sequences.read('chunks',id),value);assert.equal(await m.sequences.put('chunks',value),id);assert.equal(await m.sequences.put('chunks',value),id);
 });
 assert.equal(f.batches.length,before+1,'An authenticated read still requires the supplied retaining transaction');assert.equal(f.objects.size,1);
});
test('pending children precede storage and cancellation stops both cached and in-flight reads',async()=>{
 const f=fixture(),value={items:['stored']},id=await seed(f,'chunks',value),controller=new AbortController();f.reads.clear();
 await assert.rejects(withDatasetPreparationWrites(f.materials,{writePage:f.writePage,signal:controller.signal},async m=>{
  await m.sequences.read('chunks',id);const pending={items:['pending']},pendingId=await m.sequences.put('chunks',pending);
  assert.equal(f.objects.has(sequenceFile('chunks',pendingId)),false);assert.deepEqual(await m.sequences.read('chunks',pendingId),pending);assert.equal(f.reads.has(sequenceFile('chunks',pendingId)),false);
  controller.abort();await assert.rejects(m.sequences.read('chunks',id),{name:'AbortError'});await assert.rejects(m.sequences.read('chunks',pendingId),{name:'AbortError'});
 }),{name:'AbortError'});
 assert.equal(f.objects.size,1);
 const interrupted=new AbortController(),read=f.materials.sequences.read.bind(f.materials.sequences);
 f.materials.sequences.read=async(...args)=>{const result=await read(...args);interrupted.abort();return result;};
 await assert.rejects(withDatasetPreparationWrites(f.materials,{writePage:f.writePage,signal:interrupted.signal},m=>m.sequences.read('chunks',id)),{name:'AbortError'});
 f.materials.sequences.read=read;assert.deepEqual(await withDatasetPreparationWrites(f.materials,{writePage:f.writePage},m=>m.sequences.read('chunks',id)),value);
});
test('cached fallback reads do not conceal a failed final flush or survive a retry',async()=>{
 for(const durable of [false,true]){
  const f=fixture(),value={items:['schema']},id=await seed(f,'chunks',value),pending={items:['new row']};let pendingId;f.reads.clear();f.setFail({at:2,durable});
  await assert.rejects(withDatasetPreparationWrites(f.materials,{writePage:f.writePage},async m=>{assert.deepEqual(await m.sequences.read('chunks',id),value);pendingId=await m.sequences.put('chunks',pending);return pendingId;}),/Interrupted 2/);
  assert.equal(f.objects.has(sequenceFile('chunks',pendingId)),durable);f.setFail(null);
  const repeated=await withDatasetPreparationWrites(f.materials,{writePage:f.writePage},async m=>{assert.deepEqual(await m.sequences.read('chunks',id),value);return m.sequences.put('chunks',pending);});
  assert.equal(repeated,pendingId);assert.equal(f.reads.get(sequenceFile('chunks',id)),2);assert.deepEqual(await f.materials.sequences.read('chunks',pendingId),pending);
 }
});

test('new row cell nodes authenticate once inside bounded writer batches without preflight transactions',async()=>{
 const f=fixture();let last;
 await withDatasetPreparationWrites(f.materials,{writePage:f.writePage},async m=>{
  for(let row=0;row<40;row++){const builder=m.sequences.builder('cells',fn=>fn());for(let column=0;column<4;column++)await builder.append({kind:'string',value:String(column),pointer:'/'+row+'/'+column});last=await builder.finish();}
  return last;
 });
 const nodes=[...f.objects.keys()].filter(key=>key.includes('/nodes/'));assert.equal(nodes.length,40);assert.equal(f.outsideReads.size,0);
 for(const key of nodes)assert.equal(f.reads.get(key),1,'Final writer still authenticates each generated node');assert.ok(f.batches.every(batch=>batch.length<=32));assert.equal((await f.materials.sequences.item(last,3)).pointer,'/39/3');
 const normal=fixture(),builder=normal.materials.sequences.builder('cells',normal.writePage);await builder.append({kind:'string',value:'ordinary'});const ref=await builder.finish();assert.equal(normal.reads.get(sequenceFile('nodes',ref.root.hash)),2,'Ordinary sequence owners retain the default preflight');
});

test('deferred node checks reject corrupt existing chunks and nodes before returning any prepared root',async()=>{
 for(const kind of ['chunks','nodes']){
  const f=fixture(),ref=await prepare(f,1),nodeFile=sequenceFile('nodes',ref.root.hash),node=JSON.parse(f.objects.get(nodeFile)),file=kind==='nodes'?nodeFile:sequenceFile('chunks',node.revision),original=f.objects.get(file),corrupt=serialize({corrupted:true});
  f.objects.set(file,corrupt);f.reads.clear();f.outsideReads.clear();let published=false;
  await assert.rejects(prepare(f,1).then(value=>{published=true;return value;}),{code:'MATERIAL_MISSING'});
  assert.equal(published,false);assert.equal(f.objects.get(file),corrupt,'Authentication must fail instead of replacing existing bytes');assert.equal(f.reads.get(file),1);assert.equal(f.outsideReads.size,0,'Existing bytes are checked by the supplied writer');
  f.objects.set(file,original);assert.deepEqual(await prepare(f,1),ref);assert.equal((await f.materials.sequences.item(ref,0)).value,'v0');
 }
});

test('deferred node authentication preserves the 8 KiB raw admission limit even when parsed hashes match',async()=>{
 const f=fixture(),ref=await prepare(f,1),file=sequenceFile('nodes',ref.root.hash),original=f.objects.get(file),padded=original+' '.repeat(8193-Buffer.byteLength(original));
 assert.deepEqual(JSON.parse(padded),JSON.parse(original));assert.equal(Buffer.byteLength(padded),8193);f.objects.set(file,padded);f.reads.clear();f.outsideReads.clear();let published=false;
 await assert.rejects(prepare(f,1).then(value=>{published=true;return value;}),{code:'LIMIT'});
 assert.equal(published,false);assert.equal(f.objects.get(file),padded);assert.equal(f.reads.get(file),1);assert.equal(f.outsideReads.size,0);
 f.objects.set(file,original+' '.repeat(8192-Buffer.byteLength(original)));assert.deepEqual(await prepare(f,1),ref);assert.equal((await f.materials.sequences.item(ref,0)).value,'v0');
});
